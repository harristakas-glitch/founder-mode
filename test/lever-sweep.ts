// The dominant-strategy detector — for every lever, informed play must beat both extremes.
//
// This is the generalization of the harness that caught peg-the-dial dominance (2026-08-25
// audit, critical x2): each lever runs three arms on paired seeds with an otherwise-identical
// informed bot — an EXTREME-LOW arm, the INFORMED arm (the expert bot's own policy), and an
// EXTREME-HIGH arm. If an extreme arm beats informed on median founder value, that lever has a
// degenerate setting and the game has a dominant strategy. Nightly, not per-commit (heavy).
//
//   npx tsx test/lever-sweep.ts [seeds] [--assert]

import { advanceWeek, newGame, valuation, marketingMax } from '../src/game/engine'
import { BOTS } from './bots/archetypes'
import { sectorById } from '../src/game/data'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const args = process.argv.slice(2).filter((a) => a !== '--assert')
const ASSERT = process.argv.includes('--assert')
const SEEDS = Number(args[0]) || 10
const WEEKS = 120
const SECTORS: SectorId[] = ['saas', 'fintech']
/** an extreme arm "dominates" if it beats informed by more than this ratio on median —
 *  tolerance keeps seed noise from crying wolf; peg-high pre-fix measured 4.5-8.4x */
const DOMINANCE = 1.25

interface Lever {
  name: string
  /** applied every week on top of the expert bot; return true to SUPPRESS expert's own use of the lever */
  low: (s: GameState) => void
  high: (s: GameState) => void
}

const LEVERS: Lever[] = [
  {
    name: 'price-dial',
    low: (s) => {
      const ref = sectorById(s.sector).arpuPerCustomer
      if (s.simV2) s.simV2.pricing = { price: ref * 0.25, lastChangedWeek: s.week, manual: true }
    },
    high: (s) => {
      const ref = sectorById(s.sector).arpuPerCustomer
      if (s.simV2) s.simV2.pricing = { price: ref * 6, lastChangedWeek: s.week, manual: true }
    },
  },
  {
    name: 'marketing',
    low: (s) => (s.marketingSpend = 0),
    high: (s) => (s.marketingSpend = marketingMax(s)),
  },
  {
    name: 'allocation',
    low: (s) => (s.allocation = { ...s.allocation, features: 80, quality: 5, bugs: 5, research: 10 }),
    high: (s) => (s.allocation = { ...s.allocation, features: 5, quality: 80, bugs: 5, research: 10 }),
  },
  {
    name: 'positioning',
    low: (s) => {
      if (s.simV2) s.simV2.positioning = { targetSegmentId: null }
    },
    high: (s) => {
      // INCOHERENT positioning: rotate the declared segment every single week. The previous
      // "high" arm (always declare the least-served segment) turned out to be a legitimate
      // upmarket-expansion strategy, not abuse — it beat informed on saas by honestly courting
      // the underserved enterprise tier. True degenerate use of the dial is thrashing it:
      // a story that changes weekly should never beat a coherent one.
      const v2 = s.simV2
      if (!v2 || v2.segments.length === 0) return
      const pick = v2.segments[s.week % v2.segments.length]
      if (pick) v2.positioning = { targetSegmentId: pick.id }
    },
  },
]

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)

function run(sector: SectorId, seed: number, override?: (s: GameState) => void): number {
  const bot = BOTS.expert
  const cfg = { mode: 'career', format: 'standard', sector, seed, engine: 'v2' } as GameConfig
  let s = newGame('Sweep', sector, bot.founderKind, { config: cfg })
  for (let w = 0; w < WEEKS && !s.gameOver; w++) {
    bot.play(s)
    override?.(s) // the arm's move lands AFTER the bot's, so the override is authoritative
    if (s.gameOver) break
    s = advanceWeek(s)
  }
  return s.gameOver ? (s.gameOver.payout ?? 0) : Math.round(s.founderEquity * valuation(s))
}

let failures = 0
console.log(`Lever sweep — expert bot ± one lever forced to its extreme, ${SEEDS} paired seeds × ${SECTORS.join('/')}\n`)
console.log('lever        sector  |  low-extreme   informed    high-extreme | verdict')
for (const lever of LEVERS) {
  for (const sector of SECTORS) {
    const lows: number[] = []
    const infs: number[] = []
    const highs: number[] = []
    for (let i = 0; i < SEEDS; i++) {
      const seed = 1000 + i * 97
      infs.push(run(sector, seed))
      lows.push(run(sector, seed, lever.low))
      highs.push(run(sector, seed, lever.high))
    }
    const mi = med(infs)
    const dominated = mi <= 0 || med(lows) > mi * DOMINANCE || med(highs) > mi * DOMINANCE
    if (dominated) failures++
    console.log(
      `${lever.name.padEnd(12)} ${sector.padEnd(7)} | ${money(med(lows)).padStart(12)} ${money(mi).padStart(10)} ${money(med(highs)).padStart(13)} | ${dominated ? 'EXTREME DOMINATES ✗' : 'informed holds ✓'}`,
    )
  }
}

if (ASSERT) {
  console.log(failures === 0 ? '\nLEVER SWEEP: PASS' : `\nLEVER SWEEP: FAIL — ${failures} lever/sector cell(s) have a dominant extreme`)
  process.exit(failures === 0 ? 0 : 1)
}
