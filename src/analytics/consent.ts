// Analytics consent: three states, one localStorage key, and no relationship to the game save.
//
// WHY THIS FILE EXISTS AT ALL, in one paragraph, because "we added a consent banner" is the kind
// of claim that is usually decoration:
//
//   Retention — "do players come back and start another run" — is the one question that cannot be
//   answered without a PERSISTENT IDENTIFIER. Every other question here can be answered from
//   anonymous, unlinked events. In the EU, storing an identifier on the player's device for
//   analytics needs consent; sending anonymous events that store nothing does not. So the layer
//   has two personalities, and this file is the switch between them:
//
//     'unset'   — the default. Events are sent with NOTHING written to disk: posthog runs on
//                 memory-only persistence with person profiles off, so the id it uses dies with
//                 the tab and no profile is ever built. This is what makes abandonment measurable
//                 at all — a player who quits in week 3 is never asked anything, and if the
//                 default were silence we would only ever measure the survivors.
//     'granted' — the player said yes. A persistent anonymous id is kept, so runs can be linked
//                 across days and retention becomes real. Run journals may be uploaded.
//     'denied'  — the player said no, or switched it off later. NOTHING is collected: no events,
//                 no id, no upload. `capture()` returns before it constructs a client.
//
// THREE RULES THIS FILE ENFORCES, mirroring src/onboarding/progress.ts on purpose — that module
// solved exactly this problem for the onboarding ledger and there is no reason to solve it twice:
//
//   1. ITS OWN KEY. Never inside `founder-mode-save`. Clearing your game does not silently
//      re-consent you, and exporting a save does not carry a consent record with it.
//   2. IT TOLERATES GARBAGE. The value is user-writable text. Anything malformed degrades to
//      'unset' — the most private of the three states — never to a crash and never to 'granted'.
//   3. ABSENCE IS NOT CONSENT. Only the exact string 'granted' grants. A missing key, a corrupt
//      key, an empty string, a truthy object: all of them are 'unset'.
//
// NOTHING ASKS. The shipped build has no consent prompt: the player is never interrupted, the
// default is the anonymous middle state, and the only control is the tick box in the Field Guide
// footer (src/analytics/PrivacyControls.tsx), which moves between 'unset' and 'denied'.
//
// 'granted' is therefore UNREACHABLE in the current interface. It is kept, with its tests, because
// it is exactly what the deferred run-journal upload (BACKLOG.md) would need, and because deleting
// a working state machine to re-derive it in six months is how the leaderboard ended up with six
// SQL scripts. `shouldAskConsent`/`markAsked` are the hooks a future prompt would use; nothing
// calls them today and that is not a bug.

import { useSyncExternalStore } from 'react'

const KEY = 'fm-analytics-consent-v1'

export type ConsentState = 'unset' | 'granted' | 'denied'

export interface ConsentRecord {
  v: 1
  state: ConsentState
  /** Epoch ms the player answered, or 0. Informational — the state is what decides anything. */
  at: number
  /**
   * Epoch ms we put the question to them, or 0. Non-zero means NEVER ASK AGAIN, whatever they
   * did with the prompt. Closing a consent prompt without answering is an answer: it means "stop
   * asking me". The Field Guide footer is always there for anyone who changes their mind.
   */
  askedAt: number
}

const BLANK: ConsentRecord = { v: 1, state: 'unset', at: 0, askedAt: 0 }

const stamp = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Every field re-validated on read. An unrecognised state is 'unset', never 'granted'. */
export function sanitizeConsent(v: unknown): ConsentRecord {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...BLANK }
  const o = v as Record<string, unknown>
  // A whitelist, not a cast: `state: 'GRANTED'`, `state: true` and `state: {}` are all 'unset'.
  const state: ConsentState = o.state === 'granted' ? 'granted' : o.state === 'denied' ? 'denied' : 'unset'
  return { v: 1, state, at: stamp(o.at), askedAt: stamp(o.askedAt) }
}

let cache: ConsentRecord | null = null

export function readConsent(): ConsentRecord {
  if (cache) return cache
  try {
    cache = sanitizeConsent(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    // No storage at all (private mode, storage disabled, a non-browser test runner): the most
    // private state is the right failure, and it means nothing is ever persisted either.
    cache = { ...BLANK }
  }
  return cache
}

export const consentState = (): ConsentState => readConsent().state

/**
 * The one predicate the rest of the layer asks. False means: send nothing, construct nothing,
 * import nothing. It is checked on EVERY capture rather than once at startup, which is what makes
 * "revoking stops collection immediately" true rather than true-after-a-reload.
 */
export const collectionEnabled = (): boolean => consentState() !== 'denied'

/** True only in the state where a persistent identifier and a journal upload are permitted. */
export const consentGranted = (): boolean => consentState() === 'granted'

/** True while the player has neither been asked nor answered — i.e. the prompt is still owed. */
export const shouldAskConsent = (): boolean => {
  const c = readConsent()
  return c.state === 'unset' && c.askedAt === 0
}

// ---------- subscription ----------
//
// Same shape as src/onboarding/progress.ts: React reads this through useSyncExternalStore, and
// src/analytics/client.ts subscribes so that a revocation reaches posthog without the UI having
// to remember to tell it.

const listeners = new Set<() => void>()

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The value identity useSyncExternalStore compares. Replaced on every write. */
export function snapshot(): ConsentRecord {
  return readConsent()
}

function commit(next: ConsentRecord) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Quota, private mode, storage disabled. The choice still holds for this session; it just
    // does not survive a reload, which fails towards 'unset' — the private direction.
  }
  for (const fn of listeners) fn()
}

/**
 * Record the player's answer. `true` is the ONLY thing that grants.
 *
 * Answering also marks the question as asked, so the prompt cannot come back after a "no".
 */
export function setConsent(granted: boolean): void {
  const now = Date.now()
  commit({ v: 1, state: granted ? 'granted' : 'denied', at: now, askedAt: readConsent().askedAt || now })
}

/**
 * Back to the anonymous default: collection continues, nothing is kept on the device.
 *
 * This is the middle rung of the Field Guide's two switches, and it is a real state rather than a
 * synonym for "off" — a player who wants the game measured but does not want to be remembered has
 * asked for something coherent, and 'unset' is exactly it. `askedAt` is preserved so that walking
 * back down the ladder cannot make the prompt reappear.
 */
export function setAnonymousConsent(): void {
  const c = readConsent()
  commit({ v: 1, state: 'unset', at: Date.now(), askedAt: c.askedAt || Date.now() })
}

/** The prompt was shown. Recorded separately from the answer so a dismissal is also final. */
export function markAsked(): void {
  const c = readConsent()
  if (c.askedAt !== 0) return
  commit({ ...c, askedAt: Date.now() })
}

/** Test hook only: drop the memoised record so a fresh read hits storage again. */
export function resetConsentCache(): void {
  cache = null
}

/**
 * Re-render on consent changes. Lives here rather than in a component file because the prompt that
 * used to own it is gone: the shipped model asks nothing on arrival, so the only consumer is the
 * off switch in the Field Guide.
 */
export function useConsent(): ConsentRecord {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
