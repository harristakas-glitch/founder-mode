// Tokenisation / ICO — Slice 3, organic vs incentivised users.
// Run: npx tsx test/token-users.test.ts
//
// Covers brief §11, §12, §52, §53 and docs/ico-architecture.md §5 (the seam with Career PMF) and
// §1.5 (the one token-aware term in `valuation`). The heavy end — 20 tokenised careers × 80 weeks
// spending $167M on rewards — lives in test/token-users-probe.ts, which is too slow for `npm test`.
// This file is the fast, mutation-verified guard on the properties that probe relies on.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file re-run to confirm it goes red. The mutations, and which assertion killed each one, are
// listed at the bottom.
//
// Three lessons from Slices 1 and 2 are applied throughout:
//
//   • THE GOLDEN TRACE GUARDS DRAW ORDER, NOT PURITY, AND IT DOES NOT GUARD THE CAPABILITY GATE.
//     Slice 2's M23 found that removing the `tokenActive` gate moved no trace at all. So purity,
//     draw COUNT and the gate are each asserted on their own here.
//   • ONE EXAMPLE IS NOT A TEST. Where an assertion could pass by luck — a float reassociation, a
//     weighting that happens to agree on the numbers picked — this file SEARCHES for a disagreeing
//     input instead of trusting one.
//   • A THRESHOLD TEST PASSES FOR THE WRONG REASONS. §52 is asserted as a BIT-IDENTITY ("for any
//     incentive spend, with the organic cohorts held fixed, `derivePmfForSegment` is unchanged"),
//     never as "PMF stayed under 66".

import { advanceWeek, newGame, valuation } from '../src/game/engine'
import { tickCareerPMF } from '../src/game/career/tick'
import { RNG } from '../src/game/data'
import {
  cohortIsOrganic,
  derivePmfForSegment,
  incentivisedCustomers,
  organicCustomers,
  resolveCohortRetention,
  resolveSegmentAcquisition,
  segmentCeiling,
  segmentPriceFit,
  segmentProductFit,
  segmentSnapshots,
  totalCustomers,
} from '../src/game/career/pmf'
import type { CustomerCohort, SegmentTruth } from '../src/game/career/types'
import { tokenisationBars } from '../src/game/token/eligibility'
import { launchToken } from '../src/game/token/launch'
import { tokenInvariants } from '../src/game/token/market'
import {
  expectedRetentionWithoutIncentives,
  incentiveContext,
  incentiveStrength,
  incentivisedKeepRate,
  incentivisedRetention4wk,
  incentivisedUsers,
  mercenaryGrowthWarning,
  organicShare,
  organicUsers,
  resolveIncentivisedAcquisition,
  retentionSplit,
  userIncentiveTokens,
} from '../src/game/token/users'
import { TOKEN_BOUNDS, TOKEN_SCORING, TOKEN_USERS } from '../src/game/token/types'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const cfg = (seed: number, sector: SectorId = 'saas', overrides?: Record<string, boolean>): GameConfig => ({
  mode: 'career',
  format: 'standard',
  sector,
  seed,
  ...(overrides ? { overrides } : {}),
})

/** A deterministic PRNG for the search-based assertions. Never the game's stream. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A Career company that has taken the fork. Bars are set rather than played, so these tests assert
 *  the MECHANIC and not the balance of the twenty weeks in front of it. */
function tokenised(sector: SectorId = 'devtools', seed = 4242, weeks = 20, overrides?: Record<string, boolean>): GameState {
  let s = newGame('Users', sector, 'technical', { config: cfg(seed, sector, overrides) })
  s.cash = 30_000_000
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  const res = launchToken(s)
  if (!res.ok) throw new Error(`setup failed: ${res.reason}`)
  return s
}

/** Point the treasury at customer rewards hard enough that the 2%/wk token cap always binds. */
function fundRewards(s: GameState): void {
  s.token!.incentives = [
    { category: 'customer_rewards', share: 0, tokensPerWeek: s.token!.supply.treasury, startedWeek: s.week, cumulativeTokens: 0, effectiveness: 0 },
  ]
}

function cohort(over: Partial<CustomerCohort> & { id: string; segmentId: string; n: number }): CustomerCohort {
  const { n, ...rest } = over
  return {
    acquiredWeek: 1,
    startingCustomers: n,
    activeCustomers: n,
    exactCustomers: n,
    acquisitionCost: 0,
    priceAtAcquisition: 52,
    productQualityAtAcquisition: 50,
    ...rest,
  } as CustomerCohort
}

function play(s: GameState, weeks: number, opts: { fund?: boolean; cutAt?: number } = {}): GameState {
  let g = s
  if (opts.fund) fundRewards(g)
  for (let i = 0; i < weeks && !g.gameOver; i++) {
    g.marketingSpend = 12_000
    if (opts.cutAt !== undefined && i === opts.cutAt) g.token!.incentives = []
    if (g.cash < 3_000_000) g.cash = 30_000_000
    g = advanceWeek(g)
  }
  return g
}

// =================================================================================================
console.log('— §5.2: absent origin IS organic —')

{
  const c = cohort({ id: 'a', segmentId: 's', n: 10 })
  ok(c.origin === undefined && cohortIsOrganic(c), 'a cohort written before this field existed is organic')
  ok(cohortIsOrganic({ ...c, origin: 'organic' }), 'and an explicitly organic one is too')
  ok(!cohortIsOrganic({ ...c, origin: 'incentivised' }), 'only `incentivised` is not organic')

  const career = tokenised().career!
  career.cohorts = [
    cohort({ id: 'o1', segmentId: 'x', n: 100 }),
    cohort({ id: 'o2', segmentId: 'x', n: 50, origin: 'organic' }),
    cohort({ id: 'i1', segmentId: 'x', n: 400, origin: 'incentivised' }),
    cohort({ id: 'o3', segmentId: 'y', n: 7 }),
  ]
  ok(totalCustomers(career) === 557, 'totalCustomers still counts everyone')
  ok(organicCustomers(career) === 157, 'organicCustomers excludes the rented ones')
  ok(incentivisedCustomers(career) === 400, 'incentivisedCustomers counts only them')
  ok(organicCustomers(career, 'x') === 150 && incentivisedCustomers(career, 'x') === 400, 'and both filter by segment')
  ok(
    organicCustomers(career) + incentivisedCustomers(career) === totalCustomers(career),
    'organic + incentivised === total, exactly',
  )
}

// =================================================================================================
console.log('\n— §52: EXCLUSION, NOT WEIGHTING. The bit-identity invariant —')

{
  // The guarantee, stated as the contract states it: for ANY incentive spend, with the organic
  // cohorts held fixed, `derivePmfForSegment` returns a bit-identical result. A 0.1 weighting, or
  // reading `totalCustomers`, must break this.
  const s = tokenised('saas', 7)
  const career = s.career!
  const seg = career.primaryTargetSegmentId
  const truth = career.segmentTruth[seg]
  const organic = [cohort({ id: 'o1', segmentId: seg, n: 120, retentionAt4wk: 0.7 }), cohort({ id: 'o2', segmentId: seg, n: 80, retentionAt4wk: 0.66 })]
  const derive = (cohorts: CustomerCohort[]) => {
    career.cohorts = cohorts
    return derivePmfForSegment({
      segmentId: seg,
      customers: organicCustomers(career, seg),
      retention4wk: career.retentionBySegment[seg] ?? 0,
      priceFit: segmentPriceFit(truth, career.pricing),
      productFit: segmentProductFit(truth, s.quality, career.focus, s.sector, seg),
      truth,
      beliefs: career.segmentBeliefs[seg],
      ceiling: segmentCeiling(truth, 250_000),
    })
  }
  const baseline = JSON.stringify(derive(organic))
  // Search, rather than trust one example: a weighting could agree by luck on any single size.
  const rng = prng(0xbeef)
  let disagreements = 0
  for (let i = 0; i < 400; i++) {
    const n = Math.round(1 + rng() * 250_000)
    const ret = rng()
    const withRented = [...organic, cohort({ id: `i${i}`, segmentId: seg, n, retentionAt4wk: ret, origin: 'incentivised' })]
    if (JSON.stringify(derive(withRented)) !== baseline) disagreements++
  }
  ok(disagreements === 0, 'derivePmfForSegment is BIT-IDENTICAL across 400 incentivised cohorts from 1 to 250,000 customers')

  // And the same statement negated, so the test cannot pass because the derive function ignores
  // its `customers` argument entirely.
  career.cohorts = organic
  const moreOrganic = derive([...organic, cohort({ id: 'o3', segmentId: seg, n: 5_000, retentionAt4wk: 0.7 })])
  career.cohorts = organic
  ok(moreOrganic.score > JSON.parse(baseline).score, 'while adding ORGANIC customers does move it — the exclusion is of origin, not of the argument')
}

{
  // AND THE SAME GUARANTEE AT THE CALL SITE, which is where it can actually be broken.
  //
  // The assertion above proves `derivePmfForSegment` is deterministic; it does NOT prove the weekly
  // tick hands it the organic count, because the test computes that argument itself. Mutating
  // `tickCareerPMF` to pass `totalCustomers` — the §52 violation in its purest form — survived it.
  // So the tick is called directly and its own output inspected.
  const s = tokenised('saas', 4242)
  const career = s.career!
  const seg = career.primaryTargetSegmentId
  career.cohorts = [
    cohort({ id: 'o1', segmentId: seg, n: 200, acquiredWeek: s.week - 12, retentionAt4wk: 0.6 }),
    cohort({ id: 'i1', segmentId: seg, n: 9_000, acquiredWeek: s.week - 12, retentionAt4wk: 0.95, origin: 'incentivised' }),
  ]
  s.users = totalCustomers(career)
  let n = 0
  const r = tickCareerPMF(s, {
    sectorTam: 250_000,
    sectorAcqBase: 5,
    marketingSpend: 0,
    rng: prng(1),
    uid: () => `u${n++}`,
  })
  const scored = r.segmentPmf.find((p) => p.segmentId === seg)!
  ok(
    scored.customers === organicCustomers(career, seg),
    `the tick scores PMF on the ORGANIC count (${scored.customers}), not the total (${totalCustomers(career, seg)})`,
  )
  ok(scored.customers < totalCustomers(career, seg) * 0.1, 'and the two are far apart here, so the assertion is not passing by coincidence')
  ok(scored.retention4wk === career.retentionBySegment[seg], 'and on the ORGANIC retention — the 95% rented cohort is not in it')
  ok(r.customers === totalCustomers(career), 'while `s.users` gets the TOTAL: rented users are real users with real revenue and real infra cost')
}

{
  // End to end, and the strongest form of the claim: eighty weeks of the maximum permitted rewards
  // spend cannot raise the PMF ceiling above what the identical company reaches spending nothing.
  for (const [sector, seed] of [['devtools', 20260810], ['saas', 4242]] as [SectorId, number][]) {
    const base = tokenised(sector, seed)
    const peak = (fund: boolean) => {
      let g = structuredClone(base)
      if (fund) fundRewards(g)
      let best = 0
      for (let i = 0; i < 35 && !g.gameOver; i++) {
        g.marketingSpend = 12_000
        if (g.cash < 3_000_000) g.cash = 30_000_000
        g = advanceWeek(g)
        best = Math.max(best, Math.round(g.pmf))
      }
      return { best, rented: incentivisedCustomers(g.career!) }
    }
    const spent = peak(true)
    const control = peak(false)
    ok(
      spent.best <= control.best,
      `${sector}/${seed}: ${spent.rented.toLocaleString()} bought customers moved peak PMF from ${control.best} to ${spent.best} — spend can only ever COST PMF`,
    )
  }
}

{
  // The same guarantee at the level the player experiences it: the screen and the tick must agree.
  const s = tokenised('devtools', 31337)
  const career = s.career!
  const seg = career.primaryTargetSegmentId
  const before = segmentSnapshots({ career, sector: s.sector, quality: s.quality, sectorTam: 900_000 })
  career.cohorts.push(cohort({ id: 'rent', segmentId: seg, n: 900_000, origin: 'incentivised' }))
  const after = segmentSnapshots({ career, sector: s.sector, quality: s.quality, sectorTam: 900_000 })
  ok(JSON.stringify(before) === JSON.stringify(after), 'segmentSnapshots (what the UI shows) is unmoved by 900,000 rented customers')
}

{
  // retentionBySegment is measured over ORGANIC cohorts only. A rented cohort with perfect
  // retention must not raise it, and one with terrible retention must not lower it.
  const base = tokenised('saas', 4242)
  const seg = base.career!.primaryTargetSegmentId
  const run = (rentedRetention: number | null) => {
    const s = structuredClone(base)
    const c = s.career!
    c.cohorts = [cohort({ id: 'o', segmentId: seg, n: 300, acquiredWeek: s.week - 10, retentionAt4wk: 0.55 })]
    if (rentedRetention !== null)
      c.cohorts.push(cohort({ id: 'i', segmentId: seg, n: 3000, acquiredWeek: s.week - 10, retentionAt4wk: rentedRetention, origin: 'incentivised' }))
    s.users = totalCustomers(c)
    const out = advanceWeek(s)
    return out.career!.retentionBySegment[seg]
  }
  const none = run(null)
  ok(Math.abs(run(0.99) - none) < 1e-12, 'a rented cohort retaining 99% does not raise organic retention')
  ok(Math.abs(run(0.01) - none) < 1e-12, 'and one retaining 1% does not lower it — measured over organic cohorts ONLY')
}

// =================================================================================================
console.log('\n— §12: split retention, and the number that tells the truth —')

{
  const dep = TOKEN_BOUNDS.incentiveDependence
  ok(dep === 0.62, 'incentiveDependence is the contract\'s 0.62')

  // THE BLEND IS IN FOUR-WEEK SPACE. `resolveCohortRetention` returns a WEEKLY keep rate of ~0.90;
  // blending there instead gives 0.342/wk with the rewards off — a four-week survival of 1.4%,
  // where §12 asks for something in the 24–31% band. This assertion is what pins the space.
  const weekly = 0.9
  const four = weekly ** 4
  const stoppedWeekly = incentivisedKeepRate(weekly, 0)
  const stoppedFour = stoppedWeekly ** 4
  ok(Math.abs(stoppedFour - four * (1 - dep)) < 1e-12, 'with the rewards off, the FOUR-WEEK number is organic4 × 0.38')
  ok(stoppedFour > 0.15 && stoppedFour < 0.35, `and it lands in §12's band: ${(stoppedFour * 100).toFixed(1)}% (§12 illustrates 31%)`)
  ok(
    Math.abs(stoppedFour - (weekly * (1 - dep)) ** 4) > 0.2,
    'a weekly-space blend would give 1.4% instead — the two are not close, so this assertion has teeth',
  )

  const paidWeekly = incentivisedKeepRate(weekly, 1)
  ok(paidWeekly > weekly, 'while the rewards run, incentivised retention EXCEEDS organic — growth genuinely looks better')
  ok((paidWeekly ** 4) > 0.8, `and reads ${((paidWeekly ** 4) * 100).toFixed(0)}% at four weeks against organic's ${(four * 100).toFixed(0)}% (§12: 81% vs 63%)`)
  ok(incentivisedKeepRate(weekly, 0.4) < weekly, 'half-hearted rewards are WORSE than none: the dependence is paid for whether or not it works')

  // Monotone in strength, searched rather than sampled at two points.
  let monotone = true
  let prev = -1
  for (let i = 0; i <= 200; i++) {
    const v = incentivisedKeepRate(weekly, i / 200)
    if (v < prev - 1e-12) monotone = false
    prev = v
  }
  ok(monotone, 'the keep rate is monotone non-decreasing in incentive strength across 201 points')

  // And it tracks the organic rate, so a good product still helps the people you are paying.
  ok(incentivisedKeepRate(0.95, 0.5) > incentivisedKeepRate(0.85, 0.5), 'a better product retains rented users better too — the organic term is a real input')
}

{
  const s = tokenised('devtools', 4242)
  const career = s.career!
  const seg = career.primaryTargetSegmentId
  career.retentionBySegment[seg] = 0.63

  // The counterfactual is a pure ALGEBRAIC substitution — no simulation, no lookahead — so it
  // cannot move with what is currently being spent.
  const at = (strength: number) => {
    const split = retentionSplit(s, seg, strength)
    return split.incentivisedWithoutIncentives
  }
  const values = new Set([at(0), at(0.25), at(0.5), at(0.99), at(1)].map((v) => v.toFixed(15)))
  ok(values.size === 1, 'expectedRetentionWithoutIncentives is identical at every level of current spend')
  ok(Math.abs(at(1) - 0.63 * (1 - TOKEN_BOUNDS.incentiveDependence)) < 1e-12, 'and equals the organic four-week rate × 0.38')
  ok(
    expectedRetentionWithoutIncentives(career, undefined, seg) === 0.63,
    'with no token there are no incentives, so the counterfactual IS the organic number',
  )
  ok(retentionSplit(s, seg, 1).incentivised > retentionSplit(s, seg, 1).incentivisedWithoutIncentives, 'the gap §12 exists to show is real')
  ok(retentionSplit(s, seg, 1).organic === 0.63, 'and the organic figure is the measured one, untouched')
}

{
  // End to end: what actually happens when the rewards stop.
  const base = tokenised('devtools', 4242)
  const seg = base.career!.primaryTargetSegmentId
  const withSpend = play(structuredClone(base), 30, { fund: true })
  const rentedAtCut = incentivisedCustomers(withSpend.career!)
  ok(rentedAtCut > 50, `thirty weeks of rewards bought ${rentedAtCut} customers`)
  const forecast = retentionSplit(withSpend, seg).incentivisedWithoutIncentives
  const after = play(structuredClone(withSpend), 4, { cutAt: 0 })
  const survivors = incentivisedCustomers(after.career!) / rentedAtCut
  ok(survivors < 0.45, `four weeks after the cut, ${(survivors * 100).toFixed(0)}% of the rented base is left`)
  ok(
    Math.abs(survivors - forecast) < 0.15,
    `and the counterfactual shown BEFORE the cut (${(forecast * 100).toFixed(0)}%) predicted it (${(survivors * 100).toFixed(0)}%)`,
  )
  const organicBefore = organicCustomers(withSpend.career!)
  const organicAfter = organicCustomers(after.career!)
  ok(organicAfter > organicBefore * 0.7, 'while the ORGANIC base is basically untouched — a company with real PMF has a floor the token economy cannot reach')

  // And the displayed number stops lying the week the rewards stop. `retentionAt4wk` is frozen at
  // four weeks old by design, so a cohort snapshotted WHILE IT WAS BEING PAID would otherwise keep
  // reporting its paid figure long after the payments end — measured, 62–67% for twenty weeks after
  // the cut, beside a forecast correctly saying 23%.
  const paidReading = withSpend.career!.retentionBySegmentIncentivised?.[seg]
  ok(paidReading !== undefined && paidReading > 0.6, `while the rewards ran, measured incentivised retention read ${((paidReading ?? 0) * 100).toFixed(0)}%`)
  ok(after.career!.retentionBySegmentIncentivised?.[seg] === undefined, 'and the week they stop, the measured key is DROPPED — it describes a population that is no longer being paid')
  ok(
    Math.abs(retentionSplit(after, seg).incentivised - retentionSplit(after, seg).incentivisedWithoutIncentives) < 1e-12,
    'so the displayed number falls back to the counterfactual, and the screen tells one story',
  )
}

// =================================================================================================
console.log('\n— §5.1: the referral term, and the contract\'s unbuildable instruction —')

{
  // The optional argument must be a perfect no-op when omitted, or every existing Career run moves.
  const rng = prng(0xf00d)
  let same = 0
  for (let i = 0; i < 300; i++) {
    const truth: SegmentTruth = {
      needIntensity: rng() * 100,
      willingnessToPay: rng() * 100,
      retentionPotential: rng() * 100,
      acquisitionAccessibility: rng() * 100,
      productRequirement: rng() * 100,
      marketSize: rng() * 100,
      competitiveIntensity: rng() * 100,
      salesCycleWeeks: 1 + rng() * 8,
      expansionPotential: rng() * 100,
    }
    const args = {
      truth,
      productFit: rng() * 100,
      priceFit: rng() * 100,
      marketingSpend: rng() * 80_000,
      hype: rng() * 100,
      currentCustomers: Math.round(rng() * 40_000),
      ceiling: 1_000 + rng() * 200_000,
      marketingPenalty: 0.4 + rng() * 0.6,
      acqScale: 0.4 + rng() * 3,
    }
    const a = resolveSegmentAcquisition({ ...args, rng: prng(i) })
    const b = resolveSegmentAcquisition({ ...args, rng: prng(i), referralCustomers: args.currentCustomers })
    if (a === b) same++
  }
  ok(same === 300, 'omitting `referralCustomers` is bit-identical to passing `currentCustomers` — 300 random inputs')

  const truth: SegmentTruth = {
    needIntensity: 70, willingnessToPay: 60, retentionPotential: 70, acquisitionAccessibility: 80,
    productRequirement: 40, marketSize: 70, competitiveIntensity: 30, salesCycleWeeks: 2, expansionPotential: 50,
  }
  const shared = { truth, productFit: 70, priceFit: 70, marketingSpend: 10_000, hype: 40, ceiling: 500_000, marketingPenalty: 1, acqScale: 1 }
  const total = 20_000
  const organic = 4_000
  const withAll = resolveSegmentAcquisition({ ...shared, currentCustomers: total, rng: prng(1) })
  const withSplit = resolveSegmentAcquisition({ ...shared, currentCustomers: total, referralCustomers: organic, rng: prng(1) })
  ok(withSplit < withAll, 'rented customers do NOT refer: splitting the argument lowers acquisition')
  // …and `room` still reads the total. If the contract's literal instruction had been followed,
  // `currentCustomers` would BE the organic count and rented users would stop consuming headroom —
  // so buying users would make ORGANIC acquisition easier, which is a worse leak than the one being
  // closed.
  const roomOnOrganic = resolveSegmentAcquisition({ ...shared, currentCustomers: organic, referralCustomers: organic, rng: prng(1) })
  ok(roomOnOrganic > withSplit, 'and the TOTAL still consumes market headroom — the market is full whoever paid to fill it')
}

// =================================================================================================
console.log('\n— Incentivised acquisition: pure, capped, and its own population —')

{
  const truth: SegmentTruth = {
    needIntensity: 70, willingnessToPay: 60, retentionPotential: 70, acquisitionAccessibility: 80,
    productRequirement: 40, marketSize: 70, competitiveIntensity: 30, salesCycleWeeks: 2, expansionPotential: 50,
  }
  const base = { truth, productFit: 60, currentCustomers: 1_000, ceiling: 200_000, marketingPenalty: 1, acqScale: 1 }
  ok(resolveIncentivisedAcquisition({ ...base, incentiveDollars: 0 }) === 0, 'no spend buys nobody')
  ok(resolveIncentivisedAcquisition({ ...base, incentiveDollars: -5 }) === 0, 'and a negative budget does not buy negative people')
  ok(
    resolveIncentivisedAcquisition({ ...base, incentiveDollars: 40_000 }) > resolveIncentivisedAcquisition({ ...base, incentiveDollars: 10_000 }),
    'more spend buys more customers',
  )
  ok(
    resolveIncentivisedAcquisition({ ...base, incentiveDollars: 40_000, currentCustomers: 190_000 }) <
      resolveIncentivisedAcquisition({ ...base, incentiveDollars: 40_000 }),
    'and a nearly-full market resists being bought — `room` binds here too',
  )
  // Diminishing returns: the sqrt shape is inherited from the organic spend term, so this cannot
  // become a linear money-printer.
  const one = resolveIncentivisedAcquisition({ ...base, incentiveDollars: 10_000 })
  const four = resolveIncentivisedAcquisition({ ...base, incentiveDollars: 40_000 })
  ok(four < one * 3, `quadrupling the budget buys ${(four / one).toFixed(2)}×, not 4× — sqrt, like every other spend term`)

  // PURE. `tickCareerPMF` is NOT inside the tokenActive gate, so a draw here would put a
  // capability-dependent branch in the middle of the stream every seeded run depends on.
  const prevNext = RNG.next
  let draws = 0
  RNG.next = () => {
    draws++
    return prevNext()
  }
  try {
    for (let i = 0; i < 200; i++) resolveIncentivisedAcquisition({ ...base, incentiveDollars: 1_000 + i })
  } finally {
    RNG.next = prevNext
  }
  ok(draws === 0, 'resolveIncentivisedAcquisition draws ZERO times — 200 calls, 0 draws')
}

// =================================================================================================
console.log('\n— The capability gate, and the draw count —')

{
  // The gate. Slice 2's M23 showed the golden trace does NOT catch a missing capability gate, so it
  // is asserted directly: with `tokenUserComposition` off, a funded rewards programme buys nobody.
  const on = tokenised('devtools', 4242)
  const off = tokenised('devtools', 4242, 20, { tokenUserComposition: false })
  const onEnd = play(structuredClone(on), 20, { fund: true })
  const offEnd = play(structuredClone(off), 20, { fund: true })
  ok(incentivisedCustomers(onEnd.career!) > 0, 'with the capability ON, a funded programme buys customers')
  ok(incentivisedCustomers(offEnd.career!) === 0, 'with the capability OFF, the identical programme buys NOBODY')
  ok(userIncentiveTokens(offEnd) > 0, '…even though the treasury is still releasing tokens — the gate is on the USERS, not on the treasury')

  // THE STREAM. `advanceWeek` runs its randomness inside `seeded()`, which swaps `RNG.next` for a
  // freshly seeded generator keyed on (config.seed, week, rngTick) — so instrumenting `RNG.next`
  // from out here counts nothing, and an assertion that did would be vacuous. What CAN be asserted,
  // and is what actually matters, is that the number of seeded blocks entered is unchanged: that
  // count is the stream partition every daily challenge, Arena replay and golden trace depends on.
  const a = structuredClone(on)
  const b = structuredClone(on)
  fundRewards(a)
  b.capabilities = { ...b.capabilities, tokenUserComposition: false }
  fundRewards(b)
  const ticksA = advanceWeek(a).flags.rngTick
  const ticksB = advanceWeek(b).flags.rngTick
  ok(ticksA === ticksB && ticksA! > 0, `a Career week enters the same number of seeded blocks with the capability on or off (${ticksA})`)

  // And the acceptance test the plan actually asks for, at unit scale: a run that never tokenised
  // is IDENTICAL with the capability on or off. (`npm run bots` proves the same thing at scale.)
  const fingerprint = (over?: Record<string, boolean>) => {
    let g = newGame('Untokenised', 'saas', 'technical', { config: cfg(31337, 'saas', over) })
    const out: string[] = []
    for (let i = 0; i < 20 && !g.gameOver; i++) {
      g = advanceWeek(g)
      out.push(`${g.week}|${g.users}|${Math.round(g.cash)}|${g.pmf.toFixed(6)}|${totalCustomers(g.career!)}|${g.career!.cohorts.length}`)
    }
    return out.join(';')
  }
  ok(fingerprint() === fingerprint({ tokenUserComposition: false }), 'a Career run that never tokenised is identical with the capability on or off')
}

{
  // Purity of every reader in the module: a `Math.random()` inside one of these is invisible to the
  // golden trace, because a pure read does not feed the simulation.
  const s = play(structuredClone(tokenised('social', 7)), 12, { fund: true })
  const snap = JSON.stringify(s)
  const readings = new Set<string>()
  const prevNext = RNG.next
  let draws = 0
  RNG.next = () => {
    draws++
    return prevNext()
  }
  try {
    for (let i = 0; i < 100; i++)
      readings.add(
        JSON.stringify([
          organicUsers(s), incentivisedUsers(s), organicShare(s), userIncentiveTokens(s),
          incentiveContext(s), retentionSplit(s, s.career!.primaryTargetSegmentId), mercenaryGrowthWarning(s),
        ]),
      )
  } finally {
    RNG.next = prevNext
  }
  ok(readings.size === 1, 'every Slice 3 read is pure: 100 repeat evaluations, 100 identical')
  ok(draws === 0, 'and none of them touches the RNG stream')
  ok(JSON.stringify(s) === snap, 'and none of them mutates the state')
}

// =================================================================================================
console.log('\n— §4.6: the user split invariant —')

{
  const s = tokenised('ecommerce', 31337)
  let g = structuredClone(s)
  fundRewards(g)
  const violations: string[] = []
  for (let i = 0; i < 30 && !g.gameOver; i++) {
    g.marketingSpend = 12_000
    if (g.cash < 3_000_000) g.cash = 30_000_000
    g = advanceWeek(g)
    if (organicUsers(g) + incentivisedUsers(g) !== Math.max(0, Math.round(g.users)))
      violations.push(`w${g.week}: ${organicUsers(g)}+${incentivisedUsers(g)} !== ${g.users}`)
    const inv = tokenInvariants(g)
    if (inv.length) violations.push(`w${g.week}: ${inv.join('; ')}`)
  }
  ok(violations.length === 0, `organicUsers + incentivisedUsers === s.users every week of a 30-week rewards campaign${violations.length ? ': ' + violations[0] : ''}`)
  ok(incentivisedUsers(g) > 0 && organicUsers(g) > 0, 'and both populations are non-empty, so the identity is not passing trivially')

  // The mirror on TokenState follows the cohorts rather than drifting from them.
  ok(g.token!.users.incentivised === incentivisedUsers(g), 'the TokenState mirror is written FROM the cohorts in Career')
  const desynced = structuredClone(g)
  desynced.token!.users.incentivised += 25
  ok(tokenInvariants(desynced).some((v) => v.includes('user split broken (mirror)')), 'and a desynced mirror is caught by the invariant')
}

// =================================================================================================
console.log('\n— The reconciliation split: a churn shock hits both populations —')

{
  // The §52 leak found by measurement. Incentivised cohorts are pushed AFTER the organic one each
  // week, and the reconciliation loop walks newest-first — so before this was split, every
  // company-wide user loss was absorbed ENTIRELY by rented users and never reached an organic
  // cohort's four-week snapshot. Buying users was a shock absorber for the number §52 protects.
  // The property, stated without re-implementing a single formula: an organic cohort must fare
  // EXACTLY as well beside a rented population as it would have fared alone. A 30% company-wide
  // outage is a 30% outage for the organic base whether or not two thirds of the company is rented.
  const build = (withRented: boolean) => {
    const s = tokenised('saas', 7)
    const seg = s.career!.primaryTargetSegmentId
    s.career!.cohorts = [cohort({ id: 'o', segmentId: seg, n: 400, acquiredWeek: s.week })]
    if (withRented) s.career!.cohorts.push(cohort({ id: 'i', segmentId: seg, n: 600, acquiredWeek: s.week, origin: 'incentivised' }))
    const base = withRented ? 1_000 : 400
    s.users = Math.round(base * 0.7) // the outage
    s.marketingSpend = 0
    return advanceWeek(s)
  }
  const seg = build(false).career!.primaryTargetSegmentId
  const alone = organicCustomers(build(false).career!, seg)
  const beside = build(true)
  const organicLeft = organicCustomers(beside.career!, seg)
  const rentedLeft = incentivisedCustomers(beside.career!, seg)
  ok(alone < 400 * 0.75, `alone, a 30% outage leaves the organic cohort at ${alone} of 400`)
  ok(
    Math.abs(organicLeft - alone) <= 2,
    `and beside 600 rented customers it lands at ${organicLeft} — within 2 of the same number, so the rented base is NOT a shock absorber`,
  )
  ok(rentedLeft < 600 * 0.75, `while the rented population took its own ${600 - rentedLeft} of the hit (${rentedLeft} left)`)
}

// =================================================================================================
console.log('\n— §53: the token-driven-growth warning —')

{
  // The leak is now DELIBERATE. This fixture used to get its weak organic retention incidentally
  // — social/555 happened to settle a hair under the 0.62 bar — so the moment `retentionAt4wk`
  // was corrected to measure four weeks of churn instead of five, every reading in the game rose
  // ~4.3pp, this run landed at 63.2%, and a test about a leaky product was quietly running on a
  // product that no longer leaked. Premium pricing into Social's price-sensitive casual users is
  // an explicit leak: price fit is a retention factor by design, and it does not depend on where
  // the retention baseline happens to sit.
  const leaky = structuredClone(tokenised('social', 555))
  leaky.career!.pricing = 'premium'
  const s = play(leaky, 45, { fund: true })
  ok(
    (s.career!.retentionBySegment[s.career!.primaryTargetSegmentId] ?? 1) < TOKEN_USERS.warnOrganicRetention,
    `the fixture really is leaky (organic retention ${((s.career!.retentionBySegment[s.career!.primaryTargetSegmentId] ?? 0) * 100).toFixed(0)}% against a ${(TOKEN_USERS.warnOrganicRetention * 100).toFixed(0)}% bar)`,
  )
  const w = mercenaryGrowthWarning(s)
  ok(!!w, 'a rewards campaign into a leaky product produces the §53 warning')
  if (w) {
    ok(w.incentivisedShare >= TOKEN_USERS.warnIncentivisedShare, `most of the segment is rented (${(w.incentivisedShare * 100).toFixed(0)}%)`)
    ok(w.organicRetention < TOKEN_USERS.warnOrganicRetention, `organic retention is weak (${(w.organicRetention * 100).toFixed(0)}%)`)
    ok(w.growth >= TOKEN_USERS.warnGrowthPct, `and growth genuinely looks strong (+${(w.growth * 100).toFixed(0)}%)`)
    ok(w.expectedWithoutIncentives < w.incentivisedRetention, 'and it carries the counterfactual, which is the whole point')
    ok(s.inbox.some((m) => m.title === 'Token-driven growth'), 'and the player is told, in the inbox')
    ok(
      s.career!.lastExplanations[0]?.primaryCause.includes('incentive-driven'),
      'and it is the FIRST thing said about the week',
    )
  }

  // Each of the three conditions is necessary. Break one at a time.
  const healthy = structuredClone(s)
  healthy.career!.retentionBySegment[healthy.career!.primaryTargetSegmentId] = 0.85
  ok(!mercenaryGrowthWarning(healthy), 'no warning when organic retention is healthy — renting users is not itself a sin')
  const flat = structuredClone(s)
  for (const h of flat.history) h.users = flat.history[flat.history.length - 1].users
  ok(!mercenaryGrowthWarning(flat), 'no warning when growth is flat — there is nothing being masked')
  const mostlyOrganic = structuredClone(s)
  mostlyOrganic.career!.cohorts = mostlyOrganic.career!.cohorts.filter(cohortIsOrganic)
  ok(!mercenaryGrowthWarning(mostlyOrganic), 'no warning when the growth is actually organic')
  const noToken = structuredClone(s)
  noToken.token = undefined
  ok(!mercenaryGrowthWarning(noToken), 'and never on a run with no token slice')
  const capOff = structuredClone(s)
  capOff.capabilities = { ...capOff.capabilities, tokenUserComposition: false }
  ok(!mercenaryGrowthWarning(capOff), 'nor with the capability off')

  // A segment with no measured organic retention yet is UNKNOWN, not weak.
  const unmeasured = structuredClone(s)
  unmeasured.career!.retentionBySegment[unmeasured.career!.primaryTargetSegmentId] = 0
  ok(!mercenaryGrowthWarning(unmeasured), 'and a segment with no four-week data yet is unknown, not weak')
}

// =================================================================================================
console.log('\n— §1.5: the valuation discount —')

{
  // Exactly 1 when tokens are off. A cohort carrying `origin: 'incentivised'` on a run with NO
  // token slice must not be discounted at all: `incentivisedUsers` reads 0 without a slice, so the
  // term is `s.users - 0` — the identical expression, bit for bit.
  let plain = newGame('Plain', 'saas', 'technical', { config: cfg(7) })
  for (let i = 0; i < 12; i++) plain = advanceWeek(plain)
  const before = valuation(plain)
  const stray = structuredClone(plain)
  for (const c of stray.career!.cohorts) c.origin = 'incentivised'
  ok(incentivisedUsers(stray) === 0, 'a run with no token slice has no incentivised users, whatever the cohorts say')
  ok(valuation(stray) === before, 'so valuation() is BIT-IDENTICAL — the factor is exactly 1 when tokens are off')

  // And the discount is exactly 0.35 when they are on.
  const s = play(structuredClone(tokenised('social', 31337)), 25, { fund: true })
  const rented = incentivisedUsers(s)
  ok(rented > 100, `${rented.toLocaleString()} rented users to discount`)
  const asOrganic = structuredClone(s)
  for (const c of asOrganic.career!.cohorts) c.origin = undefined
  const discounted = valuation(s)
  const full = valuation(asOrganic)
  ok(discounted < full, 'rented users are worth LESS to an acquirer')
  // Recover the implied discount: valuation is linear in the user term, so removing
  // `rented × (1 − d)` users must give the same number.
  const trimmed = structuredClone(asOrganic)
  trimmed.users = asOrganic.users - rented * (1 - TOKEN_SCORING.incentivisedUserValuationDiscount)
  ok(Math.abs(valuation(trimmed) - discounted) <= 1, `the implied discount is exactly ${TOKEN_SCORING.incentivisedUserValuationDiscount}`)
  // …and the assertion has teeth: a different constant disagrees by a wide margin.
  const wrong = structuredClone(asOrganic)
  wrong.users = asOrganic.users - rented * (1 - 0.5)
  ok(Math.abs(valuation(wrong) - discounted) > 1_000, 'a 0.5 discount would disagree by more than $1,000 — the check is not vacuous')

  // A DISCOUNT, NEVER AN ADDITION: no configuration of rented users raises enterprise value.
  let everLower = true
  for (const frac of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    const v = structuredClone(asOrganic)
    const target = Math.round(totalCustomers(v.career!) * frac)
    let left = target
    for (const c of v.career!.cohorts) {
      if (left <= 0) break
      c.origin = 'incentivised'
      left -= c.activeCustomers
    }
    if (valuation(v) > full + 1e-6) everLower = false
  }
  ok(everLower, 'across six rented fractions, valuation never rises — it is a discount, never an addition')
  ok(
    valuation(s) < valuation(asOrganic) && networkUnchanged(s),
    'and no token market cap reaches valuation() — the two legs stay disjoint',
  )
}

function networkUnchanged(s: GameState): boolean {
  // valuation() must not move when the token PRICE moves. If it ever did, enterprise value would be
  // absorbing network value and §1.2's disjoint legs would be gone.
  const a = valuation(s)
  const hot = structuredClone(s)
  hot.token!.market.price *= 50
  return valuation(hot) === a
}

// =================================================================================================
console.log('\n— Incentive strength: ARPU-denominated, and a pure read of THIS week —')

{
  const saas = tokenised('saas', 7)
  const social = tokenised('social', 7)
  // The same dollars-per-user means different things in a $24/wk sector and a $1.80/wk one.
  const dollars = 500
  ok(
    incentiveStrength(saas, dollars, 100) < incentiveStrength(social, dollars, 100),
    'the same spend per user is weaker in a high-ARPU sector — strength is a share of revenue, not a dollar count',
  )
  ok(incentiveStrength(saas, 0, 100) === 0, 'no spend is no strength')
  ok(incentiveStrength(saas, 1e9, 100) === 1, 'and strength saturates at 1')
  ok(
    incentiveStrength(saas, dollars, 1_000) < incentiveStrength(saas, dollars, 100),
    'the same budget over ten times the rented base buys each of them a tenth as much — sustaining it needs ACCELERATING spend',
  )

  // Only customer_rewards reaches users. Slice 4 owns the other five categories, and treating them
  // as a customer subsidy would make every allocation identical — precisely what that slice must
  // disprove.
  const g = structuredClone(saas)
  g.token!.incentives = [
    { category: 'developer_grants', share: 0, tokensPerWeek: g.token!.supply.treasury, startedWeek: g.week, cumulativeTokens: 0, effectiveness: 0 },
  ]
  ok(userIncentiveTokens(g) === 0, 'developer grants buy no customers — only `customer_rewards` reaches users')
  g.token!.incentives.push({ category: 'customer_rewards', share: 0, tokensPerWeek: g.token!.supply.treasury, startedWeek: g.week, cumulativeTokens: 0, effectiveness: 0 })
  const half = userIncentiveTokens(g)
  g.token!.incentives = [g.token!.incentives[1]]
  const all = userIncentiveTokens(g)
  ok(half > 0 && Math.abs(half - all / 2) < 1e-6, 'and a 50/50 split gets pro rata half of the capped release, not half of the ask')
  ok(all <= g.token!.supply.treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek + 1e-6, 'the 2%/wk token cap still binds — Slice 3 never re-derives it')
}

// =================================================================================================
console.log('\n— Cohort retention still answers its own question —')

{
  // `resolveCohortRetention` gains NO argument (§5.3). Its signature and behaviour are untouched;
  // the token module bends the ANSWER.
  const truth: SegmentTruth = {
    needIntensity: 70, willingnessToPay: 60, retentionPotential: 70, acquisitionAccessibility: 80,
    productRequirement: 40, marketSize: 70, competitiveIntensity: 30, salesCycleWeeks: 2, expansionPotential: 50,
  }
  const keep = resolveCohortRetention({ truth, productFit: 70, priceFit: 70, bugs: 10, weeksSinceAcquired: 8 })
  ok(keep > 0.9 && keep < 1, `it still returns a weekly keep rate (${keep.toFixed(4)})`)
  ok(incentivisedRetention4wk(keep ** 4, 1) > keep ** 4, 'and the token module raises it while the rewards run')
  ok(incentivisedRetention4wk(keep ** 4, 0) < keep ** 4, 'and drops it below organic when they stop')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// =================================================================================================
// MUTATIONS RUN AGAINST THIS FILE. Each was applied on its own, `npm test` re-run, and reverted.
// 35 applied, 35 killed. A mutation that stays green is a test that does not exist.
//
//   M1  cohortIsOrganic always true                                    KILLED
//   M2  absent origin means INCENTIVISED instead of organic            KILLED (career-pmf.test.ts)
//   M3  the tick passes totalCustomers to derivePmfForSegment          KILLED  ← the §52 violation itself
//   M4  §52 exclusion becomes a 0.1 weighting                          KILLED
//   M5  retentionBySegment measured over all cohorts                   KILLED
//   M6  referral term reads total customers again                      KILLED
//   M7  `room` reads organic too (the contract's literal instruction)  KILLED
//   M8  retention blended in WEEKLY space, as §5.3 literally writes it KILLED
//   M9  incentiveDependence 0.62 -> 0                                  KILLED
//   M10 the counterfactual reports current strength, not zero          KILLED
//   M11 incentivised retention can never exceed organic                KILLED
//   M12 resolveIncentivisedAcquisition buys nobody                     KILLED
//   M13 resolveIncentivisedAcquisition draws from the RNG stream       KILLED
//   M14 the tokenUserComposition gate removed (Slice 2's M23 analogue) KILLED
//   M15 no valuation discount: rented users count in full              KILLED
//   M16 valuation discount retuned 0.35 -> 0.5                         KILLED
//   M17 valuation ADDS for rented users instead of discounting         KILLED
//   M18 incentivisedUsers always zero                                  KILLED
//   M19 organicUsers ignores the split                                 KILLED
//   M20 §53 drops the weak-organic-retention condition                 KILLED
//   M21 §53 drops the growth condition                                 KILLED
//   M22 §53 drops the rented-share condition                           KILLED
//   M23 reconciliation reverts to newest-first only                    KILLED  ← the leak this slice found
//   M24 incentive strength in flat dollars, not ARPU                   KILLED
//   M25 incentive strength ignores the rented head count               KILLED
//   M26 every incentive category buys customers                        KILLED
//   M27 the stale incentivised-retention key is never dropped          KILLED
//   M28 retentionSplit reports measured as the counterfactual          KILLED
//   M29 the TokenState mirror stops following the cohorts              KILLED
//   M30 bought customers land in an ORGANIC cohort                     KILLED
//   M31 the §53 warning is never surfaced to the player                KILLED
//   M32 incentivised acquisition ignores market headroom               KILLED
//   M33 incentivised acquisition becomes linear in spend, not sqrt     KILLED
//   M34 organicUserCount stops reading the cohorts (fairValue leak)    KILLED
//   M35 segmentSnapshots shows PMF on the total count                  KILLED
//
// The first version of this file had TWO survivors, M3 and M4 — the §52 exclusion itself. The
// bit-identity assertion computed `organicCustomers` in the test and handed it to
// `derivePmfForSegment`, so it proved the derive function was deterministic and proved nothing at
// all about what the weekly tick passes it. `tickCareerPMF` is now called directly and its own
// `segmentPmf` output inspected. That is the lesson worth keeping: assert on the CALL SITE, not on
// the function you would have to call correctly to reach it.
