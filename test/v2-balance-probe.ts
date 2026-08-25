// Business Simulation V2 — the balance probe (spec §57-61, contract phase 8). Two bot
// profiles per sector, headless, deterministic: CASUAL (default allocation, modest spend,
// says yes to money, answers every choice with option 0) and ACTIVE (quality-led build,
// hires engineering and sales, commissions research, prices to what the estimates say,
// reacts to capacity crises). The instrument measures the V2 game the way the V1 winrate
// probe measures the classic one — outcomes, not vibes.
//
//   npx tsx test/v2-balance-probe.ts [seeds] [sectors...]

import { advanceWeek, newGame } from '../src/game/engine'
import { BOTS } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { SectorId } from '../src/game/types'

const argRest = process.argv.slice(2)
const SEEDS = Number(argRest[0]) || 16
const SECTORS = (argRest.slice(1).length ? argRest.slice(1) : ['saas', 'social', 'fintech']) as SectorId[]
const WEEKS = 120

const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)

interface Row {
  sector: string
  player: string
  bankrupt: number
  fired: number
  exits: number
  alive: number
  chapters: Record<string, number>
  vals: number[]
  customers: number[]
}

const rows: Row[] = []
for (const sector of SECTORS) {
  for (const player of ['casual', 'active'] as const) {
    const row: Row = { sector, player, bankrupt: 0, fired: 0, exits: 0, alive: 0, chapters: {}, vals: [], customers: [] }
    for (let i = 0; i < SEEDS; i++) {
      const cfg = { mode: 'career', format: 'standard', sector, seed: 1000 + i * 97, engine: 'v2' } as GameConfig
      const bot = BOTS[player]
      let s = newGame(`${player}V2`, sector, bot.founderKind, { config: cfg })
      for (let w = 0; w < WEEKS && !s.gameOver; w++) {
        bot.play(s)
        if (s.gameOver) break
        s = advanceWeek(s)
      }
      const go = s.gameOver
      if (go?.type === 'bankrupt') row.bankrupt++
      else if (go?.type === 'fired') row.fired++
      else if (go) row.exits++
      else row.alive++
      const ch = s.simV2?.chapter ?? '?'
      row.chapters[ch] = (row.chapters[ch] ?? 0) + 1
      row.vals.push(go?.payout ?? Math.round((s.simV2?.weeklyHistory.at(-1)?.revenue ?? 0) * 52))
      row.customers.push(s.users)
    }
    rows.push(row)
  }
}

console.log(`V2 balance probe — ${SEEDS} seeds × ${SECTORS.join('/')} × 120wk\n`)
console.log('sector  player  | bkrpt fired exits alive | med-customers  med-val/ARR | chapters reached')
for (const r of rows) {
  const ch = Object.entries(r.chapters)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')
  console.log(
    `${r.sector.padEnd(7)} ${r.player.padEnd(7)}| ${String(r.bankrupt).padStart(5)} ${String(r.fired).padStart(5)} ${String(r.exits).padStart(5)} ${String(r.alive).padStart(5)} | ${String(med(r.customers)).padStart(13)}  ${money(med(r.vals)).padStart(11)} | ${ch}`,
  )
}
