// Win-rate probe — the balance campaign's baseline instrument (owner calibration, 2026-08-23:
// "in many quick plays I win very easily and many simulation games I lose also very easily").
//
// Run: npx tsx test/winrate-probe.ts [seeds] [sector...]
//
// Two archetypal players, both modes, many seeds. The point is DIFFICULTY CALIBRATION, not
// strategy ranking (career-bots.ts owns that): a CASUAL first-timer should not win most quick
// runs, and an ACTIVE, reasonable player should not die in most simulation runs. Harness rules
// inherited from career-bots.ts / balance-probe.ts: budgets through the same clamps a player
// has, raises actually accepted, `failed` (bankrupt+fired) reported separately from exits,
// score off gameOver.payout.

import { advanceWeek, newGame, pitchInvestors, acceptTermSheet, resolveChoiceOnState, valuation, marketingMax } from '../src/game/engine'
import { segmentsForSector, startExperiment, canRunExperiment, experimentDef } from '../src/game/career/pmf'
import { repositionTo } from '../src/game/career/tick'
import type { GameState, SectorId } from '../src/game/types'

const SEEDS = Number(process.argv[2]) || 16
const SECTORS = (process.argv.slice(3).length ? process.argv.slice(3) : ['saas', 'social']) as SectorId[]
const WEEKS = { quick: 104, career: 120 } as const

let ids = 0
const uid = () => `wr${ids++}`

function common(s: GameState, raiseFreely: boolean) {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
  if (s.raiseCooldown === 0 && (raiseFreely ? s.termSheets.length === 0 && s.week % 8 === 0 : s.cash < (s.lastExpenses || 5000) * 25)) {
    s.termSheets = pitchInvestors(s).sheets
  }
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
}

/** What a first-time player does: defaults, some ads, a hire when flush, says yes to money. */
function casual(s: GameState): void {
  common(s, true)
  s.marketingSpend = Math.min(5000, marketingMax(s))
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  if (s.cash > 150_000 && staff < 4 && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
}

/** A reasonable, attentive player: reads the dashboard and reacts with the normal levers. */
function active(s: GameState): void {
  common(s, false)
  // allocation reacts to state the way the UI teaches
  if (s.bugs > 45) s.allocation = { features: 25, quality: 20, bugs: 40, research: 15, bet: 0 }
  else if (s.pmf < 40) s.allocation = { features: 30, quality: 35, bugs: 10, research: 25, bet: 0 }
  else s.allocation = { features: 50, quality: 25, bugs: 10, research: 15, bet: 0 }
  // marketing scaled to runway: push when funded, cut when tight
  const runway = s.cash / Math.max(1, (s.lastExpenses || 5000) - (s.lastRevenue || 0))
  s.marketingSpend = runway > 30 ? Math.min(12_000, marketingMax(s)) : runway > 15 ? 4000 : 500
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  const affordable = Math.min(8, 1 + Math.floor((s.lastRevenue || 0) / 2500))
  if (runway > 25 && staff < affordable && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
  // career: target an accessible segment, price sanely, run the cheap experiments
  if (s.career) {
    if (s.week === 2) {
      const segs = segmentsForSector(s.sector)
      const seg = [...segs].sort((a, b) => b.base.acquisitionAccessibility - a.base.acquisitionAccessibility)[0]
      repositionTo(s, seg.id, 1)
      s.career.pricing = 'market'
    }
    const seg = s.career.primaryTargetSegmentId
    if (s.week % 10 === 3 && canRunExperiment(s.career, 'interview', seg, s.cash).ok) {
      startExperiment(s.career, s.week, 'interview', seg, uid())
      s.cash -= experimentDef('interview').cashCost
    }
  }
}

interface Row {
  mode: 'quick' | 'career'
  sector: SectorId
  player: 'casual' | 'active'
  bankrupt: number
  fired: number
  unicorn: number
  exits: number
  alive: number
  deathWeeks: number[]
  exitWeeks: number[]
  vals: number[]
}

function play(mode: 'quick' | 'career', sector: SectorId, player: 'casual' | 'active', seed: number) {
  let s = newGame('P', sector, 'technical', { config: { mode, format: 'standard', sector, seed } })
  const act = player === 'casual' ? casual : active
  for (let i = 0; i < WEEKS[mode] && !s.gameOver; i++) {
    act(s)
    s = advanceWeek(s)
  }
  return s
}

const rows: Row[] = []
for (const mode of ['quick', 'career'] as const) {
  for (const sector of SECTORS) {
    for (const player of ['casual', 'active'] as const) {
      const row: Row = { mode, sector, player, bankrupt: 0, fired: 0, unicorn: 0, exits: 0, alive: 0, deathWeeks: [], exitWeeks: [], vals: [] }
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = play(mode, sector, player, seed * 101 + 7)
        const g = s.gameOver
        if (!g || g.type === 'timeup') row.alive++
        else if (g.type === 'bankrupt' || g.type === 'fired') {
          if (g.type === 'bankrupt') row.bankrupt++
          else row.fired++
          row.deathWeeks.push(g.week)
        } else if (g.type === 'unicorn') row.unicorn++
        else {
          row.exits++
          row.exitWeeks.push(g.week)
        }
        row.vals.push(g?.payout ?? Math.round(valuation(s) * s.founderEquity))
      }
      rows.push(row)
    }
  }
}

const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`)
console.log(`\n${SEEDS} seeds × ${SECTORS.join('/')} — horizon: quick ${WEEKS.quick}wk, career ${WEEKS.career}wk\n`)
console.log('mode    sector  player  | bkrpt fired unicorn exits alive | death-wk exit-wk  med-founder-net')
for (const r of rows) {
  console.log(
    `${r.mode.padEnd(7)} ${r.sector.padEnd(7)} ${r.player.padEnd(7)}| ${String(r.bankrupt).padStart(5)} ${String(r.fired).padStart(5)} ${String(r.unicorn).padStart(7)} ${String(r.exits).padStart(5)} ${String(r.alive).padStart(5)} | ${String(med(r.deathWeeks) || '—').padStart(8)} ${String(med(r.exitWeeks) || '—').padStart(7)}  ${money(med(r.vals)).padStart(12)}`,
  )
}
