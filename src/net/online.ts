// Online multiplayer transport: one Supabase Realtime channel per room.
// Presence carries each player's public state; a single 'start' broadcast kicks off the match.
// No database, no SQL — rooms exist only while someone is in them.

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import type { FounderKind, Ruleset, SectorId } from '../game/types'

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
  playing?: boolean // in the match (vs still sitting in the lobby) — absent on older clients
  // open-book intel (multiplayer is a clear-information game; older clients omit these)
  cash?: number
  rev?: number // weekly revenue
  pmf?: number
}

export interface StartPayload {
  seed: number
  sector: SectorId
  cap: number
  deadline: number
  /** Host-chosen capability toggles. Receivers whitelist keys — never trust this shape. */
  caps?: Record<string, boolean>
  /** @deprecated legacy 10-key Ruleset from clients older than the mode/format model. */
  rules?: Ruleset
  hostId?: string // who claims to be starting the match — checked against presence
}

export interface AttackPayload {
  fromCompany: string
  targetId: string
  kind: 'poach' | 'smear' | 'raid'
  fromId?: string // sender's player id, for receiver-side rate limiting
}

export interface EmotePayload {
  from: string
  emoji: string
}

export interface ChatPayload {
  from: string
  text: string
}

export interface Handlers {
  onPlayers: (players: NetPlayer[]) => void
  onStart: (p: StartPayload) => void
  onEmote?: (p: EmotePayload) => void
  onChat?: (p: ChatPayload) => void
  onAttack?: (p: AttackPayload) => void
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

export function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 5 } },
    })
  }
  return client
}

// Presence is attacker-controlled: any peer can track arbitrary JSON. Everything the rest
// of the app reads must survive a hostile or buggy client, so it is coerced and bounded here.
const MAX_USERS = 1e10
const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0)
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback)

export function normalizePlayer(raw: unknown, key: string): NetPlayer | null {
  const p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object') return null
  // a peer cannot impersonate another slot: the presence key is the identity of record
  if (typeof p.id !== 'string' || p.id !== key) return null
  return {
    id: p.id.slice(0, 64),
    company: str(p.company, 30, 'Unknown Inc.') || 'Unknown Inc.',
    founder: p.founder === 'business' ? 'business' : 'technical',
    host: p.host === true,
    week: Math.floor(num(p.week, 10_000)),
    ready: p.ready === true,
    users: num(p.users, MAX_USERS),
    val: num(p.val, Number.MAX_SAFE_INTEGER),
    payout: num(p.payout, Number.MAX_SAFE_INTEGER),
    over: p.over === true,
    overType: typeof p.overType === 'string' ? p.overType.slice(0, 20) : undefined,
    playing: p.playing === true,
  }
}

function readPlayers(): NetPlayer[] {
  const state = channel?.presenceState() ?? {}
  const players = Object.entries(state)
    .map(([key, metas]) => normalizePlayer((metas as unknown[])[0], key))
    .filter((p): p is NetPlayer => p !== null)
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
  // Broadcast payloads are unauthenticated JSON from any peer — coerce before handing them on,
  // and never let one malformed message throw inside the socket callback.
  const safe = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      console.warn('dropped a malformed realtime message', e)
    }
  }
  ch.on('presence', { event: 'sync' }, () => safe(() => handlers.onPlayers(readPlayers())))
  ch.on('broadcast', { event: 'start' }, ({ payload }) => safe(() => handlers.onStart(payload as StartPayload)))
  ch.on('broadcast', { event: 'emote' }, ({ payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>
    safe(() => handlers.onEmote?.({ from: str(p.from, 30, 'Someone'), emoji: str(p.emoji, 8, '👀') }))
  })
  ch.on('broadcast', { event: 'chat' }, ({ payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>
    const text = str(p.text, 200)
    if (text) safe(() => handlers.onChat?.({ from: str(p.from, 30, 'Someone'), text }))
  })
  ch.on('broadcast', { event: 'attack' }, ({ payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>
    const kind = p.kind
    if (kind !== 'poach' && kind !== 'smear' && kind !== 'raid') return
    if (typeof p.targetId !== 'string') return
    safe(() =>
      handlers.onAttack?.({
        fromCompany: str(p.fromCompany, 30, 'A rival'),
        targetId: p.targetId as string,
        kind,
        fromId: typeof p.fromId === 'string' ? p.fromId.slice(0, 64) : undefined,
      }),
    )
  })
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

export async function broadcastEmote(payload: EmotePayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'emote', payload })
}

export async function broadcastChat(payload: ChatPayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'chat', payload })
}

export async function broadcastAttack(payload: AttackPayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'attack', payload })
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
