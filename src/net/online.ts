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
  /**
   * Client-local only: never sent, never read off the wire. Supabase presence is ephemeral, so a
   * backgrounded tab or a blipped socket drops a peer from the next sync even though they are
   * still in the match. Once a match is under way the store keeps those players and flags them
   * here rather than deleting them — see the roster merge in `onPlayers`.
   */
  absent?: boolean
  /** Client-local only: ms epoch when we lost sight of them. Cleared the moment they reappear. */
  absentSince?: number
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

/**
 * Phase 1 of a sealed bid: the hash only. Broadcasting the amount directly would let a modified
 * client read a rival's premium off the wire and undercut it, which is exactly the thing a sealed
 * bid is supposed to prevent.
 */
export interface CommitPayload {
  candidateId: string
  playerId: string
  company: string
  commitment: string // sha256(candidateId|premiumPct|nonce|playerId)
  week: number
}

/**
 * Phase 2: the amount and the nonce, sent when the founder locks their turn in. Safe to reveal
 * then — every bid is already committed, so knowing a rival's number cannot change your own. A
 * reveal that does not hash back to its commitment is discarded, and so is a missing one.
 */
export interface RevealPayload {
  candidateId: string
  playerId: string
  company: string
  premiumPct: number
  nonce: string
  reputation: number
  runwayWeeks: number
  week: number
}

export interface BidPayload {
  candidateId: string
  playerId: string
  company: string
  premiumPct: number
  reputation: number
  runwayWeeks: number
  week: number
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
  onCommit?: (p: CommitPayload) => void
  onReveal?: (p: RevealPayload) => void
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

/**
 * How long a player can stay invisible before the room writes them off. Generous on purpose: a
 * browser refresh drops presence for a few seconds and must never cost someone the match.
 */
export const FORFEIT_MS = 75_000

/** Gone long enough to count as having walked away. Players who already finished keep their real ending. */
export function hasForfeited(p: NetPlayer, now = Date.now()): boolean {
  return !p.over && !!p.absent && p.absentSince !== undefined && now - p.absentSince > FORFEIT_MS
}

/** Still contesting the market: not finished, not walked away. */
export function isContesting(p: NetPlayer, now = Date.now()): boolean {
  return !p.over && !hasForfeited(p, now)
}

function readPlayers(): NetPlayer[] {
  const state = channel?.presenceState() ?? {}
  const players = Object.entries(state)
    .map(([key, metas]) => normalizePlayer((metas as unknown[])[0], key))
    .filter((p): p is NetPlayer => p !== null)
  // stable order: host first, then by company name
  return players.sort((a, b) => Number(b.host) - Number(a.host) || a.company.localeCompare(b.company))
}

/** What the UI should say about the socket. */
export type LinkState = 'live' | 'reconnecting' | 'offline'

let roomCode: string | null = null
let liveHandlers: Handlers | null = null
let rejoinTimer: ReturnType<typeof setTimeout> | null = null
let rejoinAttempt = 0
let joinedOnce = false
let linkState: LinkState = 'offline'
let onLink: ((s: LinkState) => void) | null = null
let wakeWired = false

/** Subscribe to connection health so the UI can say "reconnecting" instead of going quiet. */
export function onLinkStateChange(cb: ((s: LinkState) => void) | null): void {
  onLink = cb
}

export function getLinkState(): LinkState {
  return linkState
}

function setLink(next: LinkState) {
  if (linkState === next) return
  linkState = next
  onLink?.(next)
}

/** Attach every listener this room needs. Called fresh on each (re)join — channels aren't reusable. */
function wire(ch: RealtimeChannel, handlers: Handlers) {
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
  ch.on('broadcast', { event: 'commit' }, ({ payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>
    if (typeof p.candidateId !== 'string' || typeof p.playerId !== 'string' || typeof p.commitment !== 'string') return
    safe(() =>
      handlers.onCommit?.({
        candidateId: p.candidateId as string,
        playerId: (p.playerId as string).slice(0, 64),
        company: str(p.company, 30, 'A rival'),
        commitment: (p.commitment as string).slice(0, 64),
        week: Math.floor(num(p.week, 10_000)),
      }),
    )
  })
  ch.on('broadcast', { event: 'reveal' }, ({ payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>
    if (typeof p.candidateId !== 'string' || typeof p.playerId !== 'string' || typeof p.nonce !== 'string') return
    safe(() =>
      handlers.onReveal?.({
        candidateId: p.candidateId as string,
        playerId: (p.playerId as string).slice(0, 64),
        company: str(p.company, 30, 'A rival'),
        // peer-reported and therefore bounded: an unbounded premium would auto-win every auction
        premiumPct: Math.min(100, Math.max(0, num(p.premiumPct, 100))),
        nonce: (p.nonce as string).slice(0, 64),
        reputation: Math.min(100, Math.max(0, num(p.reputation, 100))),
        runwayWeeks: Math.min(999, num(p.runwayWeeks, 999)),
        week: Math.floor(num(p.week, 10_000)),
      }),
    )
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
}

/**
 * Open (or reopen) the room channel. The subscribe callback fires for the WHOLE life of the
 * channel, not just the first join — handling only the initial status was why a dropped socket
 * left the player silently disconnected until they reloaded the page.
 */
function openChannel(initial: boolean): Promise<void> {
  const code = roomCode
  const handlers = liveHandlers
  const me = myState
  if (!code || !handlers || !me) return Promise.resolve()

  const ch = getClient().channel(`fm-room-${code}`, {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  })
  channel = ch
  wire(ch, handlers)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = initial
      ? setTimeout(() => {
          settled = true
          reject(new Error('Connection timed out — check your internet and the Supabase config.'))
        }, 12_000)
      : null

    ch.subscribe(async (status) => {
      // a status from a channel we've already replaced (or left) is not ours to act on
      if (channel !== ch) return

      if (status === 'SUBSCRIBED') {
        if (timer) clearTimeout(timer)
        joinedOnce = true
        rejoinAttempt = 0
        setLink('live')
        // Re-announce ourselves on EVERY join. Presence is per-channel, so a silent reconnect
        // that skipped this would put us back in the room as a ghost with no state.
        try {
          if (myState) await ch.track(myState as unknown as Record<string, unknown>)
        } catch {
          // the next rejoin will retry the track
        }
        if (!settled) {
          settled = true
          resolve()
        }
        return
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (initial && !joinedOnce) {
          if (timer) clearTimeout(timer)
          if (!settled) {
            settled = true
            reject(new Error(`Could not join the room (${status}). Check the Supabase config and try again.`))
          }
          return
        }
        // we were live and lost it — climb back on our own rather than making the player reload
        scheduleRejoin()
        if (!settled) {
          settled = true
          resolve()
        }
      }
    })
  })
}

/** Exponential backoff, capped, one attempt in flight at a time. */
function scheduleRejoin() {
  if (!roomCode || rejoinTimer) return
  setLink('reconnecting')
  const wait = Math.min(15_000, 800 * 2 ** rejoinAttempt)
  rejoinAttempt++
  rejoinTimer = setTimeout(async () => {
    rejoinTimer = null
    if (!roomCode) return
    const dead = channel
    channel = null
    if (dead) {
      try {
        await getClient().removeChannel(dead)
      } catch {
        // removing an already-dead channel is fine
      }
    }
    try {
      await openChannel(false)
    } catch {
      scheduleRejoin()
    }
  }, wait)
}

/**
 * A backgrounded tab gets its timers throttled and its socket quietly killed, so returning to the
 * page is the single most common moment to discover you are disconnected. Retry immediately
 * instead of waiting out the backoff.
 */
function wake() {
  if (!roomCode) return
  if (channel && channel.state === 'joined') {
    void pushState({}) // re-assert presence in case the server dropped our entry
    return
  }
  rejoinAttempt = 0
  if (rejoinTimer) {
    clearTimeout(rejoinTimer)
    rejoinTimer = null
  }
  scheduleRejoin()
}

function wireWakeListeners() {
  if (wakeWired || typeof document === 'undefined') return
  wakeWired = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake()
  })
  window.addEventListener('online', wake)
  window.addEventListener('offline', () => setLink('reconnecting'))
}

export async function connectRoom(code: string, me: NetPlayer, handlers: Handlers): Promise<void> {
  await leaveRoom()
  wireWakeListeners()
  roomCode = code
  liveHandlers = handlers
  myState = me
  joinedOnce = false
  rejoinAttempt = 0
  await openChannel(true)
}

export async function pushState(patch: Partial<NetPlayer>): Promise<void> {
  if (!channel || !myState) return
  myState = { ...myState, ...patch }
  await channel.track(myState as unknown as Record<string, unknown>)
}

export async function broadcastStart(payload: StartPayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'start', payload })
}

export async function broadcastCommit(payload: CommitPayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'commit', payload })
}

export async function broadcastReveal(payload: RevealPayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'reveal', payload })
}

/** 128 bits of nonce: enough that a commitment cannot be brute-forced back to its premium. */
export function makeNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * The binding hash. Includes the player id so a commitment cannot be replayed by someone else,
 * and the candidate id so it cannot be moved to a different auction.
 */
export async function hiringCommitment(candidateId: string, premiumPct: number, nonce: string, playerId: string): Promise<string> {
  const data = new TextEncoder().encode(`${candidateId}|${premiumPct}|${nonce}|${playerId}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join('')
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
  // clear the supervisor FIRST, so the CLOSED status from unsubscribing isn't read as a drop
  roomCode = null
  liveHandlers = null
  joinedOnce = false
  rejoinAttempt = 0
  if (rejoinTimer) {
    clearTimeout(rejoinTimer)
    rejoinTimer = null
  }
  setLink('offline')
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
