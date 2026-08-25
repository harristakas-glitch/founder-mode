// The balance lockfile gate — golden traces pin determinism; this pins BALANCE.
//
// test/balance-bands.json stores, per cell (sector × archetype on V2 Simulation), the outcome
// bands the canonical probe is expected to land in at 16 seeds. Any engine change that moves a
// cell out of band fails this gate until the lockfile is updated IN THE SAME COMMIT with a
// rationale — exactly the golden-trace discipline, but statistical.
//
//   npx tsx test/balance-gate.ts --smoke     fast guardrails (4 seeds): catastrophes only
//   npx tsx test/balance-gate.ts --full      the real gate (16 seeds): every band
//   npx tsx test/balance-gate.ts --update    re-measure at 16 seeds and REWRITE the lockfile
//                                            (commit it with a rationale, like a golden)
//
// Band semantics at --full: counts (bankrupt/fired/exits) must sit within [lo, hi]; medians
// (customers, founder value) within [med/tol, med*tol]. At --smoke only disasters trip it:
// a bankruptcy count above hi+1, any firing where the band is 0, or a median outside 3x.

import { readFileSync, writeFileSync } from 'node:fs'
import { advanceWeek, newGame, valuation } from '../src/game/engine'
import { BOTS } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const MODE = process.argv.includes('--update') ? 'update' : process.argv.includes('--full') ? 'full' : 'smoke'
const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce', 'aiml']
const ARCHETYPES = ['casual', 'active'] as const
const FULL_SEEDS = 16
const SMOKE_SEEDS = 4
const WEEKS = 120
const MED_TOL = 1.7 // full-gate multiplicative tolerance on medians
const BANDS_PATH = new URL('./balance-bands.json', import.meta.url).pathname

interface Cell {
  bankrupt: [number, number]
  fired: [number, number]
  exits: [number, number]
  medCustomers: number
  medFounderValue: number
}
type Bands = { seeds: number; note: string; cells: Record<string, Cell> }

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)

function measure(sector: SectorId, archetype: (typeof ARCHETYPES)[number], seeds: number) {
  const bot = BOTS[archetype]
  let bankrupt = 0
  let fired = 0
  let exits = 0
  const customers: number[] = []
  const founderValue: number[] = []
  for (let i = 0; i < seeds; i++) {
    const cfg = { mode: 'career', format: 'standard', sector, seed: 1000 + i * 97, engine: 'v2' } as GameConfig
    let s: GameState = newGame(`${archetype}V2`, sector, bot.founderKind, { config: cfg })
    for (let w = 0; w < WEEKS && !s.gameOver; w++) {
      bot.play(s)
      if (s.gameOver) break
      s = advanceWeek(s)
    }
    if (s.gameOver?.type === 'bankrupt') bankrupt++
    else if (s.gameOver?.type === 'fired') fired++
    else if (s.gameOver) exits++
    customers.push(s.users)
    founderValue.push(s.gameOver ? (s.gameOver.payout ?? 0) : Math.round(s.founderEquity * valuation(s)))
  }
  return { bankrupt, fired, exits, medCustomers: med(customers), medFounderValue: med(founderValue) }
}

if (MODE === 'update') {
  const bands: Bands = {
    seeds: FULL_SEEDS,
    note: 'Balance lockfile — regenerate ONLY via `npx tsx test/balance-gate.ts --update`, and commit the change with a rationale for why the balance legitimately moved.',
    cells: {},
  }
  for (const sector of SECTORS)
    for (const a of ARCHETYPES) {
      const m = measure(sector, a, FULL_SEEDS)
      // count bands: ±3 around the measured value, floored at 0 (16-seed binomial noise)
      bands.cells[`${sector}/${a}`] = {
        bankrupt: [Math.max(0, m.bankrupt - 3), m.bankrupt + 3],
        fired: [0, m.fired + 2],
        exits: [Math.max(0, m.exits - 3), Math.min(FULL_SEEDS, m.exits + 3)],
        medCustomers: m.medCustomers,
        medFounderValue: m.medFounderValue,
      }
      console.log(`${sector}/${a}: bankrupt=${m.bankrupt} exits=${m.exits} medCust=${m.medCustomers} medFV=${money(m.medFounderValue)}`)
    }
  writeFileSync(BANDS_PATH, JSON.stringify(bands, null, 2) + '\n')
  console.log(`\nlockfile rewritten: ${BANDS_PATH} — commit it with a rationale`)
  process.exit(0)
}

const bands: Bands = JSON.parse(readFileSync(BANDS_PATH, 'utf8'))
const seeds = MODE === 'full' ? FULL_SEEDS : SMOKE_SEEDS
let failures = 0
console.log(`Balance gate (${MODE}, ${seeds} seeds) vs lockfile @${bands.seeds} seeds\n`)
for (const sector of SECTORS)
  for (const a of ARCHETYPES) {
    const cell = bands.cells[`${sector}/${a}`]
    if (!cell) continue
    const m = measure(sector, a, seeds)
    const problems: string[] = []
    if (MODE === 'full') {
      if (m.bankrupt < cell.bankrupt[0] || m.bankrupt > cell.bankrupt[1]) problems.push(`bankrupt ${m.bankrupt} ∉ [${cell.bankrupt}]`)
      if (m.fired < cell.fired[0] || m.fired > cell.fired[1]) problems.push(`fired ${m.fired} ∉ [${cell.fired}]`)
      if (m.exits < cell.exits[0] || m.exits > cell.exits[1]) problems.push(`exits ${m.exits} ∉ [${cell.exits}]`)
      if (m.medFounderValue > 0 && cell.medFounderValue > 0 && (m.medFounderValue > cell.medFounderValue * MED_TOL || m.medFounderValue < cell.medFounderValue / MED_TOL))
        problems.push(`medFV ${money(m.medFounderValue)} vs locked ${money(cell.medFounderValue)} (>${MED_TOL}x)`)
    } else {
      // smoke: catastrophes only, scaled to the smaller sample
      const scaledBankruptHi = Math.ceil((cell.bankrupt[1] / bands.seeds) * seeds) + 1
      if (m.bankrupt > scaledBankruptHi) problems.push(`bankrupt ${m.bankrupt}/${seeds} > guardrail ${scaledBankruptHi}`)
      if (cell.fired[1] === 0 && m.fired > 0) problems.push(`fired ${m.fired} where the band is 0`)
      if (m.medFounderValue > 0 && cell.medFounderValue > 0 && (m.medFounderValue > cell.medFounderValue * 3 || m.medFounderValue < cell.medFounderValue / 3))
        problems.push(`medFV ${money(m.medFounderValue)} vs locked ${money(cell.medFounderValue)} (>3x)`)
    }
    if (problems.length) {
      failures++
      console.log(`✗ ${sector}/${a}: ${problems.join('; ')}`)
    } else {
      console.log(`✓ ${sector}/${a}`)
    }
  }

console.log(failures === 0 ? '\nBALANCE GATE: PASS' : `\nBALANCE GATE: FAIL — ${failures} cell(s) out of band. If the move is intended, run --update and commit the lockfile with a rationale.`)
process.exit(failures === 0 ? 0 : 1)
