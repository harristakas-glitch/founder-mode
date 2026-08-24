// Business Simulation V2 — the balance probe (spec §57-61, contract phase 8). Two bot
// profiles per sector, headless, deterministic: CASUAL (default allocation, modest spend,
// says yes to money, answers every choice with option 0) and ACTIVE (quality-led build,
// hires engineering and sales, commissions research, prices to what the estimates say,
// reacts to capacity crises). The instrument measures the V2 game the way the V1 winrate
// probe measures the classic one — outcomes, not vibes.
//
//   npx tsx test/v2-balance-probe.ts [seeds] [sectors...]

import { advanceWeek, newGame, pitchInvestors, acceptTermSheet, resolveChoiceOnState, marketingMax } from '../src/game/engine'
import { startResearchV2 } from '../src/game/sim2/research'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const argRest = process.argv.slice(2)
const SEEDS = Number(argRest[0]) || 16
const SECTORS = (argRest.slice(1).length ? argRest.slice(1) : ['saas', 'social', 'fintech']) as SectorId[]
const WEEKS = 120

const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)

function resolveChoices(s: GameState): void {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
}

function hire(s: GameState, role: string): void {
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  if (s.cash < 180_000 || staff >= 10) return
  const c = [...s.candidates].filter((x) => x.role === role).sort((a, b) => b.skill - a.skill)[0]
  if (!c) return
  s.candidates = s.candidates.filter((x) => x.id !== c.id)
  s.offersOut.push(c)
}

function casual(s: GameState): void {
  resolveChoices(s)
  s.marketingSpend = Math.min(5_000, marketingMax(s))
  if (s.raiseCooldown === 0 && s.termSheets.length === 0 && s.week % 8 === 0) s.termSheets = pitchInvestors(s).sheets
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  if (s.week % 9 === 0) hire(s, 'engineer')
}

function active(s: GameState): void {
  resolveChoices(s)
  const v2 = s.simV2!
  if (s.week === 2) {
    s.allocation = { ...s.allocation, features: 40, quality: 35, bugs: 15, research: 10 }
    s.marketingSpend = Math.min(6_000, marketingMax(s))
  }
  // scale spend only after the service side holds and the channel is not screaming
  if (s.week > 20 && v2.serviceQuality > 60 && (v2.gtm?.lastCac ?? 0) < 400) s.marketingSpend = Math.min(10_000, marketingMax(s))
  else if (v2.serviceQuality < 45) s.marketingSpend = Math.min(3_000, marketingMax(s))
  // study the money question early, then price to the segment you ACTUALLY serve — premium
  // into a mass-consumer base is a real mistake the economics punish (measured, round 1)
  if (s.week === 6) startResearchV2(s, 'pricing_study', v2.segments[1]?.id ?? v2.segments[0].id)
  if (s.week === 20 && s.career) {
    const served: Record<string, number> = {}
    for (const c of v2.cohorts) served[c.segmentId] = (served[c.segmentId] ?? 0) + c.size
    const domId = Object.entries(served).sort((a, b) => b[1] - a[1])[0]?.[0]
    const dom = v2.segments.find((x) => x.id === domId)
    if (dom) {
      const est = dom.knowledge.wtp.visibleEstimate
      s.career.pricing = est > v2.pricing.price * 1.35 ? 'premium' : est < v2.pricing.price * 0.75 ? 'low' : 'market'
    }
  }
  // team: engineers first (attributes are the game), one seller for the upmarket door, service
  if (s.week === 10 || s.week === 24 || s.week === 38 || s.week === 52) hire(s, 'engineer')
  if (s.week === 30) hire(s, 'sales')
  if (s.week === 18 || s.week === 44) hire(s, 'designer')
  if (s.raiseCooldown === 0 && s.termSheets.length === 0 && (s.cash < 250_000 || s.week % 16 === 0)) s.termSheets = pitchInvestors(s).sheets
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount / b.equity - a.amount / a.equity)[0].id)
}

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
      let s = newGame(`${player}V2`, sector, player === 'active' ? 'business' : 'technical', { config: cfg })
      for (let w = 0; w < WEEKS && !s.gameOver; w++) {
        ;(player === 'casual' ? casual : active)(s)
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
