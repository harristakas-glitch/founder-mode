import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  acceptTermSheet,
  acquireRival,
  advanceWeek,
  applyEffects,
  canStartVenture,
  ipoEligible,
  killVenture,
  newGame,
  pitchInvestors,
  pitchTeam,
  pivot,
  startIPO,
  startVenture,
  totalUsers,
  uid,
  valuation,
} from './game/engine'
import { sfx } from './sound'
import { SECTORS, sectorById } from './game/data'
import type { FounderKind, GameState, SectorId } from './game/types'
import { ROUND_SECONDS, onlineConfigured } from './net/config'
import {
  broadcastStart,
  connectRoom,
  leaveRoom,
  makeRoomCode,
  myId,
  pushState,
  type NetPlayer,
  type StartPayload,
} from './net/online'

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

export interface RunRecord {
  company: string
  sector: string
  ending: 'bankrupt' | 'unicorn' | 'acquired' | 'fired' | 'timeup' | 'ipo'
  weeks: number
  score: number // founder payout in $
}

const HALL_KEY = 'founder-mode-hall'

export function readHall(): RunRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HALL_KEY) ?? '[]')
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
}

// ---------- daily challenge ----------

const DAILY_EPOCH = 20666 // days-since-1970 of challenge #1

export function dailyInfo(): { seed: number; id: number; sector: SectorId } {
  const day = Math.floor(Date.now() / 86_400_000)
  return { seed: day * 7919, id: day - DAILY_EPOCH + 1, sector: SECTORS[day % SECTORS.length].id }
}

export interface NewGameSetup {
  mode: 'free' | 'daily'
  sector: SectorId
  name: string
  founder: FounderKind
  scenario?: string
}

export const MATCH_CAP = 104 // weeks in a capped run (daily & online matches)

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

interface Store {
  game: GameState | null
  online: OnlineSession | null
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
  beginMatch: (sector: SectorId) => void
  // --- in-game actions ---
  sendOffer: (candidateId: string) => void
  fire: (employeeId: string) => void
  giveRaise: (employeeId: string) => void
  doPivot: () => void
  fileIPO: () => void
  startBet: (sector: SectorId) => void
  shelveBet: (ventureId: string) => void
  buyRival: (rivalId: string, method: 'cash' | 'stock') => void
  rallyTeam: (style: 'vision' | 'numbers' | 'war') => void
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
        week: g.week,
        users: totalUsers(g),
        val: valuation(g),
        over: !!g.gameOver,
        overType: g.gameOver?.type,
        payout: g.gameOver?.payout ?? 0,
      })

      const othersUsers = (players: NetPlayer[]): number =>
        players.reduce((a, p) => (p.id === myId() || p.over ? a : a + p.users), 0)

      let advancing = false

      // Called on every presence sync: catch up if behind, advance if everyone is ready.
      const maybeNetAdvance = () => {
        const { game, online } = get()
        if (!game || !online || online.phase !== 'playing' || advancing) return
        const players = online.players
        if (players.length === 0) return

        // catch up if the room has moved past us (e.g. we reconnected)
        const maxWeek = Math.max(...players.map((p) => p.week))
        if (!game.gameOver && maxWeek > game.week) {
          advancing = true
          let g = game
          while (g.week < maxWeek && !g.gameOver) g = advanceWeek(g, othersUsers(players))
          if (g.gameOver) recordRun(g)
          advancing = false
          set({ game: g })
          void pushState({ ...myNetSummary(g), ready: false })
          return
        }

        // advance when every living, present player is ready for this week
        const living = players.filter((p) => !p.over)
        if (living.length === 0) return
        const allReady = living.every((p) => p.ready && p.week >= game.week)
        if (!allReady) return
        if (game.gameOver) return
        advancing = true
        const next = advanceWeek(game, othersUsers(players))
        if (next.gameOver) recordRun(next)
        advancing = false
        weekSounds(next)
        set({ game: next, online: { ...get().online!, deadline: Date.now() + ROUND_SECONDS * 1000 } })
        void pushState({ ...myNetSummary(next), ready: false })
      }

      const handlers = {
        onPlayers: (players: NetPlayer[]) => {
          const online = get().online
          if (!online) return
          set({ online: { ...online, players } })
          maybeNetAdvance()
        },
        onStart: (p: StartPayload) => {
          const online = get().online
          if (!online || online.phase === 'playing') return
          const g = newGame(online.myCompany, p.sector, online.myFounder, {
            seed: p.seed,
            challenge: { label: 'Online match', cap: p.cap },
            aiRivals: false, // the other players are the rivals
          })
          set({
            game: g,
            online: { ...online, phase: 'playing', sector: p.sector, deadline: p.deadline },
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
          })
        } catch (e) {
          set({ connecting: false, online: null })
          throw e
        }
      }

      return {
        game: null,
        online: null,
        connecting: false,
        screen: 'dashboard',
        setScreen: (screen) => set({ screen }),

        startGame: (setup) => {
          const daily = setup.mode === 'daily'
          const info = dailyInfo()
          const sector = daily ? info.sector : setup.sector
          const seed = daily ? info.seed : undefined
          const challenge = daily ? { label: `Daily #${info.id}`, cap: MATCH_CAP } : null
          set({
            game: newGame(setup.name || 'Untitled Inc.', sector, setup.founder, { seed, challenge, scenario: daily ? undefined : setup.scenario }),
            online: null,
            screen: 'dashboard',
          })
        },

        abandonGame: () => {
          void leaveRoom()
          set({ game: null, online: null, screen: 'dashboard' })
        },

        advance: () => {
          const { game, online } = get()
          if (!game) return
          if (!online) {
            if (game.gameOver) return
            const next = advanceWeek(game)
            if (next.gameOver) recordRun(next)
            weekSounds(next)
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

        leaveOnline: () => {
          void leaveRoom()
          set({ online: null, game: null, screen: 'dashboard' })
        },

        beginMatch: (sector) => {
          const online = get().online
          if (!online || !online.host || online.phase !== 'lobby') return
          const payload: StartPayload = {
            seed: Math.floor(Math.random() * 2 ** 31),
            sector,
            cap: MATCH_CAP,
            deadline: Date.now() + ROUND_SECONDS * 1000,
          }
          void broadcastStart(payload)
          handlers.onStart(payload) // broadcast doesn't echo to self
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
          set({ game: { ...g, marketingSpend: value } })
        },

        resolveChoice: (messageId, choiceIndex) => {
          const g = get().game
          if (!g) return
          const game = structuredClone(g)
          const msg = game.inbox.find((m) => m.id === messageId)
          if (!msg || msg.resolved || !msg.choices) return
          const choice = msg.choices[choiceIndex]
          if (!choice) return
          msg.resolved = true
          msg.resultText = choice.resultText
          if (choice.effects.special === 'acquired' && msg.meta?.acquisitionAmount) {
            game.gameOver = {
              type: 'acquired',
              week: game.week,
              payout: Math.round(msg.meta.acquisitionAmount * game.founderEquity),
            }
            recordRun(game)
            sfx.cash()
            if (get().online) void pushState(myNetSummary(game))
          } else {
            applyEffects(game, choice.effects)
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
      // online sessions are live connections — never persist them across reloads
      partialize: (state) => ({ game: state.game, screen: state.screen }),
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
        }
        return { ...current, ...p }
      },
    },
  ),
)
