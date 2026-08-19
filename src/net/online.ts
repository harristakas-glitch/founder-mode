// Online multiplayer transport: one Supabase Realtime channel per room.
// Presence carries each player's public state; a single 'start' broadcast kicks off the match.
// No database, no SQL — rooms exist only while someone is in them.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
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
  /**
   * Widened for the hit piece and price war. A client older than those still whitelists only the
   * original three and drops the rest, so an attack simply does not land on them — the attacker
   * still pays. Graceful degradation, not a desync.
   */
  kind: 'poach' | 'smear' | 'raid' | 'hitpiece' | 'pricewar'
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

/** A target buying their way out of a price war. The users named here move to the initiator. */
export interface ConcedePayload {
  fromCompany: string
  /** The founder who STARTED the war — the only one who should be credited. */
  targetId: string
  users: number
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
  onConcede?: (p: ConcedePayload) => void
}

let clientPromise: Promise<SupabaseClient> | null = null
let channel: RealtimeChannel | null = null
let myState: NetPlayer | null = null

const ID_KEY = 'founder-mode-player-id'

/** Unbiased random ints from the CSPRNG. Math.random is predictable and must not pick secrets. */
function randomInts(n: number, mod: number): number[] {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  // rejection-free because 256 % 32 === 0 for our alphabet; kept explicit so a future
  // alphabet change cannot silently introduce modulo bias
  const limit = 256 - (256 % mod)
  const out: number[] = []
  for (let i = 0; i < bytes.length && out.length < n; i++) {
    if (bytes[i] < limit) out.push(bytes[i] % mod)
  }
  while (out.length < n) out.push(...randomInts(n - out.length, mod))
  return out
}

export function myId(): string {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    // 96 bits from the CSPRNG. The old id was Math.random + Date.now, which is both guessable
    // and grindable: ids are public on the leaderboard and are the only handle on a room slot.
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

/**
 * Mint a brand-new identity for this device and return it. Only for the case where the current
 * id is unusable — the leaderboard proved it belongs to another device's secret. Never call this
 * while in a room: the id is also the presence key holding this player's seat.
 */
export function resetPlayerId(): string {
  localStorage.removeItem(ID_KEY)
  return myId()
}

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I confusion
  // Math.random let an observer who had seen a few codes predict the next ones and walk into
  // rooms they were never invited to. 5 chars is still only ~33M codes — see the review's note
  // on room-code enumeration; this closes prediction, not brute force.
  return randomInts(5, alphabet.length)
    .map((i) => alphabet[i])
    .join('')
}

/**
 * Lazy on purpose: @supabase/supabase-js is a third of the main bundle and a solo run never
 * needs it, so the library is a dynamic import that only loads on first online use. A failed
 * chunk load (offline PWA launch, say) clears the memo so the next attempt retries.
 */
export function getClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(
      ({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          realtime: { params: { eventsPerSecond: 5 } },
        }),
      (e) => {
        clientPromise = null
        throw e
      },
    )
  }
  return clientPromise
}

// Presence is attacker-controlled: any peer can track arbitrary JSON. Everything the rest
// of the app reads must survive a hostile or buggy client, so it is coerced and bounded here.
const MAX_USERS = 1e10
/** Mirrors the engine's own clamp in `applyConcedeGain` — a war cannot move more than this. */
const MAX_CONCEDE_USERS = 1e7
const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0)

/**
 * Characters a peer has no legitimate reason to send and that wreck the UI when rendered:
 * C0/C1 controls (newlines that break a one-line label), zero-width padding, and the bidi
 * override/isolate range — U+202E in a company name reverses every line it lands in.
 * U+2028/U+2029 are here because they are line breaks that are NOT in the C0 range: the first
 * pass stripped `\n` and left the separator that renders identically in a `pre-wrap` label.
 * U+200D (ZWJ) is deliberately NOT stripped: emoji families are built from it.
 */
const UNSAFE_CHARS = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B\\u200C\\u200E\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
)

const str = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' ? v.replace(UNSAFE_CHARS, '').slice(0, max) : fallback

/** Exactly `len` lowercase hex characters, or null. Used for commitments and nonces. */
const hex = (v: unknown, len: number): string | null =>
  typeof v === 'string' && v.length === len && /^[0-9a-f]+$/.test(v) ? v : null

/** A game-generated opaque id (candidate, player, target). Never contains our hash delimiter. */
const opaqueId = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(UNSAFE_CHARS, '')
  if (!s || s.length > 64 || s.includes('|')) return null
  return s
}

const int = (v: unknown, min: number, max: number): number => Math.min(max, Math.max(min, Math.floor(num(v, max))))

export function normalizePlayer(raw: unknown, key: string): NetPlayer | null {
  const p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object') return null
  // A peer cannot impersonate another slot: the presence key is the identity of record.
  //
  // The id is held to the SAME domain as every other id on the wire (`opaqueId`: non-empty,
  // <= 64 chars, no control/bidi characters, no `|`) and must then equal its key exactly. It
  // used to be checked against the key and only THEN truncated to 64 — so a 71-character key
  // passed the check and came back as a 64-character id that was no longer its own key. Two
  // different keys sharing a 64-char prefix collapsed onto one NetPlayer.id, which defeats the
  // single guarantee presence offers, duplicates React keys, and — now that the broadcast
  // roster is built from readPlayers() — would put a forged id into the bid gate.
  const id = opaqueId(p.id)
  if (!id || id !== key) return null
  return {
    id,
    company: str(p.company, 30, 'Unknown Inc.') || 'Unknown Inc.',
    founder: p.founder === 'business' ? 'business' : 'technical',
    host: p.host === true,
    week: Math.floor(num(p.week, 10_000)),
    ready: p.ready === true,
    users: num(p.users, MAX_USERS),
    val: num(p.val, Number.MAX_SAFE_INTEGER),
    payout: num(p.payout, Number.MAX_SAFE_INTEGER),
    over: p.over === true,
    overType: typeof p.overType === 'string' ? str(p.overType, 20) || undefined : undefined,
    playing: p.playing === true,
    // Open-book intel. These were declared on NetPlayer and read by the market table but never
    // copied out of the raw presence blob, so every rival's cash/revenue/PMF column rendered
    // as "—". Coerced and bounded like everything else a peer sends.
    cash: typeof p.cash === 'number' && Number.isFinite(p.cash) ? Math.max(-1e12, Math.min(1e12, p.cash)) : undefined,
    rev: typeof p.rev === 'number' && Number.isFinite(p.rev) ? Math.max(0, Math.min(1e12, p.rev)) : undefined,
    pmf: typeof p.pmf === 'number' && Number.isFinite(p.pmf) ? Math.max(0, Math.min(100, p.pmf)) : undefined,
  }
}

/**
 * A hostile peer can track thousands of presence keys on one socket. The roster feeds React
 * lists and the market-share denominator, so it needs a hard ceiling — no real room is close.
 */
export const MAX_PLAYERS = 32

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
  players.sort((a, b) => Number(b.host) - Number(a.host) || a.company.localeCompare(b.company))
  // Keep our own slot even if a flood pushed us past the cut, so the store never loses track of us.
  if (players.length > MAX_PLAYERS) {
    const me = myState?.id
    const kept = players.slice(0, MAX_PLAYERS)
    if (me && !kept.some((p) => p.id === me)) {
      const mine = players.find((p) => p.id === me)
      if (mine) kept[kept.length - 1] = mine
    }
    return kept
  }
  return players
}

// ---------------------------------------------------------------------------------------------
// Peer message validation.
//
// Presence has one real guarantee: the key a peer tracks under is the identity that key's blob
// must claim (`normalizePlayer`). Broadcast has NO sender identity at all — Supabase delivers
// `{type, event, payload}` and nothing else — so `playerId` in a commit/reveal and `fromId` in
// an attack are simply strings the sender picked. Two rules make that survivable without a
// server refereeing the room:
//
//   1. Nobody may speak as me. Broadcast is configured `self: false`, so a payload claiming my
//      own id is always forged. This is the one that matters: without it a peer could publish a
//      commitment under my id, replacing my real one, then "reveal" any premium it liked and my
//      own client would believe I had bid it.
//   2. Nobody may speak as an id that is not in the room. That bounds the commit/bid lists to
//      the roster instead of letting one peer mint unlimited identities.
//
// Neither rule authenticates a peer against *another* peer — that needs signatures or Realtime
// Authorization; see docs/security-review.md. They do close the attacks that damage the
// receiving player's own game state.
// ---------------------------------------------------------------------------------------------

export interface PeerContext {
  /** This device's id. A payload claiming it is forged by definition. */
  selfId: string
  /** Ids currently visible in presence. Empty means "not synced yet" and skips the roster gate. */
  roster: ReadonlySet<string>
}

function peerId(v: unknown, ctx: PeerContext): string | null {
  const id = opaqueId(v)
  if (!id) return null
  if (id === ctx.selfId) return null // rule 1
  if (ctx.roster.size > 0 && !ctx.roster.has(id)) return null // rule 2
  return id
}

/**
 * Inbound token buckets. A modified client can send as fast as the socket allows; this bounds
 * what reaches the store and the DOM. Per-identity buckets stop one peer from monopolising a
 * channel; the global bucket is the one that actually holds, because `from` on a chat or emote
 * is just a company name a flooder can vary at will.
 */
const LIMITS: Record<string, { perSender: number; global: number; windowMs: number }> = {
  chat: { perSender: 6, global: 24, windowMs: 10_000 },
  emote: { perSender: 10, global: 40, windowMs: 10_000 },
  attack: { perSender: 4, global: 24, windowMs: 60_000 },
  // A war lasts six weeks and can be conceded once, so two a minute per peer is already
  // generous; the point is that this path ADDS users to our own persisted save.
  concede: { perSender: 2, global: 12, windowMs: 60_000 },
  commit: { perSender: 8, global: 48, windowMs: 60_000 },
  reveal: { perSender: 8, global: 48, windowMs: 60_000 },
  start: { perSender: 4, global: 12, windowMs: 60_000 },
}

const buckets = new Map<string, number[]>()

/** Exported so the rate limiter can be exercised deterministically in tests. */
export function resetRateLimits(): void {
  buckets.clear()
  seenCommitments.clear()
}

function take(key: string, limit: number, windowMs: number, now: number): boolean {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  // A flooder cycling identities would otherwise grow this map without bound.
  if (buckets.size > 256) for (const k of [...buckets.keys()].slice(0, 128)) buckets.delete(k)
  return true
}

export function allow(event: keyof typeof LIMITS | string, sender: string, now = Date.now()): boolean {
  const l = LIMITS[event]
  if (!l) return true
  if (!take(`g:${event}`, l.global, l.windowMs, now)) return false
  return take(`s:${event}:${sender}`, l.perSender, l.windowMs, now)
}

/**
 * A commitment is a 256-bit value bound to (candidate, premium, nonce, player). It is NOT bound
 * to a week, so the same string replayed in a later round would still verify. Remembering the
 * ones we have seen makes that replay a no-op without changing the hash preimage — which would
 * otherwise have to be rolled out to every client at once to avoid breaking live auctions.
 */
const seenCommitments = new Map<string, string>()

function commitmentIsFresh(commitment: string, playerId: string, week: number): boolean {
  const tag = `${playerId}@${week}`
  const prev = seenCommitments.get(commitment)
  if (prev !== undefined && prev !== tag) return false
  seenCommitments.set(commitment, tag)
  if (seenCommitments.size > 512) for (const k of [...seenCommitments.keys()].slice(0, 256)) seenCommitments.delete(k)
  return true
}

export function validateCommit(raw: unknown, ctx: PeerContext): CommitPayload | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const playerId = peerId(p.playerId, ctx)
  const candidateId = opaqueId(p.candidateId)
  const commitment = hex(p.commitment, 64)
  if (!playerId || !candidateId || !commitment) return null
  const week = int(p.week, 0, 10_000)
  if (!commitmentIsFresh(commitment, playerId, week)) return null
  return { candidateId, playerId, company: str(p.company, 30, 'A rival') || 'A rival', commitment, week }
}

export function validateReveal(raw: unknown, ctx: PeerContext): RevealPayload | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const playerId = peerId(p.playerId, ctx)
  const candidateId = opaqueId(p.candidateId)
  const nonce = hex(p.nonce, 32)
  if (!playerId || !candidateId || !nonce) return null
  return {
    candidateId,
    playerId,
    company: str(p.company, 30, 'A rival') || 'A rival',
    // bounded: an unbounded premium would auto-win every auction
    premiumPct: int(p.premiumPct, 0, 100),
    nonce,
    reputation: int(p.reputation, 0, 100),
    runwayWeeks: int(p.runwayWeeks, 0, 999),
    week: int(p.week, 0, 10_000),
  }
}

/**
 * The receive-side whitelist, and the ONLY place attack kinds are enumerated on the wire.
 *
 * It listed three kinds while the game shipped five: `hitpiece` and `pricewar` (engine.ts
 * `ATTACKS`) are offered against online peers by Market.tsx's PvpOps panel, the attacker paid
 * for them, and every victim's client silently dropped the packet. That also took the price-war
 * economy down with it — no `pricewar` ever arrived, so `priceWarFrom` was never set and a
 * concession had nobody to credit. A whitelist that falls behind the feature it guards deletes
 * the feature; keep this in sync with `AttackDef['id']`.
 */
const ATTACK_KINDS: ReadonlySet<string> = new Set(['poach', 'smear', 'raid', 'hitpiece', 'pricewar'])

export function validateAttack(raw: unknown, ctx: PeerContext): AttackPayload | null {
  const p = (raw ?? {}) as Record<string, unknown>
  // `has` on a Set, not a lookup in an object literal: `kind: '__proto__'` must not match.
  const kind = typeof p.kind === 'string' && ATTACK_KINDS.has(p.kind) ? (p.kind as AttackPayload['kind']) : null
  if (!kind) return null
  const targetId = opaqueId(p.targetId)
  // fromId is REQUIRED. The store dedupes incoming attacks with `fromId ?? fromCompany`, so a
  // sender that simply omitted it — or varied it freely — got one extra hit per week per value.
  const fromId = peerId(p.fromId, ctx)
  if (!targetId || !fromId) return null
  return { fromCompany: str(p.fromCompany, 30, 'A rival') || 'A rival', targetId, kind, fromId }
}

/**
 * A concession hands the war's initiator the customers the conceder just gave up, so it is the
 * one broadcast that ADDS value to the receiver's own save. It shipped with a store handler and
 * a sender but no validator — and therefore no listener in `wire()` either, which is why the
 * price-war economy never closed the loop in Arena.
 *
 * `fromId` is optional here, unlike an attack's: a concession is not rate-limited per-week by
 * identity, so there is nothing for a missing id to bypass, and older clients do not send one.
 * When it IS present it is held to the same two rules as everything else — nobody may speak as
 * me, nobody may speak as an id that is not in the room.
 */
export function validateConcede(raw: unknown, ctx: PeerContext): ConcedePayload | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const targetId = opaqueId(p.targetId)
  if (!targetId) return null
  if (p.fromId !== undefined && p.fromId !== null && !peerId(p.fromId, ctx)) return null
  return {
    fromCompany: str(p.fromCompany, 30, 'A rival') || 'A rival',
    targetId,
    // The engine clamps this again (`applyConcedeGain`), but a NaN reaching a persisted
    // GameState is not something to leave to the last line of defence: this number is added to
    // the receiver's user count and then written to localStorage.
    users: int(p.users, 0, MAX_CONCEDE_USERS),
  }
}

export function validateChat(raw: unknown): ChatPayload | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const text = str(p.text, 200).trim()
  if (!text) return null
  return { from: str(p.from, 30, 'Someone') || 'Someone', text }
}

export function validateEmote(raw: unknown): EmotePayload | null {
  const p = (raw ?? {}) as Record<string, unknown>
  return { from: str(p.from, 30, 'Someone') || 'Someone', emoji: str(p.emoji, 8, '👀') || '👀' }
}

/** What the UI should say about the socket. */
export type LinkState = 'live' | 'reconnecting' | 'offline'

let roomCode: string | null = null
let liveHandlers: Handlers | null = null
let rejoinTimer: ReturnType<typeof setTimeout> | null = null
let rejoinInFlight = false
let rejoinAttempt = 0
let lastWakeReset = 0
const WAKE_RESET_MS = 10_000
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

/**
 * The identity context every inbound broadcast is judged against, rebuilt per message.
 *
 * Built from `readPlayers()`, NOT from the raw presence keys. Those are two different sets: raw
 * keys are uncapped and unvalidated, so a peer tracking thousands of them used to get thousands
 * of accepted bidder identities that never appeared as players — past both the MAX_PLAYERS
 * ceiling and the self-consistency check that makes a presence key mean anything. The gate must
 * admit exactly the people the room can see.
 */
function peerContext(): PeerContext {
  return { selfId: myState?.id ?? '', roster: new Set(readPlayers().map((p) => p.id)) }
}

/** Attach every listener this room needs. Called fresh on each (re)join — channels aren't reusable. */
function wire(ch: RealtimeChannel, handlers: Handlers) {
  // Broadcast payloads are unauthenticated JSON from any peer — validate before handing them on,
  // and never let one malformed message throw inside the socket callback.
  const safe = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      console.warn('dropped a malformed realtime message', e)
    }
  }
  /** Validate, rate-limit, then dispatch. `sender` names the bucket the message is charged to. */
  const on = <T>(event: string, validate: (raw: unknown, ctx: PeerContext) => T | null, sender: (p: T) => string, run: (p: T) => void) => {
    ch.on('broadcast', { event }, ({ payload }) => {
      safe(() => {
        const p = validate(payload, peerContext())
        if (!p) return
        if (!allow(event, sender(p))) return
        run(p)
      })
    })
  }

  ch.on('presence', { event: 'sync' }, () => safe(() => handlers.onPlayers(readPlayers())))

  // 'start' carries no peer id of its own; the store checks hostId against the presence roster
  // (`validStart`). Rate-limited globally so a start-spammer cannot churn the room.
  ch.on('broadcast', { event: 'start' }, ({ payload }) =>
    safe(() => {
      const p = (payload ?? {}) as Record<string, unknown>
      if (!allow('start', str(p.hostId, 64, '?'))) return
      handlers.onStart(payload as StartPayload)
    }),
  )

  on('emote', (raw) => validateEmote(raw), (p) => p.from, (p) => handlers.onEmote?.(p))
  on('chat', (raw) => validateChat(raw), (p) => p.from, (p) => handlers.onChat?.(p))
  on('commit', validateCommit, (p) => p.playerId, (p) => handlers.onCommit?.(p))
  on('reveal', validateReveal, (p) => p.playerId, (p) => handlers.onReveal?.(p))
  on('attack', validateAttack, (p) => p.fromId ?? 'anon', (p) => handlers.onAttack?.(p))
  // `concede` had a sender (broadcastConcede), a store handler (onConcede) and no listener at
  // all, so conceding a price war removed the conceder's customers and gave them to nobody.
  on('concede', validateConcede, (p) => p.fromCompany, (p) => handlers.onConcede?.(p))
}

/** Tear down whatever channel we currently hold. Safe to call when there isn't one. */
async function dropChannel(): Promise<void> {
  const dead = channel
  channel = null
  if (!dead) return
  try {
    await (await getClient()).removeChannel(dead)
  } catch {
    // removing an already-dead channel is fine
  }
}

/**
 * Open (or reopen) the room channel. The subscribe callback fires for the WHOLE life of the
 * channel, not just the first join — handling only the initial status was why a dropped socket
 * left the player silently disconnected until they reloaded the page.
 */
async function openChannel(initial: boolean): Promise<void> {
  const code = roomCode
  const handlers = liveHandlers
  const me = myState
  if (!code || !handlers || !me) return

  const client = await getClient()
  // the room may have been left (or replaced) while the client chunk was loading —
  // opening a channel for it now would resurrect a membership nobody holds
  if (roomCode !== code || liveHandlers !== handlers || myState !== me) return

  const ch = client.channel(`fm-room-${code}`, {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  })
  channel = ch
  wire(ch, handlers)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    // Both failure paths must drop the channel before rejecting. The store's `connect` catches
    // the error and clears its own state, but the subscription stayed alive and kept retrying
    // its join in the background — a leaked channel per failed join attempt, and `inRoom()`
    // answering true for a room the player is not in.
    const timer = initial
      ? setTimeout(() => {
          settled = true
          void dropChannel()
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
            void dropChannel()
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
  // `rejoinInFlight` covers the window the timer id does not: once the timer has fired it sets
  // `rejoinTimer = null` and then awaits, and anything calling scheduleRejoin during that await
  // used to start a SECOND openChannel. Both created a channel, the second overwrote `channel`,
  // and the first was never removed — a leaked subscription per flap, still holding the topic
  // and still tracking presence, so the room saw a ghost copy of the player.
  if (!roomCode || rejoinTimer || rejoinInFlight) return
  setLink('reconnecting')
  const wait = Math.min(15_000, 800 * 2 ** rejoinAttempt)
  rejoinAttempt++
  rejoinTimer = setTimeout(async () => {
    rejoinTimer = null
    if (!roomCode) return
    rejoinInFlight = true
    try {
      await dropChannel()
      await openChannel(false)
    } catch {
      scheduleRejoin()
    } finally {
      rejoinInFlight = false
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
  if (rejoinInFlight) return // an attempt is already running; let it finish
  // Resetting the backoff on every wake let a flapping connection (or a user flicking between
  // tabs) hammer a reconnect every 800ms for as long as the outage lasted. Reset at most once
  // per WAKE_RESET_MS so the backoff still does its job.
  const now = Date.now()
  if (now - lastWakeReset > WAKE_RESET_MS) {
    lastWakeReset = now
    rejoinAttempt = 0
  }
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

export async function broadcastConcede(payload: ConcedePayload): Promise<void> {
  await channel?.send({ type: 'broadcast', event: 'concede', payload })
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
  lastWakeReset = 0
  // Buckets and seen-commitments are per-room state; carrying them into the next room would
  // let one room's traffic silence the next one's.
  resetRateLimits()
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
