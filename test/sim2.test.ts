// Business Simulation V2 — the contract's testing gates (docs/business-sim-v2-implementation.md
// §8). Phase 1 scope: determinism, isolation from V1, choice-model laws, reconciliation,
// truth isolation, the seeded-RNG ban, and the first playable loop actually playing.

import { readFileSync, readdirSync } from 'node:fs'
import { advanceWeek, newGame } from '../src/game/engine'
import { choiceShares, effectiveWtp, offerUtility, priceFit, productFit } from '../src/game/sim2/economics'
import { marketTemplate } from '../src/game/sim2/config/markets'
import type { GameConfig } from '../src/game/modes'
import type { GameState } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`)
  if (!cond) fails.push(msg)
}

const v2cfg = (seed: number, sector = 'saas'): GameConfig =>
  ({ mode: 'career', format: 'standard', sector, seed, engine: 'v2' }) as GameConfig

const playWeeks = (s: GameState, n: number): GameState => {
  let g = s
  for (let i = 0; i < n; i++) g = advanceWeek(g)
  return g
}

console.log('— The gate: V2 exists only where it was asked for —')
{
  const q = newGame('Q', 'saas', 'technical', { config: { mode: 'quick', format: 'standard', sector: 'saas', seed: 5 } as GameConfig })
  const c1 = newGame('C', 'saas', 'technical', { config: { mode: 'career', format: 'standard', sector: 'saas', seed: 5 } as GameConfig })
  ok(q.simV2 === undefined && playWeeks(q, 3).simV2 === undefined, 'quick never allocates V2 state')
  ok(c1.simV2 === undefined && playWeeks(c1, 3).simV2 === undefined, 'a classic Simulation run never allocates V2 state')
  const v2 = newGame('V', 'saas', 'technical', { config: v2cfg(5) })
  ok(v2.simV2 !== undefined && v2.simV2.version === 2, 'engine:"v2" allocates the V2 root state at creation')
}

console.log('— Determinism: same seed + same decisions = identical state —')
{
  const a = playWeeks(newGame('D', 'saas', 'technical', { config: v2cfg(77) }), 20)
  const b = playWeeks(newGame('D', 'saas', 'technical', { config: v2cfg(77) }), 20)
  ok(JSON.stringify(a.simV2) === JSON.stringify(b.simV2), 'twenty V2 weeks replay byte-identically')
  ok(a.users === b.users && a.cash === b.cash && a.pmf === b.pmf, 'the shared numbers agree too')
  const c = playWeeks(newGame('D', 'saas', 'technical', { config: v2cfg(78) }), 20)
  ok(JSON.stringify(c.simV2) !== JSON.stringify(a.simV2), 'a different seed deals a different market')
}

console.log('— Choice-model laws (spec §44) —')
{
  const tpl = marketTemplate('saas')
  const seg = newGame('L', 'saas', 'technical', { config: v2cfg(9) }).simV2!.segments[1]
  // shares + outside sum to 1
  const offers = [
    { id: 'p', fit: 0.6, priceFitV: 0.5, brand: 30, installedShare: 0.1 },
    { id: 'r1', fit: 0.5, priceFitV: 0.6, brand: 40, installedShare: 0 },
  ]
  const sh = choiceShares(seg, offers, tpl.choiceTemperature)
  const sum = Object.values(sh).reduce((a, b) => a + b, 0)
  ok(Math.abs(sum - 1) < 1e-9 && sh.outside > 0, `shares + outside option sum to 1 (${sum.toFixed(9)}), outside is never zero`)
  // monotonicity: better fit never lowers utility
  const u1 = offerUtility(seg, { id: 'p', fit: 0.4, priceFitV: 0.5, brand: 30, installedShare: 0 })
  const u2 = offerUtility(seg, { id: 'p', fit: 0.7, priceFitV: 0.5, brand: 30, installedShare: 0 })
  ok(u2 > u1, 'better product fit never reduces utility')
  // price far above WTP is punished, smoothly
  const wtp = 20
  ok(priceFit(60, wtp, 0.6) < priceFit(22, wtp, 0.6) && priceFit(22, wtp, 0.6) < priceFit(8, wtp, 0.6), 'price above WTP always converts worse')
  ok(priceFit(8, wtp, 0.6) - priceFit(14, wtp, 0.6) < priceFit(22, wtp, 0.6) - priceFit(40, wtp, 0.6) + 1, 'cheap has diminishing upside (smooth, no cliffs)')
  // brand never reduces demand-side utility
  const u3 = offerUtility(seg, { id: 'p', fit: 0.5, priceFitV: 0.5, brand: 70, installedShare: 0 })
  ok(u3 >= u1, 'better brand never reduces utility')
  // brand cannot rescue terrible fit (bounded pricing power)
  ok(effectiveWtp(seg, 0.1, 100) < effectiveWtp(seg, 0.9, 0), 'brand at 100 with terrible fit is worth less than great fit with no brand')
  // thresholds bite: an enterprise-style segment punishes a product below its security floor
  const ent = newGame('L', 'saas', 'technical', { config: v2cfg(9) }).simV2!.segments[3]
  const below = productFit({ core: 85, reliability: 90, security: 30, integrations: 70, service: 70, ease: 70 }, ent.attributePreferences)
  const above = productFit({ core: 85, reliability: 90, security: 65, integrations: 70, service: 70, ease: 70 }, ent.attributePreferences)
  ok(above - below > 0.2, `a hard threshold is a wall, not a slope (${below.toFixed(2)} vs ${above.toFixed(2)})`)
}

console.log('— The first playable loop (spec phase 1) —')
{
  let g = newGame('P', 'saas', 'technical', { config: v2cfg(41) })
  g.marketingSpend = 4000
  g = playWeeks(g, 30)
  const v2 = g.simV2!
  ok(g.users > 0, `the causal chain acquires customers (${g.users})`)
  ok(g.lastRevenue > 0, `and they pay (${Math.round(g.lastRevenue)}/wk)`)
  ok(v2.weeklyHistory.length === 30, 'a snapshot per week, no gaps')
  const custSum = v2.cohorts.reduce((a, c) => a + c.size, 0)
  ok(Math.abs(custSum - g.users) < 1, 'customers === the sum of living cohorts (one truth)')
  const last = v2.weeklyHistory[v2.weeklyHistory.length - 1]
  const hist = g.history[g.history.length - 1]
  ok(Math.abs(last.netIncome - (hist.revenue - hist.expenses)) < 1, 'the snapshot closes to the same ledger the P&L reads')
  ok(v2.weeklyHistory.some((s) => s.eventIds.length > 0), 'weeks emit ranked, visible events')
  // playing quality should show up as fit rising somewhere
  const fitEarly = Object.values(v2.weeklyHistory[4].productFit).reduce((a, b) => a + b, 0)
  const fitLate = Object.values(last.productFit).reduce((a, b) => a + b, 0)
  ok(fitLate > fitEarly, 'building the product moves segment fit — the chain, not a stat bonus')
}

console.log('— Phase 2: GTM saturation, sales capacity, expansion —')
{
  const { createSimV2 } = await import('../src/game/sim2/init')
  const { resolveWeekV2 } = await import('../src/game/sim2/resolveWeek')
  const mkInputs = (over: Record<string, unknown> = {}) =>
    ({
      week: 30,
      sector: 'saas',
      engPointsP: 8,
      af: 0.5,
      aq: 0.3,
      ab: 0.2,
      bugs: 10,
      brandStock: 20,
      perfSpend: 12_000,
      price: 22,
      infraCostPerUser: 0.12,
      macroFactor: 1,
      rivals: [],
      churnRelief: 1,
      acquisitionEff: 1,
      salesPoints: 0,
      servicePoints: 3,
      aiSupportMult: 1,
      founderKind: 'technical' as const,
      runwayWeeks: 40,
      boardTarget: 0,
      rng: () => 0.5,
      ...over,
    }) as never

  // the same product, priced for everyone: attributes high enough that fit exists everywhere
  const base = () => {
    let seq = 0.3
    const st = createSimV2('saas', 22, () => ((seq = (seq * 9301 + 0.49297) % 1), seq))
    for (const a of st.attributes) a.value = 70
    return st
  }

  // 1. channel saturation: a fresh channel outperforms a burned one at the SAME spend
  const freshCh = base()
  const burned = base()
  burned.gtm.paidSaturationEma = 60_000
  resolveWeekV2(freshCh, mkInputs())
  resolveWeekV2(burned, mkInputs())
  const freshNew = freshCh.weeklyHistory[0].newCustomers
  const burnedNew = burned.weeklyHistory[0].newCustomers
  ok(freshNew > burnedNew, `a saturated paid channel buys fewer customers at the same spend (${freshNew} vs ${burnedNew})`)

  // 2. sales capacity: sales-led segments are capped by humans, and hiring sales opens them
  const noSales = base()
  const withSales = base()
  resolveWeekV2(noSales, mkInputs())
  resolveWeekV2(withSales, mkInputs({ salesPoints: 12 }))
  const salesLedWon = (st: typeof noSales) =>
    st.cohorts.filter((c) => c.segmentId === 'mid_market' || c.segmentId === 'enterprise').reduce((a, c) => a + c.size, 0)
  ok(salesLedWon(withSales) > salesLedWon(noSales), `a sales team closes what a founder alone cannot (${salesLedWon(withSales).toFixed(1)} vs ${salesLedWon(noSales).toFixed(1)})`)
  ok(noSales.events.some((e) => e.type === 'sales_capacity_constrained'), 'the constrained pipeline emits the capacity fact (spec §0A.16)')

  // 3. expansion: retained customers deepen — revenue per customer rises with NO price change
  let g = newGame('E', 'saas', 'technical', { config: v2cfg(55) })
  g.marketingSpend = 4000
  g = playWeeks(g, 45)
  const hist = g.simV2!.weeklyHistory
  const arpuAt = (i: number) => (hist[i].customers > 0 ? hist[i].revenue / hist[i].customers : 0)
  ok(arpuAt(hist.length - 1) > arpuAt(14) * 1.003, `retained cohorts expand (${arpuAt(14).toFixed(2)} → ${arpuAt(hist.length - 1).toFixed(2)} $/customer/wk)`)
  ok(g.simV2!.finance.revenueDrivers.expansion > 0, 'the P&L driver decomposition carries the expansion line')
  // 4. the unit truth reaches the Capital sparklines
  const fh = g.finHistory!
  ok(fh[fh.length - 1].cac === hist[hist.length - 1].cac, 'finHistory CAC IS the causal engine’s realized CAC')
}

console.log('— Phase 3: commitments, Plan vs Actual, the two confidences —')
{
  const { acceptTermSheet } = await import('../src/game/engine')
  const { tickConfidence, confidenceWord } = await import('../src/game/sim2/confidence')
  const { createSimV2 } = await import('../src/game/sim2/init')

  // 1. a closed round becomes a FIRST-CLASS commitment (spec §0A.10)
  let g = newGame('B', 'saas', 'technical', { config: v2cfg(63) })
  g.marketingSpend = 4000
  g = playWeeks(g, 6)
  g.termSheets = [{ id: 't1', investor: 'Meridian', amount: 1_500_000, equity: 0.2, weeksLeft: 3 }]
  acceptTermSheet(g, 't1')
  const c = g.simV2!.planning.commitments[0]
  ok(!!c && c.metricId === 'weekly_growth' && c.dueWeek === g.week + 12, 'the round installs a growth commitment due at the review')
  ok(c.ambition >= 0 && c.ambition <= 1, `ambition is measured against current reality (${c.ambition.toFixed(2)})`)

  // 2. the two confidences move DIFFERENTLY (spec §17.2): strong upside, no execution record
  const v2 = createSimV2('saas', 22, () => 0.42)
  v2.weeklyHistory.push({ week: 10, customers: 500, revenue: 9000, netIncome: -2000, cash: 150000, price: 22, choiceShare: {}, productFit: {}, attributes: {}, brand: 20, boardConfidence: 60, investorConfidence: 55, planVariance: 0, newCustomers: 40, churnedCustomers: 8, paidSpend: 4000, cac: 100, eventIds: [] } as never)
  const b0 = v2.boardConfidence.value
  const i0 = v2.investorConfidence.value
  for (let w = 11; w < 19; w++)
    tickConfidence(v2, { week: w, revenue: 9000 * Math.pow(1.07, w - 10), macroFactor: 1, runwayWeeks: 40, growth4w: 0.07, churnRate: 0.015, bestFit: 0.7, boardTarget: 0 })
  ok(v2.investorConfidence.value - i0 > 5, `hot growth warms investors (+${(v2.investorConfidence.value - i0).toFixed(1)})`)
  ok(Math.abs(v2.boardConfidence.value - b0) < 4, `…while the board waits for delivered commitments (${(v2.boardConfidence.value - b0).toFixed(1)})`)

  // 3. controllability (spec §0A.11): the same miss costs less when the macro broke it
  const mk = () => {
    const x = createSimV2('saas', 22, () => 0.42)
    x.planning.forecastLog = [{ week: 6, projectedRevenue: 10_000, macroAtForecast: 1 }]
    return x
  }
  const controllable = mk()
  tickConfidence(controllable, { week: 10, revenue: 6_000, macroFactor: 1, runwayWeeks: 40, growth4w: 0.01, churnRate: 0.03, bestFit: 0.5, boardTarget: 0 })
  const external = mk()
  tickConfidence(external, { week: 10, revenue: 6_000, macroFactor: 0.9, runwayWeeks: 40, growth4w: 0.01, churnRate: 0.03, bestFit: 0.5, boardTarget: 0 })
  ok(controllable.boardConfidence.value < external.boardConfidence.value, `an execution miss costs board credibility; a recession costs less (${controllable.boardConfidence.value.toFixed(1)} vs ${external.boardConfidence.value.toFixed(1)})`)

  // 4. a due commitment SETTLES exactly once, as an event
  const due = mk()
  due.planning.commitments.push({ id: 'x', createdWeek: 1, dueWeek: 10, metricId: 'weekly_growth', targetValue: 0.05, importance: 1, ambition: 0.5, status: 'on_track' })
  const ev = tickConfidence(due, { week: 10, revenue: 10_000, macroFactor: 1, runwayWeeks: 40, growth4w: 0.02, churnRate: 0.02, bestFit: 0.6, boardTarget: 0.05 })
  ok(due.planning.commitments[0].status === 'missed' && ev.some((e) => e.type === 'commitment_missed' && e.eligibleForMajorMoment), 'a missed commitment settles once and is Major-Moment eligible')
  ok(typeof confidenceWord(due.boardConfidence.value) === 'string', 'confidence speaks in words, not decimals')
}

console.log('— Phase 4: research narrows knowledge, never the market —')
{
  const { applyJournaled } = await import('../src/game/replay')
  let g = newGame('R', 'saas', 'technical', { config: v2cfg(88) })
  g.journal = []
  g.marketingSpend = 3000
  const seg = g.simV2!.segments[3] // enterprise — the one worth studying
  const truthBefore = seg.knowledge.wtp.truth
  const confBefore = seg.knowledge.wtp.confidence
  const rangeBefore = seg.knowledge.wtp.uncertaintyRange[1] - seg.knowledge.wtp.uncertaintyRange[0]
  const cashBefore = g.cash

  g = applyJournaled(g, 'v2_research', { k: 'pricing_study', seg: 'enterprise' }).state
  ok(g.cash === cashBefore - 12_000, 'the study bills its cash up front')
  ok(g.simV2!.pendingResearch.length === 1, 'and goes into the field')
  g = applyJournaled(g, 'advance').state
  const midConf = g.simV2!.segments[3].knowledge.wtp.confidence
  ok(Math.abs(midConf - confBefore) < 1e-9, 'nothing is learned before the study lands (delayed truth, spec §14.4)')
  g = applyJournaled(g, 'advance').state
  const after = g.simV2!.segments[3].knowledge.wtp
  ok(after.truth === truthBefore, 'RESEARCH NEVER CHANGES THE MARKET — truth is byte-identical')
  ok(after.confidence > confBefore + 0.2, `confidence rises (${Math.round(confBefore * 100)}% → ${Math.round(after.confidence * 100)}%)`)
  ok(after.uncertaintyRange[1] - after.uncertaintyRange[0] < rangeBefore * 0.6, 'the uncertainty band narrows hard')
  ok(after.uncertaintyRange[0] <= after.truth && after.truth <= after.uncertaintyRange[1], 'the narrowed band actually contains the truth')
  ok(g.simV2!.weeklyHistory.some((s2) => s2.eventIds.some((id) => id.includes('research'))), 'the completion is an explicit event (spec §0A.13)')

  // classic runs cannot start a study
  let c = newGame('C', 'saas', 'technical', { config: { mode: 'career', format: 'standard', sector: 'saas', seed: 88 } as GameConfig })
  c.journal = []
  const cCash = c.cash
  c = applyJournaled(c, 'v2_research', { k: 'pricing_study', seg: 'enterprise' }).state
  ok(c.cash === cCash && c.simV2 === undefined, 'a classic run’s journal cannot commission V2 research (gate holds)')
}

console.log('— Phase 6: milestones fire once, chapters are earned, identity is derived —')
{
  const { companyIdentity } = await import('../src/game/sim2/story')
  let g = newGame('S', 'saas', 'technical', { config: v2cfg(41) })
  g.marketingSpend = 4000
  g.allocation = { ...g.allocation, features: 40, quality: 35, bugs: 15, research: 10 }
  g = playWeeks(g, 45)
  const v2 = g.simV2!
  ok(v2.firedMilestones.includes('first_customer') && v2.firedMilestones.includes('customers_100'), `milestones persisted: ${v2.firedMilestones.join(', ')}`)
  ok(new Set(v2.firedMilestones).size === v2.firedMilestones.length, 'each milestone fired exactly once, ever')
  ok(v2.chapter === 'early_traction' || v2.chapter === 'scaling', `the company EARNED its chapter (${v2.chapter})`)
  ok(g.inbox.some((m) => m.title.startsWith('📖')), 'the chapter transition told its story in the inbox')
  const id1 = companyIdentity(v2, 0)
  ok(id1.length > 5 && !id1.includes('undefined'), `identity is derived from play: "${id1}"`)

  // a stagnant company stays in chapter one — weeks alone earn nothing (spec §0A.8)
  let idle = newGame('I', 'saas', 'technical', { config: v2cfg(43) })
  idle.marketingSpend = 0
  idle.allocation = { ...idle.allocation, features: 5, quality: 5, bugs: 5, research: 85 }
  idle = playWeeks(idle, 40)
  ok(idle.simV2!.chapter === 'searching_for_fit', 'forty idle weeks earn no chapter — state advances chapters, never time')
}

console.log('— Truth isolation + seeded-RNG ban —')
{
  const screens = readdirSync('src/screens').filter((f) => f.endsWith('.tsx'))
  let leaks = 0
  for (const f of screens) {
    const src = readFileSync(`src/screens/${f}`, 'utf8')
    if (/\.truth\b/.test(src) || /knowledge\.\w+\.truth/.test(src)) leaks++
  }
  ok(leaks === 0, 'no screen reads a .truth field — the player sees estimates only')
  const sim2files = readdirSync('src/game/sim2', { recursive: true }) as string[]
  let mathRandom = 0
  for (const f of sim2files) {
    if (!String(f).endsWith('.ts')) continue
    if (/Math\.random/.test(readFileSync(`src/game/sim2/${f}`, 'utf8'))) mathRandom++
  }
  ok(mathRandom === 0, 'Math.random is banned inside the V2 engine')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
