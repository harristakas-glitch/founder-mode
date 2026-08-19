// Global Daily Challenge leaderboard, backed by a single Supabase table
// (see supabase/leaderboard-v6.sql). Every function is a silent no-op when the
// Supabase keys in src/net/config.ts are still placeholders, and never throws:
// the leaderboard is decoration, never something that can break a run.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, onlineConfigured } from './config'
import { inRoom, myId, resetPlayerId } from './online'

export interface DailyScore {
  player_id: string
  company: string
  score: number
  weeks: number
  ending: string
  display_name?: string | null
}

const TABLE = 'daily_scores'
const SECRET_KEY = 'founder-mode-score-secret'

/**
 * Characters no honest company or display name contains and that wreck the table when rendered.
 * Identical to the peer-string filter in online.ts and deliberately kept in sync with it: the
 * presence path was hardened against bidi overrides and this one, which reaches strictly MORE
 * people, was not. A leaderboard row is peer-supplied input like any other — the anon key is
 * public by design, so anyone can INSERT a row whose `company` reverses every line it lands in,
 * and every player who opens the daily screen renders it.
 *
 * U+200D (ZWJ) survives, as it does on the wire: emoji families are built from it.
 */
const UNSAFE_CHARS = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B\\u200C\\u200E\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
)

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(UNSAFE_CHARS, '').slice(0, max) : '')

const bounded = (v: unknown, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0

/**
 * Coerce one row on the way OUT of the database, before React ever sees it.
 *
 * Server-side constraints are the right place for this and v5/v6 do bound the lengths — but the
 * client renders whatever the table holds, including rows written before any given constraint
 * landed, and a row is not trustworthy just because a policy accepted it. Returns null for a row
 * that cannot be rendered at all (`player_id` is the React key), never throws.
 *
 * Exported for test/net-security.test.ts.
 */
export function sanitizeScoreRow(raw: unknown): DailyScore | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const player_id = clean(r.player_id, 64)
  if (!player_id) return null
  const display_name = clean(r.display_name, 24)
  return {
    player_id,
    company: clean(r.company, 30),
    score: bounded(r.score, SCORE_MAX),
    weeks: bounded(r.weeks, 520),
    // Not whitelisted against ENDINGS: an ending this client does not know about is a NEWER
    // client's, and blanking those rows would hide every real score the moment an ending ships.
    // endingEmoji() already falls back for anything it does not recognise.
    ending: clean(r.ending, 20),
    display_name: display_name || null,
  }
}

// Proof that we own our leaderboard row. player_id is public (it's in the leaderboard
// everyone reads), so it cannot authenticate anything — this secret can, because the
// database column holding it is not readable with the public key. See
// supabase/leaderboard-v6.sql §7.
function scoreSecret(): string {
  let s = localStorage.getItem(SECRET_KEY)
  if (!s || s.length < 16) {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(SECRET_KEY, s)
  }
  return s
}

let clientPromise: Promise<SupabaseClient> | null = null
let clientSecret = ''

/** Lazy: the library is a dynamic import so a run that never posts a score never downloads it. */
async function getClient(): Promise<SupabaseClient> {
  const secret = scoreSecret()
  // The secret is baked into a header at construction time, so a memoized client outlives any
  // change to it — the row would be written under one secret and authenticated with another,
  // and every later update would be refused as if we were a stranger to our own row.
  if (!clientPromise || clientSecret !== secret) {
    clientSecret = secret
    clientPromise = import('@supabase/supabase-js').then(
      ({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { 'x-player-secret': secret } },
          /**
           * This client is deliberately, permanently ANONYMOUS.
           *
           * supabase-js derives its session storage key from the project ref alone
           * (`sb-<ref>-auth-token`) and persists sessions by default, so the leaderboard client
           * and the Realtime client in online.ts share one session — and once social login is
           * switched on (BACKLOG 1.2) this client would silently start sending the signed-in
           * user's JWT. PostgREST would then run every request as `authenticated` instead of
           * `anon`, and every RLS policy on daily_scores is written `to anon`: signed-in players
           * would see an empty leaderboard and be unable to post. That is the same failure mode
           * as v3 and v4 — a control that blocks attackers and every real user at once — armed
           * and waiting for an unrelated settings change to trigger it.
           *
           * Ownership here is proved by the x-player-secret header, never by a session, so
           * there is nothing to persist. `detectSessionInUrl` is off for the same reason: only
           * the auth client should consume the OAuth code from the callback URL, and two
           * clients racing for it is a coin flip.
           *
           * supabase/leaderboard-v6.sql grants the policies to `authenticated` as well, so the
           * hole is closed from both ends and neither fix depends on the other.
           */
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
 * The only endings the database accepts. Anything else is a bug, not a score.
 *
 * `network` is ICO Slice 7's token ending. It was added here and to the three constraint sites in
 * supabase/leaderboard-v6.sql IN THE SAME COMMIT, because this list mirrors that CHECK — adding it
 * on one side only converts a silent client-side refusal into a silent server-side one. v5 has not
 * been applied yet (BACKLOG 1.3), so the owner's single run now carries the ending with it and no
 * follow-up migration is needed.
 */
const ENDINGS = new Set(['bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo', 'network'])

/** Mirrors the CHECK constraint in supabase/leaderboard-v6.sql. */
const SCORE_MAX = 1e12

/**
 * Record a finished daily run. Upserts on (day, player_id) and keeps the
 * higher score if the player already posted one today. Race-tolerant, not
 * race-proof: two simultaneous submits resolve last-write-wins, which is fine
 * for a game leaderboard. Never throws.
 */
export async function submitDailyScore(
  day: number,
  entry: { company: string; score: number; weeks: number; ending: string; display_name?: string | null },
): Promise<void> {
  if (!onlineConfigured) return
  try {
    const db = await getClient()
    const row = {
      day: Math.round(day),
      player_id: myId(),
      // Sanitised on the way IN as well as on the way out. The company name is typed by the
      // player on the new-game screen and goes straight to a table every other player reads —
      // this device should not be the one that publishes a bidi override, even though every
      // reader now strips it.
      company: clean(entry.company, 30),
      // 1e15 exceeded the database's own ceiling, so any run that somehow scored above 1e12
      // was silently rejected instead of being clamped to something storable.
      score: Math.min(SCORE_MAX, Math.max(0, Math.round(entry.score) || 0)),
      weeks: Math.min(520, Math.max(0, Math.round(entry.weeks) || 0)),
      ending: entry.ending,
      display_name: entry.display_name ? clean(entry.display_name, 24) || null : null,
      secret: scoreSecret(),
    }
    if (!ENDINGS.has(row.ending)) return warn(`refusing to submit an unknown ending "${row.ending}"`)
    if (!Number.isFinite(row.day) || row.day < 1) return warn(`refusing to submit a nonsense day ${row.day}`)

    // Fetch-compare: only overwrite an existing row with an equal-or-better score.
    const { data: existing } = await db.from(TABLE).select('score').eq('day', day).eq('player_id', row.player_id).maybeSingle()
    if (existing && existing.score > row.score) return

    const { error } = await db.from(TABLE).upsert(row, { onConflict: 'day,player_id' })
    if (!error) return

    // The leaderboard used to swallow every failure without a word. That is how a policy that
    // rejected 100% of real submissions ran in production unnoticed — the game looked fine and
    // the table just stayed empty. Failures stay non-fatal, but they are no longer silent.
    warn(`score submission rejected: ${error.code ?? '?'} ${error.message}`)

    // A player_id is bound to the first device that used it (leaderboard-v6.sql §3). If ours is
    // bound to someone else's secret — a squatter from before that fix, or a device that lost
    // its secret but kept its id — we can never post again under it. Mint a fresh identity and
    // retry once, but never mid-match: the id is also this device's seat in a room.
    if (isIdentityRejection(error) && !inRoom()) {
      const fresh = resetPlayerId()
      warn(`player id was not ours to use; retrying under a fresh identity ${fresh.slice(0, 8)}…`)
      const retry = await db.from(TABLE).upsert({ ...row, player_id: fresh }, { onConflict: 'day,player_id' })
      if (retry.error) warn(`retry also rejected: ${retry.error.code ?? '?'} ${retry.error.message}`)
    }
  } catch (e) {
    // Network/config errors never surface — the run result screen must not break.
    warn(`score submission failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function warn(msg: string): void {
  console.warn(`[leaderboard] ${msg}`)
}

/**
 * Only the one unambiguous signal: the v5 trigger's own message, raised when the id we are
 * writing under is bound to a different device's secret.
 *
 * Deliberately NOT any 42501 / "row-level security" failure. Rotating on those was wrong and a
 * test caught it doing real damage: a plain policy refusal also happens when a player improves
 * their own score and the request is rejected for an unrelated reason, and the "recovery" then
 * threw away a legitimate player's identity and their whole leaderboard history. A destructive
 * repair needs a certain diagnosis, not a plausible one.
 */
function isIdentityRejection(error: { code?: string; message?: string }): boolean {
  return /registered to another device/i.test(error.message ?? '')
}

/** Top scores for a given daily challenge, best first. Returns [] on any failure. */
export async function fetchDailyTop(day: number, limit = 10): Promise<DailyScore[]> {
  if (!onlineConfigured) return []
  try {
    const { data, error } = await (await getClient())
      .from(TABLE)
      .select('player_id, company, score, weeks, ending, display_name')
      .eq('day', day)
      .order('score', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return (data as unknown[]).map(sanitizeScoreRow).filter((r): r is DailyScore => r !== null)
  } catch {
    return []
  }
}
