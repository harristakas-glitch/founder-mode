// Career balance regressions (Slice −1). Run: npx tsx test/career-balance.test.ts
//
// These pin the three problems `docs/gameplay-review.md` left open, so that each one FAILS if the
// fix is reverted. See `docs/balance-baseline.md` for the diagnosis and the measured before/after.
//
// The bots come from `test/balance-probe.ts` rather than being re-implemented here. That is
// deliberate: a regression test that carries its own private copy of the strategy stops testing
// the thing the sweep measured the moment either copy is edited, and this repo has already shipped
// one test that pasted an engine formula into itself and passed while the game was broken.
//
// Thresholds are set with real headroom under the measured values (recorded beside each), so this
// file fails on a regression, not on noise.

import { play, coast, failed, founderNet } from './balance-probe'
import { resolveSegmentAcquisition, resolveCohortRetention } from '../src/game/career/pmf'
import type { GameState, SectorId } from '../src/game/types'
import type { PricingStrategy, SegmentTruth } from '../src/game/career/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const SEEDS = Array.from({ length: 12 }, (_, i) => 11 * (i + 1))
const WEEKS = 60
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]
const M = (n: number) => '$' + (n / 1e6).toFixed(1) + 'M'

const run = (sector: SectorId, lv: Parameters<typeof play>[2] = {}) => SEEDS.map((s) => play(s, sector, lv, WEEKS).state)
const idle = (sector: SectorId) => SEEDS.map((s) => coast(s, sector, WEEKS).state)

// ---------------------------------------------------------------------------------------------
console.log('— Playing the game beats not playing it (review finding 3) —')
//
// The review reported coasting "surviving" 24/24 against active play's 5–21/24 and read that as
// the premise inverted. It was a measurement error (see the next block), but the property it was
// reaching for is real and worth pinning: the score the game actually reports at the end has to
// reward activity, and it has to reward it by enough that the risk is paid for.

const reference: Record<string, GameState[]> = {}
for (const sector of ['saas', 'social', 'ecommerce'] as SectorId[]) {
  const ref = run(sector)
  reference[sector] = ref
  const co = idle(sector)
  const refNet = ref.map(founderNet)
  const coNet = co.map(founderNet)
  const ratio = median(refNet) / median(coNet)

  // measured: saas 3.9x · social 10.3x · ecommerce 9.8x
  ok(ratio >= 2.5, `${sector}: active play returns ${ratio.toFixed(1)}x coasting's founder net (${M(median(refNet))} vs ${M(median(coNet))})`)

  // The stronger claim, and the one that makes activity a real choice rather than a gamble: a
  // BELOW-median active run still beats the median idle run. If only the lucky quartile of active
  // play beat coasting, "do nothing" would be the correct risk-adjusted line.
  // measured: saas $2.3M · social $16.7M · ecommerce $9.3M against coast medians of $1.6M/$2.0M/$2.4M
  ok(
    pct(refNet, 0.25) > median(coNet),
    `${sector}: a bottom-quartile active run (${M(pct(refNet, 0.25))}) still beats the median coasting run (${M(median(coNet))})`,
  )

  // measured: 0/12 in all three
  ok(ref.filter(failed).length <= 3, `${sector}: active play is not a coin flip — ${ref.filter(failed).length}/12 runs went bankrupt or fired the founder`)
}

// ---------------------------------------------------------------------------------------------
console.log('— An acquisition is an ending, not a death (the metric that produced finding 3) —')
//
// `common()` in every bot harness answers inbox choices with option 0, and option 0 on an
// acquisition offer is *Sell the company*. Both shipped harnesses scored `alive = !gameOver`, so a
// premium exit was recorded as a death, and `Coast` posted a perfect record only because a company
// worth $2M is never offered one (the trigger is a $8M valuation).
//
// The game-side invariant that makes "sold" a win: taking the offer must pay more than the paper
// value of holding. If that ever stops being true the harness reading was accidentally right, and
// this test is what says so.

const sold = Object.values(reference).flat().filter((r) => r.gameOver?.type === 'acquired')
ok(sold.length > 0, `the reference policy actually reaches exits (${sold.length} acquisitions across ${Object.keys(reference).length} sectors)`)
ok(!sold.some(failed), 'no acquisition is classified as a failure')

// Price the offer against the valuation it was actually made on. The offer is created and the
// history row for that week is written from the same `val`, so this is exact — comparing against
// `valuation(r)` at the ENDING instead is off by the week of growth between the two.
const premiums = sold.map((r) => {
  const offer = r.inbox.find((m) => m.meta?.acquisitionAmount !== undefined)!
  const paper = r.history.find((h) => h.week === offer.week)?.valuation ?? 0
  return paper > 0 ? offer.meta!.acquisitionAmount! / paper : 0
})
ok(premiums.every((p) => p > 0), 'every acquisition offer can be priced against the week it was made')
// `premium = 1.1 + 0.9 * growth` then × rand(0.92, 1.12), rounded to the nearest $1M — so a single
// small offer can round marginally under, but none may be a lowball and the median must be a real
// premium. measured: median 1.4x, minimum 0.99x.
ok(
  Math.min(...premiums) >= 0.95,
  `no acquisition is a lowball on the company's own paper value (worst ${Math.min(...premiums).toFixed(2)}x)`,
)
ok(
  median(premiums) >= 1.1,
  `selling pays a real premium over holding — median offer is ${median(premiums).toFixed(2)}x the week's valuation`,
)

// ---------------------------------------------------------------------------------------------
console.log('— No pricing option is dominated (review finding 2) —')
//
// The review measured `always low` against `always premium` while both bots let their beliefs pick
// the SEGMENT — and those beliefs steer at the high-willingness-to-pay end, where pricing low is
// simply wrong. That measures the lever against the wrong market.
//
// Pointed at the market it exists for — the reachable, price-sensitive end every sector has — each
// option has to be the best answer somewhere, or it is not a choice.

// The mechanism, pinned directly. `low` is only ever correct on a reachable, price-sensitive
// segment, and those segments were designed with market-size headroom as their compensating
// advantage — headroom a 90-week campaign never reaches (~2% of the ceiling), so it was worth
// about a percentage point of acquisition while the retention and price penalties were charged
// every week. Referrals are what pay that compensation weekly instead.
{
  const truth: SegmentTruth = {
    needIntensity: 58, willingnessToPay: 24, retentionPotential: 38, acquisitionAccessibility: 84,
    productRequirement: 30, marketSize: 78, competitiveIntensity: 62, salesCycleWeeks: 1, expansionPotential: 14,
  }
  const base = {
    truth, productFit: 80, marketingSpend: 6_000, hype: 20, ceiling: 88_636,
    marketingPenalty: 1, acqScale: 1, rng: () => 0.5,
  }
  const at = (customers: number, priceFit: number) => resolveSegmentAcquisition({ ...base, currentCustomers: customers, priceFit })

  // A base of customers has to bring more customers, or volume is worth nothing until the ceiling.
  ok(at(1_500, 97) > at(0, 97), `an existing customer base drives acquisition (${at(0, 97)} → ${at(1_500, 97)} new customers/wk at 1,500 held)`)

  // And it has to be the PRICE that switches the engine on, or `low` is not a trade-off — it is
  // just a discount. Referral volume converts through the same price-fit term as everything else.
  const lift = (priceFit: number) => at(1_500, priceFit) - at(0, priceFit)
  ok(
    lift(97) >= lift(13) * 3,
    `underpricing a reachable segment is what makes referrals pay: +${lift(97)}/wk priced for them vs +${lift(13)}/wk priced above them`,
  )

  // Bounded by construction: the referral rate per customer must stay under the weekly churn rate
  // for this segment, or growth becomes self-sustaining and the loop has no restoring force.
  const keep = resolveCohortRetention({ truth, productFit: 80, priceFit: 97, bugs: 20, weeksSinceAcquired: 8 })
  const referralPerCustomer = (at(1_500, 97) - at(0, 97)) / 1_500
  ok(
    referralPerCustomer < 1 - keep,
    `referrals amplify growth but can never sustain it: ${(referralPerCustomer * 100).toFixed(2)}%/wk referred against ${((1 - keep) * 100).toFixed(2)}%/wk churned`,
  )
}

const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social']
const netFor = (sector: SectorId, pricing: PricingStrategy, target: 'cheapest' | 'richest') =>
  median(run(sector, { pricing, target }).map(founderNet))

for (const sector of ALL) {
  const lo = { low: netFor(sector, 'low', 'cheapest'), market: netFor(sector, 'market', 'cheapest'), premium: netFor(sector, 'premium', 'cheapest') }
  // measured margins over `market` on the cheapest segment: 2.4x saas · 1.6x devtools · 2.1x
  // ecommerce · 1.6x fintech · 2.9x social. The bar sits at 1.35x: comfortably under the measured
  // minimum, and above the 1.0-1.2x those same sectors show with the referral term disabled.
  ok(
    lo.low > lo.market * 1.35 && lo.low > lo.premium * 1.35,
    `${sector}: on the price-sensitive segment, LOW pricing wins (${M(lo.low)} vs market ${M(lo.market)}, premium ${M(lo.premium)})`,
  )
}

for (const sector of ALL) {
  const hi = { low: netFor(sector, 'low', 'richest'), market: netFor(sector, 'market', 'richest'), premium: netFor(sector, 'premium', 'richest') }
  // The other end has to stay true too, or "fix low" has simply moved the dominated option.
  ok(
    hi.premium > hi.market * 1.25 && hi.premium > hi.low * 1.25,
    `${sector}: on the high-willingness-to-pay segment, PREMIUM pricing wins (${M(hi.premium)} vs market ${M(hi.market)}, low ${M(hi.low)})`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— Social is not structurally harder than the rest (review finding 5) —')
//
// The review could not separate "Social is hard" from "the bots' revenue-denominated hiring rule is
// wrong for Social", because turning hiring off took Social from 10/24 to 19/24 "alive". Both
// numbers were counts of unsold companies. On bankruptcies there was nothing to explain.

const socialRef = reference.social
const saasRef = reference.saas
const socialNoHire = run('social', { hire: false })
const socialMargin = run('social', { marginHiring: true })

// measured: social 0/12, saas 0/12
ok(
  socialRef.filter(failed).length <= saasRef.filter(failed).length + 2,
  `social fails ${socialRef.filter(failed).length}/12 against saas's ${saasRef.filter(failed).length}/12 — not a harder sector`,
)
// measured: 0/12 with hiring, 0/12 without. The lever the review suspected does nothing here.
ok(
  Math.abs(socialRef.filter(failed).length - socialNoHire.filter(failed).length) <= 2,
  `hiring is not what kills Social companies (${socialRef.filter(failed).length}/12 with hires vs ${socialNoHire.filter(failed).length}/12 without)`,
)
// A margin-denominated rule is allowed to be better — it should not be a rescue, because there is
// nothing to rescue. measured: $20.5M revenue-denominated vs $23.9M margin-denominated.
ok(
  socialMargin.filter(failed).length <= 3,
  `a margin-denominated hiring rule does not change the picture either (${socialMargin.filter(failed).length}/12 failed, net ${M(median(socialMargin.map(founderNet)))})`,
)

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
