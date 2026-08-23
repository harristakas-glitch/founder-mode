// The player profile: nickname, badge wall, per-mode personal bests.
//
// PRIVACY IS THE DESIGN (owner, 2026-08-22: "real name should not be visible"): the profile row
// is created server-side with a GENERATED nickname, the real name and email are never copied
// into it, and from the moment a profile exists the client sends the NICKNAME to the
// leaderboard — never the OAuth name. The profile is the public face; auth stays private.
//
// Achievements and bests are client-asserted, like every solo-run number (BACKLOG §3.3): the
// server caps their size and shape, it cannot verify them. Sync is a MERGE in both directions —
// badges are a set union, bests keep the higher score — so two devices enrich each other and
// neither can accidentally erase the other's history.
import { onlineConfigured } from './config'
import { getClient } from './online'
import { safeAvatar } from './auth'

export interface ModeBest {
  score: number
  weeks: number
  ending: string
  /** Player-typed free text. Since profiles-v2 this TRAVELS, scrubbed — the owner decided
   *  (2026-08-23) that run history belongs to the profile across browsers, and company names
   *  are the history. Same exposure class as the leaderboard, which has published player-typed
   *  company names next to the nickname since v6. The 2026-08-22 stripping is superseded. */
  company?: string
  at: number // ms epoch of the run's end, for "when" on the card
}

export type ProfileBests = Partial<Record<'quick' | 'career' | 'arena', ModeBest>>

/** One hall-of-fame run on the wire — the same shape the local hall keeps (store RunRecord),
 *  declared here rather than imported because store.ts imports this module. */
export interface HallEntry {
  company: string
  sector: string
  ending: string
  weeks: number
  score: number
  /** ms epoch; 0 on entries recorded before profiles-v2 */
  at?: number
}

export interface Profile {
  userId: string
  nickname: string
  avatar: string | null
  achievements: string[]
  bests: ProfileBests
  /** Top runs by score, merged across devices. The server caps the blob; we keep 10. */
  hall: HallEntry[]
  /** Lifetime finished runs. A high-water mark, not a sum — see the merge in
   *  pushProfileProgress for why two pre-sync histories can undercount once. */
  runCount: number
  createdAt: string
}

/** Mirrors the server CHECK exactly — the player hears it from us before the database does. */
export const NICKNAME_RULE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,22}[A-Za-z0-9]$/

export function nicknameProblem(nick: string): string | null {
  if (nick.length < 3) return 'At least 3 characters.'
  if (nick.length > 24) return 'At most 24 characters.'
  if (!NICKNAME_RULE.test(nick)) return 'Letters, digits, spaces and . _ - only; start and end on a letter or digit.'
  // HTML collapses whitespace runs, so "Quiet  Falcon" would WEAR "Quiet Falcon" on screen —
  // the server refuses it for the same reason (impersonation), we just say it kindlier.
  if (/ {2}/.test(nick)) return 'One space at a time.'
  return null
}

// Same character class the leaderboard sanitizer strips: control chars, zero-widths, bidi
// overrides — anything that lets a string lie about what it looks like.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g
const scrub = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(UNSAFE_CHARS, '').slice(0, max) : '')

/** One hall entry, hostile until proven: every field re-typed, re-bounded and re-scrubbed —
 *  the row is world-writable by its owner, and its owner's browser console is not our client. */
function coerceHallEntry(v: unknown): HallEntry | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const score = Number(r.score)
  if (!Number.isFinite(score) || score < 0 || score > 1e15) return null
  return {
    company: scrub(r.company, 40) || '—',
    sector: scrub(r.sector, 24),
    ending: scrub(r.ending, 16),
    weeks: Math.max(0, Math.min(100_000, Math.round(Number(r.weeks) || 0))),
    score: Math.round(score),
    at: Math.max(0, Number(r.at) || 0),
  }
}

export const HALL_LIMIT = 10

/** Server rows render for every player, so they are bounded like presence: hostile until coerced.
 *  Exported for the test suite; production callers go through fetchMyProfile. */
export function coerceProfileRow(row: Record<string, unknown> | null): Profile | null {
  if (!row || typeof row.user_id !== 'string' || typeof row.nickname !== 'string') return null
  const achievements = Array.isArray(row.achievements)
    ? row.achievements.filter((a): a is string => typeof a === 'string' && a.length <= 64).slice(0, 200)
    : []
  const bests: ProfileBests = {}
  if (row.bests && typeof row.bests === 'object') {
    for (const mode of ['quick', 'career', 'arena'] as const) {
      const b = (row.bests as Record<string, unknown>)[mode]
      if (!b || typeof b !== 'object') continue
      const r = b as Record<string, unknown>
      const score = Number(r.score)
      if (!Number.isFinite(score) || score < 0) continue
      const company = scrub(r.company, 40)
      bests[mode] = {
        score,
        weeks: Math.max(0, Math.min(100_000, Number(r.weeks) || 0)),
        ending: scrub(r.ending, 24),
        ...(company ? { company } : {}),
        at: Number(r.at) || 0,
      }
    }
  }
  const hall = Array.isArray(row.hall)
    ? row.hall
        .map(coerceHallEntry)
        .filter((e): e is HallEntry => e !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, HALL_LIMIT)
    : []
  const runCount = Math.max(0, Math.min(1_000_000, Math.round(Number(row.run_count) || 0)))
  return {
    userId: row.user_id,
    nickname: scrub(row.nickname, 24) || 'player',
    avatar: safeAvatar(row.avatar_url),
    achievements,
    bests,
    hall,
    runCount,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  }
}

export async function fetchMyProfile(): Promise<Profile | null> {
  if (!onlineConfigured) return null
  try {
    const client = await getClient()
    const { data: s } = await client.auth.getSession()
    const uid = s.session?.user?.id
    if (!uid) return null
    const { data } = await client.from('profiles').select('*').eq('user_id', uid).maybeSingle()
    return coerceProfileRow(data)
  } catch {
    return null
  }
}

export async function renameProfile(nickname: string): Promise<string | null> {
  const problem = nicknameProblem(nickname)
  if (problem) return problem
  try {
    const client = await getClient()
    const { data: s } = await client.auth.getSession()
    const uid = s.session?.user?.id
    if (!uid) return 'Sign in first.'
    const { error } = await client.from('profiles').update({ nickname }).eq('user_id', uid)
    if (!error) return null
    return /duplicate|unique|23505/i.test(error.message) ? 'That name is taken.' : error.message
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** A run's stat identity. Two DISTINCT runs can share it (every bankruptcy scores 0, and players
 *  reuse company names), so stats alone never decide sameness — see mergeHalls. */
const statsKey = (e: HallEntry) => JSON.stringify([e.company, e.sector, e.ending, e.weeks, e.score])

/**
 * Union by run identity, local entries re-coerced like server ones, best HALL_LIMIT survive.
 * Pure and exported so the test suite can hold the merge to its promises.
 *
 * Identity (review fix, 2026-08-23): same stats AND same `at` — two honest runs with identical
 * stats finished at different times are BOTH kept. A timestampless copy (`at` 0/absent — the
 * pre-v2 wire shape) is the one exception: it is absorbed by any timestamped same-stats entry,
 * because it may well BE that run seen through a pre-v2 lens, and pre-v2 data never could
 * distinguish stat-twins anyway.
 */
export function mergeHalls(remote: HallEntry[], local: unknown[]): HallEntry[] {
  const groups = new Map<string, HallEntry[]>()
  for (const e of [...remote, ...local.map(coerceHallEntry).filter((e): e is HallEntry => e !== null)]) {
    const k = statsKey(e)
    const g = groups.get(k)
    if (g) g.push(e)
    else groups.set(k, [e])
  }
  const out: HallEntry[] = []
  for (const g of groups.values()) {
    const stamped = new Map<number, HallEntry>()
    let legacy: HallEntry | null = null
    for (const e of g) {
      const at = e.at ?? 0
      if (at > 0) stamped.set(at, e)
      else legacy = e
    }
    if (stamped.size > 0) out.push(...stamped.values())
    else if (legacy) out.push(legacy)
  }
  return out.sort((a, b) => b.score - a.score).slice(0, HALL_LIMIT)
}

/**
 * The next value of the server-side lifetime counter. Pure and exported for the tests.
 *
 * Delta-based (review fix, 2026-08-23 — max() silently swallowed any run recorded while the
 * local base lagged the server): each device adds ONLY the runs it recorded since it last saw
 * the server's number. `base` is that last-seen number, or null on a device that has never
 * completed a sync under this scheme — there the delta is unknowable, so it falls back to the
 * old high-water mark for one sync and the baseline starts from the result.
 */
export function nextRunCount(server: number, local: number, base: number | null): number {
  const candidate = base === null ? Math.max(server, local) : server + Math.max(0, local - base)
  return Math.max(0, Math.min(1_000_000, Math.round(candidate) || 0))
}

/**
 * Push the local badge set, per-mode bests, hall of fame and run counter up, merged: union for
 * badges and hall entries (see mergeHalls), higher score wins per mode, delta-add for the
 * counter (see nextRunCount). Returns the profile as the server now holds it, plus
 * `historySynced`: whether the server ACCEPTED the hall and counter this time. The caller must
 * not treat the returned hall/runCount as authoritative when it is false — on the fallback
 * paths they are the server's pre-merge copy, and writing them over localStorage is how a
 * review found this code wiping players' local history (2026-08-23, two criticals).
 */
export async function pushProfileProgress(local: {
  achievements: string[]
  bests: ProfileBests
  hall: HallEntry[]
  runCount: number
  /** server count at this device's last completed sync; null = never synced under the delta scheme */
  runBase: number | null
}): Promise<(Profile & { historySynced: boolean }) | null> {
  if (!onlineConfigured) return null
  try {
    const current = await fetchMyProfile()
    if (!current) return null
    const badgeUnion = [...new Set([...current.achievements, ...local.achievements])].sort()
    const bests: ProfileBests = { ...current.bests }
    for (const mode of ['quick', 'career', 'arena'] as const) {
      const mine = local.bests[mode]
      if (!mine || (bests[mode] && mine.score <= bests[mode]!.score)) continue
      // Everything published is re-scrubbed HERE, not trusted from localStorage — a tampered
      // local value must come out of the sanitizer the same as an honest one.
      const company = scrub(mine.company, 40)
      bests[mode] = {
        score: mine.score,
        weeks: mine.weeks,
        ending: scrub(mine.ending, 24),
        ...(company ? { company } : {}),
        at: mine.at,
      }
    }
    const hall = mergeHalls(current.hall, local.hall)
    const runCount = nextRunCount(current.runCount, Math.round(local.runCount) || 0, local.runBase)
    const changed =
      badgeUnion.join(',') !== [...current.achievements].sort().join(',') ||
      JSON.stringify(bests) !== JSON.stringify(current.bests) ||
      JSON.stringify(hall) !== JSON.stringify(current.hall) ||
      runCount !== current.runCount
    // nothing to write — the server already holds everything local knows, so history IS synced
    if (!changed) return { ...current, historySynced: true }
    const client = await getClient()
    const { error } = await client
      .from('profiles')
      .update({ achievements: badgeUnion, bests, hall, run_count: runCount })
      .eq('user_id', current.userId)
    if (error) {
      // The full-shape update failed — profiles-v2 columns missing, a CHECK, or a transient
      // blip; supabase-js reports them all the same way. Sync what the v1 schema can hold
      // rather than syncing nothing, but say loudly that the HISTORY did not make it: the
      // caller must keep its local hall and counter untouched so they can retry next time.
      const { error: v1err } = await client.from('profiles').update({ achievements: badgeUnion, bests }).eq('user_id', current.userId)
      return v1err ? { ...current, historySynced: false } : { ...current, achievements: badgeUnion, bests, historySynced: false }
    }
    return { ...current, achievements: badgeUnion, bests, hall, runCount, historySynced: true }
  } catch {
    return null
  }
}
