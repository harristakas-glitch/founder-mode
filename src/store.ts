import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { acceptTermSheet, advanceWeek, applyEffects, newGame, pitchInvestors, pivot, uid } from './game/engine'
import { sectorById } from './game/data'
import type { FounderKind, GameState, SectorId } from './game/types'

export interface RunRecord {
  company: string
  sector: string
  ending: 'bankrupt' | 'unicorn' | 'acquired' | 'fired'
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

interface Store {
  game: GameState | null
  screen: ScreenId
  setScreen: (s: ScreenId) => void
  startGame: (name: string, sector: SectorId, founder: FounderKind) => void
  abandonGame: () => void
  advance: () => void
  sendOffer: (candidateId: string) => void
  fire: (employeeId: string) => void
  giveRaise: (employeeId: string) => void
  doPivot: () => void
  setAllocation: (key: 'features' | 'quality' | 'bugs' | 'research', value: number) => void
  setMarketing: (value: number) => void
  resolveChoice: (messageId: string, choiceIndex: number) => void
  pitch: () => void
  accept: (sheetId: string) => void
  decline: (sheetId: string) => void
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      game: null,
      screen: 'dashboard',
      setScreen: (screen) => set({ screen }),

      startGame: (name, sector, founder) =>
        set({ game: newGame(name || 'Untitled Inc.', sector, founder), screen: 'dashboard' }),

      abandonGame: () => set({ game: null, screen: 'dashboard' }),

      advance: () => {
        const g = get().game
        if (!g || g.gameOver) return
        const next = advanceWeek(g)
        if (next.gameOver) recordRun(next)
        set({ game: next })
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
        set({ game })
      },

      decline: (sheetId) => {
        const g = get().game
        if (!g) return
        set({ game: { ...g, termSheets: g.termSheets.filter((t) => t.id !== sheetId) } })
      },
    }),
    {
      name: 'founder-mode-save',
      version: 4,
      migrate: (persisted, version) => {
        // v1 saves predate PMF/rivals/climate — start fresh rather than load a broken state.
        if (version < 2) return { game: null, screen: 'dashboard' as ScreenId }
        const state = persisted as { game: GameState | null; screen: ScreenId }
        // v2 -> v3: milestones & lifetime research were added; keep the run, fill defaults.
        if (version < 3 && state.game) {
          state.game.milestones ??= []
          state.game.totalResearch ??= state.game.researchSignal ?? 0
          state.game.flash ??= null
        }
        // v3 -> v4: board pressure & traits; existing employees just have no trait.
        if (version < 4 && state.game) {
          state.game.board ??= null
        }
        return state
      },
    },
  ),
)
