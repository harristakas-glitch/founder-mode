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
  /** Present locally; STRIPPED before publishing. Company names are player-typed free text and
   *  players name companies after themselves — pushing them to a world-readable table is the
   *  exact leak the nickname system exists to prevent (review finding, 2026-08-22). */
  company?: string
  at: number // ms epoch of the run's end, for "when" on the card
}

export type ProfileBests = Partial<Record<'quick' | 'career' | 'arena', ModeBest>>

export interface Profile {
  userId: string
  nickname: string
  avatar: string | null
  achievements: string[]
  bests: ProfileBests
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
      bests[mode] = {
        score,
        weeks: Math.max(0, Math.min(100_000, Number(r.weeks) || 0)),
        ending: scrub(r.ending, 24),
        at: Number(r.at) || 0,
      }
    }
  }
  return {
    userId: row.user_id,
    nickname: scrub(row.nickname, 24) || 'player',
    avatar: safeAvatar(row.avatar_url),
    achievements,
    bests,
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

/**
 * Push the local badge set and per-mode bests up, merged: union for badges, higher score wins
 * per mode. Returns the profile as the server now holds it. Never throws — a profile that
 * fails to sync is a profile that syncs next time.
 */
export async function pushProfileProgress(local: { achievements: string[]; bests: ProfileBests }): Promise<Profile | null> {
  if (!onlineConfigured) return null
  try {
    const current = await fetchMyProfile()
    if (!current) return null
    const badgeUnion = [...new Set([...current.achievements, ...local.achievements])].sort()
    const bests: ProfileBests = { ...current.bests }
    for (const mode of ['quick', 'career', 'arena'] as const) {
      const mine = local.bests[mode]
      // company deliberately does not travel — see ModeBest. Everything published here is
      // game-generated (score, weeks, ending id), never player-typed.
      if (mine && (!bests[mode] || mine.score > bests[mode]!.score))
        bests[mode] = { score: mine.score, weeks: mine.weeks, ending: mine.ending, at: mine.at }
    }
    const changed =
      badgeUnion.join(',') !== [...current.achievements].sort().join(',') ||
      JSON.stringify(bests) !== JSON.stringify(current.bests)
    if (!changed) return current
    const client = await getClient()
    const { error } = await client
      .from('profiles')
      .update({ achievements: badgeUnion, bests })
      .eq('user_id', current.userId)
    if (error) return current
    return { ...current, achievements: badgeUnion, bests }
  } catch {
    return null
  }
}
