// The PostHog client: lazily constructed, consent-aware, and unable to reach the network until
// somebody has replaced the placeholder key in ./config.ts.
//
// LAZY, AND FOR A MEASURED REASON. The entry chunk was deliberately cut by splitting
// @supabase/supabase-js out of it (src/net/online.ts, src/net/leaderboard.ts) and the canvas share
// card out of it (src/shareImage.ts). posthog-js is comparable in size to the Supabase client, and
// a player who arrives, plays one run and leaves has no reason to download an analytics SDK before
// the game is on screen. So it is a dynamic `import()` behind a memoised promise, and — copied
// verbatim from the two modules above, because the bug it prevents is real — A FAILED CHUNK LOAD
// CLEARS THE MEMO so the next attempt retries instead of caching the failure forever. That case is
// not hypothetical here: the game is a PWA, it launches offline, and the analytics chunk is not in
// the service worker's precache.
//
// WHICH BUILD, AND WHY THE DEEP IMPORT. `posthog-js/dist/module.slim.no-external` rather than
// `posthog-js`. src/csp.ts ships `script-src 'self'` and test/csp.test.ts fails the build if that
// ever widens, so an SDK that lazy-loads its own extensions from a CDN at runtime would be a
// feature that silently half-works: session replay, surveys and the toolbar would each try a
// <script> from a third-party origin and each be refused by the browser. The `no-external` build
// contains no script-injection path AT ALL — `createElement('script')` does not appear in it —
// which turns "we configured it not to" into "it cannot", the same distinction this codebase draws
// everywhere else. `disable_external_dependency_loading` is set below as well; neither depends on
// the other being right. The `slim` half drops session replay, autocapture and surveys, none of
// which this module wants, and halves the chunk.
//
// NOTHING HERE THROWS INTO THE GAME. Every entry point is best-effort. Analytics is decoration on
// top of a game, exactly as the leaderboard is, and a vendor outage must never be visible to a
// player mid-run.

import type { PostHog } from 'posthog-js/dist/module.slim.no-external'
import { POSTHOG_HOST, POSTHOG_KEY, analyticsConfigured } from './config'
import { collectionEnabled, consentGranted, subscribe } from './consent'
import { sanitizeEventProperties, scrubUrlProperties, type EventProps, type PropValue } from './props'

let clientPromise: Promise<PostHog> | null = null

/**
 * The single decision: may anything at all happen right now?
 *
 * Checked on EVERY capture, not once at startup. That is what makes "revoking stops collection
 * immediately" a property of the code rather than a claim in a document — the moment the consent
 * record flips to 'denied' the next capture returns here, before the promise is touched.
 */
export function analyticsActive(): boolean {
  return analyticsConfigured && collectionEnabled()
}

/**
 * Two personalities, one library.
 *
 *   anonymous (consent 'unset') — `persistence: 'memory'` writes NOTHING to the device: no cookie,
 *     no localStorage, no sessionStorage. The distinct id posthog generates lives in a variable
 *     and dies with the tab. `person_profiles: 'never'` stamps `$process_person_profile: false` on
 *     every event, so ingestion builds no profile to attach anything to. The cost is honest and
 *     worth stating: PostHog's "unique users" in this mode counts APP OPENS, not people.
 *
 *   consented (consent 'granted') — persistence moves to localStorage+cookie and person profiles
 *     come on. That is the whole of what consent buys, and it is the only thing that makes the
 *     retention question answerable.
 *
 * NOT USED, ON PURPOSE: the leaderboard's `founder-mode-player-id`. It exists because a player
 * opted into a leaderboard; reusing it to key analytics would silently repurpose an identifier the
 * player agreed to for something else, which is precisely the move that makes a privacy claim
 * untrue. PostHog mints its own id and the two never meet.
 *
 * Exported so test/analytics.test.ts can assert the mapping directly. Without that, "no persistent
 * identifier before consent" would only be checkable by running the real SDK in a real browser,
 * which this suite cannot do — and an untestable privacy claim is the kind that turns out to be
 * false eighteen months later.
 */
export function modeConfig(): { persistence: 'memory' | 'localStorage+cookie'; person_profiles: 'never' | 'always' } {
  return consentGranted()
    ? { persistence: 'localStorage+cookie', person_profiles: 'always' }
    : { persistence: 'memory', person_profiles: 'never' }
}

function getClient(): Promise<PostHog> | null {
  if (!analyticsActive()) return null
  // A non-browser host (the test runner, a future SSR pass) has no place to put an analytics SDK.
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (!clientPromise) {
    clientPromise = import('posthog-js/dist/module.slim.no-external').then(
      ({ posthog }) => {
        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          // Pins the SDK's own defaults so a posthog-js upgrade cannot switch a behaviour on
          // underneath us — which for an analytics library means "start collecting something new".
          defaults: '2025-05-24',

          // THE BRIEF'S RULE, and the right one: this is a game, not a form. Autocapture would
          // record every click and keystroke target in the interface, which is noise, quota and —
          // the part that matters — the one mechanism that could carry a typed company name out
          // of the browser without anybody deciding it should.
          autocapture: false,
          capture_pageview: false, // one screen, no routing; `app_opened` says it better
          capture_pageleave: false, // `run_suspended` carries the week, which is the useful half
          disable_session_recording: true,
          disable_surveys: true,
          disable_web_experiments: true,
          capture_performance: false,
          enable_heatmaps: false,
          // Belt to the `no-external` build's braces: no third-party <script>, ever.
          disable_external_dependency_loading: true,
          // No feature flags are used, so no flag request is made. One fewer round trip, and one
          // fewer way for a vendor response to influence what the client does.
          advanced_disable_flags: true,
          // Honour a browser that has already said no. Free to respect, and the alternative is
          // asking a player who set the header a question they have already answered.
          respect_dnt: true,
          // Only meaningful for replay/autocapture, both off. Kept so that switching either on by
          // accident fails closed rather than open.
          mask_all_text: true,
          sanitize_properties: scrubUrlProperties,
          ...modeConfig(),
        })
        return posthog
      },
      (e) => {
        clientPromise = null // failed chunk load retries next call instead of caching the failure
        throw e
      },
    )
  }
  return clientPromise
}

/** Run something against the client if — and only if — there is allowed to be one. */
function withClient(fn: (ph: PostHog) => void): void {
  let p: Promise<PostHog> | null = null
  try {
    p = getClient()
  } catch {
    return
  }
  if (!p) return
  void p.then(fn).catch(() => {
    // offline, blocked by an extension, a vendor 500: none of it is the player's problem
  })
}

/**
 * Send one named event. THE ONLY WAY ANYTHING LEAVES THIS MODULE.
 *
 * Properties pass through `sanitizeEventProperties` first, so a caller that hands over a whole
 * game state ships the handful of allowlisted fields and nothing else. Callers should not reach
 * for this directly — ./events.ts exposes a named, typed function per event, so no string literal
 * is ever written at a call site and the event list is a list rather than a grep.
 *
 * RETURNS WHAT IT SENT, and that is not a convenience — it is what makes the privacy claim
 * testable. Every event function hands this bag back to its caller, so test/analytics.test.ts can
 * invoke the real `runStarted`/`runEnded`/… with hostile input and assert on the exact properties
 * that would have gone out, with no mocked-out vendor, no injected sink and no test-only code path
 * that might not be the one production uses. The sanitising happens whether or not anything is
 * active, so the answer is the same in both cases.
 */
export function capture(event: string, props?: EventProps, options?: { beacon?: boolean }): Record<string, PropValue> {
  const safe = sanitizeEventProperties(props)
  withClient((ph) => {
    ph.capture(
      event,
      safe,
      // A page being torn down has no time for a queued XHR. sendBeacon survives the unload,
      // which is the difference between measuring where players quit and measuring where players
      // who politely closed the tab from the results screen quit.
      options?.beacon ? { transport: 'sendBeacon' } : undefined,
    )
  })
  return safe
}

/**
 * Has a vendor client ever been constructed in this page?
 *
 * Exported for test/analytics.test.ts, which uses it to assert the strongest form of the inertness
 * property: with the placeholder key in place, no number of captures causes the dynamic
 * `import('posthog-js')` to be reached at all — the SDK is not merely silent, it is not present.
 */
export function clientConstructed(): boolean {
  return clientPromise !== null
}

/**
 * React to a consent change without the UI having to remember to tell us.
 *
 * Registering the subscription at module scope is safe: `subscribe` only adds a function to a Set,
 * touches no storage and imports no vendor code, so this file stays inert until something actually
 * captures.
 */
subscribe(() => {
  // Nothing has been constructed yet: the next capture will pick the right personality at init,
  // and if consent is now 'denied' there will never be a next capture.
  if (!clientPromise) return
  const granted = consentGranted()
  const stillAllowed = analyticsActive()
  const p = clientPromise
  void p
    .then((ph) => {
      if (!stillAllowed) {
        // Revocation, in the order that leaves the least behind: clear the stored id while the
        // store that holds it is still addressable, move persistence into memory so nothing is
        // written again, then tell the SDK to stop. `analyticsActive()` has ALREADY stopped every
        // future capture on its own — this is cleanup, not the control.
        ph.reset()
        ph.set_config({ persistence: 'memory', person_profiles: 'never' })
        ph.opt_out_capturing()
        return
      }
      ph.set_config(modeConfig())
      if (granted) ph.opt_in_capturing()
    })
    .catch(() => {})
})
