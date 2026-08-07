import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  acceptTermSheet,
  acquireRival,
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  buyShield,
  capabilitiesFromLegacyRules,
  migrateLegacySave,
  applyEffects,
  canStartVenture,
  drawDebt,
  ipoEligible,
  marketingMax,
  killVenture,
  newGame,
  pitchInvestors,
  pitchTeam,
  pivot,
  repayDebt,
  resolveChoiceOnState,
  sellSecondary,
  startIPO,
  takeVacation,
  startVenture,
  totalUsers,
  uid,
  valuation,
} from './game/engine'
import { sfx } from './sound'
import { checkAchievements } from './game/achievements'
import { submitDailyScore } from './net/leaderboard'
import { currentProfile, onAuthChange, signInWith, signOut, type AuthProfile, type AuthProvider } from './net/auth'

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
import { addJournal, canRunExperiment, experimentDef, segmentDef, startExperiment } from './game/career/pmf'
import { repositionTo } from './game/career/tick'
import type { FounderKind, GameState, SectorId } from './game/types'
import { ROUND_SECONDS, onlineConfigured } from './net/config'
import {
  broadcastAttack,
  broadcastChat,
  broadcastEmote,
  broadcastStart,
  connectRoom,
  leaveRoom,
  makeRoomCode,
  myId,
  pushState,
  type AttackPayload,
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

export interface RunRecord {
  company: string
  sector: string
  ending: 'bankrupt' | 'unicorn' | 'acquired' | 'fired' | 'timeup' | 'ipo'
  weeks: number
  score: number // founder payout in $
}

const HALL_KEY = 'founder-mode-hall'

/**
 * Brief §28: components ask for a capability, never for a mode.
 *   const detailedPMF = useGameCapability('detailedPMF')
 */
export function useGameCapability(key: CapabilityKey): boolean {
  return useStore((s) => s.game?.capabilities?.[key] ?? false)
}

export function readHall(): RunRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(HALL_KEY) ?? '[]')
    return Array.isArray(v) ? v : [] // a corrupt value must not break .push() later
  } catch {
    return []
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
    }
  }
  if (next.flash?.startsWith('🏁')) sfx.milestone()
  else if (next.flash?.startsWith('IPO pulled')) sfx.ominous()
  else if (next.inbox[0]?.title === 'Board ultimatum' && !next.inbox[0].resolved) sfx.ominous()
  else sfx.week()
}

function recordRun(g: GameState) {
  if (!g.gameOver) return
  const score = g.gameOver.payout ?? 0
  const runs = readHall()
  runs.push({
    company: g.companyName,
    sector: sectorById(g.sector).name,
    ending: g.gameOver.type,
    weeks: g.gameOver.week,
    score,
  })
  runs.sort((a, b) => b.score - a.score)
  localStorage.setItem(HALL_KEY, JSON.stringify(runs.slice(0, 10)))
  // daily challenge scores also go to the global leaderboard (no-op until Supabase is configured)
  // Brief §30: leaderboard availability is a CAPABILITY, not a format check. The label is
  // still parsed for the challenge number, but the capability decides whether we submit.
  const daily = g.challenge?.label.match(/^Daily #(\d+)/)
  if (daily && hasCapability(g, 'leaderboard'))
    void submitDailyScore(Number(daily[1]), {
      company: g.companyName,
      score,
      weeks: g.gameOver.week,
      ending: g.gameOver.type,
      display_name: useStore.getState().authUser?.name ?? null,
    })
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
}

const clampSpend = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)))

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
  emotes: EmoteToast[]
  chat: ChatMessage[]
  authUser: AuthProfile | null
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
  attackPlayer: (targetId: string, kind: 'poach' | 'smear' | 'raid') => void
  buyShield: () => void
  resumeOnline: () => Promise<void>
  cancelReady: () => void
  sendEmote: (emoji: string) => void
  sendChat: (text: string) => void
  initAuth: () => Promise<void>
  signIn: (provider: AuthProvider) => Promise<string | null>
  signOutUser: () => Promise<void>
  // --- in-game actions ---
  sendOffer: (candidateId: string) => void
  fire: (employeeId: string) => void
  giveRaise: (employeeId: string) => void
  doPivot: () => void
  // --- Career: PMF Discovery ---
  runExperiment: (type: import('./game/career/types').ExperimentType, segmentId: string) => void
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
  setMarketing: (value: number) => void
  resolveChoice: (messageId: string, choiceIndex: number) => void
  pitch: () => void
  accept: (sheetId: string) => void
  decline: (sheetId: string) => void
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
      const othersUsers = (players: NetPlayer[]): number =>
        Math.min(1e10, players.reduce((a, p) => (p.id === myId() || p.over ? a : a + (Number.isFinite(p.users) ? Math.max(0, p.users) : 0)), 0))

      let advancing = false
      const attacksTakenThisWeek = new Set<string>()

      // The 'start' broadcast is unauthenticated: only the presence-declared host may open a match,
      // and every field has to be sane before it becomes a GameState (a bad sector white-screens
      // the app, a bad cap can hang it, a stale deadline forfeits everyone's first turn).
      const validStart = (
        p: StartPayload,
        players: NetPlayer[],
      ): { seed: number; sector: SectorId; cap: number; caps: Partial<GameCapabilities> } | null => {
        const host = players.find((x) => x.host)
        if (host && p.hostId && p.hostId !== host.id) return null
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
        const players = online.players
        if (players.length === 0) return

        // catch up if the room has moved past us (e.g. we reconnected). A peer can advertise any
        // week it likes, so never simulate past the match cap or for more than a sane number of turns.
        const cap = game.challenge?.cap ?? MATCH_CAP
        const maxWeek = Math.min(cap, Math.max(...players.map((p) => p.week)))
        if (!game.gameOver && maxWeek > game.week) {
          advancing = true
          let g = game
          for (let i = 0; i < CATCH_UP_LIMIT && g.week < maxWeek && !g.gameOver; i++) g = advanceWeek(g, othersUsers(players))
          if (g.gameOver) recordRun(g)
          advancing = false
          weekSounds(g)
          awardAchievements(g)
          // we arrive mid-round: give ourselves the rest of this round, not an expired clock
          set({ game: g, online: { ...get().online!, deadline: Date.now() + ROUND_SECONDS * 1000 } })
          void pushState({ ...myNetSummary(g), ready: false })
          return
        }

        // advance when every living player who is actually in the match is ready for this week.
        // Someone still sitting in the lobby (joined late, or mid-reconnect) must not deadlock the room.
        const living = players.filter((p) => !p.over && p.playing !== false)
        if (living.length === 0) return
        const allReady = living.every((p) => p.ready && p.week >= game.week)
        if (!allReady) return
        if (game.gameOver) return
        advancing = true
        const next = advanceWeek(game, othersUsers(players))
        if (next.gameOver) recordRun(next)
        advancing = false
        weekSounds(next)
        awardAchievements(next)
        set({ game: next, online: { ...get().online!, deadline: Date.now() + ROUND_SECONDS * 1000 } })
        void pushState({ ...myNetSummary(next), ready: false })
      }

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
        onPlayers: (players: NetPlayer[]) => {
          const online = get().online
          if (!online) return
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
        onEmote: showEmote,
        onChat: (p: ChatPayload) => appendChat(p, false),
        onAttack: (p: AttackPayload) => {
          if (p.targetId !== myId()) return
          const g = get().game
          if (!g || g.gameOver) return
          if (!hasCapability(g, 'pvpActions')) return // attacks don't exist in a match where PvP is off
          // one hit per attacker per week, however many packets they send
          const key = `${p.fromId ?? p.fromCompany}@${g.week}`
          if (attacksTakenThisWeek.has(key)) return
          attacksTakenThisWeek.add(key)
          const game = structuredClone(g)
          applyAttackIncoming(game, p.kind, p.fromCompany)
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
        emotes: [],
        chat: [],
        authUser: null,
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
          }
          const rules = resolveGameRules(config)
          set({
            game: newGame(setup.name || 'Untitled Inc.', sector, setup.founder, {
              config,
              challenge: rules.maxTurns ? { label: daily ? `Daily #${info.id}` : 'Capped run', cap: rules.maxTurns } : null,
              scenario: config.scenario,
            }),
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
            const next = advanceWeek(game)
            if (next.gameOver) recordRun(next)
            weekSounds(next)
            awardAchievements(next)
            set({ game: next })
            return
          }
          // online: mark myself ready; the week moves when everyone is
          if (game.gameOver) return
          sfx.week()
          const players = online.players.map((p) => (p.id === myId() ? { ...p, ready: true } : p))
          set({ online: { ...online, players } })
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
          set({ authUser: await currentProfile() })
          onAuthChange((p) => set({ authUser: p }))
        },

        signIn: async (provider) => signInWith(provider),

        signOutUser: async () => {
          await signOut()
          set({ authUser: null })
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

        buyShield: () => {
          const { game } = get()
          if (!game || game.gameOver) return
          const g = structuredClone(game)
          if (!buyShield(g)) return
          sfx.cash()
          set({ game: g })
          void pushState(myNetSummary(g))
        },

        sendOffer: (candidateId) => {
          const g = get().game
          if (!g) return
          const c = g.candidates.find((x) => x.id === candidateId)
          if (!c) return
          const game = structuredClone(g)
          game.candidates = game.candidates.filter((x) => x.id !== candidateId)
          game.offersOut.push(c)
          game.flash = `Offer sent to ${c.name}. They'll answer when you advance the week — candidates get cold feet when your runway is under ~10 weeks.`
          set({ game })
        },

        fire: (employeeId) => {
          const g = get().game
          if (!g) return
          const e = g.employees.find((x) => x.id === employeeId)
          if (!e) return
          const game = structuredClone(g)
          game.employees = game.employees.filter((x) => x.id !== employeeId)
          game.cash -= Math.round(e.salary / 12) // one month severance
          applyEffects(game, { morale: -8 })
          game.inbox.unshift({
            id: uid(),
            week: game.week,
            kind: 'system',
            title: `${e.name} was let go`,
            body: `You paid one month of severance ($${Math.round(e.salary / 12).toLocaleString()}). The team is rattled.`,
          })
          set({ game })
        },

        giveRaise: (employeeId) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          const e = game.employees.find((x) => x.id === employeeId)
          if (!e) return
          e.salary = Math.round((e.salary * 1.1) / 1000) * 1000
          e.morale = Math.min(100, e.morale + 12)
          set({ game })
        },

        doPivot: () => {
          const g = get().game
          if (!g || g.gameOver) return
          const game = structuredClone(g)
          pivot(game)
          sfx.pivot()
          set({ game })
        },

        // ---- Career: PMF Discovery 2.0 ----
        runExperiment: (type, segmentId) => {
          const g = get().game
          if (!g?.career || !hasCapability(g, 'customerResearch')) return
          const gate = canRunExperiment(g.career, type, segmentId, g.cash)
          if (!gate.ok) {
            set({ game: { ...g, flash: `Can't run that experiment — ${gate.reason}.` } })
            return
          }
          const game = structuredClone(g)
          const def = experimentDef(type)
          startExperiment(game.career!, game.week, type, segmentId, uid())
          game.cash -= def.cashCost
          const segName = segmentDef(game.sector, segmentId).name
          addJournal(game.career!, {
            week: game.week,
            category: 'experiment',
            title: `Started: ${def.name} — ${segName}`,
            description: def.blurb,
            relatedSegmentId: segmentId,
          })
          game.flash = `🔬 ${def.name} started on ${segName}. Results in ${def.weeks} weeks — research takes time, which is the point.`
          sfx.week()
          set({ game })
        },

        setTargetSegment: (segmentId) => {
          const g = get().game
          if (!g?.career || g.career.primaryTargetSegmentId === segmentId) return
          const game = structuredClone(g)
          repositionTo(game, segmentId, game.week)
          sfx.pivot()
          set({ game })
        },

        setPricing: (p) => {
          const g = get().game
          if (!g?.career || g.career.pricing === p) return
          const game = structuredClone(g)
          const from = game.career!.pricing
          game.career!.pricing = p
          addJournal(game.career!, {
            week: game.week,
            category: 'pricing',
            title: `Pricing: ${from} → ${p}`,
            description:
              p === 'premium'
                ? 'Asking for more. Fewer will convert; those who do are worth more — if they stay.'
                : p === 'low'
                  ? 'Cheaper to say yes to. More customers, thinner economics.'
                  : 'Priced at the middle of the market.',
          })
          game.flash = `💲 Pricing moved to ${p}. Conversion and retention will re-rate over the next few weeks.`
          set({ game })
        },

        setProductFocus: (f) => {
          const g = get().game
          if (!g?.career || g.career.focus === f) return
          const game = structuredClone(g)
          game.career!.focus = f
          addJournal(game.career!, {
            week: game.week,
            category: 'strategy',
            title: `Product focus: ${f.replace('_', ' ')}`,
            description: 'What the roadmap optimises for. Segments value these differently.',
          })
          game.flash = `🧭 Product now optimised for ${f.replace('_', ' ')}.`
          set({ game })
        },

        fileIPO: () => {
          const g = get().game
          if (!g || !ipoEligible(g)) return
          const game = structuredClone(g)
          startIPO(game)
          sfx.ominous()
          set({ game })
        },

        startBet: (sector) => {
          const g = get().game
          if (!g || !canStartVenture(g).ok) return
          const game = structuredClone(g)
          startVenture(game, sector)
          sfx.milestone()
          set({ game })
        },

        shelveBet: (ventureId) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          killVenture(game, ventureId)
          set({ game })
        },

        buyRival: (rivalId, method) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          if (acquireRival(game, rivalId, method)) sfx.cash()
          else sfx.ominous()
          set({ game })
        },

        takeDebt: (amount) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          drawDebt(game, amount)
          sfx.cash()
          set({ game })
        },

        payDebt: (amount) => {
          const g = get().game
          if (!g || !g.debt) return
          const game = structuredClone(g)
          repayDebt(game, amount)
          sfx.week()
          set({ game })
        },

        recharge: () => {
          const g = get().game
          if (!g || g.vacationCooldown > 0) return
          const game = structuredClone(g)
          takeVacation(game)
          sfx.milestone()
          set({ game })
        },

        doSecondary: () => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          sellSecondary(game)
          sfx.cash()
          set({ game })
        },

        rallyTeam: (style) => {
          const g = get().game
          if (!g || g.pitchCooldown > 0 || g.employees.length === 0) return
          const game = structuredClone(g)
          pitchTeam(game, style)
          if (game.rally || game.flash?.includes('landed')) sfx.milestone()
          else sfx.ominous()
          set({ game })
        },

        setAllocation: (key, value) => {
          const g = get().game
          if (!g) return
          set({ game: { ...g, allocation: { ...g.allocation, [key]: value } } })
        },

        setMarketing: (value) => {
          const g = get().game
          if (!g) return
          const spend = Number.isFinite(value) ? clampSpend(value, marketingMax(g)) : 0
          set({ game: { ...g, marketingSpend: spend } })
        },

        resolveChoice: (messageId, choiceIndex) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          const wasOver = !!game.gameOver
          resolveChoiceOnState(game, messageId, choiceIndex)
          if (!wasOver && game.gameOver) {
            recordRun(game)
            sfx.cash()
            awardAchievements(game)
            if (get().online) void pushState(myNetSummary(game))
          }
          set({ game })
        },

        pitch: () => {
          const g = get().game
          if (!g || g.raiseCooldown > 0) return
          const game = structuredClone(g)
          const { sheets, message } = pitchInvestors(game)
          game.termSheets = sheets
          game.inbox.unshift(message)
          set({ game })
        },

        accept: (sheetId) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          acceptTermSheet(game, sheetId)
          sfx.cash()
          set({ game })
        },

        decline: (sheetId) => {
          const g = get().game
          if (!g) return
          set({ game: { ...g, termSheets: g.termSheets.filter((t) => t.id !== sheetId) } })
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
        }
        return { ...current, ...p }
      },
    },
  ),
)
