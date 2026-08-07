// Career PMF bot strategies (brief §53). Purpose is to detect broken or dominant play,
// not to make every bot succeed.
import { advanceWeek, newGame, pitchInvestors, acceptTermSheet, resolveChoiceOnState } from '../src/game/engine'
import { canRunExperiment, experimentDef, segmentsForSector, startExperiment, totalCustomers, PMF_LABEL, derivePmfForSegment, segmentPriceFit, segmentProductFit, segmentCeiling } from '../src/game/career/pmf'
import { repositionTo } from '../src/game/career/tick'
import { sectorById } from '../src/game/data'
import { valuation } from '../src/game/engine'
import type { GameState } from '../src/game/types'
import type { ExperimentType } from '../src/game/career/types'

let ids = 0
const uid = () => `bot${ids++}`

function cfg(seed: number) {
  return { mode: 'career' as const, format: 'standard' as const, sector: 'saas' as const, seed }
}

function common(s: GameState) {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
  if (s.raiseCooldown === 0 && s.cash < (s.lastExpenses || 5000) * 25) pitchInvestors(s)
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  // Hire against what the business can carry, not against a runway number. The earlier
  // version hired 8 people on $1k/wk of revenue and every strategy died of payroll, which
  // told us nothing about the strategies.
  const affordable = Math.min(8, 1 + Math.floor(s.lastRevenue / 2500))
  if (s.cash / Math.max(1, s.lastExpenses || 5000) > 25 && staff < affordable && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
}

function tryExperiment(s: GameState, type: ExperimentType, seg: string) {
  if (!s.career) return
  if (canRunExperiment(s.career, type, seg, s.cash).ok) {
    startExperiment(s.career, s.week, type, seg, uid())
    s.cash -= experimentDef(type).cashCost
  }
}

// 1. Picks the easiest segment, barely researches, spends hard.
function carelessGrowth(seed: number, weeks = 90) {
  let s = newGame('Careless', 'saas', 'technical', { config: cfg(seed) })
  const segs = segmentsForSector('saas')
  const easiest = [...segs].sort((a, b) => b.base.acquisitionAccessibility - a.base.acquisitionAccessibility)[0]
  repositionTo(s, easiest.id, 1)
  s.career!.pricing = 'low'
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s)
    s.marketingSpend = Math.min(Math.max(2_000, s.lastRevenue * 1.2), s.cash * 0.06, 200_000)
    s = advanceWeek(s)
  }
  return s
}

// 2. Interviews → prototype → pricing → pilot, targets on evidence, scales only after retention.
function disciplinedDiscovery(seed: number, weeks = 90) {
  let s = newGame('Disciplined', 'saas', 'technical', { config: cfg(seed) })
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s)
    const c = s.career!
    const target = c.primaryTargetSegmentId
    const b = c.segmentBeliefs[target]
    // run the cheapest experiment that still answers an open question
    if (b.needIntensity.confidence < 0.45) tryExperiment(s, 'interview', target)
    else if (b.acquisitionAccessibility.confidence < 0.45) tryExperiment(s, 'landing_page', target)
    else if (b.productRequirement.confidence < 0.5) tryExperiment(s, 'prototype', target)
    else if (b.willingnessToPay.confidence < 0.6) tryExperiment(s, 'pricing_test', target)
    else if (b.retentionPotential.confidence < 0.7) tryExperiment(s, 'pilot', target)

    // after week 30, switch to the segment whose evidence looks best
    if (s.week === 30) {
      const scored = segmentsForSector('saas').map((sg) => {
        const bb = c.segmentBeliefs[sg.id]
        return { id: sg.id, v: bb.needIntensity.estimate * 0.4 + bb.willingnessToPay.estimate * 0.35 + bb.retentionPotential.estimate * 0.55 }
      })
      const best = scored.sort((x, y) => y.v - x.v)[0]
      if (best.id !== target) repositionTo(s, best.id, s.week)
    }
    // only scale once the base actually holds
    const retention = c.retentionBySegment[c.primaryTargetSegmentId] ?? 0
    s.marketingSpend = retention > 0.72 ? Math.min(Math.max(4_000, s.lastRevenue * 1.1), s.cash * 0.05, 180_000) : Math.min(3_000, s.cash * 0.004)
    s = advanceWeek(s)
  }
  return s
}

// 3. Bets on the high-value segment, invests in product, accepts slow growth.
function enterpriseBet(seed: number, weeks = 90) {
  let s = newGame('Enterprise', 'saas', 'technical', { config: cfg(seed) })
  const segs = segmentsForSector('saas')
  const richest = [...segs].sort((a, b) => b.base.willingnessToPay - a.base.willingnessToPay)[0]
  repositionTo(s, richest.id, 1)
  s.career!.pricing = 'premium'
  s.career!.focus = 'enterprise_readiness'
  s.allocation = { features: 30, quality: 45, bugs: 15, research: 10, bet: 0 }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s)
    const c = s.career!
    if (s.week % 12 === 3) tryExperiment(s, 'pilot', c.primaryTargetSegmentId)
    s.marketingSpend = Math.min(Math.max(2_000, s.lastRevenue * 0.8), s.cash * 0.03, 60_000)
    s = advanceWeek(s)
  }
  return s
}

function report(name: string, runs: GameState[]) {
  const alive = runs.filter((r) => !r.gameOver).length
  const dead = runs.filter((r) => r.gameOver?.type === 'bankrupt' || r.gameOver?.type === 'fired').length
  const cust = runs.map((r) => r.users).sort((a, b) => a - b)
  const cash = runs.map((r) => Math.round(r.cash)).sort((a, b) => a - b)
  const mid = Math.floor(runs.length / 2)
  const pmfs = runs.map((r) => {
    if (!r.career) return 'n/a'
    const tam = sectorById(r.sector).tam
    const best = segmentsForSector(r.sector)
      .map((sg) => {
        const t = r.career!.segmentTruth[sg.id]
        return derivePmfForSegment({
          segmentId: sg.id,
          customers: totalCustomers(r.career!, sg.id),
          retention4wk: r.career!.retentionBySegment[sg.id] ?? 0,
          priceFit: segmentPriceFit(t, r.career!.pricing),
          productFit: segmentProductFit(t, r.quality, r.career!.focus, r.sector, sg.id),
          truth: t,
          beliefs: r.career!.segmentBeliefs[sg.id],
          ceiling: segmentCeiling(t, tam),
        })
      })
      .sort((a, b) => b.score - a.score)[0]
    return PMF_LABEL[best.status]
  })
  const counts: Record<string, number> = {}
  for (const p of pmfs) counts[p] = (counts[p] ?? 0) + 1
  const retention = runs.map((r) => (r.career ? (r.career.retentionBySegment[r.career.primaryTargetSegmentId] ?? 0) : 0)).sort((a, b) => a - b)
  const rev = runs.map((r) => Math.round(r.lastRevenue)).sort((a, b) => a - b)
  const val = runs.map((r) => Math.round(valuation(r))).sort((a, b) => a - b)
  const spent = runs.map((r) => Math.round(r.career ? r.career.cohorts.reduce((a, c) => a + c.acquisitionCost, 0) : 0)).sort((a, b) => a - b)
  const firstRev = runs
    .map((r) => r.history.find((x) => x.revenue > 2000)?.week ?? 999)
    .sort((a, b) => a - b)
  console.log(
    `${name.padEnd(22)} alive ${String(alive).padStart(2)}/${runs.length} · died ${dead} · median customers ${cust[mid].toLocaleString().padStart(8)} · median cash ${('$' + cash[mid].toLocaleString()).padStart(12)} · median 4wk retention ${(retention[mid] * 100).toFixed(0)}%`,
  )
  console.log(`${' '.repeat(22)} best-segment PMF: ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ')}`)
  console.log(
    `${' '.repeat(22)} median rev/wk $${rev[mid].toLocaleString()} · median valuation $${(val[mid] / 1e6).toFixed(1)}M · median wk to $2k/wk revenue ${firstRev[mid] === 999 ? 'never' : firstRev[mid]} · median ad spend $${spent[mid].toLocaleString()}`,
  )
}

const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88]
console.log('— Career bot strategies, 8 seeds, 90 weeks —\n')
report('Careless Growth', SEEDS.map((s) => carelessGrowth(s)))
report('Disciplined Discovery', SEEDS.map((s) => disciplinedDiscovery(s)))
report('Enterprise Bet', SEEDS.map((s) => enterpriseBet(s)))
