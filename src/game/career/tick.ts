// The Career week: experiments finish, evidence lands, customers arrive and leave.
//
// This replaces Quick Play's single-number PMF/acquisition step when `detailedPMF` is on. It
// deliberately reuses the shared simulation for everything else (cash, payroll, product work,
// events, board, valuation) — Career is a different lens on the same company, not a fork.

import type { GameState } from '../types'
import type { CareerPMFState, CausalExplanation, SegmentId } from './types'
import {
  addJournal,
  biggestUncertainty,
  cohortDecaysApplied,
  cohortIsOrganic,
  derivePmfForSegment,
  experimentDef,
  experimentAnswered,
  EXPERIMENT_ANSWERS,
  incentivisedCustomers,
  METRIC_LABEL,
  organicCustomers,
  resolveCohortRetention,
  RETENTION_WINDOW_WEEKS,
  resolveExperiment,
  resolveSegmentAcquisition,
  expansionMultiplier,
  revenueMultiplier,
  segmentCeiling,
  segmentDef,
  segmentPriceFit,
  segmentProductFit,
  segmentsForSector,
  startExperiment,
  totalCustomers,
  updateBelief,
  type SegmentPmf,
} from './pmf'
import { PMF_LABEL } from './pmf'
// ICO Slice 3. Career owns the cohort list; the token module owns the token maths. Nothing
// imported here draws from the RNG stream — see the header of token/users.ts.
import {
  incentiveContext,
  incentivisedKeepRate,
  mercenaryGrowthWarning,
  resolveIncentivisedAcquisition,
} from '../token/users'
import { TOKEN_USERS } from '../token/types'

export interface CareerTickResult {
  customers: number
  companyPmfScore: number
  revenueMultiplier: number
  segmentPmf: SegmentPmf[]
  productCapacityDrain: number // 0–1 of engineering output eaten by running experiments
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Career's dollars-to-customers scale for a sector, from Quick Play's `acqBase`.
 *
 * `acqBase / 5` was the whole rule, and it is the same unit hazard `careerArpu` was added to fix on
 * the revenue side: `acqBase` is calibrated for Quick Play's tens-of-thousands user counts, and
 * dividing by 5 re-used it on Career's hundreds-scale cohorts. Revenue got recalibrated per sector;
 * acquisition never did. Measured consequence (test/token-balance-probe.ts): the token path's edge
 * over traditional ranked PERFECTLY with this scale — Social 24 → 6.0x, E-commerce 4 → 2.5x,
 * Dev Tools 1.6 → 1.6x, Fintech 1.2 → 1.3x, SaaS 1 → 1.06x — because any early capital injection
 * compounds through it (the fork's week-13 sale bought 61k users against traditional's 13k on the
 * same seeds). It also made Social the always-right SECTOR pick: $40M median, zero failures,
 * double the field.
 *
 * The fix is a knee, not a curve: at or below `HUMAN_SCALE` the old expression is returned to the
 * bit, so four of five sectors — every one whose Career economy was tuned and measured in
 * docs/balance-baseline.md — are untouched. Above it, the excess is compressed with a soft power.
 * A straight exponent was measured and rejected: 0.6-0.8 across the board closed the gap in exact
 * proportion to how badly it damaged E-commerce's and Social's own traditional health (E-commerce
 * $20M → $9.5M at 0.8), because their whole economies lean on the efficiency, not just the exploit.
 * The knee only reaches the range where capital compounds super-linearly.
 */
export const CAREER_ACQ = { humanScale: 5, excessExponent: 0.6, floor: 0.4 } as const
export function careerAcqScale(acqBase: number): number {
  const raw = acqBase / 5
  const scaled = raw <= CAREER_ACQ.humanScale ? raw : CAREER_ACQ.humanScale + Math.pow(raw - CAREER_ACQ.humanScale, CAREER_ACQ.excessExponent)
  return Math.max(CAREER_ACQ.floor, scaled)
}

/**
 * Advance the Career PMF subsystem by one week. Mutates `s` (which is already a clone inside
 * advanceWeek) and returns the numbers the shared simulation needs.
 */

/**
 * How much of this week's engineering output Career eats: experiments consume real product
 * capacity, and a repositioning halves velocity while the roadmap is rebuilt. Computed
 * separately from the weekly tick because the engineering block runs BEFORE it.
 */
export function careerProductDrag(s: GameState): number {
  const c = s.career
  if (!c) return 1
  const expDrain = c.activeExperiments.filter((e) => e.status === 'active').reduce((a, e) => a + e.productCapacityCost, 0)
  const repos = c.repositioning ? c.repositioning.productPenalty : 1
  return Math.max(0.3, (1 - Math.min(0.7, expDrain)) * repos)
}

/** Marketing budget consumed by running experiments — a landing page test buys its own ads. */
export function careerMarketingDrain(s: GameState): number {
  const c = s.career
  if (!c) return 0
  return c.activeExperiments.filter((e) => e.status === 'active').reduce((a, e) => a + e.marketingCapacityCost, 0)
}

export function tickCareerPMF(
  s: GameState,
  opts: { sectorTam: number; sectorAcqBase: number; marketingSpend: number; rng: () => number; uid: () => string },
): CareerTickResult {
  const career = s.career as CareerPMFState
  const { sectorTam, sectorAcqBase, marketingSpend, rng, uid } = opts
  const sector = s.sector
  const segs = segmentsForSector(sector)
  const target = career.primaryTargetSegmentId

  // Reconcile first. Events, viral moments and arcs award users straight onto s.users, and
  // those people belong to no cohort — without this they would silently disappear the moment
  // the cohort total is written back. Absorb them into the target segment instead.
  const tracked = totalCustomers(career)
  if (s.users > tracked) {
    career.cohorts.push({
      id: uid(),
      acquiredWeek: s.week,
      segmentId: target,
      startingCustomers: s.users - tracked,
      activeCustomers: s.users - tracked,
      exactCustomers: s.users - tracked,
      acquisitionCost: 0,
      priceAtAcquisition: career.pricing === 'low' ? 26 : career.pricing === 'premium' ? 82 : 52,
      productQualityAtAcquisition: s.quality,
    })
  } else if (s.users < tracked && tracked > 0) {
    // Something removed users (a churn event, an outage, a rival's price war) — take it off the
    // newest cohorts.
    //
    // ICO SLICE 3, AND THIS WAS A REAL §52 LEAK, FOUND BY MEASUREMENT RATHER THAN BY READING.
    //
    // Incentivised cohorts are pushed AFTER the organic one each week, so they sit at the end of
    // the array — and this loop walks from the end. Left alone, every company-wide user loss was
    // absorbed ENTIRELY by the rented population, and the damage to `exactCustomers` never reached
    // an organic cohort's four-week snapshot. Buying users therefore acted as a shock absorber for
    // the one number §52 protects. Measured on devtools/20260810 over 80 weeks: organic four-week
    // retention read 72.6% with maximum incentive spend against 53.8% for the identical zero-spend
    // control, and company PMF 64 against 47. The organic cohorts were the same cohorts, acquired
    // in the same weeks, at the same sizes — only the shocks had been redirected.
    //
    // The fix is to split the loss between the two populations in PROPORTION TO THEIR SIZE, then
    // walk newest-first within each exactly as before. With no incentivised cohort the rented share
    // is 0, the organic pass sees every cohort, and the arithmetic is character-for-character what
    // it was — which is why `npm run bots` is byte-identical.
    const rented = incentivisedCustomers(career)
    /**
     * Remove `n` customers from the cohorts `pick` selects, IN PROPORTION TO THEIR SIZE.
     *
     * This walked newest-first and emptied each cohort before touching the next, which meant every
     * company-wide loss landed almost entirely on the youngest cohort — and the youngest cohort is
     * precisely the one about to freeze its four-week snapshot. Measured across 6 runs and 4
     * sectors: every shock week hit exactly 1.00 cohort out of 25-41 live, so a 2.86% segment-wide
     * loss arrived as a 53.1% loss to one cohort's permanent record.
     *
     * That is the whole of the PMF oscillation the owner kept reporting as "it goes up then down".
     * Decomposed on seed 4242, the clean product signal rose almost monotonically 66.5% -> 83.4%
     * over seventy weeks with a consecutive-cohort dispersion of 0.35pp; as shipped it read 12.10pp
     * and swung 39-83%. The estimator was also BIASED -4.21pp, not merely noisy.
     *
     * Proportional attribution is both quieter and more truthful — an outage does not preferentially
     * target people who signed up nine days ago. Measured: RMSE 5.55 -> 2.03pp, bias -4.21 -> -1.73,
     * week-to-week jitter 1.13 -> 0.25pp, and it costs ZERO responsiveness: a real step still shows
     * up half-way in 12 weeks, exactly as before. Longer averaging windows bought less for 9-11
     * weeks of lag, and a minimum cohort size was measurably useless (median cohort is 696 people).
     */
    const drain = (n: number, pick: (c: (typeof career.cohorts)[number]) => boolean): number => {
      const picked = career.cohorts.filter((c) => pick(c) && c.activeCustomers > 0)
      const pool = picked.reduce((a, c) => a + c.activeCustomers, 0)
      if (pool <= 0 || n <= 0) return 0
      let left = Math.min(n, pool)
      const removed = left
      // Largest first, so the rounding remainder lands where it is proportionally smallest.
      for (const c of [...picked].sort((a, b) => b.activeCustomers - a.activeCustomers)) {
        if (left <= 0) break
        const share = Math.min(c.activeCustomers, left, Math.max(1, Math.round((removed * c.activeCustomers) / pool)))
        c.activeCustomers -= share
        // keep the unrounded count in step, or decay would resurrect the people we just removed
        c.exactCustomers = Math.max(0, (c.exactCustomers ?? c.activeCustomers + share) - share)
        left -= share
      }
      // Whatever rounding left over comes off the largest cohort that can still absorb it.
      for (const c of [...picked].sort((a, b) => b.activeCustomers - a.activeCustomers)) {
        if (left <= 0) break
        const take = Math.min(c.activeCustomers, left)
        c.activeCustomers -= take
        c.exactCustomers = Math.max(0, (c.exactCustomers ?? c.activeCustomers + take) - take)
        left -= take
      }
      return removed - left
    }
    let toRemove = tracked - s.users
    const rentedQuota = Math.min(toRemove, Math.round(toRemove * (rented / tracked)))
    toRemove -= drain(toRemove - rentedQuota, cohortIsOrganic)
    // Whatever the organic side could not absorb spills to the rented side, and vice versa: the
    // total removed is unchanged, only its attribution is fair.
    toRemove -= drain(toRemove, (c) => !cohortIsOrganic(c))
    drain(toRemove, cohortIsOrganic)
  }

  const before = totalCustomers(career)
  const beforeRetention = career.retentionBySegment[target] ?? 0

  // --- repositioning cools off ------------------------------------------------------------
  if (career.repositioning) {
    career.repositioning.remainingWeeks -= 1
    if (career.repositioning.remainingWeeks <= 0) career.repositioning = undefined
  }
  const marketingPenalty = career.repositioning ? career.repositioning.marketingPenalty : 1
  const productPenalty = career.repositioning ? career.repositioning.productPenalty : 1

  // --- experiments -------------------------------------------------------------------------
  // Who runs a study changes what it is worth. Designers do user research for a living, so they
  // count triple; everyone else contributes as a body in the room. Previously headcount of any
  // kind counted the same, which made "should I hire a designer for discovery?" a question with
  // no answer.
  const researchHeads = s.employees.reduce((a, e) => a + (e.role === 'designer' ? 3 : e.role === 'marketer' ? 1.5 : 1), 0)
  const executionQuality = clamp01(0.25 + (s.quality / 100) * 0.4 + Math.min(0.35, researchHeads * 0.035))
  let productCapacityDrain = 0
  let learned: string | null = null

  for (const exp of career.activeExperiments) {
    if (exp.status !== 'active') continue
    productCapacityDrain += exp.productCapacityCost
    if (s.week < exp.completionWeek) continue

    exp.status = 'complete'
    const truth = career.segmentTruth[exp.segmentId]
    const evidence = resolveExperiment(exp, truth, executionQuality, rng, uid, s.week)
    const segName = segmentDef(sector, exp.segmentId).name
    const def = experimentDef(exp.type)

    const confBefore = career.segmentBeliefs[exp.segmentId][evidence[0].metric].confidence
    for (const ev of evidence) {
      career.evidence.unshift(ev)
      career.segmentBeliefs[exp.segmentId][ev.metric] = updateBelief(career.segmentBeliefs[exp.segmentId][ev.metric], ev)
    }
    if (career.evidence.length > 120) career.evidence.length = 120
    const confAfter = career.segmentBeliefs[exp.segmentId][evidence[0].metric].confidence

    learned = `${def.name} on ${segName}: ${evidence[0].summary}`
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `🔬 ${def.name} complete — ${segName}`,
      body:
        evidence.map((e) => `• ${e.summary}`).join('\n') +
        `\n\nConfidence on ${evidence[0].metric === 'willingnessToPay' ? 'willingness to pay' : 'the headline question'}: ` +
        `${Math.round(confBefore * 100)}% → ${Math.round(confAfter * 100)}%.` +
        // The single most-asked question about this screen: what did that DO? Answer it in the
        // message rather than making the player infer it from a number that did not move.
        `\n\nWhat this changes: what you BELIEVE about ${segName}, not what they are. It does not move ` +
        `PMF on its own — PMF is scored on customers who stay. What it buys you is knowing where to ` +
        `aim before you spend the quarter building for the wrong people.`,
    })
    addJournal(career, {
      week: s.week,
      category: 'discovery',
      title: `${def.name} — ${segName}`,
      description: evidence[0].summary,
      relatedSegmentId: exp.segmentId,
    })
  }
  // Standing studies renew themselves while the cash lasts. Discovery is a programme you fund,
  // not a button you press every three weeks — but a programme finishes.
  for (const done of career.activeExperiments) {
    if (done.status !== 'complete' || !done.standing) continue
    const def = experimentDef(done.type)
    // Retire once the study has answered what it was for. Belief gains scale with
    // `(1 − confidence)`, so past its bar a renewal charges full price for nothing measurable:
    // measured over 24 seeds × 5 sectors, flagging every experiment standing cost 37–72% of median
    // founder net and up to 10/24 runs' survival against the identical strategy without it.
    if (experimentAnswered(career, done.type, done.segmentId)) {
      const { metric, bar } = EXPERIMENT_ANSWERS[done.type]
      const conf = career.segmentBeliefs[done.segmentId][metric].confidence
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: `Standing study concluded — ${def.name}`,
        body:
          `The rolling ${def.name.toLowerCase()} on ${segmentDef(sector, done.segmentId).name} has answered its question: ` +
          `confidence on ${METRIC_LABEL[metric].toLowerCase()} is ${Math.round(conf * 100)}%, past the ${Math.round(bar * 100)}% ` +
          `where more of the same instrument stops moving the number. It has been retired rather than renewed, ` +
          `saving ${'$'}${def.cashCost.toLocaleString()} a cycle. Point the budget at a question you cannot yet answer.`,
      })
      addJournal(career, {
        week: s.week,
        category: 'discovery',
        title: `Retired: standing ${def.name.toLowerCase()}`,
        description: `${METRIC_LABEL[metric]} on ${segmentDef(sector, done.segmentId).name} reached ${Math.round(conf * 100)}% confidence. Further repeats of this study buy nothing.`,
        relatedSegmentId: done.segmentId,
      })
      continue
    }
    if (s.cash < def.cashCost * 1.5) {
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: `Standing study paused — ${def.name}`,
        body: `The rolling ${def.name.toLowerCase()} on ${segmentDef(sector, done.segmentId).name} has stopped: it costs ${'$'}${def.cashCost.toLocaleString()} a cycle and the account cannot carry it. Restart it from Discovery when there is room.`,
      })
      continue
    }
    s.cash -= def.cashCost
    startExperiment(career, s.week, done.type, done.segmentId, uid(), true)
  }
  career.activeExperiments = career.activeExperiments.filter((e) => e.status === 'active')

  // --- customers ---------------------------------------------------------------------------
  // Deals whose sales cycle has completed land first: they become paying cohorts THIS week, so
  // they are decayed this week (exactly the arrival semantics a directly-pushed cohort always
  // had), they feed this week's `room` and referral terms, and their snapshot fields are the
  // ones taken when the deal was won. No RNG is drawn here — the draws all happened the week
  // the deal was won — so the weekly draw count is unchanged whatever the pipeline holds.
  if (career.pipeline?.length) {
    const due = career.pipeline.filter((p) => p.landWeek <= s.week)
    if (due.length) {
      career.pipeline = career.pipeline.filter((p) => p.landWeek > s.week)
      for (const p of due) {
        career.cohorts.push({
          id: uid(),
          acquiredWeek: s.week,
          segmentId: p.segmentId,
          startingCustomers: p.customers,
          activeCustomers: p.customers,
          exactCustomers: p.customers,
          acquisitionCost: p.acquisitionCost,
          priceAtAcquisition: p.priceAtAcquisition,
          productQualityAtAcquisition: p.productQualityAtAcquisition,
        })
      }
    }
  }

  const targetTruth = career.segmentTruth[target]
  const targetFit = segmentProductFit(targetTruth, s.quality, career.focus, sector, target)
  const targetPrice = segmentPriceFit(targetTruth, career.pricing)
  const ceiling = segmentCeiling(targetTruth, sectorTam)

  const acquired = resolveSegmentAcquisition({
    truth: targetTruth,
    productFit: targetFit,
    priceFit: targetPrice,
    marketingSpend,
    hype: s.hype,
    // ICO Slice 3, docs/ico-architecture.md §5.1, with the contract's one unbuildable instruction
    // resolved — see `referralCustomers` in pmf.ts. The TOTAL feeds `room`, because the market is
    // full whoever paid to fill it; ORGANIC feeds the referral term, because a customer who was
    // paid to be here does not evangelise. `organicCustomers === totalCustomers` whenever no
    // incentivised cohort exists, so this is a no-op for every non-token run BY CONSTRUCTION.
    currentCustomers: totalCustomers(career, target),
    referralCustomers: organicCustomers(career, target),
    ceiling,
    marketingPenalty,
    acqScale: careerAcqScale(sectorAcqBase),
    rng,
  })

  if (acquired > 0) {
    // `salesCycleWeeks` wired in (gameplay-review finding 6). Customers this week's spend WON
    // land `salesCycleWeeks − 1` weeks from now: a 1-week cycle is interest and money inside the
    // same tick — the exact code path that always existed, byte for byte, so the reachable
    // low-end segments (Freelancers, Individual Developers, …, all cycle 1) are untouched and
    // only the genuinely long-cycle end of the market gets SLOW. The snapshot fields are taken
    // now, when the deal is won; the cohort starts churning when it lands, because a customer
    // cannot leave before they have arrived.
    const lag = Math.max(0, Math.round(targetTruth.salesCycleWeeks) - 1)
    if (lag === 0) {
      career.cohorts.push({
        id: uid(),
        acquiredWeek: s.week,
        segmentId: target,
        startingCustomers: acquired,
        activeCustomers: acquired,
        exactCustomers: acquired,
        acquisitionCost: marketingSpend,
        priceAtAcquisition: career.pricing === 'low' ? 26 : career.pricing === 'premium' ? 82 : 52,
        productQualityAtAcquisition: s.quality,
      })
    } else {
      ;(career.pipeline ??= []).push({
        landWeek: s.week + lag,
        segmentId: target,
        customers: acquired,
        acquisitionCost: marketingSpend,
        priceAtAcquisition: career.pricing === 'low' ? 26 : career.pricing === 'premium' ? 82 : 52,
        productQualityAtAcquisition: s.quality,
      })
    }
  }

  // --- incentivised acquisition (ICO Slice 3) -----------------------------------------------
  // A SEPARATE ADDITIVE TERM, in a separate function, with no shared coefficients: two functions,
  // two populations. Pure and noiseless, so a Career week draws the same number of times whether or
  // not the token capability is on — see the determinism note in token/users.ts.
  const incentives = incentiveContext(s, incentivisedCustomers(career))
  if (incentives.active && incentives.reward > 0) {
    const bought = resolveIncentivisedAcquisition({
      truth: targetTruth,
      productFit: targetFit,
      // `reward`, NOT `dollars`. The budget that buys customers has the token price taken out of it;
      // `dollars` is what the same tokens cost the treasury at the market price, and it is recorded
      // below as the cohort's acquisition cost. See `rewardBudget` in token/users.ts.
      rewardBudget: incentives.reward,
      currentCustomers: totalCustomers(career, target),
      ceiling,
      marketingPenalty,
      acqScale: careerAcqScale(sectorAcqBase),
    })
    if (bought > 0) {
      career.cohorts.push({
        id: uid(),
        acquiredWeek: s.week,
        segmentId: target,
        startingCustomers: bought,
        activeCustomers: bought,
        exactCustomers: bought,
        // The cost is denominated in tokens and paid out of the treasury, not out of `marketingSpend`.
        acquisitionCost: incentives.dollars,
        priceAtAcquisition: career.pricing === 'low' ? 26 : career.pricing === 'premium' ? 82 : 52,
        productQualityAtAcquisition: s.quality,
        origin: 'incentivised',
      })
    }
  }

  // How hard the rewards are running THIS week, per incentivised head AFTER this week's buying —
  // so the same budget spread over a bigger rented base buys each of them less. That is loop A's
  // third restoring force where a player can feel it: sustaining a large incentivised population
  // needs accelerating spend against a treasury that is draining.
  const incentiveStrengthNow = incentives.active
    ? incentiveContext(s, incentivisedCustomers(career)).strength
    : 0

  // --- retention, per cohort ---------------------------------------------------------------
  // Aggregate growth can hide a rotting base — that is exactly what cohorts are for.
  let churnedTotal = 0
  for (const c of career.cohorts) {
    const truth = career.segmentTruth[c.segmentId]
    if (!truth) continue
    const fit = segmentProductFit(truth, s.quality, career.focus, sector, c.segmentId)
    const price = segmentPriceFit(truth, career.pricing)
    const keepOrganic = resolveCohortRetention({ truth, productFit: fit, priceFit: price, bugs: s.bugs, weeksSinceAcquired: s.week - c.acquiredWeek })
    // `resolveCohortRetention` gains NO argument (docs/ico-architecture.md §5.3): it answers "what
    // would the product hold?" for this cohort's segment, exactly as it always did, and the token
    // module bends the answer. While the rewards run, an incentivised cohort retains BETTER than an
    // organic one; the week the spend stops it falls to 0.38× the organic four-week rate.
    const keep = cohortIsOrganic(c) ? keepOrganic : incentivisedKeepRate(keepOrganic, incentiveStrengthNow)
    const before = c.activeCustomers
    // Decay the unrounded count, then round only for display. Rounding first let a cohort of a
    // handful of people survive intact week after week and report perfect retention.
    const exact = Math.max(0, (c.exactCustomers ?? c.activeCustomers) * keep)
    c.exactCustomers = exact
    c.activeCustomers = Math.max(0, Math.round(exact))
    churnedTotal += before - c.activeCustomers
    // Freeze this cohort's four-week number once it has been charged exactly four weeks of churn.
    // Measuring "everything older than 4 weeks" instead made the metric lifetime survival, which
    // decays forever — so retention (and therefore PMF) could only ever fall.
    //
    // The count is DECAYS APPLIED, not calendar age, and the two differ by one: a cohort is pushed
    // and then decayed in this same loop on the week it arrives, so its acquisition week is its
    // first week of churn. The old condition (`s.week - c.acquiredWeek >= 4`) waited for a fifth
    // decay — four inside the `weeksSinceAcquired < RETENTION_WINDOW_WEEKS` honeymoon and one
    // outside it — and froze that as "four-week retention". It understated every reading in the
    // game by ~4.7pp and PMF by ~4 points (docs/pmf-why-it-is-stuck.md §7).
    if (
      c.retentionAt4wk === undefined &&
      cohortDecaysApplied(s.week, c.acquiredWeek) >= RETENTION_WINDOW_WEEKS &&
      c.startingCustomers > 0
    ) {
      // off the exact count: `3/3 = 100%` on a rounded cohort is a rounding artifact, not evidence
      c.retentionAt4wk = clamp01(exact / c.startingCustomers)
    }
  }
  career.cohorts = career.cohorts.filter((c) => c.activeCustomers > 0).slice(-60)

  // --- 4-week retention, measured per segment ----------------------------------------------
  // SPLIT, from ICO Slice 3. `retentionBySegment` keeps its name and its meaning and is now
  // measured over ORGANIC cohorts only — which is bit-identical for any run that has none, because
  // absent `origin` IS organic. It is the number that feeds PMF. The incentivised measure is a
  // second, optional record that never does.
  for (const seg of segs) {
    // Average the most recent cohorts' four-week snapshots, weighted by size. This tracks
    // whether the company is getting BETTER at keeping people, and rises when fit improves.
    const measured = career.cohorts.filter((c) => c.segmentId === seg.id && c.retentionAt4wk !== undefined && cohortIsOrganic(c)).slice(-10)
    const weight = measured.reduce((a, c) => a + c.startingCustomers, 0)
    career.retentionBySegment[seg.id] =
      weight > 0
        ? clamp01(measured.reduce((a, c) => a + c.retentionAt4wk! * c.startingCustomers, 0) / weight)
        : (career.retentionBySegment[seg.id] ?? 0)

    // The key is CREATED only once an incentivised cohort has actually produced a four-week
    // number, so a traditional save never grows it (docs/ico-architecture.md §2: no reader creates
    // a sub-slice it does not own).
    const bought = career.cohorts.filter((c) => c.segmentId === seg.id && c.retentionAt4wk !== undefined && !cohortIsOrganic(c)).slice(-10)
    const boughtWeight = bought.reduce((a, c) => a + c.startingCustomers, 0)
    if (boughtWeight > 0 && incentiveStrengthNow > 0) {
      const split = (career.retentionBySegmentIncentivised ??= {})
      split[seg.id] = clamp01(bought.reduce((a, c) => a + c.retentionAt4wk! * c.startingCustomers, 0) / boughtWeight)
    } else if (career.retentionBySegmentIncentivised) {
      // AND IT IS DROPPED the week the rewards stop, or the week the last rented customer leaves.
      //
      // `retentionBySegment` legitimately holds its last value when a segment goes quiet — organic
      // retention is a property of the product, and the product did not stop existing. An
      // incentivised measurement is not: `retentionAt4wk` is frozen at four weeks old by design, so
      // a cohort snapshotted WHILE IT WAS BEING PAID keeps reporting its paid number long after the
      // payments end. Measured, that made the screen read 62–67% incentivised retention for twenty
      // weeks after the rewards were cut and the population had evaporated — while the forecast
      // beside it correctly said 23%. Two numbers about the same vanished people, disagreeing.
      //
      // "Incentivised retention" only means anything while incentives are running. When they are
      // not, the honest number is the counterfactual, and dropping the key is what makes
      // `retentionSplit` fall back to it.
      delete career.retentionBySegmentIncentivised[seg.id]
    }
  }
  if (career.retentionBySegmentIncentivised && Object.keys(career.retentionBySegmentIncentivised).length === 0)
    career.retentionBySegmentIncentivised = undefined

  // --- derived PMF, per segment ------------------------------------------------------------
  const segmentPmf = segs.map((seg) => {
    const truth = career.segmentTruth[seg.id]
    return derivePmfForSegment({
      segmentId: seg.id,
      // §52, and the reason this whole slice exists. ORGANIC CUSTOMERS AND ORGANIC RETENTION ONLY —
      // EXCLUSION, NOT WEIGHTING. Any weight, however small, means enough incentive spend still
      // buys Strong PMF; exclusion makes the guarantee structural, and testable as a bit-identity:
      // with the organic cohorts held fixed, this call returns the same result for ANY spend.
      customers: organicCustomers(career, seg.id),
      retention4wk: career.retentionBySegment[seg.id] ?? 0,
      priceFit: segmentPriceFit(truth, career.pricing),
      productFit: segmentProductFit(truth, s.quality, career.focus, sector, seg.id),
      truth,
      beliefs: career.segmentBeliefs[seg.id],
      ceiling: segmentCeiling(truth, sectorTam),
    })
  })
  // The company is only as validated as its best *proven* segment.
  const best = [...segmentPmf].sort((a, b) => b.score - a.score)[0]
  const customers = totalCustomers(career)

  // --- explanations ------------------------------------------------------------------------
  const explanations: CausalExplanation[] = []
  const netDelta = customers - before
  const retentionNow = career.retentionBySegment[target] ?? 0
  const targetName = segmentDef(sector, target).name

  if (churnedTotal > acquired * 0.6 && churnedTotal > 5) {
    explanations.push({
      metric: 'retention',
      direction: 'down',
      primaryCause:
        targetPrice < 55
          ? `${targetName} are leaving: at this price they don't stay long enough to pay back what you spent winning them.`
          : targetFit < 50
            ? `${targetName} are leaving because the product doesn't yet clear their bar.`
            : `${targetName} churn quickly by nature — this segment simply doesn't hold.`,
      secondaryCauses: [`${churnedTotal.toLocaleString()} customers churned against ${acquired.toLocaleString()} acquired.`],
    })
  }
  if (acquired > 0 && netDelta > 0 && retentionNow > 0 && retentionNow < 0.6) {
    explanations.push({
      metric: 'acquisition',
      direction: 'up',
      primaryCause: `Customer count is rising, but ${targetName} retention is only ${Math.round(retentionNow * 100)}% — this growth is rented, not owned.`,
      secondaryCauses: ['Spending harder here buys a bigger leak, not a bigger company.'],
    })
  }
  if (targetPrice < 45) {
    explanations.push({
      metric: 'conversion',
      direction: 'down',
      primaryCause: `Your price is well above what ${targetName} will pay, so most of the interest you generate never converts.`,
      secondaryCauses: [],
    })
  }

  // --- brief §53: token-driven growth (ICO Slice 3) -----------------------------------------
  // "User growth is strong. However, organic retention remains weak. Most recent growth appears
  // incentive-driven." The predicate is pure and lives in the token module; this decides when to
  // SAY it. It goes at the FRONT of the explanations because when it is true it is the only thing
  // about the week that matters.
  const mercenary = mercenaryGrowthWarning(s)
  if (mercenary) {
    const pct = (v: number) => `${Math.round(v * 100)}%`
    explanations.unshift({
      metric: 'pmf',
      direction: 'flat',
      primaryCause:
        `User growth is strong — up ${pct(mercenary.growth)} over ${TOKEN_USERS.warnWindowWeeks} weeks — but ` +
        `${pct(mercenary.incentivisedShare)} of ${targetName} are here for the rewards, and organic ` +
        `retention is only ${pct(mercenary.organicRetention)}. Most recent growth is incentive-driven.`,
      secondaryCauses: [
        `Incentivised retention reads ${pct(mercenary.incentivisedRetention)} while the rewards run.`,
        `If they stopped, expect ${pct(mercenary.expectedWithoutIncentives)}.`,
      ],
    })
    // Said once, then not again for a while: it is a lesson, not a nag.
    const lastWarned = career.journal.find((j) => j.title.startsWith('Token-driven growth'))
    if (!lastWarned || s.week - lastWarned.week >= TOKEN_USERS.warnCooldownWeeks) {
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: 'Token-driven growth',
        body:
          `User growth is strong: ${targetName} are up ${pct(mercenary.growth)} over the last ${TOKEN_USERS.warnWindowWeeks} weeks.\n\n` +
          `However, organic retention remains weak — ${pct(mercenary.organicRetention)} at four weeks. ` +
          `${mercenary.incentivisedUsers.toLocaleString()} of them (${pct(mercenary.incentivisedShare)}) are being paid to be here, ` +
          `and while the rewards run they retain at ${pct(mercenary.incentivisedRetention)}.\n\n` +
          `If the rewards stopped, expect ${pct(mercenary.expectedWithoutIncentives)}.\n\n` +
          `Most recent growth appears incentive-driven. None of it counts toward product-market fit, ` +
          `because a customer who stays to collect a reward is not evidence that the product is worth staying for.`,
      })
      addJournal(career, {
        week: s.week,
        category: 'milestone',
        title: `Token-driven growth — ${targetName}`,
        description:
          `${pct(mercenary.incentivisedShare)} of the segment is incentivised. Organic retention ${pct(mercenary.organicRetention)}; ` +
          `expected retention without incentives ${pct(mercenary.expectedWithoutIncentives)}.`,
        relatedSegmentId: mercenary.segmentId,
      })
    }
  }

  career.lastExplanations = explanations.slice(0, 3)

  // --- founder briefing --------------------------------------------------------------------
  career.lastBriefing = {
    week: s.week,
    customersDelta: netDelta,
    revenueDeltaPct: 0, // filled by advanceWeek once the shared revenue formula has run
    retentionDeltaPct: Math.round(((retentionNow - beforeRetention) * 100 + Number.EPSILON) * 10) / 10,
    why: explanations[0]?.primaryCause ?? `Steady week targeting ${targetName}.`,
    learned,
    uncertainty: biggestUncertainty(career, sector),
  }

  // --- milestones worth remembering ---------------------------------------------------------
  const bestLabel = PMF_LABEL[best.status]
  const lastMilestone = career.journal.find((j) => j.category === 'milestone' && j.title.startsWith('PMF'))
  if ((best.status === 'strong' || best.status === 'scalable') && !lastMilestone) {
    addJournal(career, {
      week: s.week,
      category: 'milestone',
      title: `PMF: ${bestLabel} in ${segmentDef(sector, best.segmentId).name}`,
      description: `Retention held at ${Math.round(best.retention4wk * 100)}% across ${best.customers.toLocaleString()} customers who are paying. This is the real thing.`,
      relatedSegmentId: best.segmentId,
    })
  }

  return {
    customers,
    companyPmfScore: best.score,
    revenueMultiplier: revenueMultiplier(career.pricing) * expansionMultiplier(career.cohorts, career.segmentTruth, s.week),
    segmentPmf,
    productCapacityDrain: Math.min(0.7, productCapacityDrain) * (2 - productPenalty),
  }
}

/** Switch the primary target. Costs a repositioning period sized by how different they are. */
export function repositionTo(s: GameState, newSegment: SegmentId, week: number): void {
  const career = s.career as CareerPMFState
  if (!career || career.primaryTargetSegmentId === newSegment) return
  const from = career.primaryTargetSegmentId
  const a = career.segmentTruth[from]
  const b = career.segmentTruth[newSegment]
  // the further apart the two segments' requirements are, the longer the whiplash
  const distance = Math.abs(a.productRequirement - b.productRequirement) + Math.abs(a.willingnessToPay - b.willingnessToPay)
  const weeks = Math.max(2, Math.min(6, Math.round(distance / 30)))
  career.repositioning = {
    previousSegmentId: from,
    newSegmentId: newSegment,
    startWeek: week,
    remainingWeeks: weeks,
    productPenalty: 0.7,
    marketingPenalty: 0.55,
  }
  career.primaryTargetSegmentId = newSegment

  // Retune the roadmap to what the new segment actually values. segmentProductFit scores the
  // focus by its rank in that segment's `values`: +18 for its first choice, +9 for its second,
  // −8 for anything else. Leaving the old focus in place therefore swung product fit by up to 26
  // points the moment you repositioned, silently and in the wrong direction — the opposite of
  // what "we are rebuilding around these customers" should mean. A focus the new segment already
  // ranks first or second is kept, since that is a deliberate choice the player may want.
  const wanted = segmentDef(s.sector, newSegment).values
  const keptFocus = wanted.indexOf(career.focus) <= 1 && wanted.indexOf(career.focus) >= 0
  if (!keptFocus) career.focus = wanted[0]

  const fromName = segmentDef(s.sector, from).name
  const toName = segmentDef(s.sector, newSegment).name
  const retention = career.retentionBySegment[from] ?? 0
  addJournal(career, {
    week,
    category: 'pivot',
    title: `Segment pivot: ${fromName} → ${toName}`,
    description:
      (retention > 0
        ? `${fromName} retention had settled at ${Math.round(retention * 100)}%. Betting the roadmap on ${toName} instead.`
        : `Redirecting the company at ${toName} before spending more on ${fromName}.`) +
      (keptFocus ? '' : ` The roadmap retunes for ${career.focus.replace('_', ' ')}, which is what ${toName} actually values.`),
    relatedSegmentId: newSegment,
  })
  s.flash = `🎯 Now targeting ${toName}. The team needs ~${weeks} weeks to turn the ship — product and marketing both suffer until then.`
  s.inbox.unshift({
    id: `repos-${week}`,
    week,
    kind: 'system',
    title: `Repositioning to ${toName}`,
    body: `The roadmap, the messaging and the sales motion were all built for ${fromName}. Expect ${weeks} weeks of reduced product velocity and weaker acquisition while the company turns. Customers you already have do not disappear — but nobody is optimising for them any more.`,
  })
}
