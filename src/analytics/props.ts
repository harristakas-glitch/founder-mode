// What is allowed to leave the browser, expressed as data rather than as discipline.
//
// THE PROBLEM THIS SOLVES. The game contains free text the player authored: the company name (the
// start screen and the lobby row), the multiplayer chat box, the room code, and the Field Guide's
// search field. It also renders a display name that arrives from an OAuth provider. None of that
// is anybody's business but the player's, and the usual way it ends up on an analytics vendor's
// servers is not a decision — it is a `capture('x', { ...state })` written a year later by
// somebody who did not know.
//
// So the control is a POSITIVE ALLOWLIST OF PROPERTY NAMES, applied to every event on the way out,
// with no escape hatch. `company`, `companyName`, `name`, `display_name`, `message`, `code` and
// `query` are not on it and cannot be added by accident — adding one is a diff in this file, in
// this list, under this comment. A spread of game state through `capture()` therefore arrives at
// PostHog as the handful of fields below and nothing else.
//
// A second, independent control bounds the VALUES: a string property must look like an
// identifier — short, no spaces, no punctuation beyond `_.:+-`, no control or bidi characters.
// "Hyperloop for Cats, Inc." fails that on the space alone. Neither control needs the other to be
// correct, which is the point: the leaderboard shipped three controls that each assumed the other
// half worked (docs/security-review-2026-08.md), and this is the cheap version of not doing that.
//
// Everything here is pure and takes no DOM — test/analytics.test.ts asserts against these
// functions directly rather than against a mocked-out vendor SDK.

/**
 * Every property name any event in this module may carry. Alphabetical, one line each, with the
 * question it serves. Nothing outside this set survives `sanitizeEventProperties`.
 */
export const ANALYTICS_PROPERTIES = new Set<string>([
  'bytes', // journal upload: payload size
  'career', // is this a Career run (detailed PMF) — segments beginners vs returning players
  'cash', // simulation output, rounded dollars
  'concept', // onboarding: which founder's note was delivered (a catalogue id)
  'consent', // 'granted' | 'denied' — recorded only on the grant path, see events.ts
  'employees', // simulation output
  'ending', // Q2: which ending was reached
  'entries', // journal upload: number of journal entries
  'feature', // design: which system the player actually touched (a fixed vocabulary)
  'first_open', // Q1: is this the first time this browser has opened the game
  'first_run', // design: is this the player's first ever run — "what do beginners pick"
  'format', // Q2: standard | daily_challenge | scenario
  'founder', // design: which founder archetype
  'mode', // Q2: quick | career | arena
  'notes_enabled', // onboarding: did they switch the notes layer off
  'ok', // journal upload: did it land
  'pivots', // simulation output
  'pmf', // simulation output, 0-100
  'reason', // journal upload / abandonment: why this event fired
  'revenue', // simulation output, rounded dollars per week
  'runs_finished_before', // Q4: retention proxy that works WITHOUT a persistent id
  'runs_started_before', // Q4: same
  'scenario', // design: which scenario, when one is chosen
  'score', // Q2: founder payout at the end
  'screen', // Q3/design: where the player was standing — the abandonment coordinate
  'sector', // Q2/design: which sector
  'stage', // simulation output: Pre-seed…
  'standalone', // Q1: installed as a PWA, or a browser tab
  'tokenised', // design: did they ever launch a token
  'trigger', // run_suspended: what ended the session (tab hidden, page unload)
  'users', // simulation output
  'verified', // replay verdict of the finished run
  'week', // Q3: THE playing-time metric — weeks advanced, not wall clock
  'weeks', // Q3: weeks at the moment a run ended or was abandoned
])

/**
 * The shape a string property value must have. Deliberately narrower than "a safe string": these
 * are enum members, screen ids and catalogue ids, every one of which is an identifier the code
 * chose — never something a person typed.
 */
const IDENTIFIER = /^[A-Za-z0-9_.:+-]{1,48}$/

/** Numbers are bounded so a runaway simulation value cannot become an unreadable property. */
const MAX_NUMBER = 1e15

export type PropValue = string | number | boolean
export type EventProps = Record<string, PropValue | null | undefined>

/**
 * The one function every capture goes through. Returns a NEW object containing only allowlisted
 * keys holding values of a permitted shape. Never throws — an event with a bad property is sent
 * without it, because losing one field beats losing the event and beats crashing the game.
 */
export function sanitizeEventProperties(props: EventProps | undefined): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  if (!props || typeof props !== 'object') return out
  for (const [k, v] of Object.entries(props)) {
    if (!ANALYTICS_PROPERTIES.has(k)) continue
    if (typeof v === 'boolean') {
      out[k] = v
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue
      out[k] = Math.round(Math.max(-MAX_NUMBER, Math.min(MAX_NUMBER, v)))
    } else if (typeof v === 'string') {
      if (IDENTIFIER.test(v)) out[k] = v
    }
    // null, undefined, objects, arrays, functions: dropped. There is no event that needs one,
    // and a nested object is how a whole GameState ends up on a vendor's disk.
  }
  return out
}

/**
 * PostHog's OWN properties, scrubbed on the way out (wired as `sanitize_properties` in client.ts).
 *
 * This runs over the finished property bag — the one that also carries `$lib`, `$session_id`,
 * `distinct_id` and friends — so it is a scrubber, NOT an allowlist. Dropping unknown keys here
 * would break the SDK's own bookkeeping; the allowlist above is applied earlier, to our half.
 *
 * The only thing it changes: URL-shaped properties lose their query string and fragment. The game
 * has no routing and puts nothing in the URL, but `$referrer` is whatever site linked here and
 * that one is genuinely outside our control — a referrer carrying `?email=…` is a real shape of
 * accident, and the referring DOMAIN is the whole of what question 1 ("where do visitors come
 * from") actually needs.
 */
const URL_PROPERTIES = new Set([
  '$current_url',
  '$referrer',
  '$initial_current_url',
  '$initial_referrer',
  '$pathname',
  '$initial_pathname',
])

export function scrubUrlProperties(properties: Record<string, unknown>): Record<string, unknown> {
  if (!properties || typeof properties !== 'object') return properties
  const out: Record<string, unknown> = { ...properties }
  for (const key of URL_PROPERTIES) {
    const v = out[key]
    if (typeof v !== 'string' || v.length === 0) continue
    out[key] = stripUrlDetail(v)
  }
  return out
}

/** `https://host/path?q=secret#frag` → `https://host/path`. Anything unparseable is cut at the ?. */
export function stripUrlDetail(raw: string): string {
  try {
    const u = new URL(raw)
    // An opaque-origin scheme (`android-app:`, `capacitor:`, a custom PWA wrapper) parses fine but
    // reports its origin as the literal string "null", so rebuilding from it would replace a real
    // referrer with the word "null" and quietly destroy the answer to "where do visitors come
    // from". Those fall through to the textual cut below, which is correct for any scheme.
    if (u.origin && u.origin !== 'null') return `${u.origin}${u.pathname}`
  } catch {
    // not a URL at all
  }
  return raw.split(/[?#]/)[0]
}
