// Career Phase 1 — PMF Discovery 2.0. Run: npx tsx test/career-pmf.test.ts
import { advanceWeek, newGame, weeklyOffice } from '../src/game/engine'
import { hasCapability, type GameConfig } from '../src/game/modes'
import { generateAllTruth, segmentsForSector } from '../src/game/career/segments'
import {
  ANSWER_EVIDENCE_FLOOR,
  EXPERIMENTS,
  EXPERIMENT_ANSWERS,
  TRUTH_METRICS,
  canRunExperiment,
  experimentAnswered,
  createCareerPMF,
  derivePmfForSegment,
  experimentDef,
  migrateCareerSave,
  resolveCohortRetention,
  RETENTION_WINDOW_WEEKS,
  settledCohortRetention,
  resolveExperiment,
  segmentPriceFit,
  segmentProductFit,
  startExperiment,
  suggestedExperiment,
  totalCustomers,
  updateBelief,
} from '../src/game/career/pmf'
import { careerProductDrag, repositionTo } from '../src/game/career/tick'
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
for (const sector of ['saas', 'social', 'fintech', 'devtools', 'ecommerce', 'aiml']) {
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
// `blaster.cash < patient.cash` was true by subtraction — marketingSpend leaves the account every
// week regardless of whether it buys anything. The claim of the section is about EFFICIENCY, so
// assert efficiency: dollars spent per customer still on the books at week 26.
const costPer = (s: typeof blaster, spend: number) => (spend * 26) / Math.max(1, s.users)
ok(
  costPer(blaster, 250_000) > costPer(patient, 15_000) * 3,
  `scaling before fit costs far more per surviving customer ($${Math.round(costPer(blaster, 250_000)).toLocaleString()} vs $${Math.round(costPer(patient, 15_000)).toLocaleString()})`,
)
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

console.log('— The suggested experiment must not repeat itself —')
let sg = newGame('Sug', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
sg.cash = 3_000_000
sg.marketingSpend = 25_000
const suggestions: string[] = []
let sn = 0
for (let w = 0; w < 24; w++) {
  const sug = suggestedExperiment(sg.career!, sg.sector)
  suggestions.push(sug ? `${sug.type}:${sug.segmentId}` : 'none')
  if (sug && canRunExperiment(sg.career!, sug.type, sug.segmentId, sg.cash).ok) {
    startExperiment(sg.career!, sg.week, sug.type, sug.segmentId, `s${sn++}`)
    sg.cash -= experimentDef(sug.type).cashCost
  }
  sg.cash = 3_000_000
  sg = advanceWeek(sg)
}
let longestStreak = 1
for (let i = 0; i < suggestions.length; i++) {
  let run = 1
  while (i + run < suggestions.length && suggestions[i + run] === suggestions[i]) run++
  longestStreak = Math.max(longestStreak, run)
}
// The message and the bound used to disagree: `<= 2` permits the same suggestion twice running,
// which is exactly what "never twice running" forbids. The bound is the honest one — a suggestion
// legitimately persists for the week in which its experiment is being started — so the WORDING was
// what needed fixing, and `<= 3` is now the failure it is meant to catch.
ok(longestStreak <= 2, `a suggestion never survives more than the week it is acted on (longest streak ${longestStreak}, max allowed 2)`)
ok(new Set(suggestions).size >= 5, `suggestions vary across experiments and segments (${new Set(suggestions).size} distinct in 24 weeks)`)
ok(
  new Set(suggestions.map((x) => x.split(':')[1])).size >= 2,
  'the recommendation looks beyond the current target segment',
)
// something already in flight is never re-recommended
const inflightRun = newGame('Inflight', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
const first = suggestedExperiment(inflightRun.career!, inflightRun.sector)!
startExperiment(inflightRun.career!, 1, first.type, first.segmentId, 'inflight')
const second = suggestedExperiment(inflightRun.career!, inflightRun.sector)
// Split from a single `!second || ...`. That form passed if `suggestedExperiment` regressed to
// returning null whenever anything was in flight — which would leave the player with no guidance
// at all, a worse bug than the one being guarded.
ok(!!second, 'with one study running there is still something else worth doing')
ok(`${second?.type}:${second?.segmentId}` !== `${first.type}:${first.segmentId}`, 'work already running is never suggested again')

console.log('— Retention is a 4-week snapshot, not lifetime decay —')
let ret = newGame('Ret', 'saas', 'technical', { config: cfg({ seed: 909 }) })
ret.cash = 8_000_000
ret.marketingSpend = 30_000
ret.allocation = { features: 35, quality: 35, bugs: 20, research: 10, bet: 0 }
const retTrace: number[] = []
for (let w = 0; w < 40; w++) {
  ret.cash = 8_000_000
  ret = advanceWeek(ret)
  if (w > 10) retTrace.push(ret.career!.retentionBySegment[ret.career!.primaryTargetSegmentId] ?? 0)
}
const early = retTrace[0]
const late = retTrace[retTrace.length - 1]
ok(late > 0.2, `retention does not decay toward zero over time (${(late * 100).toFixed(0)}%)`)
ok(Math.abs(late - early) < 0.45, `retention is a stable measure, not a monotonic slide (${(early * 100).toFixed(0)}% -> ${(late * 100).toFixed(0)}%)`)
ok(
  ret.career!.cohorts.filter((c) => c.retentionAt4wk !== undefined).length > 0,
  'cohorts snapshot their four-week retention once and keep it',
)

// …and it is FOUR weeks of churn, not five.
//
// The tick pushes a cohort and decays it in the same week, so calendar age and decays-applied
// differ by one. The snapshot used to fire at `s.week - acquiredWeek >= 4` — five decays, four of
// them inside the `weeksSinceAcquired < 4` honeymoon and one outside it — and froze that as
// "four-week retention". Measured, that understated every reading by ~4.3pp and PMF by 4 points.
//
// This does not restate the snapshot condition (a test that mirrors the code cannot catch an
// off-by-one in it). It pins product and price so the weekly keep rate is a known constant, then
// asserts the frozen number IS that constant to the fourth power — and is not the fifth power,
// which is what the bug produced. Both directions of the off-by-one die.
{
  console.log('— …and four-week retention is four weeks of churn, not five —')
  let w4 = newGame('W4', 'saas', 'technical', { config: cfg({ seed: 909 }) })
  const seg4 = w4.career!.primaryTargetSegmentId
  const truth4 = w4.career!.segmentTruth[seg4]
  // Pin everything the keep rate reads. Quality and bugs drift with the allocation every week, so
  // they are re-pinned after each tick; truth, focus and pricing never move on their own.
  const QUALITY = 60
  const BUGS = 10
  const pin = (g: typeof w4) => { g.quality = QUALITY; g.bugs = BUGS; g.cash = 20_000_000; g.marketingSpend = 4_000 }
  pin(w4)
  for (let w = 0; w < 14; w++) { w4 = advanceWeek(w4); pin(w4) }

  const fit4 = segmentProductFit(truth4, QUALITY, w4.career!.focus, 'saas', seg4)
  const price4 = segmentPriceFit(truth4, w4.career!.pricing)
  const keepHoneymoon = resolveCohortRetention({ truth: truth4, productFit: fit4, priceFit: price4, bugs: BUGS, weeksSinceAcquired: 0 })
  const keepAfter = resolveCohortRetention({ truth: truth4, productFit: fit4, priceFit: price4, bugs: BUGS, weeksSinceAcquired: RETENTION_WINDOW_WEEKS })
  const fourWeeks = keepHoneymoon ** 4
  const fiveWeeks = fourWeeks * keepAfter

  ok(
    Math.abs(settledCohortRetention({ truth: truth4, productFit: fit4, priceFit: price4, bugs: BUGS }) - fourWeeks) < 1e-12,
    `settledCohortRetention — the number the UI forecasts with — is exactly ${RETENTION_WINDOW_WEEKS} weekly keep rates`,
  )

  // The honeymoon boundary and the measurement window are ONE constant, and this is what that
  // buys: every decay inside the window is a honeymoon decay, and the very next one is not. If
  // the two ever drift, `retentionAt4wk` straddles the boundary again — four honeymoon weeks plus
  // a fifth post-honeymoon one — which is precisely the shape of the bug. Nothing else in this
  // file notices, because a wider honeymoon leaves the four-week product itself unchanged.
  {
    const keep = (age: number) => resolveCohortRetention({ truth: truth4, productFit: fit4, priceFit: price4, bugs: BUGS, weeksSinceAcquired: age })
    let allSame = true
    for (let age = 1; age < RETENTION_WINDOW_WEEKS; age++) if (Math.abs(keep(age) - keep(0)) > 1e-12) allSame = false
    ok(allSame, `all ${RETENTION_WINDOW_WEEKS} decays inside the window share one keep rate — the honeymoon covers the whole measurement`)
    ok(
      Math.abs(keep(RETENTION_WINDOW_WEEKS) - keep(RETENTION_WINDOW_WEEKS - 1)) > 1e-6,
      'and the rate changes on the very next week — the honeymoon ends exactly where the window does, neither early nor late',
    )
  }

  // The cohorts on the books under this pinned policy. Take the frozen ones and compare.
  // No size filter: the snapshot is taken off the UNROUNDED count, so a fourteen-person cohort is
  // as exact as a fourteen-thousand-person one. `Math.max`/`Math.min` of an empty list are
  // ∓Infinity and would make both comparisons below pass vacuously, so the count is asserted first
  // and asserted generously.
  const frozen = w4.career!.cohorts.filter((c) => c.retentionAt4wk !== undefined && c.segmentId === seg4)
  ok(frozen.length >= 8, `there are frozen cohorts to check (${frozen.length})`)
  const worstToFour = frozen.length ? Math.max(...frozen.map((c) => Math.abs(c.retentionAt4wk! - fourWeeks))) : NaN
  const bestToFive = frozen.length ? Math.min(...frozen.map((c) => Math.abs(c.retentionAt4wk! - fiveWeeks))) : NaN
  ok(
    worstToFour < 0.005,
    `every frozen cohort reports ${(fourWeeks * 100).toFixed(2)}% — four decays (worst gap ${(worstToFour * 100).toFixed(3)}pp)`,
  )
  ok(
    bestToFive > worstToFour,
    `and none of them reports the five-decay number ${(fiveWeeks * 100).toFixed(2)}% (closest gap ${(bestToFive * 100).toFixed(3)}pp vs ${(worstToFour * 100).toFixed(3)}pp)`,
  )
  // The gap the bug was worth, stated so a regression reads as a number rather than a boolean.
  ok(
    fourWeeks - fiveWeeks > 0.03,
    `the two readings really are far apart — ${((fourWeeks - fiveWeeks) * 100).toFixed(2)}pp, which is what the bug cost every retention number in the game`,
  )
}

// neglecting bugs must cost retention, and therefore PMF — this is the lesson the owner hit
function allocRun(alloc: { features: number; quality: number; bugs: number; research: number; bet: number }) {
  let g2 = newGame('A', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
  g2.allocation = alloc
  for (let w = 0; w < 40; w++) {
    g2.cash = 20_000_000
    g2.marketingSpend = 25_000
    g2 = advanceWeek(g2)
  }
  return g2
}
const neglected = allocRun({ features: 70, quality: 15, bugs: 15, research: 0, bet: 0 })
const maintained = allocRun({ features: 40, quality: 25, bugs: 35, research: 0, bet: 0 })
ok(neglected.bugs > maintained.bugs, `shipping features without fixing bugs accumulates them (${Math.round(neglected.bugs)} vs ${Math.round(maintained.bugs)})`)
ok(maintained.pmf > neglected.pmf, `and that costs PMF — bug-neglect ${Math.round(neglected.pmf)} vs maintained ${Math.round(maintained.pmf)}`)

console.log('— The sales cycle is a pipeline, not a modifier (gameplay-review finding 6) —')
// `salesCycleWeeks` was generated per segment per seed, believed, measured by $28k paid pilots —
// and read by nothing. Wired in: customers won this week land `salesCycleWeeks − 1` weeks later
// through CareerPMFState.pipeline. These pin the three properties that make the wiring safe.
//
// Seed 606's belief-chosen starting target is Enterprise with a 12-week cycle — the segment the
// lag exists for.
{
  let g = newGame('Cycle', 'saas', 'technical', { config: cfg({ seed: 606 }) })
  const target = g.career!.primaryTargetSegmentId
  const cycle = g.career!.segmentTruth[target].salesCycleWeeks
  ok(cycle >= 8, `seed 606 opens on ${target}, a long-cycle segment (${cycle} wk) — the setup this block needs`)
  let firstUsersWeek = 0
  let pipelinePeak = 0
  for (let w = 0; w < 18; w++) {
    g.cash = Math.max(g.cash, 3_000_000)
    g.marketingSpend = 30_000
    g = advanceWeek(g)
    pipelinePeak = Math.max(pipelinePeak, g.career!.pipeline?.reduce((a, p) => a + p.customers, 0) ?? 0)
    if (!firstUsersWeek && g.users > 0) firstUsersWeek = g.week
  }
  ok(pipelinePeak > 100, `deals accumulate in the pipeline while the cycle runs (peak ${pipelinePeak} customers in flight)`)
  ok(
    firstUsersWeek >= cycle && firstUsersWeek <= cycle + 4,
    `the first customers LAND when the sales cycle completes — week ${firstUsersWeek} on a ${cycle}-week cycle, not week 2`,
  )
}
// A one-week cycle is interest and money inside the same tick — the exact code path that always
// existed — so the fast half of the market must never even grow the pipeline key.
{
  let g = newGame('Fast', 'saas', 'technical', { config: cfg({ seed: 606 }) })
  repositionTo(g, 'freelancers', 1)
  const cycle = g.career!.segmentTruth.freelancers.salesCycleWeeks
  ok(cycle === 1, `freelancers run a one-week cycle in every seed (${cycle})`)
  let firstUsersWeek = 0
  for (let w = 0; w < 12; w++) {
    g.cash = Math.max(g.cash, 3_000_000)
    g.marketingSpend = 30_000
    g = advanceWeek(g)
    if (!firstUsersWeek && g.users > 0) firstUsersWeek = g.week
  }
  ok(g.career!.pipeline === undefined, 'a one-week-cycle run never grows the pipeline key — bit-identical path to before the lag existed')
  ok(firstUsersWeek > 0 && firstUsersWeek <= 6, `and its customers arrive without a lag (first landed week ${firstUsersWeek})`)
}
// Save-compat: a Career save persisted before the pipeline existed simply has no key. Absent
// means empty — the `origin` / `exactCustomers` trick — so it must load and tick, no migration.
{
  let g = newGame('Old', 'saas', 'technical', { config: cfg({ seed: 606 }) })
  for (let w = 0; w < 6; w++) {
    g.cash = Math.max(g.cash, 3_000_000)
    g.marketingSpend = 30_000
    g = advanceWeek(g)
  }
  delete g.career!.pipeline // exactly what an old save looks like the moment it is loaded
  let survived = true
  try {
    for (let w = 0; w < 4; w++) g = advanceWeek(g)
  } catch {
    survived = false
  }
  ok(survived && !g.gameOver, 'a save without the pipeline key loads and ticks — absent means empty, no migration write')
}

console.log('— Briefing, explanations and capacity drain are real (not inert) —')
let br = newGame('Brief', 'saas', 'technical', { config: cfg({ seed: 606 }) })
br.cash = 3_000_000
br.marketingSpend = 30_000
// 20 weeks, not 12 — seed 606's belief-chosen starting target is Enterprise with a 12-week
// sales cycle, so since `salesCycleWeeks` was wired in (gameplay-review finding 6) the first
// cohort LANDS at week 13 and freezes its four-week retention snapshot at week 16. At 12 weeks
// this block was reading a pipeline full of deals and a customer base of zero, which is the
// mechanism working, not retention tracking being dead.
for (let w = 0; w < 20; w++) br = advanceWeek(br)
ok(!!br.career!.lastBriefing, 'a weekly founder briefing is produced')
ok(br.career!.lastBriefing!.week === br.week, 'the briefing is for the current week')
const revenues = br.history.map((h) => h.revenue).filter((r) => r > 0)
ok(revenues.length < 2 || br.career!.lastBriefing!.revenueDeltaPct !== 0, `revenueDeltaPct is populated, not permanently 0 (${br.career!.lastBriefing!.revenueDeltaPct}%)`)
ok(typeof br.career!.lastBriefing!.uncertainty === 'string' && br.career!.lastBriefing!.uncertainty.length > 10, 'the briefing names a biggest uncertainty')
// `some(typeof v === 'number')` on a Record<SegmentId, number> passed if every segment was 0,
// i.e. if retention tracking were entirely dead.
ok(
  Object.values(br.career!.retentionBySegment).some((v) => v > 0 && v <= 1),
  `per-segment retention is tracked with real values (${Object.values(br.career!.retentionBySegment).map((v) => v.toFixed(2)).join(', ')})`,
)

// experiments must cost engineering time, and repositioning must slow the product down
const idle = newGame('Idle', 'saas', 'technical', { config: cfg({ seed: 707 }) })
const busy = newGame('Busy', 'saas', 'technical', { config: cfg({ seed: 707 }) })
startExperiment(busy.career!, 1, 'pilot', busy.career!.primaryTargetSegmentId, 'x1')
ok(careerProductDrag(busy) < careerProductDrag(idle), `running a pilot costs engineering capacity (${careerProductDrag(busy).toFixed(2)} vs ${careerProductDrag(idle).toFixed(2)})`)
const repositioned = newGame('Repos', 'saas', 'technical', { config: cfg({ seed: 707 }) })
const otherSeg = segmentsForSector('saas').find((x) => x.id !== repositioned.career!.primaryTargetSegmentId)!
repositionTo(repositioned, otherSeg.id, 1)
ok(careerProductDrag(repositioned) < careerProductDrag(idle), 'repositioning slows product velocity, not just marketing')

console.log('— A standing study is a programme that finishes, not a subscription —')
// Flagging every study standing must not be strictly worse than running them one-off. It was:
// the renewal charged full price forever for a belief that had stopped moving, because
// `updateBelief` gains scale with (1 - confidence).
{
  const seg = 'small_teams'
  const sat = newGame('Sat', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
  const b = sat.career!.segmentBeliefs[seg]
  for (const t of EXPERIMENTS) {
    const { metric, bar } = EXPERIMENT_ANSWERS[t.type]
    b[metric] = { ...b[metric], confidence: bar + 0.01, evidenceCount: ANSWER_EVIDENCE_FLOOR }
    ok(experimentAnswered(sat.career!, t.type, seg), `${t.name} counts as answered once ${metric} passes ${bar}`)
    b[metric] = { ...b[metric], confidence: bar - 0.05, evidenceCount: ANSWER_EVIDENCE_FLOOR }
    ok(!experimentAnswered(sat.career!, t.type, seg), `${t.name} is still open just below the bar`)
    // The bug this floor exists for: `initialBeliefs` seeds one metric per segment at confidence
    // 0.42 with ZERO evidence — the assumption worth killing — and 0.42 clears the interview and
    // landing-page bars outright. Confidence alone therefore retired a standing study on its first
    // cycle. A conviction is not a finding, at any confidence.
    b[metric] = { ...b[metric], confidence: 0.99, evidenceCount: ANSWER_EVIDENCE_FLOOR - 1 }
    ok(
      !experimentAnswered(sat.career!, t.type, seg),
      `${t.name} is NOT answered by conviction alone — 99% confidence on ${ANSWER_EVIDENCE_FLOOR - 1} reading(s) is still open`,
    )
    b[metric] = { ...b[metric], confidence: 0.99, evidenceCount: ANSWER_EVIDENCE_FLOOR }
    ok(experimentAnswered(sat.career!, t.type, seg), `${t.name} is answered once that confidence is corroborated`)
  }

  // The assertions above are written in terms of the constant, so they survive a change TO the
  // constant. Pin it with literals as well: one reading is a result, two is corroboration, and
  // "prove the belief three times" would be a different (and more expensive) game.
  {
    const pin = newGame('Pin', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
    const pb = pin.career!.segmentBeliefs[seg]
    const set = (n: number) => { pb.needIntensity = { ...pb.needIntensity, confidence: 0.99, evidenceCount: n } }
    set(0); ok(!experimentAnswered(pin.career!, 'interview', seg), 'floor is exactly 2: an untested conviction is never an answer')
    set(1); ok(!experimentAnswered(pin.career!, 'interview', seg), 'floor is exactly 2: one reading is a result, not an answer')
    set(2); ok(experimentAnswered(pin.career!, 'interview', seg), 'floor is exactly 2: two corroborating readings close the question')
  }

  // The seeded prior really does clear those bars — if `initialBeliefs` ever stops planting an
  // overconfident metric, this guard should be revisited rather than silently kept.
  {
    let overconfidentAboveABar = 0
    for (let seed = 1; seed <= 60; seed++) {
      const fresh = newGame('Prior', 'saas', 'technical', { config: cfg({ seed: 101 * seed }) })
      for (const sg of segmentsForSector('saas')) {
        const bb = fresh.career!.segmentBeliefs[sg.id]
        for (const t of EXPERIMENTS) {
          const { metric, bar } = EXPERIMENT_ANSWERS[t.type]
          if (bb[metric].evidenceCount === 0 && bb[metric].confidence >= bar) overconfidentAboveABar++
        }
      }
    }
    ok(overconfidentAboveABar > 0, `a fresh game really does plant unearned confidence above a bar (${overconfidentAboveABar} cases in 60 seeds)`)
  }

  // The recommendation ladder and the renewal must agree, or the game bills for a study it has
  // stopped recommending. Drive every belief past its bar and check both go quiet together.
  const done = newGame('Done', 'saas', 'technical', { config: cfg({ seed: 4243 }) })
  for (const sg of segmentsForSector('saas')) {
    const bb = done.career!.segmentBeliefs[sg.id]
    for (const m of TRUTH_METRICS) bb[m] = { ...bb[m], confidence: 0.95, evidenceCount: ANSWER_EVIDENCE_FLOOR }
  }
  ok(suggestedExperiment(done.career!, 'saas') === null, 'nothing left to recommend once every belief is confident')
  ok(
    EXPERIMENTS.every((t) => experimentAnswered(done.career!, t.type, done.career!.primaryTargetSegmentId)),
    'and nothing left to renew either — the two thresholds cannot drift apart',
  )

  // …and they must agree in the OTHER direction too. Confidence without evidence keeps the
  // renewal alive, so it must keep the recommendation alive as well — otherwise the game is
  // paying for a study it refuses to suggest, which is the exact drift the shared table prevents.
  const unearned = newGame('Unearned', 'saas', 'technical', { config: cfg({ seed: 4243 }) })
  for (const sg of segmentsForSector('saas')) {
    const bb = unearned.career!.segmentBeliefs[sg.id]
    for (const m of TRUTH_METRICS) bb[m] = { ...bb[m], confidence: 0.95, evidenceCount: 0 }
  }
  ok(
    suggestedExperiment(unearned.career!, 'saas') !== null,
    'a board of confident, never-tested beliefs still has something worth recommending',
  )

  // End to end: a standing pilot on a saturated belief must stop taking money.
  let rich = newGame('Rich', 'saas', 'technical', { config: cfg({ seed: 4244 }) })
  const tgt = rich.career!.primaryTargetSegmentId
  const rb = rich.career!.segmentBeliefs[tgt]
  rb.retentionPotential = { ...rb.retentionPotential, confidence: 0.9, evidenceCount: ANSWER_EVIDENCE_FLOOR }
  startExperiment(rich.career!, rich.week, 'pilot', tgt, 'standing-1', true)
  rich.cash = 5_000_000
  rich.marketingSpend = 0
  const cashBefore = rich.cash
  for (let w = 0; w < 20; w++) rich = advanceWeek(rich)
  ok(
    rich.career!.activeExperiments.filter((e) => e.type === 'pilot').length === 0,
    'a standing pilot whose question is answered is retired, not renewed',
  )
  // Had the study kept rolling, 20 weeks is two renewals at $28k each. The old bound was `< 28_000`
  // — which still passes if a bug charges a whole extra renewal minus a dollar. The bound is now
  // derived from what this company ACTUALLY costs to run with marketing at zero: office overhead
  // over the 20 weeks, plus generous headroom for per-user infra. A single spurious renewal blows it.
  const overhead = weeklyOffice(rich) * 20 * 1.5
  const spent = cashBefore - rich.cash
  ok(
    spent < overhead && spent < experimentDef('pilot').cashCost,
    `and it stops charging: $${Math.round(spent).toLocaleString()} over 20 weeks is running costs, not a $${experimentDef('pilot').cashCost.toLocaleString()} renewal (overhead ceiling $${Math.round(overhead).toLocaleString()})`,
  )
  ok(
    !rich.career!.journal.some((j) => j.week > 1 && /renew/i.test(j.title)),
    'and no renewal was recorded at all — it retired, it did not quietly roll on',
  )

  // …and the reported bug, end to end through `advanceWeek`: the SAME setup, but the confidence
  // is unearned. This drives the tick, not `experimentAnswered`, because the bug was never that
  // the predicate was unreachable — it was that the renewal loop believed it.
  //
  // `interview` is the case a player actually hits: bar 0.40 against a seeded prior of 0.42, on
  // the cheapest study and the one the ladder opens with. Two weeks a cycle, so 20 weeks is room
  // for many renewals; before the evidence floor this ran exactly once and retired.
  let convinced = newGame('Convinced', 'saas', 'technical', { config: cfg({ seed: 4244 }) })
  const ctgt = convinced.career!.primaryTargetSegmentId
  const cb = convinced.career!.segmentBeliefs[ctgt]
  cb.needIntensity = { ...cb.needIntensity, confidence: 0.9, evidenceCount: 0 }
  startExperiment(convinced.career!, convinced.week, 'interview', ctgt, 'standing-2', true)
  convinced.cash = 5_000_000
  convinced.marketingSpend = 0
  let cycles = 1
  const seenIds = new Set(convinced.career!.activeExperiments.map((e) => e.id))
  let retiredAtCycle = 0
  for (let w = 0; w < 20; w++) {
    convinced = advanceWeek(convinced)
    for (const e of convinced.career!.activeExperiments) if (!seenIds.has(e.id)) { seenIds.add(e.id); cycles++ }
    if (!retiredAtCycle && convinced.inbox.some((m) => /Standing study concluded/.test(m.title))) retiredAtCycle = cycles
  }
  ok(cycles > 1, `a standing study is NOT retired by conviction it never tested — it ran ${cycles} cycles over 20 weeks, not once`)
  ok(
    retiredAtCycle === 0 || retiredAtCycle >= ANSWER_EVIDENCE_FLOOR,
    `and when it does conclude it is on evidence: ${retiredAtCycle === 0 ? 'still running' : `cycle ${retiredAtCycle}`}, never before cycle ${ANSWER_EVIDENCE_FLOOR}`,
  )
  ok(
    convinced.career!.segmentBeliefs[ctgt].needIntensity.evidenceCount >= ANSWER_EVIDENCE_FLOOR,
    'and the programme actually bought the evidence it was renewed for',
  )
}

// ---- churn with reasons (simulation-depth §4): the attribution must be honest ----------------
//
// The plan's own caution: "if the terms are multiplicative, a share of loss is a modelling
// choice, not a fact. State the decomposition rule ... and make sure the shares sum to the actual
// loss, or the screen will quietly lie." These cases are that sentence as assertions.
{
  const { resolveCohortRetention: keepOf, resolveCohortRetentionBreakdown: breakdownOf } = await import('../src/game/career/pmf')
  const truths = [
    { retentionPotential: 20 }, { retentionPotential: 55 }, { retentionPotential: 90 },
  ] as never[]
  let checked = 0
  let worstResidual = 0
  for (const truth of truths)
    for (const productFit of [5, 40, 95])
      for (const priceFit of [10, 60, 100])
        for (const bugs of [0, 30, 80])
          for (const weeksSinceAcquired of [0, 2, 6]) {
            const args = { truth, productFit, priceFit, bugs, weeksSinceAcquired } as never
            const b = breakdownOf(args)
            const scalar = keepOf(args)
            if (b.keep !== scalar) fails.push(`breakdown.keep drifted from the scalar at ${JSON.stringify(args)}`)
            const sum = Object.values(b.causes).reduce((a, v) => a + v, 0)
            const residual = Math.abs(sum - b.loss)
            worstResidual = Math.max(worstResidual, residual)
            if (residual > 1e-12) fails.push(`shares do not sum to the loss (off by ${residual}) at ${JSON.stringify(args)}`)
            for (const [k, v] of Object.entries(b.causes)) if (v < 0) fails.push(`negative share ${k}=${v}`)
            checked++
          }
  ok(checked === 243 && worstResidual <= 1e-12, `churn attribution: ${checked}/243 states — breakdown.keep === scalar keep, shares sum to loss exactly (worst residual ${worstResidual.toExponential(1)}), no negative shares`)

  // monotonicity: worsening ONE factor must not shrink its own share
  const base = { truth: { retentionPotential: 60 } as never, productFit: 60, priceFit: 60, bugs: 20, weeksSinceAcquired: 6 }
  const before = breakdownOf(base as never)
  const worse = breakdownOf({ ...base, bugs: 70 } as never)
  ok(worse.causes.bugs > before.causes.bugs, 'worsening a factor raises its own attributed share (bugs 20 -> 70)')

  // a perfect state attributes nothing
  const perfect = breakdownOf({ truth: { retentionPotential: 100 } as never, productFit: 100, priceFit: 100, bugs: 0, weeksSinceAcquired: 6 } as never)
  const perfectSum = Object.values(perfect.causes).reduce((a, v) => a + v, 0)
  ok(Math.abs(perfectSum - perfect.loss) <= 1e-12, 'the keep ceiling attributes its residue rather than inventing a cause')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
