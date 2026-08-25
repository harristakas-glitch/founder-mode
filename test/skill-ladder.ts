// The skill ladder — the design claim "better play does better", enforced.
//
// Runs the tiered archetypes (doNothing < casual < active < expert) through identical seeded
// V2 Simulation runs per sector and asserts outcomes are monotone in tier. A tier inversion
// is a balance defect (the 2026-08-25 audit found two: fintech and devtools both had casual
// beating active — devtools is fixed, fintech is narrowed and tracked).
//
//   npx tsx test/skill-ladder.ts [seeds] [--assert]
//
// Gate policy: HARD_SECTORS fail the run on inversion; the rest report (they are either
// known-open calibration items or too new to gate). Promote a sector to HARD when it holds
// at 16 seeds across two consecutive calibration rounds.

import { advanceWeek, newGame, valuation } from '../src/game/engine'
import { LADDER } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { SectorId } from '../src/game/types'

const args = process.argv.slice(2).filter((a) => a !== '--assert')
const ASSERT = process.argv.includes('--assert')
const SEEDS = Number(args[0]) || 12
const WEEKS = 120
const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce', 'aiml']
/** sectors where the ladder is a hard gate (see policy above) */
const HARD_SECTORS: SectorId[] = ['saas', 'devtools', 'aiml']
/** an upper tier must reach at least this fraction of the next lower tier's median to "hold" —
 *  tolerance for seed noise; a real inversion lands well under it */
const TOLERANCE = 0.9

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)

let failures = 0
console.log(`Skill ladder — ${SEEDS} seeds × ${WEEKS}wk × ${LADDER.map((b) => b.name).join(' < ')}\n`)
console.log('sector    | doNothing   casual      active      expert     | verdict')

for (const sector of SECTORS) {
  const meds: number[] = []
  for (const bot of LADDER) {
    const scores: number[] = []
    for (let i = 0; i < SEEDS; i++) {
      const cfg = { mode: 'career', format: 'standard', sector, seed: 1000 + i * 97, engine: 'v2' } as GameConfig
      let s = newGame(`${bot.name}L`, sector, bot.founderKind, { config: cfg })
      for (let w = 0; w < WEEKS && !s.gameOver; w++) {
        bot.play(s)
        if (s.gameOver) break
        s = advanceWeek(s)
      }
      // founder value: the exit cheque if the run ended, the founder's paper worth if not.
      // Firings/bankruptcies score their (small or zero) payout — dying is properly punished.
      scores.push(s.gameOver ? (s.gameOver.payout ?? 0) : Math.round(s.founderEquity * valuation(s)))
    }
    meds.push(med(scores))
  }
  const holds = meds.every((m, i) => i === 0 || m >= meds[i - 1] * TOLERANCE)
  const hard = HARD_SECTORS.includes(sector)
  const verdict = holds ? 'monotone ✓' : hard ? 'INVERTED ✗ (gated)' : 'inverted — tracked'
  if (!holds && hard) failures++
  console.log(
    `${sector.padEnd(9)} | ${meds.map((m) => money(m).padEnd(11)).join(' ')}| ${verdict}`,
  )
}

if (ASSERT) {
  console.log(failures === 0 ? '\nSKILL LADDER: PASS' : `\nSKILL LADDER: FAIL — ${failures} gated sector(s) inverted`)
  process.exit(failures === 0 ? 0 : 1)
}
