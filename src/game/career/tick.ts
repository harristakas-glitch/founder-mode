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
  derivePmfForSegment,
  experimentDef,
  experimentAnswered,
  EXPERIMENT_ANSWERS,
  METRIC_LABEL,
  resolveCohortRetention,
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

export interface CareerTickResult {
  customers: number
  companyPmfScore: number
  revenueMultiplier: number
  segmentPmf: SegmentPmf[]
  productCapacityDrain: number // 0–1 of engineering output eaten by running experiments
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

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
    // something removed users (a churn event, an outage) — take it off the newest cohorts
    let toRemove = tracked - s.users
    for (let i = career.cohorts.length - 1; i >= 0 && toRemove > 0; i--) {
      const c = career.cohorts[i]
      const take = Math.min(c.activeCustomers, toRemove)
      c.activeCustomers -= take
      // keep the unrounded count in step, or decay would resurrect the people we just removed
      c.exactCustomers = Math.max(0, (c.exactCustomers ?? c.activeCustomers + take) - take)
      toRemove -= take
    }
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
    currentCustomers: totalCustomers(career, target),
    ceiling,
    marketingPenalty,
    acqScale: Math.max(0.4, sectorAcqBase / 5),
    rng,
  })

  if (acquired > 0) {
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
  }

  // --- retention, per cohort ---------------------------------------------------------------
  // Aggregate growth can hide a rotting base — that is exactly what cohorts are for.
  let churnedTotal = 0
  for (const c of career.cohorts) {
    const truth = career.segmentTruth[c.segmentId]
    if (!truth) continue
    const fit = segmentProductFit(truth, s.quality, career.focus, sector, c.segmentId)
    const price = segmentPriceFit(truth, career.pricing)
    const keep = resolveCohortRetention({ truth, productFit: fit, priceFit: price, bugs: s.bugs, weeksSinceAcquired: s.week - c.acquiredWeek })
    const before = c.activeCustomers
    // Decay the unrounded count, then round only for display. Rounding first let a cohort of a
    // handful of people survive intact week after week and report perfect retention.
    const exact = Math.max(0, (c.exactCustomers ?? c.activeCustomers) * keep)
    c.exactCustomers = exact
    c.activeCustomers = Math.max(0, Math.round(exact))
    churnedTotal += before - c.activeCustomers
    // Freeze this cohort's four-week number the week it turns four weeks old. Measuring
    // "everything older than 4 weeks" instead made the metric lifetime survival, which decays
    // forever — so retention (and therefore PMF) could only ever fall.
    if (c.retentionAt4wk === undefined && s.week - c.acquiredWeek >= 4 && c.startingCustomers > 0) {
      // off the exact count: `3/3 = 100%` on a rounded cohort is a rounding artifact, not evidence
      c.retentionAt4wk = clamp01(exact / c.startingCustomers)
    }
  }
  career.cohorts = career.cohorts.filter((c) => c.activeCustomers > 0).slice(-60)

  // --- 4-week retention, measured per segment ----------------------------------------------
  for (const seg of segs) {
    // Average the most recent cohorts' four-week snapshots, weighted by size. This tracks
    // whether the company is getting BETTER at keeping people, and rises when fit improves.
    const measured = career.cohorts.filter((c) => c.segmentId === seg.id && c.retentionAt4wk !== undefined).slice(-10)
    const weight = measured.reduce((a, c) => a + c.startingCustomers, 0)
    career.retentionBySegment[seg.id] =
      weight > 0
        ? clamp01(measured.reduce((a, c) => a + c.retentionAt4wk! * c.startingCustomers, 0) / weight)
        : (career.retentionBySegment[seg.id] ?? 0)
  }

  // --- derived PMF, per segment ------------------------------------------------------------
  const segmentPmf = segs.map((seg) => {
    const truth = career.segmentTruth[seg.id]
    return derivePmfForSegment({
      segmentId: seg.id,
      customers: totalCustomers(career, seg.id),
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
