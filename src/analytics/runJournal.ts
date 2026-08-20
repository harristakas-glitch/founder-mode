// Uploading the run journal — the part no analytics vendor can give us.
//
// Founder Mode is deterministic, and src/game/replay.ts already records a complete, replayable
// action journal for every solo run: the config plus the ordered log of what the player did is
// enough to rebuild the run exactly, week by week. A finished 90-week run is about 4 KB of it.
//
// PostHog can answer the questions we thought to ask. A journal answers the ones we did not: it
// can be replayed later against any metric that gets invented afterwards — where founders run out
// of cash, whether anyone finds the Discovery loop, what the median week-20 state looks like for a
// player who quits versus one who finishes — without having to have instrumented any of it in
// advance. That is worth more than the event stream, and it is the thing that is genuinely ours.
//
// ---------------------------------------------------------------------------------------------
// THIS IS A NEW ATTACK SURFACE ON A CODEBASE THAT WAS JUST HARDENED.
// ---------------------------------------------------------------------------------------------
// docs/security-review-2026-08.md sets the standard, and §10 of supabase/leaderboard-v6.sql
// literally wrote the warning for this feature before it existed: "IF YOU ADD THE REPLAY-PROOF
// COLUMNS, BOUND THEM FIRST — journal jsonb writable by anon with no size limit is a storage DoS."
// So:
//
//   * the table is INSERT-ONLY for anon and authenticated: no select, no update, no delete, and
//     the grant is COLUMN-LEVEL so a client cannot even name `id` or `created_at`;
//   * the size cap is enforced on BOTH sides, and the client's ceiling is `JOURNAL_LIMIT` —
//     the same constant `recordJournal` and `sanitizeJournal` already use, not a second number
//     invented here that could drift away from the first;
//   * a payload over the byte cap is DROPPED rather than truncated, because a truncated journal
//     replays to a desync and would read as tampering;
//   * every scalar is bounded and every string is shape-checked before it is sent, and again by
//     the CHECK constraints in supabase/run-journals-v1.sql, which is a separate script from
//     leaderboard-v6.sql on purpose — that one is a single clean thing the owner has not yet run.
//
// AND THE COMPANY NAME NEVER GOES. `ReplayHeader` carries it because `replayRun` passes it to
// `newGame`, but the name is cosmetic: it appears in inbox prose and nowhere else in the
// simulation, so replacing it with a fixed placeholder produces a byte-identical replay. That is
// not an assumption — test/analytics.test.ts replays a real run under both names and asserts the
// fingerprints match, which is also a canary: if the name ever starts feeding an outcome, the test
// goes red instead of the redaction silently breaking verification.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, onlineConfigured } from '../net/config'
import { JOURNAL_LIMIT, headerOf, sanitizeJournal, stateFingerprint, verifyRun, type JournalEntry } from '../game/replay'
import type { GameState } from '../game/types'
import { MAX_JOURNAL_BYTES, RUN_JOURNAL_TABLE, analyticsConfigured } from './config'
import { consentGranted } from './consent'
import type { RunStopReason } from './events'

/** What replaces the player's company name in the uploaded header. Never a hash of it — a hash of
 *  a 24-character name from a small population is not anonymous, it is a lookup table away. */
export const REDACTED_COMPANY = 'redacted'

/**
 * No string inside a journal payload should be longer than this. Every payload the registry in
 * src/game/replay.ts writes today is an index, a number, an enum member or a generated id, so this
 * is slack. It is here as a TRIPWIRE for the day somebody adds an action carrying something the
 * player typed: the upload refuses rather than shipping it, and says so via `run_journal_uploaded`
 * with `ok: false`, so the failure is visible instead of silent.
 */
const MAX_PAYLOAD_STRING = 96

export interface RunJournalPayload {
  run_key: string
  reason: RunStopReason
  mode: string
  format: string
  sector: string
  scenario: string | null
  founder: string
  ending: string | null
  weeks: number
  score: number
  seed: number
  fingerprint: string
  verified: string
  entries: number
  journal: JournalEntry[]
  header: unknown
}

export type UploadRefusal =
  | 'unconfigured' // the PostHog placeholder, or the Supabase placeholder, is still in place
  | 'no_consent' // the player has not granted analytics consent (or has revoked it)
  | 'no_journal' // arena run, legacy save, or a log that overflowed JOURNAL_LIMIT
  | 'too_large' // past the byte cap — dropped, never truncated
  | 'unsafe_payload' // the tripwire above: a journal entry carried a string it should not
  | 'network' // the request failed; the run is simply not uploaded

export type UploadResult = { sent: true; entries: number; bytes: number } | { sent: false; reason: UploadRefusal }

/**
 * Every gate that must be open before a single byte moves, expressed over its three inputs.
 *
 * Split out from `journalUploadAllowed` for one reason, and it is not style: the shipped build has
 * a placeholder PostHog key, so `analyticsConfigured` is false and the composed predicate is false
 * whatever consent says. A test against the composed version therefore passes just as happily with
 * the consent term DELETED — which is the one term that matters. Taking the inputs as arguments
 * makes the honest path assertable too: all three open, and an upload is allowed.
 */
export function uploadGate(configured: boolean, supabaseConfigured: boolean, granted: boolean): boolean {
  return configured && supabaseConfigured && granted
}

/** The live gate. */
export function journalUploadAllowed(): boolean {
  return uploadGate(analyticsConfigured, onlineConfigured, consentGranted())
}

/** Depth-bounded scan for a string no journal payload has any business carrying. */
function payloadIsSafe(journal: readonly JournalEntry[]): boolean {
  for (const e of journal) {
    const p = e.p
    if (!p) continue
    for (const v of Object.values(p)) {
      if (typeof v === 'string' && v.length > MAX_PAYLOAD_STRING) return false
      // One level down: `tokenise` carries a LaunchDraft, whose fields are all numbers and enums.
      if (v && typeof v === 'object') {
        for (const inner of Object.values(v as Record<string, unknown>)) {
          if (typeof inner === 'string' && inner.length > MAX_PAYLOAD_STRING) return false
        }
      }
    }
  }
  return true
}

const slug = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,48}$/.test(v) ? v : fallback

const bounded = (v: unknown, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0

/**
 * Build the payload for one run. PURE — no network, no storage, no clock beyond the nonce, and it
 * never touches the state it is given. Returns a refusal rather than a half-payload.
 *
 * `nonce` exists so that two players who abandon the Daily Challenge in week 1 having done nothing
 * do not collide on the table's unique key (identical seed, identical fingerprint — the collision
 * is real and would silently drop the second one). It is generated once per run in memory and is
 * not an identifier: it is never persisted, never reused across runs, and dies with the tab.
 */
export function buildJournalPayload(
  game: GameState,
  reason: RunStopReason,
  nonce: string,
): { ok: true; payload: RunJournalPayload; bytes: number } | { ok: false; reason: UploadRefusal } {
  // Checked BEFORE sanitizeJournal, only so the refusal is diagnosable: `sanitizeJournal` already
  // refuses anything past JOURNAL_LIMIT (that is the cap, and it is deliberately not re-invented
  // here), but it refuses by returning undefined, which is indistinguishable from "this run has no
  // journal at all". An over-long log and an arena run are very different problems to be told about.
  if (Array.isArray(game.journal) && game.journal.length > JOURNAL_LIMIT) return { ok: false, reason: 'too_large' }
  // The same reader the save path uses: refuses a malformed or over-long log outright rather than
  // repairing it, which is what makes the writer's ceiling and the reader's ceiling the same one.
  const journal = sanitizeJournal(game.journal)
  if (!journal || journal.length === 0) return { ok: false, reason: 'no_journal' }
  if (!payloadIsSafe(journal)) return { ok: false, reason: 'unsafe_payload' }

  const header = { ...headerOf(game), companyName: REDACTED_COMPANY }
  const cfg = game.config
  const payload: RunJournalPayload = {
    run_key: `${cfg?.seed ?? 0}-${stateFingerprint(game)}-${reason}-${nonce}`.slice(0, 96),
    reason,
    mode: slug(cfg?.mode, 'unknown'),
    format: slug(cfg?.format, 'unknown'),
    sector: slug(cfg?.sector, 'unknown'),
    scenario: cfg?.scenario ? slug(cfg.scenario, 'unknown') : null,
    founder: slug(game.founderKind, 'unknown'),
    ending: game.gameOver ? slug(game.gameOver.type, 'unknown') : null,
    weeks: bounded(game.gameOver?.week ?? game.week, 100_000),
    score: bounded(game.gameOver?.payout ?? 0, 1e12),
    seed: bounded(cfg?.seed, 2 ** 31),
    fingerprint: String(stateFingerprint(game)),
    verified: slug(verifyRun(game).state, 'unknown'),
    entries: journal.length,
    journal,
    header,
  }

  // Measured on the JSON that will actually be sent, not estimated from the entry count: 20,000
  // tiny entries and 20,000 fat ones are wildly different amounts of storage, and the byte cap is
  // the axis the database bounds too.
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
  if (bytes > MAX_JOURNAL_BYTES) return { ok: false, reason: 'too_large' }
  return { ok: true, payload, bytes }
}

let clientPromise: Promise<SupabaseClient> | null = null

/**
 * Lazy, and permanently anonymous — the same construction and the same reasoning as
 * src/net/leaderboard.ts. `persistSession: false` matters for the same latent reason recorded as
 * finding 5 of the 2026-08 security review: supabase-js keys its session storage on the project
 * ref alone, so without this a signed-in player would start attaching their JWT to an upload whose
 * RLS policy is written for `anon`, and the feature would die the day social login is switched on.
 */
function getClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(
      ({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }),
      (e) => {
        clientPromise = null // a failed chunk load retries next call instead of caching the failure
        throw e
      },
    )
  }
  return clientPromise
}

/**
 * Upload one run. Never throws, never blocks a render, and returns WHY it did nothing when it did
 * nothing — an empty table with no explanation is how a feature stays broken for two weeks
 * (docs/security-review-2026-08.md, finding 2).
 */
export async function uploadRunJournal(game: GameState, reason: RunStopReason, nonce: string): Promise<UploadResult> {
  if (!journalUploadAllowed()) {
    return { sent: false, reason: analyticsConfigured && onlineConfigured ? 'no_consent' : 'unconfigured' }
  }
  const built = buildJournalPayload(game, reason, nonce)
  if (!built.ok) return { sent: false, reason: built.reason }
  try {
    const supabase = await getClient()
    // No `.select()`: supabase-js then sends `Prefer: return=minimal`, so the request needs no
    // SELECT privilege — which is what lets the table be genuinely insert-only for anon.
    const { error } = await supabase.from(RUN_JOURNAL_TABLE).insert(built.payload)
    if (error) return { sent: false, reason: 'network' }
    return { sent: true, entries: built.payload.entries, bytes: built.bytes }
  } catch {
    return { sent: false, reason: 'network' }
  }
}
