import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  attackRival,
  buyShield,
  capabilitiesFromLegacyRules,
  migrateLegacySave,
  canStartVenture,
  ipoEligible,
  newGame,
  applyConcedeGain,
  pickHiringWinner,
  type AttackDef,
  runwayWeeks,
  totalUsers,
  effectiveTam,
  uid,
  valuation,
} from './game/engine'
// Replay verification: every simulation-mutating player action goes through `applyJournaled`,
// which journals the action and applies it via the registry in ./game/replay — the same code a
// replay executes. The store keeps its guards, sounds and network side effects; it no longer
// owns any mutation logic of its own, which is what makes the journal's coverage a property of
// the architecture rather than of discipline.
import { applyJournaled, sanitizeJournal } from './game/replay'
import { recordReplayProof } from './net/replayProof'
import { haptic, sfx } from './sound'
import { checkAchievements } from './game/achievements'
import { submitDailyScore } from './net/leaderboard'
import { currentProfile, oauthReturnError, onAuthChange, signInWith, signOut, type AuthProfile, type AuthProvider } from './net/auth'
import { fetchMyProfile, mergeHalls, pushProfileProgress, renameProfile, type ModeBest, type Profile, type ProfileBests } from './net/profile'
import { earnedAchievements } from './game/achievements'

// Evaluate achievement unlocks against a freshly-computed state and surface them in the flash banner.
function awardAchievements(g: GameState) {
  const fresh = checkAchievements(g)
  if (fresh.length > 0) {
    g.flash =
      (g.flash ? g.flash + ' · ' : '') +
      `🏆 Unlocked: ${fresh.map((a) => `${a.emoji} ${a.name}`).join(' · ')}`
    sfx.milestone()
  }
}
import { SECTORS, sectorById } from './game/data'
import { canRunExperiment } from './game/career/pmf'
import { migrateLivingWorldSlice } from './game/world/persistence'
import { migrateTokenSlice } from './game/token/persistence'
import type { LaunchDraft } from './game/token/launch'
import type { IncentiveShares } from './game/token/incentives'
import type { FounderKind, GameState, SectorId } from './game/types'
import { ROUND_SECONDS, onlineConfigured } from './net/config'
import {
  broadcastAttack,
  broadcastCommit,
  broadcastConcede,
  type ConcedePayload,
  broadcastReveal,
  hiringCommitment,
  makeNonce,
  broadcastChat,
  broadcastEmote,
  broadcastStart,
  connectRoom,
  onLinkStateChange,
  type LinkState,
  leaveRoom,
  makeRoomCode,
  myId,
  pushState,
  type AttackPayload,
  type BidPayload,
  type CommitPayload,
  type RevealPayload,
  type ChatPayload,
  type EmotePayload,
  type NetPlayer,
  type StartPayload,
} from './net/online'
import {
  defaultCapabilities,
  hasCapability,
  resolveGameRules,
  type CapabilityKey,
  sanitizeCapabilities,
  type GameCapabilities,
  type GameConfig,
  type GameFormat,
  type GameMode,
} from './game/modes'

export type ScreenId =
  | 'dashboard'
  | 'roadmap'
  | 'strategy'
  | 'team'
  | 'hiring'
  | 'product'
  | 'growth'
  | 'market'
  | 'finance'
  | 'fundraising'
  | 'inbox'
  | 'career'
  | 'discovery'
  | 'cohorts'
  | 'story'

export interface RunRecord {
  company: string
  sector: string
  /** ICO Slice 7 added `network`. Old hall entries never carry it, which is what the reader's
   *  `ENDINGS[r.ending] ?? …` fallbacks have always been for. */
  ending: 'bankrupt' | 'unicorn' | 'acquired' | 'fired' | 'timeup' | 'ipo' | 'network'
  weeks: number
  score: number // founder payout in $
  /** ms epoch of the run's end. Absent on entries recorded before profiles-v2 (2026-08-23) —
   *  the cross-device merge treats a run's identity as everything EXCEPT this field. */
  at?: number
}

const HALL_KEY = 'founder-mode-hall'

/**
 * Brief §28: components ask for a capability, never for a mode.
 *   const detailedPMF = useGameCapability('detailedPMF')
 */
export function useGameCapability(key: CapabilityKey): boolean {
  // Delegates rather than re-reading `s.game?.capabilities?.[key]`: there must be exactly one
  // definition of what "capability on" means, and it lives in ./game/modes.
  return useStore((s) => hasCapability(s.game, key))
}

export function readHall(): RunRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(HALL_KEY) ?? '[]')
    return Array.isArray(v) ? v : [] // a corrupt value must not break .push() later
  } catch {
    return []
  }
}

// Per-mode personal bests, kept locally for every player and merged into the profile when one
// exists. The hall above is a flat top-10; the profile card wants "your best Quick Play run"
// and "your best Career run" as separate facts.
const BESTS_KEY = 'founder-mode-bests'

/**
 * Lifetime finished-run count. The hall of fame keeps the TOP TEN by score, so `readHall().length`
 * silently stops counting at ten — fine for a leaderboard, wrong for "companies built", which is a
 * biography. Absent means "no counter yet": fall back to the hall's length so an existing player's
 * number does not drop to zero on the day this shipped.
 */
const RUNS_KEY = 'founder-mode-runs'
/** The server's counter as of this device's last completed sync — the base the delta scheme in
 *  nextRunCount adds on top of. Absent = this device never synced under profiles-v2. */
const RUNS_SYNCED_KEY = 'founder-mode-runs-synced'

export function readRunCount(): number {
  try {
    const n = Number(localStorage.getItem(RUNS_KEY))
    return Number.isFinite(n) && n > 0 ? n : readHall().length
  } catch {
    return 0
  }
}

function readRunBase(): number | null {
  try {
    const v = localStorage.getItem(RUNS_SYNCED_KEY)
    if (v === null) return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

export function readLocalBests(): ProfileBests {
  try {
    const v = JSON.parse(localStorage.getItem(BESTS_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function recordLocalBest(mode: 'quick' | 'career' | 'arena', best: ModeBest): void {
  const bests = readLocalBests()
  if (!bests[mode] || best.score > bests[mode]!.score) {
    bests[mode] = best
    try {
      localStorage.setItem(BESTS_KEY, JSON.stringify(bests))
    } catch {
      // private mode / quota: the profile just doesn't remember this one
    }
  }
}

// The soundtrack of consequence: play whatever the new week deserves.
function weekSounds(next: GameState) {
  if (next.gameOver) {
    switch (next.gameOver.type) {
      case 'bankrupt':
      case 'fired':
        sfx.thud()
        return
      case 'unicorn':
        sfx.fanfare()
        return
      case 'ipo':
        sfx.bell()
        return
      case 'acquired':
        sfx.cash()
        return
      case 'timeup':
        sfx.bell()
        return
      // ICO Slice 7. A win, so it gets the win sound — there is no bell to ring on this path.
      case 'network':
        sfx.fanfare()
        return
    }
  }
  if (next.flash?.startsWith('🏁') || next.flash?.startsWith('🏆') || next.flash?.startsWith('📖')) sfx.milestone()
  else if (next.flash?.startsWith('IPO pulled')) sfx.ominous()
  else if (next.inbox[0]?.title === 'Board ultimatum' && !next.inbox[0].resolved) sfx.ominous()
  // a Major Moment just landed (V2): outage, board intervention, price war… — the room goes quiet
  else if (next.inbox.slice(0, 4).some((m) => m.kind === 'choice' && !m.resolved && /^(🔥|🏛|🚪|⚖️|🔓|⚔️)/u.test(m.title))) sfx.ominous()
  else sfx.week()
}

function recordRun(g: GameState) {
  if (!g.gameOver) return
  const score = g.gameOver.payout ?? 0
  // the profile's per-mode best — recorded for everyone, synced upward when signed in
  const mode = g.config?.mode ?? 'quick'
  if (mode === 'quick' || mode === 'career' || mode === 'arena') {
    recordLocalBest(mode, {
      score,
      weeks: g.gameOver.week,
      ending: g.gameOver.type,
      company: g.companyName,
      at: Date.now(),
    })
    // sync moved BELOW: it reads the hall and the counter, which are written after this block —
    // firing here shipped a profile that was always one run behind (fixed with profiles-v2)
  }
  try {
    localStorage.setItem(RUNS_KEY, String(readRunCount() + 1))
  } catch {
    // private mode / quota — the biography just does not count this one
  }
  // Guarded like the counter write above: in private mode setItem THROWS, and an unguarded
  // throw here used to skip the profile sync below entirely (review finding, 2026-08-23).
  try {
    const runs = readHall()
    runs.push({
      company: g.companyName,
      sector: sectorById(g.sector).name,
      ending: g.gameOver.type,
      weeks: g.gameOver.week,
      score,
      at: Date.now(),
    })
    runs.sort((a, b) => b.score - a.score)
    localStorage.setItem(HALL_KEY, JSON.stringify(runs.slice(0, 10)))
  } catch {
    // storage full / private mode — the hall misses this one, the sync below still runs
  }
  // AFTER the hall and the counter exist, so this run is in what gets pushed (profiles-v2)
  void useStore.getState().syncProfileProgress()
  // daily challenge scores also go to the global leaderboard (no-op until Supabase is configured)
  // Brief §30: leaderboard availability is a CAPABILITY, not a format check. The label is
  // still parsed for the challenge number, but the capability decides whether we submit.
  const daily = g.challenge?.label.match(/^Daily #(\d+)/)
  if (daily && hasCapability(g, 'leaderboard')) {
    // The leaderboard schema has no column for a decision log yet (schema work is out of scope),
    // so the proof rides locally: the run's journal, header and fingerprint are stored on this
    // device, marked verifiable, ready for a future submission path that can carry them.
    try {
      recordReplayProof(g, Number(daily[1]))
    } catch {
      // the proof is decoration on top of the score — it must never break the results screen
    }
    const finished = g.gameOver
    void (async () => {
      // the NICKNAME, never the OAuth name — and fetched on demand if the profile hasn't loaded
      // yet, so a signed-in player's attribution doesn't depend on a race with initAuth
      const st = useStore.getState()
      const nickname = st.profile?.nickname ?? (st.authUser ? (await fetchMyProfile())?.nickname : null) ?? null
      return submitDailyScore(Number(daily[1]), {
        company: g.companyName,
        score,
        weeks: finished.week,
        ending: finished.type,
        display_name: nickname,
      })
    })()
  }
}

// ---------- daily challenge ----------

const DAILY_EPOCH = 20666 // days-since-1970 of challenge #1

export function dailyInfo(): { seed: number; id: number; sector: SectorId } {
  const day = Math.floor(Date.now() / 86_400_000)
  return { seed: day * 7919, id: day - DAILY_EPOCH + 1, sector: SECTORS[day % SECTORS.length].id }
}

export interface NewGameSetup {
  /** quick | career — Arena has its own room flow */
  mode: Exclude<GameMode, 'arena'>
  format: GameFormat
  sector: SectorId
  name: string
  founder: FounderKind
  scenario?: string
  /** Simulation + Quick Play: opt into the Business Simulation V2 engine (beta) for this run. */
  engineV2?: boolean
  /** difficulty tier — same game, priced differently (src/game/tuning.ts). Absent = standard. */
  difficulty?: 'relaxed' | 'standard' | 'brutal'
}

export const MATCH_CAP = 104 // weeks in a capped run (daily & online matches)
const CATCH_UP_LIMIT = 120 // most weeks we'll ever replay in one go to rejoin a room

export interface OnlineSession {
  code: string
  host: boolean
  phase: 'lobby' | 'playing'
  sector: SectorId
  myCompany: string
  myFounder: FounderKind
  players: NetPlayer[]
  deadline: number | null // ms epoch when the current round auto-readies
  /** Who declared the running price war on us — the only founder a concession may credit. */
  priceWarFrom?: string
  /** Phase 1: hashes only. Tells you WHO is bidding on whom, never how much. */
  commits: CommitPayload[]
  /** Phase 2: reveals that hashed back to their commitment. Only these become real bids. */
  bids: BidPayload[]
  error: string | null
}

// The minimal breadcrumb persisted across reloads so a refresh doesn't eject you from the match.
export interface OnlineResume {
  code: string
  host: boolean
  phase: 'lobby' | 'playing'
  sector: SectorId
  myCompany: string
  myFounder: FounderKind
}

export interface EmoteToast {
  id: string
  from: string
  emoji: string
}

export interface ChatMessage {
  id: string
  from: string
  text: string
  self: boolean
}

interface Store {
  game: GameState | null
  online: OnlineSession | null
  onlineResume: OnlineResume | null
  reconnecting: boolean
  /** Socket health for the online room — drives the reconnect banner. */
  link: LinkState
  emotes: EmoteToast[]
  chat: ChatMessage[]
  authUser: AuthProfile | null
  /** Human-readable reason the last OAuth redirect failed, or null. Shown beside the sign-in buttons. */
  authError: string | null
  /** The public profile: nickname, badge wall, per-mode bests. Null until signed in and loaded. */
  profile: Profile | null
  connecting: boolean
  screen: ScreenId
  setScreen: (s: ScreenId) => void
  startGame: (setup: NewGameSetup) => void
  abandonGame: () => void
  advance: () => void
  // --- online ---
  hostRoom: (company: string, founder: FounderKind) => Promise<void>
  joinRoom: (code: string, company: string, founder: FounderKind) => Promise<void>
  leaveOnline: () => void
  setMyCompany: (name: string) => void
  beginMatch: (sector: SectorId, caps?: Partial<GameCapabilities>, cap?: number) => void
  attackPlayer: (targetId: string, kind: AttackDef['id']) => void
  /** Single player's counter-punch: the same attack economy, aimed at an AI rival. */
  attackRival: (rivalId: string, kind: AttackDef['id']) => void
  buyShield: () => void
  resumeOnline: () => Promise<void>
  cancelReady: () => void
  sendEmote: (emoji: string) => void
  sendChat: (text: string) => void
  initAuth: () => Promise<void>
  syncProfileProgress: () => Promise<void>
  renameProfileTo: (nickname: string) => Promise<string | null>
  signIn: (provider: AuthProvider) => Promise<string | null>
  signOutUser: () => Promise<void>
  // --- in-game actions ---
  /** premiumPct is only meaningful under `sharedHiringPool`, where the offer is a sealed bid. */
  sendOffer: (candidateId: string, premiumPct?: number) => void
  fire: (employeeId: string) => void
  giveRaise: (employeeId: string) => void
  doPivot: () => void
  // --- Career: PMF Discovery ---
  runExperiment: (type: import('./game/career/types').ExperimentType, segmentId: string, standing?: boolean) => void
  /** Turn a running study's auto-renew on or off without cancelling it. */
  setExperimentStanding: (experimentId: string, standing: boolean) => void
  /** Step out of a price war early: prices go back up and some customers follow the cheaper option. */
  concedePriceWar: () => void
  setTargetSegment: (segmentId: string) => void
  setPricing: (p: import('./game/career/types').PricingStrategy) => void
  setProductFocus: (f: import('./game/career/types').ProductFocus) => void
  fileIPO: () => void
  startBet: (sector: SectorId) => void
  shelveBet: (ventureId: string) => void
  buyRival: (rivalId: string, method: 'cash' | 'stock') => void
  rallyTeam: (style: 'vision' | 'numbers' | 'war') => void
  takeDebt: (amount: number) => void
  payDebt: (amount: number) => void
  recharge: () => void
  doSecondary: () => void
  setAllocation: (key: 'features' | 'quality' | 'bugs' | 'research' | 'bet', value: number) => void
  roadmapStart: (id: string) => void
  roadmapCancel: (id: string) => void
  betChoose: (t: string) => void
  setGrowthMix: (v: number) => void
  aiStart: (id: string) => void
  v2Research: (kind: string, segmentId: string) => void
  v2SetPrice: (v: number) => void
  counterSheet: (index: number) => void
  v2SetPositioning: (seg: string) => void
  aiCancel: (id: string) => void
  setAttentionFocus: (a: string | null) => void
  setAttentionAllocation: (alloc: Record<string, number>) => void
  betAbandon: () => void
  setMarketing: (value: number) => void
  resolveChoice: (messageId: string, choiceIndex: number) => void
  /**
   * Living World Phase 8. Answer one structured room: ask an interview question, reply to an
   * employee, take a board decision. Writes only to `game.world` — no simulation field moves.
   */
  answerInteraction: (interactionId: string, optionId: string) => void
  pitch: () => void
  accept: (sheetId: string) => void
  decline: (sheetId: string) => void
  /** ICO Slice 1. Returns false if the fork was refused (capability off, or a blocker remains). */
  tokenise: (draft?: LaunchDraft) => boolean
  /** ICO Slice 4. Point the treasury's weekly budget at the six incentive categories. */
  setIncentives: (shares: Partial<IncentiveShares>) => void
  /** ICO Slice 4. Sell treasury tokens for company cash — the token path's fundraising. */
  sellTreasury: (tokens: number) => boolean
  /** ICO Slice 7, brief §42. Sell from your OWN vested position — personal cash, into bankedPayout. */
  sellFounderPosition: (tokens: number) => boolean
  /** ICO Slice 6. Take a public position on an active proposal — the campaign, priced once. */
  setProposalStance: (proposalId: string, stance: 'support' | 'oppose') => boolean
  /** ICO Slice 6. Tear up a standing mandate — the priced defiance. */
  defyMandate: (proposalId: string) => boolean
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      // ---- online protocol helpers ----

      const myNetSummary = (g: GameState): Partial<NetPlayer> => ({
        playing: true,
        week: g.week,
        users: totalUsers(g),
        val: valuation(g),
        over: !!g.gameOver,
        overType: g.gameOver?.type,
        payout: g.gameOver?.payout ?? 0,
        cash: Math.round(g.cash),
        rev: Math.round(g.lastRevenue),
        pmf: Math.round(g.pmf),
      })

      // Peer-reported and therefore untrusted: normalizePlayer bounds each value, and the
      // sum is capped again so no combination of peers can crush everyone's growth headroom.
      /**
       * How many customers the OTHER founders in this room have taken out of the market.
       *
       * EACH PEER IS CAPPED AT THE MARKET ITSELF (security audit, 2026-08-22). Presence values are
       * self-reported and presence updates are not rate-limited, so one peer tracking
       * `users: 1e10` — 166× the largest sector's TAM, and inside the wire's MAX_USERS clamp —
       * used to land whole in this sum. It feeds `marketSaturation`, whose growth room is
       * `(1 − saturation)^1.2`, so a single presence write collapsed every other player's
       * acquisition and revenue to ~zero for the rest of the match, and each victim's client
       * persisted the wrecked result to their own save as the weeks advanced.
       *
       * A company cannot hold more of a market than the market contains, so `effectiveTam` is the
       * honest ceiling: it cannot block legitimate play (the simulation's own `room` term stops
       * real players well below it) and it bounds a liar to one ordinary competitor's worth of
       * pressure. This does NOT authenticate peers — nothing client-side can — it removes the
       * asymmetry that made lying overwhelming rather than merely rude.
       */
      const othersUsers = (players: NetPlayer[], g: GameState): number => {
        const cap = effectiveTam(g)
        return Math.min(
          1e10,
          players.reduce(
            (a, p) => (p.id === myId() || p.over ? a : a + (Number.isFinite(p.users) ? Math.min(cap, Math.max(0, p.users)) : 0)),
            0,
          ),
        )
      }

      /**
       * Settle the room's shared candidate market for this week. Every founder ran the same pure
       * `pickHiringWinner` over the same bids, so all clients agree on who got whom without a
       * server refereeing it.
       */
      const settleHiring = (g: GameState, bids: BidPayload[]): GameState => {
        if (bids.length === 0) return g
        const seed = g.config?.seed
        if (seed === undefined) return g
        const game = structuredClone(g)
        const byCandidate = new Map<string, BidPayload[]>()
        for (const b of bids) {
          if (b.week !== game.week) continue
          byCandidate.set(b.candidateId, [...(byCandidate.get(b.candidateId) ?? []), b])
        }
        const won: string[] = []
        const lost: string[] = []
        for (const [candidateId, list] of byCandidate) {
          const cand = game.candidates.find((c) => c.id === candidateId)
          if (!cand) continue
          const winner = pickHiringWinner(cand, list, seed, game.week)
          if (!winner) continue
          game.candidates = game.candidates.filter((c) => c.id !== candidateId)
          if (winner.playerId === myId()) {
            // pay the premium you offered — the auction is only meaningful if the bid binds
            won.push(`${cand.name}${winner.premiumPct > 0 ? ` (+${winner.premiumPct}%)` : ''}`)
            game.offersOut.push({ ...cand, salary: Math.round((cand.salary * (1 + winner.premiumPct / 100)) / 1000) * 1000 })
          } else if (list.some((b) => b.playerId === myId())) {
            lost.push(`${cand.name} went to ${winner.company}`)
          }
        }
        const parts = [won.length ? `Won: ${won.join(', ')}` : '', lost.length ? `Lost: ${lost.join(', ')}` : ''].filter(Boolean)
        if (parts.length) game.flash = `Hiring market — ${parts.join(' · ')}`
        return game
      }

      let advancing = false
      // My own readiness is owned locally, never read back off the wire. `channel.track` round-trips
      // asynchronously, so a presence sync can carry a stale copy of me and silently un-ready me —
      // and since the week only moves on a sync or a ready click, there was nothing left to retrigger
      // it. Both clients then sat on "Waiting for rivals" forever.
      let myReady = false
      /** My own sealed bid this round — I hold the nonce until it is time to reveal. */
      let myBid: { candidateId: string; premiumPct: number; nonce: string; reputation: number; runwayWeeks: number; week: number } | null = null
      const attacksTakenThisWeek = new Set<string>()

      // The 'start' broadcast is unauthenticated: only the presence-declared host may open a match,
      // and every field has to be sane before it becomes a GameState (a bad sector white-screens
      // the app, a bad cap can hang it, a stale deadline forfeits everyone's first turn).
      const validStart = (
        p: StartPayload,
        players: NetPlayer[],
      ): { seed: number; sector: SectorId; cap: number; caps: Partial<GameCapabilities> } | null => {
        // Fail CLOSED. This read `host && p.hostId && p.hostId !== host.id`, so omitting hostId
        // skipped the check entirely and any peer in the lobby could start the match on everyone's
        // behalf. An unsigned start is now refused outright.
        const host = players.find((x) => x.host)
        if (!host || !p.hostId || p.hostId !== host.id) return null
        if (!SECTORS.some((s) => s.id === p.sector)) return null
        if (!Number.isFinite(p.seed)) return null
        if (!Number.isInteger(p.cap) || p.cap < 1 || p.cap > 520) return null
        // accept the new capability payload, and still understand the old 10-key Ruleset
        const caps: Partial<GameCapabilities> = {
          ...capabilitiesFromLegacyRules(p.rules),
          ...sanitizeCapabilities(p.caps),
        }
        return { seed: p.seed, sector: p.sector, cap: p.cap, caps }
      }

      // Called on every presence sync: catch up if behind, advance if everyone is ready.
      const maybeNetAdvance = () => {
        const { game, online } = get()
        if (!game || !online || online.phase !== 'playing' || advancing) return
        if (online.players.length === 0) return
        // My own row is locally owned, so a stale presence echo can never un-ready me or rewind my week.
        const players = online.players.map((p) =>
          p.id === myId() ? { ...p, ready: myReady, week: game.week, absent: false } : p,
        )

        // catch up if the room has moved past us (e.g. we reconnected). A peer can advertise any
        // week it likes, so never simulate past the match cap or for more than a sane number of turns.
        // Commit a simulated week. `advancing` MUST come back down even if advanceWeek throws —
        // leaving it latched used to brick the client for the rest of the match, and because the
        // other players wait on our readiness it took the whole room down with it.
        const commit = (g: GameState) => {
          if (g.gameOver) recordRun(g)
          weekSounds(g)
          haptic(g.gameOver ? [12, 60, 12] : 8)
          awardAchievements(g)
          myReady = false
          myBid = null
          // we arrive mid-round: give ourselves the rest of this round, not an expired clock
          set({ game: g, online: { ...get().online!, deadline: Date.now() + ROUND_SECONDS * 1000, commits: [], bids: [] } })
          void pushState({ ...myNetSummary(g), ready: false })
        }

        const cap = game.challenge?.cap ?? MATCH_CAP
        const maxWeek = Math.min(cap, Math.max(...players.map((p) => p.week)))
        if (!game.gameOver && maxWeek > game.week) {
          let g = game
          advancing = true
          try {
            for (let i = 0; i < CATCH_UP_LIMIT && g.week < maxWeek && !g.gameOver; i++) g = advanceWeek(g, othersUsers(players, g))
          } catch (e) {
            console.error('catch-up failed; staying on the current week', e)
            return
          } finally {
            advancing = false
          }
          commit(g)
          return
        }

        // Advance when every living player who is actually in the match is ready for this week.
        // Someone still sitting in the lobby (joined late, or mid-reconnect) must not deadlock the
        // room — and neither must someone whose presence dropped: they keep their leaderboard row
        // and their share of the market, but they cannot hold the clock.
        const living = players.filter((p) => !p.over && p.playing !== false && !p.absent)
        if (living.length === 0) return
        const allReady = living.every((p) => p.ready && p.week >= game.week)
        if (!allReady) return
        if (game.gameOver) return
        // The shared hiring market settles before the week runs: every founder's sealed offer is
        // in by now (the week cannot advance until everyone is ready), so the candidate can choose.
        const settled = hasCapability(game, 'sharedHiringPool') ? settleHiring(game, online.bids) : game

        let next: GameState
        advancing = true
        try {
          next = advanceWeek(settled, othersUsers(players, settled))
        } catch (e) {
          console.error('week failed to simulate; staying put', e)
          return
        } finally {
          advancing = false
        }
        commit(next)
      }

      // Safety net. The week only moved on a presence sync or a ready click, so one dropped or
      // stale sync could leave every player ready and the room frozen with no event left to
      // retrigger it. Re-checking on a timer makes that state self-healing instead of terminal.
      setInterval(() => {
        if (get().online?.phase === 'playing') maybeNetAdvance()
      }, 1000)

      // The transport reconnects itself; this is only so the UI can say so out loud.
      onLinkStateChange((link) => set({ link }))

      // toast an emote for ~4 seconds
      const showEmote = (p: EmotePayload) => {
        const toast: EmoteToast = { id: uid(), from: p.from, emoji: p.emoji }
        set({ emotes: [...get().emotes, toast].slice(-5) })
        setTimeout(() => set({ emotes: get().emotes.filter((e) => e.id !== toast.id) }), 4000)
      }

      const appendChat = (p: ChatPayload, self: boolean) => {
        const msg: ChatMessage = { id: uid(), from: p.from, text: p.text.slice(0, 200), self }
        set({ chat: [...get().chat, msg].slice(-100) })
      }

      const handlers = {
        onPlayers: (incoming: NetPlayer[]) => {
          const online = get().online
          if (!online) return
          // Presence is ephemeral: a backgrounded tab or a blipped socket drops a peer from the next
          // sync even though they are still in the match. In a lobby that is correct — people really
          // do leave. Once the match is under way the roster is fixed, so keep everyone we have seen
          // and flag them absent rather than deleting them. Deleting erased a rival from the
          // leaderboard AND from the market-share denominator, which then read as 100% share.
          let players = incoming
          if (online.phase === 'playing') {
            const now = Date.now()
            const merged = new Map<string, NetPlayer>(
              incoming.map((p) => [p.id, { ...p, absent: false, absentSince: undefined }]),
            )
            for (const prev of online.players) {
              // keep the ORIGINAL absentSince across syncs, or the clock restarts every second
              if (!merged.has(prev.id)) merged.set(prev.id, { ...prev, absent: true, absentSince: prev.absentSince ?? now })
            }
            players = [...merged.values()].sort((a, b) => Number(b.host) - Number(a.host) || a.company.localeCompare(b.company))
          }
          // my own row is locally owned — a stale echo must never un-ready me (see `myReady`)
          players = players.map((p) => (p.id === myId() ? { ...p, ready: myReady, absent: false } : p))
          // host migration: if the host vanished from a lobby, the lowest player id takes the chair
          if (online.phase === 'lobby' && players.length > 0 && !players.some((p) => p.host)) {
            const minId = [...players].sort((a, b) => a.id.localeCompare(b.id))[0].id
            if (minId === myId()) {
              void pushState({ host: true })
              set({ online: { ...online, host: true, players } })
              maybeNetAdvance()
              return
            }
          }
          set({ online: { ...online, players } })
          maybeNetAdvance()
        },
        onCommit: (p: CommitPayload) => {
          const { game, online } = get()
          if (!game || !online || p.week !== game.week) return // a commitment for another week is stale
          if (!hasCapability(game, 'sharedHiringPool')) return
          // one target per founder per round — see sendOffer for why selective reveal needs this
          const commits = [...online.commits.filter((c) => c.playerId !== p.playerId), p]
          set({ online: { ...online, commits } })
        },

        onReveal: (p: RevealPayload) => {
          const { game, online } = get()
          if (!game || !online || p.week !== game.week) return
          if (!hasCapability(game, 'sharedHiringPool')) return
          // Verify NOW, while we can await the digest — settlement runs synchronously inside the
          // week advance and must not have to hash anything.
          void (async () => {
            const commit = get().online?.commits.find((c) => c.playerId === p.playerId && c.candidateId === p.candidateId)
            if (!commit) return // revealing something you never committed to buys you nothing
            const expected = await hiringCommitment(p.candidateId, p.premiumPct, p.nonce, p.playerId)
            if (expected !== commit.commitment) {
              console.warn('discarded a hiring reveal that did not match its commitment', p.playerId)
              return
            }
            const cur = get().online
            if (!cur || get().game?.week !== p.week) return
            const bid: BidPayload = {
              candidateId: p.candidateId,
              playerId: p.playerId,
              company: p.company,
              premiumPct: p.premiumPct,
              reputation: p.reputation,
              runwayWeeks: p.runwayWeeks,
              week: p.week,
            }
            set({ online: { ...cur, bids: [...cur.bids.filter((b) => b.playerId !== p.playerId), bid] } })
          })()
        },
        onConcede: (p: ConcedePayload) => {
          const g = get().game
          if (!g || g.gameOver || p.targetId !== myId()) return
          if (!hasCapability(g, 'pvpActions')) return
          const game = structuredClone(g)
          applyConcedeGain(game, p.fromCompany, p.users)
          sfx.cash()
          set({ game })
          void pushState(myNetSummary(game))
        },

        onEmote: showEmote,
        onChat: (p: ChatPayload) => appendChat(p, false),
        onAttack: (p: AttackPayload) => {
          if (p.targetId !== myId()) return
          const g = get().game
          if (!g || g.gameOver) return
          if (!hasCapability(g, 'pvpActions')) return // attacks don't exist in a match where PvP is off
          // One hit per attacker per week, however many packets they send. Keyed on fromId ONLY:
          // falling back to fromCompany let an attacker vary the name they sent and land unlimited
          // free hits, since the company string is theirs to choose. A payload with no id is not
          // rate-limitable at all, so it is dropped rather than trusted.
          if (!p.fromId) return
          const key = `${p.fromId}@${g.week}`
          if (attacksTakenThisWeek.has(key)) return
          attacksTakenThisWeek.add(key)
          const game = structuredClone(g)
          applyAttackIncoming(game, p.kind, p.fromCompany)
          // Remember who started it: a concession must credit the initiator, not whoever is nearest.
          if (p.kind === 'pricewar' && p.fromId) set({ online: { ...get().online!, priceWarFrom: p.fromId } })
          sfx.ominous()
          set({ game })
          void pushState(myNetSummary(game))
        },
        onStart: (p: StartPayload) => {
          const online = get().online
          if (!online || online.phase === 'playing') return
          const start = validStart(p, online.players)
          if (!start) return // malformed, or not from the host
          const config: GameConfig = {
            mode: 'arena',
            format: 'standard',
            sector: start.sector,
            seed: start.seed,
            overrides: start.caps,
          }
          const g = newGame(online.myCompany, start.sector, online.myFounder, {
            config,
            challenge: { label: 'Online match', cap: start.cap },
            aiRivals: false, // the other players are the rivals
          })
          set({
            game: g,
            online: { ...online, phase: 'playing', sector: start.sector, deadline: Date.now() + ROUND_SECONDS * 1000 },
            onlineResume: get().onlineResume ? { ...get().onlineResume!, phase: 'playing', sector: start.sector } : null,
            screen: 'dashboard',
          })
          void pushState({ ...myNetSummary(g), ready: false })
        },
      }

      const connect = async (code: string, host: boolean, company: string, founder: FounderKind) => {
        if (!onlineConfigured) return
        set({ connecting: true })
        const me: NetPlayer = {
          id: myId(),
          company: company || 'Untitled Inc.',
          founder,
          host,
          week: 0,
          ready: false,
          users: 0,
          val: 0,
          payout: 0,
          over: false,
        }
        try {
          await connectRoom(code, me, handlers)
          set({
            connecting: false,
            game: null,
            online: {
              code,
              host,
              phase: 'lobby',
              sector: 'saas',
              myCompany: me.company,
              myFounder: founder,
              players: [me],
              deadline: null,
              commits: [],
              bids: [],
              error: null,
            },
            onlineResume: { code, host, phase: 'lobby', sector: 'saas', myCompany: me.company, myFounder: founder },
          })
        } catch (e) {
          set({ connecting: false, online: null, onlineResume: null })
          throw e
        }
      }

      return {
        game: null,
        online: null,
        onlineResume: null,
        reconnecting: false,
        link: 'offline' as LinkState,
        emotes: [],
        chat: [],
        authUser: null,
        authError: null,
        profile: null,
        connecting: false,
        screen: 'dashboard',
        setScreen: (screen) => set({ screen }),

        startGame: (setup) => {
          const daily = setup.format === 'daily_challenge'
          const info = dailyInfo()
          const sector = daily ? info.sector : setup.sector
          const config: GameConfig = {
            mode: setup.mode,
            format: setup.format,
            sector,
            scenario: daily ? undefined : setup.scenario,
            seed: daily ? info.seed : Math.floor(Math.random() * 2 ** 31),
            // V2 is opt-in while under calibration (contract D1; quick joined as beta 2026-08-25).
            // DAILY runs on V2 for everyone since 2026-08-26: a shared ranked seed needs the
            // better-audited economy, and the flip is clean on a day boundary.
            ...((setup.mode === 'career' || setup.mode === 'quick') && setup.engineV2 ? { engine: 'v2' as const } : {}),
            ...(daily ? { engine: 'v2' as const } : {}),
            // daily is a shared, ranked seed — everyone plays the same difficulty
            ...(setup.difficulty && setup.difficulty !== 'standard' && !daily ? { difficulty: setup.difficulty } : {}),
          }
          const rules = resolveGameRules(config)
          const g = newGame(setup.name || 'Untitled Inc.', sector, setup.founder, {
            config,
            challenge: rules.maxTurns ? { label: daily ? `Daily #${info.id}` : 'Capped run', cap: rules.maxTurns } : null,
            scenario: config.scenario,
          })
          // Replay verification: solo runs record their decision log from week 1. Arena games are
          // built in onStart instead and never journal — peer inputs are not in any local log.
          g.journal = []
          set({
            game: g,
            online: null,
            screen: 'dashboard',
          })
        },

        abandonGame: () => {
          void leaveRoom()
          set({ game: null, online: null, onlineResume: null, chat: [], screen: 'dashboard' })
        },

        advance: () => {
          const { game, online } = get()
          if (!game) return
          if (!online) {
            if (game.gameOver) return
            const { state: next } = applyJournaled(game, 'advance')
            if (next.gameOver) recordRun(next)
            weekSounds(next)
            haptic(next.gameOver ? [12, 60, 12] : 8)
            awardAchievements(next)
            set({ game: next })
            return
          }
          // online: mark myself ready; the week moves when everyone is
          if (game.gameOver) return
          sfx.week()
          myReady = true
          // Reveal as we lock in. Safe now: every bid is already committed, so a rival seeing our
          // number cannot change theirs. Sent BEFORE the ready flag so it lands first.
          if (myBid && myBid.week === game.week && hasCapability(game, 'sharedHiringPool')) {
            const r: RevealPayload = { ...myBid, playerId: myId(), company: online.myCompany }
            const asBid: BidPayload = {
              candidateId: r.candidateId,
              playerId: r.playerId,
              company: r.company,
              premiumPct: r.premiumPct,
              reputation: r.reputation,
              runwayWeeks: r.runwayWeeks,
              week: r.week,
            }
            set({ online: { ...online, bids: [...online.bids.filter((b) => b.playerId !== r.playerId), asBid] } })
            void broadcastReveal(r)
          }
          const players = get().online!.players.map((p) => (p.id === myId() ? { ...p, ready: true } : p))
          set({ online: { ...get().online!, players } })
          void pushState({ ready: true, ...myNetSummary(game) })
          maybeNetAdvance()
        },

        hostRoom: async (company, founder) => {
          await connect(makeRoomCode(), true, company, founder)
        },

        joinRoom: async (code, company, founder) => {
          await connect(code.trim().toUpperCase(), false, company, founder)
        },

        // Rename yourself from inside the lobby. Every player needs this — someone who joined
        // straight from a shared code never passed through the start screen's name field and
        // would otherwise be stuck as "Untitled Inc." for the whole match.
        setMyCompany: (name) => {
          const online = get().online
          if (!online || online.phase !== 'lobby') return // the name is baked into GameState once the match starts
          const company = name.trim().slice(0, 24) || 'Untitled Inc.'
          const players = online.players.map((p) => (p.id === myId() ? { ...p, company } : p))
          set({
            online: { ...online, myCompany: company, players },
            onlineResume: get().onlineResume ? { ...get().onlineResume!, myCompany: company } : null,
          })
          void pushState({ company })
        },

        leaveOnline: () => {
          void leaveRoom()
          set({ online: null, game: null, onlineResume: null, chat: [], screen: 'dashboard' })
        },

        // After a refresh or crash: rejoin the room this device was in. The catch-up logic
        // in maybeNetAdvance replays any weeks the table played without us.
        resumeOnline: async () => {
          const r = get().onlineResume
          if (!r || get().online || !onlineConfigured) return
          const g = get().game
          // a lobby session with no game just rejoins the lobby; a match session needs its game back
          if (r.phase === 'playing' && (!g || g.challenge?.label !== 'Online match')) {
            set({ onlineResume: null })
            return
          }
          set({ reconnecting: true })
          const me: NetPlayer = {
            id: myId(),
            company: r.myCompany,
            founder: r.myFounder,
            host: r.host,
            week: g?.week ?? 0,
            ready: false,
            users: g ? totalUsers(g) : 0,
            val: g ? valuation(g) : 0,
            payout: g?.gameOver?.payout ?? 0,
            over: !!g?.gameOver,
            overType: g?.gameOver?.type,
          }
          try {
            await connectRoom(r.code, me, handlers)
            set({
              reconnecting: false,
              online: {
                code: r.code,
                host: r.host,
                phase: r.phase,
                sector: r.sector,
                myCompany: r.myCompany,
                myFounder: r.myFounder,
                players: [me],
                deadline: r.phase === 'playing' ? Date.now() + ROUND_SECONDS * 1000 : null,
                commits: [],
                bids: [],
                error: null,
              },
            })
          } catch {
            // room is gone (everyone left) — keep the local game, drop the session
            set({ reconnecting: false, online: null, onlineResume: null })
          }
        },

        cancelReady: () => {
          const { game, online } = get()
          if (!game || !online || online.phase !== 'playing' || game.gameOver) return
          myReady = false
          const players = online.players.map((p) => (p.id === myId() ? { ...p, ready: false } : p))
          set({ online: { ...online, players } })
          void pushState({ ready: false })
        },

        sendEmote: (emoji) => {
          const online = get().online
          if (!online) return
          const payload = { from: online.myCompany, emoji }
          void broadcastEmote(payload)
          showEmote(payload) // broadcast doesn't echo to self
        },

        initAuth: async () => {
          // Surface a failed OAuth return BEFORE the session check: if the provider bounced back
          // with an error fragment, currentProfile() is null and the player used to see nothing.
          set({ authError: oauthReturnError() })
          set({ authUser: await currentProfile() })
          onAuthChange((p) => {
            set({ authUser: p, ...(p ? { authError: null } : { profile: null }) })
            if (p) void get().syncProfileProgress()
          })
          if (get().authUser) void get().syncProfileProgress()
        },

        /**
         * Load the profile and merge progress BOTH ways: local badges and bests go up (union /
         * higher-score-wins), and whatever the server already knew comes back down into
         * localStorage — so a second device inherits the first one's history. Safe to call any
         * time; a signed-out player is a no-op.
         */
        syncProfileProgress: async () => {
          const snapshotCount = readRunCount()
          const merged = await pushProfileProgress({
            achievements: [...earnedAchievements()],
            bests: readLocalBests(),
            hall: readHall(),
            runCount: snapshotCount,
            runBase: readRunBase(),
          })
          if (!merged) return
          set({ profile: merged })
          try {
            localStorage.setItem('founder-mode-achievements', JSON.stringify(merged.achievements))
            const localBests = readLocalBests()
            for (const mode of ['quick', 'career', 'arena'] as const) {
              const remote = merged.bests[mode]
              if (remote && (!localBests[mode] || remote.score > localBests[mode]!.score)) localBests[mode] = remote
            }
            localStorage.setItem('founder-mode-bests', JSON.stringify(localBests))
            // The hall and the counter come back DOWN too — this is what makes a second browser
            // show the same "companies built" biography as the first (profiles-v2). Two rules,
            // both from the 2026-08-23 review (it found the naive version wiping local halls):
            //   1. ONLY when the server actually accepted the history this round — on the
            //      fallback paths merged.hall is the server's pre-merge copy, and writing it
            //      over localStorage deletes entries that exist nowhere else.
            //   2. Never overwrite — RE-MERGE with the localStorage of NOW, so a run recorded
            //      while this sync was in flight survives the write-back.
            if (merged.historySynced) {
              localStorage.setItem(HALL_KEY, JSON.stringify(mergeHalls(merged.hall, readHall())))
              // runs recorded mid-flight keep their unsynced delta on top of the new base
              const inFlight = Math.max(0, readRunCount() - snapshotCount)
              localStorage.setItem(RUNS_KEY, String(merged.runCount + inFlight))
              localStorage.setItem(RUNS_SYNCED_KEY, String(merged.runCount))
            }
          } catch {
            // storage full or private mode — the server copy is still authoritative
          }
        },

        renameProfileTo: async (nickname) => {
          const problem = await renameProfile(nickname)
          if (!problem) set({ profile: await fetchMyProfile() })
          return problem
        },

        signIn: async (provider) => signInWith(provider),

        signOutUser: async () => {
          await signOut()
          set({ authUser: null, profile: null })
        },

        sendChat: (text) => {
          const online = get().online
          const clean = text.trim().slice(0, 200)
          if (!online || !clean) return
          const payload = { from: online.myCompany, text: clean }
          void broadcastChat(payload)
          appendChat(payload, true) // broadcast doesn't echo to self
        },

        beginMatch: (sector, caps, cap) => {
          const online = get().online
          if (!online || !online.host || online.phase !== 'lobby') return
          const payload: StartPayload = {
            seed: Math.floor(Math.random() * 2 ** 31),
            sector,
            cap: cap ?? MATCH_CAP,
            deadline: Date.now() + ROUND_SECONDS * 1000,
            caps: caps ?? defaultCapabilities('arena'),
            hostId: myId(),
          }
          void broadcastStart(payload)
          handlers.onStart(payload) // broadcast doesn't echo to self
        },

        attackPlayer: (targetId, kind) => {
          const { game, online } = get()
          if (!game || !online || game.gameOver) return
          const target = online.players.find((p) => p.id === targetId)
          if (!target || target.over) return
          const g = structuredClone(game)
          if (!applyAttackOutgoing(g, kind, target.company, target.users)) return
          sfx.ominous()
          set({ game: g })
          void broadcastAttack({ fromCompany: online.myCompany, targetId, kind, fromId: myId() })
          void pushState(myNetSummary(g))
        },

        // No broadcast and no presence push: there is no room and the rival is not a peer. The
        // engine applies both sides itself, which is the half Arena delegates to the other client.
        attackRival: (rivalId, kind) => {
          const { game } = get()
          if (!game || game.gameOver) return
          const g = structuredClone(game)
          if (!attackRival(g, kind, rivalId)) return
          sfx.ominous()
          set({ game: g })
        },

        buyShield: () => {
          const { game } = get()
          if (!game || game.gameOver) return
          const g = structuredClone(game)
          if (!buyShield(g)) return
          sfx.cash()
          set({ game: g })
          void pushState(myNetSummary(g))
        },

        sendOffer: (candidateId, premiumPct = 0) => {
          const g = get().game
          if (!g) return
          const c = g.candidates.find((x) => x.id === candidateId)
          if (!c) return

          // Arena: the pool is shared, so an offer is a sealed bid rather than an instant hire.
          // Only the HASH goes out now; the amount is revealed when the founder locks their turn.
          const online = get().online
          if (hasCapability(g, 'sharedHiringPool') && online) {
            // One target per round. Without this a founder could commit on all five candidates
            // and reveal only the one they won, which defeats the point of committing at all.
            if (online.commits.some((c) => c.playerId === myId())) {
              set({ game: { ...g, flash: 'You are already courting someone this round — one target per week.' } })
              return
            }
            const premium = Math.min(100, Math.max(0, Math.round(premiumPct)))
            const runway = runwayWeeks(g)
            const nonce = makeNonce()
            myBid = { candidateId, premiumPct: premium, nonce, reputation: Math.round(g.reputation), runwayWeeks: Number.isFinite(runway) ? Math.round(runway) : 999, week: g.week }
            set({
              game: {
                ...g,
                flash: `Offer sealed for ${c.name}${premium > 0 ? ` at +${premium}%` : ' at asking'}. Nobody can see the number — not even over the wire — until the round locks.`,
              },
            })
            void (async () => {
              const commitment = await hiringCommitment(candidateId, premium, nonce, myId())
              const cur = get().online
              if (!cur) return
              const mine: CommitPayload = { candidateId, playerId: myId(), company: cur.myCompany, commitment, week: g.week }
              set({ online: { ...get().online!, commits: [...get().online!.commits.filter((x) => x.playerId !== myId()), mine] } })
              void broadcastCommit(mine)
            })()
            return
          }

          // Solo negotiation (engagement §6): the premium travels through the journal and the
          // engine prices acceptance off the ADJUSTED salary — a lowball can genuinely lose them.
          set({ game: applyJournaled(g, 'send_offer', { i: g.candidates.indexOf(c), pm: Math.max(-15, Math.min(30, Math.round(premiumPct))) }).state })
        },

        fire: (employeeId) => {
          const g = get().game
          if (!g) return
          const i = g.employees.findIndex((x) => x.id === employeeId)
          if (i < 0) return
          set({ game: applyJournaled(g, 'fire', { i }).state })
        },

        giveRaise: (employeeId) => {
          const g = get().game
          if (!g) return
          const i = g.employees.findIndex((x) => x.id === employeeId)
          if (i < 0) return
          set({ game: applyJournaled(g, 'raise', { i }).state })
        },

        doPivot: () => {
          const g = get().game
          if (!g || g.gameOver) return
          const { state } = applyJournaled(g, 'pivot')
          sfx.pivot()
          set({ game: state })
        },

        // ---- Career: PMF Discovery 2.0 ----
        concedePriceWar: () => {
          const g = get().game
          if (!g) return
          const { state: game, result } = applyJournaled(g, 'concede_price_war')
          const lost = typeof result === 'number' ? result : 0
          if (lost <= 0) return // nothing conceded: the untouched live state stays, clone and journal entry are discarded
          set({ game })
          void pushState(myNetSummary(game))
          // Credit the founder who started it. In single player there is nobody to tell, and the
          // customers simply leave — the engine has already removed them either way.
          const online = get().online
          if (online?.priceWarFrom)
            void broadcastConcede({ fromCompany: online.myCompany, targetId: online.priceWarFrom, users: lost })
          if (online) set({ online: { ...get().online!, priceWarFrom: undefined } })
        },

        setExperimentStanding: (experimentId, standing) => {
          const g = get().game
          if (!g?.career) return
          const i = g.career.activeExperiments.findIndex((e) => e.id === experimentId)
          if (i < 0) return
          set({ game: applyJournaled(g, 'experiment_standing', { i, st: standing }).state })
        },

        runExperiment: (type, segmentId, standing = false) => {
          const g = get().game
          if (!g?.career || !hasCapability(g, 'customerResearch')) return
          const gate = canRunExperiment(g.career, type, segmentId, g.cash)
          if (!gate.ok) {
            set({ game: { ...g, flash: `Can't run that experiment — ${gate.reason}.` } })
            return
          }
          const { state } = applyJournaled(g, 'run_experiment', { t: type, s: segmentId, st: standing })
          sfx.week()
          set({ game: state })
        },

        setTargetSegment: (segmentId) => {
          const g = get().game
          if (!g?.career || g.career.primaryTargetSegmentId === segmentId) return
          const { state } = applyJournaled(g, 'target_segment', { s: segmentId })
          sfx.pivot()
          set({ game: state })
        },

        setPricing: (p) => {
          const g = get().game
          if (!g?.career || g.career.pricing === p) return
          set({ game: applyJournaled(g, 'pricing', { v: p }).state })
        },

        setProductFocus: (f) => {
          const g = get().game
          if (!g?.career || g.career.focus === f) return
          set({ game: applyJournaled(g, 'focus', { v: f }).state })
        },

        fileIPO: () => {
          const g = get().game
          if (!g || !ipoEligible(g)) return
          const { state } = applyJournaled(g, 'file_ipo')
          sfx.ominous()
          set({ game: state })
        },

        startBet: (sector) => {
          const g = get().game
          if (!g || !canStartVenture(g).ok) return
          const { state } = applyJournaled(g, 'start_bet', { s: sector })
          sfx.milestone()
          set({ game: state })
        },

        shelveBet: (ventureId) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'shelve_bet', { i: g.ventures.findIndex((v) => v.id === ventureId) }).state })
        },

        buyRival: (rivalId, method) => {
          const g = get().game
          if (!g) return
          const i = g.rivals.findIndex((r) => r.id === rivalId)
          const { state, result } = applyJournaled(g, 'buy_rival', { i, m: method })
          if (result === true) sfx.cash()
          else sfx.ominous()
          set({ game: state })
        },

        takeDebt: (amount) => {
          const g = get().game
          if (!g) return
          const { state } = applyJournaled(g, 'take_debt', { n: amount })
          sfx.cash()
          set({ game: state })
        },

        payDebt: (amount) => {
          const g = get().game
          if (!g || !g.debt) return
          const { state } = applyJournaled(g, 'pay_debt', { n: amount })
          sfx.week()
          set({ game: state })
        },

        recharge: () => {
          const g = get().game
          if (!g || g.vacationCooldown > 0) return
          const { state } = applyJournaled(g, 'recharge')
          sfx.milestone()
          set({ game: state })
        },

        doSecondary: () => {
          const g = get().game
          if (!g) return
          const { state } = applyJournaled(g, 'secondary')
          sfx.cash()
          set({ game: state })
        },

        rallyTeam: (style) => {
          const g = get().game
          if (!g || g.pitchCooldown > 0 || g.employees.length === 0) return
          const { state: game } = applyJournaled(g, 'rally', { v: style })
          if (game.rally || game.flash?.includes('landed')) sfx.milestone()
          else sfx.ominous()
          set({ game })
        },

        setAllocation: (key, value) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'allocation', { k: key, v: value }).state })
        },

        roadmapStart: (id) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'roadmap_start', { id }).state })
        },

        roadmapCancel: (id) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'roadmap_cancel', { id }).state })
        },

        betChoose: (t) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'bet_choose', { t }).state })
        },

        setGrowthMix: (v) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'growth_mix', { v }).state })
        },

        counterSheet: (index) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'counter_sheet', { i: index }).state })
        },

        v2SetPrice: (v) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'v2_price', { v }).state })
        },

        v2SetPositioning: (seg) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'v2_position', { seg }).state })
        },

        v2Research: (kind, segmentId) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'v2_research', { k: kind, seg: segmentId }).state })
        },

        aiStart: (id) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'ai_start', { id }).state })
        },

        aiCancel: (id) => {
          const g = get().game
          if (!g) return
          if (!confirm('Cancel this rollout? The cash and progress are gone — a half-installed workflow is worth nothing.')) return
          set({ game: applyJournaled(g, 'ai_cancel', { id }).state })
        },

        setAttentionFocus: (a) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'attention_focus', { a }).state })
        },

        setAttentionAllocation: (alloc) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'attention_allocate', { alloc }).state })
        },

        betAbandon: () => {
          const g = get().game
          if (!g) return
          if (!confirm('Abandon the Big Bet? Sunk effort stays sunk, and the company takes a few weeks to refocus.')) return
          set({ game: applyJournaled(g, 'bet_abandon').state })
        },

        setMarketing: (value) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'marketing', { v: value }).state })
        },

        resolveChoice: (messageId, choiceIndex) => {
          const g = get().game
          if (!g) return
          const wasOver = !!g.gameOver
          const i = g.inbox.findIndex((m) => m.id === messageId)
          const { state: game } = applyJournaled(g, 'resolve_choice', { i, c: choiceIndex })
          if (!wasOver && game.gameOver) {
            recordRun(game)
            sfx.cash()
            awardAchievements(game)
            if (get().online) void pushState(myNetSummary(game))
          }
          set({ game })
        },

        // Living World Phase 8 (§38/§41/§46). The guard reads the LIVE state and bails without
        // mutating — the house rule for journaled actions — so a room that is already closed, or
        // an option already spent, never grows a journal entry that replays to nothing.
        answerInteraction: (interactionId, optionId) => {
          const g = get().game
          if (!g) return
          const room = g.world?.interactions?.find((i) => i.id === interactionId)
          if (!room || room.status !== 'open' || room.movesLeft <= 0) return
          if (!room.options.some((o) => o.id === optionId) || room.chosen.includes(optionId)) return
          set({ game: applyJournaled(g, 'interaction', { r: interactionId, o: optionId }).state })
        },

        pitch: () => {
          const g = get().game
          if (!g || g.raiseCooldown > 0) return
          set({ game: applyJournaled(g, 'pitch').state })
        },

        accept: (sheetId) => {
          const g = get().game
          if (!g) return
          const { state } = applyJournaled(g, 'accept_sheet', { i: g.termSheets.findIndex((t) => t.id === sheetId) })
          sfx.cash()
          set({ game: state })
        },

        decline: (sheetId) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'decline_sheet', { i: g.termSheets.findIndex((t) => t.id === sheetId) }).state })
        },

        // ICO brief §3/§4. The fork. The UI has already required an explicit confirmation; this
        // re-checks the capability and eligibility itself rather than trusting the caller, because
        // it is irreversible and there is no undo to fall back on.
        tokenise: (draft) => {
          const g = get().game
          if (!g) return false
          const { state, result } = applyJournaled(g, 'tokenise', draft ? { d: draft } : undefined)
          if (!(result as { ok?: boolean } | undefined)?.ok) return false // refused: clone and journal entry discarded together
          sfx.fanfare()
          set({ game: state })
          return true
        },

        // ICO Slice 4, brief §13. A standing order, not a transaction: nothing is spent here, the
        // weekly tick resolves the shares against the treasury's token-denominated cap. No sound
        // and no seeding — see `setTokenIncentives` in engine.ts for why a slider must not touch
        // the RNG stream.
        setIncentives: (shares) => {
          const g = get().game
          if (!g) return
          set({ game: applyJournaled(g, 'incentives', { s: shares }).state })
        },

        // ICO Slice 4, brief §6. The token path's fundraising. Re-checks the capability itself
        // rather than trusting the caller — it moves cash and it moves the price.
        sellTreasury: (tokens) => {
          const g = get().game
          if (!g) return false
          const { state, result } = applyJournaled(g, 'sell_treasury', { n: tokens })
          if (!(result as { ok?: boolean } | undefined)?.ok) return false
          sfx.cash()
          set({ game: state })
          return true
        },

        // ICO Slice 7, brief §42. The founder's own secondary. Journalled like every other action
        // that moves money, and unseeded for the same reason the treasury sale is: the quote the
        // player read is a pure function of state, so opening the panel must not shift the stream.
        sellFounderPosition: (tokens) => {
          const g = get().game
          if (!g) return false
          const { state, result } = applyJournaled(g, 'sell_founder', { n: tokens })
          if (!(result as { ok?: boolean } | undefined)?.ok) return false
          sfx.cash()
          set({ game: state })
          return true
        },

        // ICO Slice 6, brief §36/§69. The campaign: a public position on an active proposal. No
        // sound and no seeding — a position shifts the weekly tally through the sway term, it does
        // not touch the RNG stream (see `setGovernanceStance` in engine.ts).
        setProposalStance: (proposalId, stance) => {
          const g = get().game
          if (!g) return false
          const i = g.token?.governance.proposals.findIndex((p) => p.id === proposalId) ?? -1
          const { state, result } = applyJournaled(g, 'proposal_stance', { i, v: stance })
          if (!(result as { ok?: boolean } | undefined)?.ok) return false
          set({ game: state })
          return true
        },

        // ICO Slice 6. The priced defiance. Re-checks the capability itself rather than trusting
        // the caller — it moves trust, reputation and the legitimacy of every future vote.
        defyMandate: (proposalId) => {
          const g = get().game
          if (!g) return false
          const i = g.token?.governance.mandates.findIndex((m) => m.proposalId === proposalId) ?? -1
          const { state, result } = applyJournaled(g, 'defy_mandate', { i })
          if (!(result as { ok?: boolean } | undefined)?.ok) return false
          set({ game: state })
          return true
        },
      }
    },
    {
      name: 'founder-mode-save',
      version: 9,
      // live connections are never persisted, but the resume breadcrumb is — a refresh rejoins the room
      partialize: (state) => ({ game: state.game, screen: state.screen, onlineResume: state.onlineResume }),
      migrate: (persisted, version) => {
        // v1 saves predate PMF/rivals/climate — start fresh rather than load a broken state.
        if (version < 2) return { game: null, screen: 'dashboard' as ScreenId }
        return persisted as { game: GameState | null; screen: ScreenId }
      },
      // Shape normalization runs on EVERY load (not just version bumps) so a save can never
      // crash the app just because it predates a field — belt and suspenders.
      merge: (persisted, current) => {
        const p = persisted as { game: GameState | null; screen: ScreenId } | undefined
        if (p?.game) {
          const g = p.game
          g.milestones ??= []
          g.totalResearch ??= g.researchSignal ?? 0
          g.flash ??= null
          g.board ??= null
          g.challenge ??= null
          g.ipo ??= null
          g.ipoCooldown ??= 0
          g.ventures ??= []
          g.allocation.bet ??= 0
          g.maCooldown ??= 0
          g.scenario ??= null
          g.pitchCooldown ??= 0
          g.rally ??= null
          g.macro ??= { index: 100, rate: 5, inflation: 3 }
          g.debt ??= null
          g.flags ??= {}
          g.arcs ??= []
          g.energy ??= 80
          g.vacationCooldown ??= 0
          g.bankedPayout ??= 0
          // Legacy saves predate the mode/format model: everything solo becomes Quick Play
          // Standard (or Daily if it was a dated challenge), and multiplayer becomes Arena.
          // Career is never assigned automatically — it is an explicit player choice.
          migrateLegacySave(g) // brief §31 — see engine.ts
          // Living world (brief §68/§69). A save written before the system has no `world` at all,
          // which is legal — the weekly tick creates one. A save that HAS one is re-validated
          // rather than trusted: it is user-writable localStorage, and a malformed slice must not
          // reach the composer. An unreadable slice is dropped, not repaired; characters are
          // deterministic from the seed, so the cost of rebuilding is one week of drift.
          g.world = migrateLivingWorldSlice(g.world)
          // Tokenisation (ICO brief §74). `undefined` in, `undefined` out — the function REFUSES
          // to construct, which is how "existing saves default to institutional" is guaranteed
          // rather than hoped for: absence of the slice IS the institutional path, so a legacy
          // save needs no write at all. A malformed slice is dropped rather than repaired, exactly
          // as the living world's is, because a half-valid economy must never reach the price model.
          g.token = migrateTokenSlice(g.token)
          // Replay journal: user-writable localStorage, so its shape is re-validated on every
          // load. Malformed → absent (the run reads as unverifiable), never a crash.
          g.journal = sanitizeJournal(g.journal)
        }
        return { ...current, ...p }
      },
    },
  ),
)
