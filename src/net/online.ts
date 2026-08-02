// Online multiplayer transport: one Supabase Realtime channel per room.
// Presence carries each player's public state; a single 'start' broadcast kicks off the match.
// No database, no SQL — rooms exist only while someone is in them.

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import type { FounderKind, SectorId } from '../game/types'

export interface NetPlayer {
  id: string
  company: string
  founder: FounderKind
  host: boolean
  week: number
  ready: boolean
  users: number
  val: number
  payout: number
  over: boolean
  overType?: string
}

export interface StartPayload {
  seed: number
  sector: SectorId
  cap: number
  deadline: number
}

export interface Handlers {
  onPlayers: (players: NetPlayer[]) => void
  onStart: (p: StartPayload) => void
}

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let myState: NetPlayer | null = null

const ID_KEY = 'founder-mode-player-id'

export function myId(): string {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I confusion
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 5 } },
    })
  }
  return client
}

function readPlayers(): NetPlayer[] {
  const state = channel?.presenceState() ?? {}
  const players = Object.values(state)
    .map((metas) => (metas as unknown as NetPlayer[])[0])
    .filter((p): p is NetPlayer => !!p && typeof p.id === 'string')
  // stable order: host first, then by company name
  return players.sort((a, b) => Number(b.host) - Number(a.host) || a.company.localeCompare(b.company))
}

export async function connectRoom(code: string, me: NetPlayer, handlers: Handlers): Promise<void> {
  await leaveRoom()
  const ch = getClient().channel(`fm-room-${code}`, {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  })
  channel = ch
  myState = me
  ch.on('presence', { event: 'sync' }, () => handlers.onPlayers(readPlayers()))
  ch.on('broadcast', { event: 'start' }, ({ payload }) => handlers.onStart(payload as StartPayload))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timed out — check your internet and the Supabase config.')), 12_000)
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        await ch.track(me as unknown as Record<string, unknown>)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`Could not join the room (${status}). Check the Supabase config and try again.`))
      }
    })
  })
}

export async function pushState(patch: Partial<NetPlayer>): Promise<void> {
  if (!channel || !myState) return
  myState = { ...myState, ...patch }
  await channel.track(myState as unknown as Record<string, unknown>)
}

export async function broadcastStart(payload: StartPayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'start', payload })
}

export async function leaveRoom(): Promise<void> {
  if (channel) {
    const ch = channel
    channel = null
    myState = null
    try {
      await ch.unsubscribe()
    } catch {
      // closing a dead channel is fine
    }
  }
}

export function inRoom(): boolean {
  return channel !== null
}
