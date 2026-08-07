// Career Phase 1 — PMF Discovery 2.0. Run: npx tsx test/career-pmf.test.ts
import { advanceWeek, newGame } from '../src/game/engine'
import { hasCapability, type GameConfig } from '../src/game/modes'
import { generateAllTruth, generateSegmentTruth, segmentsForSector } from '../src/game/career/segments'
import {
  EXPERIMENTS,
  TRUTH_METRICS,
  createCareerPMF,
  derivePmfForSegment,
  experimentDef,
  migrateCareerSave,
  resolveCohortRetention,
  resolveExperiment,
  segmentPriceFit,
  segmentProductFit,
  startExperiment,
  totalCustomers,
  updateBelief,
} from '../src/game/career/pmf'
import { repositionTo } from '../src/game/career/tick'
import type { ActiveExperiment, SegmentTruth } from '../src/game/career/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}
const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ mode: 'career', format: 'standard', sector: 'saas', seed: 77, ...over })
const prng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let n = 0
const uid = () => `t${n++}`

console.log('— Segment generation (§56) —')
const t1 = generateAllTruth(4242, 'saas', 'standard')
const t2 = generateAllTruth(4242, 'saas', 'standard')
ok(JSON.stringify(t1) === JSON.stringify(t2), 'same seed → identical segment truth')
const t3 = generateAllTruth(9999, 'saas', 'standard')
ok(JSON.stringify(t1) !== JSON.stringify(t3), 'different seed → different market')
for (const sector of ['saas', 'social', 'fintech', 'devtools', 'ecommerce']) {
  const segs = segmentsForSector(sector)
  ok(segs.length === 3, `${sector} has three segments`)
}
const saas = generateAllTruth(4242, 'saas', 'standard')
ok(
  saas.enterprise.willingnessToPay > saas.freelancers.willingnessToPay &&
    saas.freelancers.acquisitionAccessibility > saas.enterprise.acquisitionAccessibility,
  'segments differ meaningfully (enterprise pays more, freelancers are easier to reach)',
)
const allValues = Object.values(t1).flatMap((x) => TRUTH_METRICS.map((m) => (x as SegmentTruth)[m]))
ok(allValues.every((v) => v >= 0 && v <= 100), 'every truth metric stays inside 0–100')

console.log('— Evidence (§57) —')
const truth = saas.small_teams
const mkExp = (type: (typeof EXPERIMENTS)[number]['type']): ActiveExperiment => ({
  id: 'e', type, segmentId: 'small_teams', startWeek: 1, completionWeek: 2,
  cashCost: 0, productCapacityCost: 0, marketingCapacityCost: 0,
  sampleSize: experimentDef(type).sampleSize, expectedEvidenceMetrics: experimentDef(type).metrics, status: 'active',
})
const interviewEv = resolveExperiment(mkExp('interview'), truth, 0.7, prng(1), uid, 5)
const pilotEv = resolveExperiment(mkExp('pilot'), truth, 0.7, prng(1), uid, 5)
ok(pilotEv[0].reliability > interviewEv[0].reliability, `a pilot is more reliable than interviews (${pilotEv[0].reliability} vs ${interviewEv[0].reliability})`)
const evA = resolveExperiment(mkExp('pricing_test'), truth, 0.7, prng(55), uid, 5)
const evB = resolveExperiment(mkExp('pricing_test'), truth, 0.7, prng(55), uid, 5)
ok(JSON.stringify(evA.map((e) => e.signal)) === JSON.stringify(evB.map((e) => e.signal)), 'same seed → same evidence')

let b = { estimate: 10, confidence: 0.1, evidenceCount: 0 }
const strong = { ...pilotEv[0], metric: 'retentionPotential' as const, signal: 80, reliability: 0.9 }
for (let i = 0; i < 4; i++) b = updateBelief(b, strong)
ok(b.estimate > 55, `strong repeated evidence moves belief toward it (${Math.round(b.estimate)})`)
ok(b.confidence > 0.4, `repeated evidence raises confidence (${b.confidence.toFixed(2)})`)
let weak = { estimate: 10, confidence: 0.1, evidenceCount: 0 }
weak = updateBelief(weak, { ...strong, reliability: 0.15 })
ok(Math.abs(weak.estimate - 10) < Math.abs(b.estimate - 10), 'weak evidence moves belief less than strong evidence')

// stated-preference bias: cheap instruments overstate willingness to pay
let interviewDelta = 0
let pricingDelta = 0
const N = 60
for (let i = 0; i < N; i++) {
  const iv = resolveExperiment(mkExp('interview'), truth, 0.7, prng(i + 100), uid, 5).find((e) => e.metric === 'willingnessToPay')!
  const pt = resolveExperiment(mkExp('pricing_test'), truth, 0.7, prng(i + 900), uid, 5).find((e) => e.metric === 'willingnessToPay')!
  interviewDelta += iv.signal - truth.willingnessToPay
  pricingDelta += pt.signal - truth.willingnessToPay
}
interviewDelta /= N
pricingDelta /= N
ok(interviewDelta > 8, `interviews systematically OVERSTATE willingness to pay by ${interviewDelta.toFixed(1)} points on average`)
ok(
  Math.abs(pricingDelta) < Math.abs(interviewDelta),
  `asking for money is closer to the truth than asking an opinion (${pricingDelta.toFixed(1)} vs ${interviewDelta.toFixed(1)}) — the "they said they'd pay" trap`,
)

console.log('— PMF is derived from behaviour, not research (§58) —')
const ceiling = 20_000
const base = { segmentId: 'small_teams', truth, ceiling, beliefs: createCareerPMF(1, 'saas', 'standard').segmentBeliefs.small_teams }
const churny = derivePmfForSegment({ ...base, customers: 5000, retention4wk: 0.35, priceFit: 80, productFit: 70 })
ok(churny.status !== 'strong' && churny.status !== 'scalable', `high acquisition + low retention is NOT strong PMF (${churny.status})`)
const sticky = derivePmfForSegment({ ...base, customers: 2000, retention4wk: 0.86, priceFit: 85, productFit: 80 })
ok(sticky.status === 'strong' || sticky.status === 'scalable', `retention + payment produces real PMF (${sticky.status})`)
ok(sticky.score > churny.score, 'a smaller, retained base scores higher than a big leaky one')

// research alone cannot manufacture PMF
const researched = createCareerPMF(5, 'saas', 'standard')
for (const m of TRUTH_METRICS) researched.segmentBeliefs.small_teams[m] = { estimate: 95, confidence: 0.98, evidenceCount: 20 }
const noCustomers = derivePmfForSegment({ ...base, beliefs: researched.segmentBeliefs.small_teams, customers: 0, retention4wk: 0, priceFit: 90, productFit: 90 })
ok(noCustomers.status !== 'strong' && noCustomers.status !== 'scalable' && noCustomers.score < 45,
  `perfect research with zero customers cannot create PMF (${noCustomers.status}, score ${noCustomers.score})`)

console.log('— Fit differs by segment (§58) —')
const q = 55
const freelanceFit = segmentProductFit(saas.freelancers, q, 'simplicity', 'saas', 'freelancers')
const enterpriseFit = segmentProductFit(saas.enterprise, q, 'simplicity', 'saas', 'enterprise')
ok(freelanceFit > enterpriseFit, `the same product serves freelancers better than enterprise (${Math.round(freelanceFit)} vs ${Math.round(enterpriseFit)})`)
const cheapFit = segmentPriceFit(saas.freelancers, 'low')
const premiumOnCheap = segmentPriceFit(saas.freelancers, 'premium')
ok(cheapFit > premiumOnCheap, 'overpricing a price-sensitive segment hurts price fit')

console.log('— Retention & cohorts (§59) —')
const keepGood = resolveCohortRetention({ truth: saas.enterprise, productFit: 85, priceFit: 85, bugs: 5, weeksSinceAcquired: 8 })
const keepBad = resolveCohortRetention({ truth: saas.freelancers, productFit: 30, priceFit: 30, bugs: 60, weeksSinceAcquired: 8 })
ok(keepGood > keepBad, `better fit retains better (${keepGood.toFixed(2)} vs ${keepBad.toFixed(2)})`)

let g = newGame('CareerCo', 'saas', 'technical', { config: cfg({ seed: 31337 }) })
ok(!!g.career, 'a Career run has the PMF subsystem')
ok(hasCapability(g, 'detailedPMF'), 'Career resolves detailedPMF = true')
g.cash = 5_000_000
g.marketingSpend = 40_000
for (let w = 0; w < 20; w++) g = advanceWeek(g)
ok(g.career!.cohorts.length > 0, `cohorts accumulate (${g.career!.cohorts.length} cohorts)`)
// Events award users directly onto s.users; the next tick must absorb them into a cohort
// rather than letting them evaporate when the cohort total is written back. Reconciliation
// happens at the START of a tick, so late-week rival theft leaves a small drift that the
// following week absorbs — the invariant is "no silent loss", not "exactly equal always".
const cohortsBefore = totalCustomers(g.career!)
g.users += 500
g = advanceWeek(g)
const grew = totalCustomers(g.career!) - cohortsBefore
ok(grew > 400, `granted users are absorbed into cohorts rather than evaporating (+${grew})`)
ok(Math.abs(totalCustomers(g.career!) - g.users) < 25, `cohort total tracks the company user count (drift ${totalCustomers(g.career!) - g.users})`)
ok(g.career!.cohorts.some((c) => c.activeCustomers < c.startingCustomers), 'churn eats into cohorts over time')

console.log('— Truth never rerolls (§60) —')
const truthBefore = JSON.stringify(g.career!.segmentTruth)
const segs = segmentsForSector('saas')
const other = segs.find((x) => x.id !== g.career!.primaryTargetSegmentId)!
const customersBefore = totalCustomers(g.career!)
repositionTo(g, other.id, g.week)
ok(g.career!.primaryTargetSegmentId === other.id, 'segment pivot updates the target')
ok(!!g.career!.repositioning && g.career!.repositioning.remainingWeeks > 0, 'repositioning costs real weeks')
ok(JSON.stringify(g.career!.segmentTruth) === truthBefore, 'the market does NOT reroll when you change your mind about it')
ok(totalCustomers(g.career!) === customersBefore, 'existing customers are not silently deleted by a pivot')
ok(g.career!.journal.some((j) => j.category === 'pivot'), 'the pivot is recorded in the decision journal')

console.log('— Scaling before PMF is punished (§26) —')
function run(seed: number, marketing: number, weeks: number) {
  let s = newGame('X', 'saas', 'technical', { config: cfg({ seed }) })
  s.cash = 4_000_000
  s.marketingSpend = marketing
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  return s
}
const blaster = run(808, 250_000, 26)
const patient = run(808, 15_000, 26)
ok(blaster.cash < patient.cash, 'spending hard on acquisition burns much more cash')
ok(
  blaster.career!.cohorts.reduce((a, c) => a + (c.startingCustomers - c.activeCustomers), 0) >
    patient.career!.cohorts.reduce((a, c) => a + (c.startingCustomers - c.activeCustomers), 0),
  'buying users before fit produces more churn in absolute terms',
)

console.log('— Determinism (§52) —')
const d1 = run(123456, 60_000, 18)
const d2 = run(123456, 60_000, 18)
ok(
  JSON.stringify([d1.users, Math.round(d1.cash), d1.career!.evidence.length]) ===
    JSON.stringify([d2.users, Math.round(d2.cash), d2.career!.evidence.length]),
  'the same Career seed and decisions reproduce exactly',
)

console.log('— Experiments take time and produce evidence (§64) —')
let e = newGame('ExpCo', 'saas', 'technical', { config: cfg({ seed: 5150 }) })
e.cash = 1_000_000
startExperiment(e.career!, e.week, 'pilot', e.career!.primaryTargetSegmentId, 'exp-1')
const completes = e.career!.activeExperiments[0].completionWeek
e = advanceWeek(e)
ok(e.career!.activeExperiments.length === 1 && e.career!.evidence.length === 0, 'an experiment in flight yields nothing yet')
while (e.week < completes) e = advanceWeek(e)
e = advanceWeek(e)
ok(e.career!.evidence.length > 0, `the pilot eventually produced evidence (${e.career!.evidence.length} items)`)
ok(e.inbox.some((m) => m.title.includes('complete')), 'results arrive through the inbox as an event')

console.log('— Mode separation (§61) —')
const quick = newGame('Q', 'saas', 'technical', { config: { mode: 'quick', format: 'standard', sector: 'saas', seed: 1 } })
const daily = newGame('D', 'saas', 'technical', { config: { mode: 'quick', format: 'daily_challenge', sector: 'saas', seed: 1 } })
const arena = newGame('A', 'saas', 'technical', { config: { mode: 'arena', format: 'standard', sector: 'saas', seed: 1 } })
ok(!hasCapability(quick, 'detailedPMF') && !quick.career, 'Quick Play has no Career PMF state')
ok(!hasCapability(daily, 'detailedPMF') && !daily.career, 'Daily Challenge has no Career PMF state')
ok(!hasCapability(arena, 'detailedPMF') && !arena.career, 'Arena has no Career PMF state')
let qq = quick
qq.marketingSpend = 5_000
for (let w = 0; w < 10; w++) qq = advanceWeek(qq)
ok(qq.users > 0 && qq.pmf > 0 && !qq.career, 'Quick Play still runs its own simple PMF model unchanged')

console.log('— Legacy Career save migration (§51) —')
const legacy = newGame('Old', 'saas', 'technical', { config: cfg({ seed: 2468 }) })
legacy.users = 900
legacy.researchSignal = 40
legacy.pmf = 45
const migrated = migrateCareerSave({ seed: 2468, sector: 'saas', scenario: 'standard', week: 30, users: 900, researchSignal: 40, pmf: 45 })
ok(JSON.stringify(migrated.segmentTruth) === JSON.stringify(generateAllTruth(2468, 'saas', 'standard')), 'migration rebuilds the ORIGINAL market from the seed')
ok(totalCustomers(migrated) === 900, 'existing users become a starting cohort rather than vanishing')
ok(migrated.journal.some((j) => j.title.includes('activated')), 'the migration is recorded in the journal')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
