// Global Daily Challenge leaderboard, backed by a single Supabase table
// (see supabase/leaderboard.sql). Every function is a silent no-op when the
// Supabase keys in src/net/config.ts are still placeholders, and never throws:
// the leaderboard is decoration, never something that can break a run.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, onlineConfigured } from './config'
import { myId } from './online'

export interface DailyScore {
  player_id: string
  company: string
  score: number
  weeks: number
  ending: string
  display_name?: string | null
}

const TABLE = 'daily_scores'

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!client) {
    // The row-scoped UPDATE policy (supabase/leaderboard-hardening.sql) matches this header
    // against the row's player_id, so a client can only raise its own score.
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { 'x-player-id': myId() } },
    })
  }
  return client
}

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
    const db = getClient()
    const player_id = myId()
    const row = {
      day,
      player_id,
      company: entry.company.slice(0, 30),
      score: Math.min(1e15, Math.max(0, Math.round(entry.score) || 0)),
      weeks: Math.min(520, Math.max(0, Math.round(entry.weeks) || 0)),
      ending: entry.ending.slice(0, 20),
      display_name: entry.display_name ? entry.display_name.slice(0, 24) : null,
    }

    // Fetch-compare: only overwrite an existing row with an equal-or-better score.
    const { data: existing } = await db
      .from(TABLE)
      .select('score')
      .eq('day', day)
      .eq('player_id', player_id)
      .maybeSingle()
    if (existing && existing.score > row.score) return

    await db.from(TABLE).upsert(row, { onConflict: 'day,player_id' })
  } catch {
    // Network/config errors never surface — the run result screen must not break.
  }
}

/** Top scores for a given daily challenge, best first. Returns [] on any failure. */
export async function fetchDailyTop(day: number, limit = 10): Promise<DailyScore[]> {
  if (!onlineConfigured) return []
  try {
    const { data, error } = await getClient()
      .from(TABLE)
      .select('player_id, company, score, weeks, ending, display_name')
      .eq('day', day)
      .order('score', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return data as DailyScore[]
  } catch {
    return []
  }
}
