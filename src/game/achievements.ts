// Achievements: persistent badges across runs, rewarding cross-system play.
// Earned ids live in localStorage; checks run every week and at every ending.
import type { GameState } from './types'
import { avgMorale, valuation } from './engine'

export interface AchievementDef {
  id: string
  emoji: string
  name: string
  desc: string
  check: (g: GameState) => boolean
}

const won = (g: GameState) => !!g.gameOver && (g.gameOver.payout ?? 0) > 0 && g.gameOver.type !== 'bankrupt' && g.gameOver.type !== 'fired'
const peakVal = (g: GameState) => Math.max(...g.history.map((h) => h.valuation), 0)

export const ACHIEVEMENTS: AchievementDef[] = [
  // endings
  { id: 'first-blood', emoji: '🎬', name: 'An Ending', desc: 'Finish a run — any run, any way.', check: (g) => !!g.gameOver },
  { id: 'unicorn', emoji: '🦄', name: 'Unicorn', desc: 'Reach a $1B valuation.', check: (g) => g.gameOver?.type === 'unicorn' },
  { id: 'bell-ringer', emoji: '🔔', name: 'Bell Ringer', desc: 'Take a company public.', check: (g) => g.gameOver?.type === 'ipo' },
  { id: 'exit-stage-left', emoji: '🤝', name: 'Exit Stage Left', desc: 'Sell the company.', check: (g) => g.gameOver?.type === 'acquired' },
  { id: 'incredible-journey', emoji: '💸', name: 'An Incredible Journey', desc: 'Go bankrupt. It happens to the best.', check: (g) => g.gameOver?.type === 'bankrupt' },
  { id: 'shown-the-door', emoji: '🪑', name: 'Shown the Door', desc: 'Get fired by your own board.', check: (g) => g.gameOver?.type === 'fired' },
  // style wins
  { id: 'crash-ipo', emoji: '🥶', name: 'Cold Open', desc: 'Ring the bell in a frozen funding market.', check: (g) => g.gameOver?.type === 'ipo' && g.climate < -0.3 },
  { id: 'debt-free', emoji: '🧘', name: 'Allergic to Leverage', desc: 'Win big without ever touching bank debt.', check: (g) => won(g) && (g.gameOver!.payout ?? 0) >= 50_000_000 && !g.flags.tookDebt },
  { id: 'leveraged', emoji: '🏦', name: 'Other People\'s Money', desc: 'Win big after using bank debt.', check: (g) => won(g) && (g.gameOver!.payout ?? 0) >= 50_000_000 && !!g.flags.tookDebt },
  { id: 'no-pivot', emoji: '🎯', name: 'First Try', desc: 'Reach a unicorn without ever pivoting.', check: (g) => g.gameOver?.type === 'unicorn' && g.pivots === 0 },
  { id: 'serial-pivoter', emoji: '🔄', name: 'Fourth Time\'s the Charm', desc: 'Win after pivoting 3+ times.', check: (g) => won(g) && g.pivots >= 3 },
  { id: 'phoenix', emoji: '🚑', name: 'Phoenix', desc: 'Take the emergency bridge and still walk away with $10M+.', check: (g) => won(g) && (g.gameOver!.payout ?? 0) >= 10_000_000 && g.bridgeUsed },
  { id: 'speedrun', emoji: '⚡', name: 'Blitzscaler', desc: 'Unicorn or IPO before week 120.', check: (g) => (g.gameOver?.type === 'unicorn' || g.gameOver?.type === 'ipo') && g.gameOver.week < 120 },
  { id: 'frozen-win', emoji: '❄️', name: 'Winter Harvest', desc: 'Win any positive exit while the climate is below −0.5.', check: (g) => won(g) && g.climate < -0.5 },
  // empire building
  { id: 'monopolist', emoji: '👑', name: 'Monopolist', desc: 'Acquire all three AI rivals in one run.', check: (g) => g.rivals.length >= 3 && g.rivals.every((r) => r.acquired) },
  { id: 'hydra', emoji: '🐉', name: 'Hydra', desc: 'Run three launched product lines at once.', check: (g) => g.ventures.filter((v) => v.launched).length >= 3 },
  { id: 'moonshot', emoji: '🌙', name: 'Moonshot', desc: 'Reach a peak valuation above $1.5B.', check: (g) => peakVal(g) >= 1_500_000_000 },
  { id: 'bootstrapper', emoji: '🥾', name: 'Bootstrapper', desc: 'Reach a $10M valuation without ever raising a round.', check: (g) => g.stage === 'Pre-seed' && valuation(g) >= 10_000_000 },
  { id: 'war-chest', emoji: '💰', name: 'War Chest', desc: 'Hold $50M in cash at once.', check: (g) => g.cash >= 50_000_000 },
  // company culture
  { id: 'ramen', emoji: '🍜', name: 'Ramen Profitable', desc: 'Cover your burn with revenue before week 30.', check: (g) => g.week < 30 && g.lastRevenue >= g.lastExpenses && g.lastRevenue > 500 },
  { id: 'people-person', emoji: '💖', name: 'Best Place to Work', desc: 'Average morale of 85+ with a team of 10+.', check: (g) => g.employees.length >= 10 && avgMorale(g) >= 85 },
  { id: 'full-squad', emoji: '🏟️', name: 'Full Squad', desc: 'Employ 25 people at once.', check: (g) => g.employees.length >= 25 },
  { id: 'talent-magnet', emoji: '🌟', name: 'Talent Magnet', desc: 'Have a perfect 10-skill employee on the team.', check: (g) => g.employees.some((e) => e.skill >= 10) },
  { id: 'orator', emoji: '🎤', name: 'The Orator', desc: 'Land 5 all-hands pitches in one run.', check: (g) => (g.flags.pitchesLanded ?? 0) >= 5 },
  { id: 'survivor', emoji: '🐢', name: 'The Long Game', desc: 'Keep a company alive to week 200.', check: (g) => g.week >= 200 && !g.gameOver },
  { id: 'daily-done', emoji: '📅', name: 'Daily Ritual', desc: 'Complete a Daily Challenge.', check: (g) => !!g.gameOver && !!g.challenge?.label.startsWith('Daily') },
]

const KEY = 'founder-mode-achievements'

export function earnedAchievements(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

// Returns the defs newly earned by this state (and persists them).
export function checkAchievements(g: GameState): AchievementDef[] {
  const earned = earnedAchievements()
  const fresh: AchievementDef[] = []
  for (const a of ACHIEVEMENTS) {
    if (earned.has(a.id)) continue
    try {
      if (a.check(g)) {
        earned.add(a.id)
        fresh.push(a)
      }
    } catch {
      // a single broken check must never take down the game loop
    }
  }
  if (fresh.length > 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify([...earned]))
    } catch {
      // private mode / quota: badges just don't persist — never break the turn
    }
  }
  return fresh
}
