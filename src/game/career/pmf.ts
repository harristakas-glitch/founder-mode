// Career PMF Discovery 2.0 — the simulation.
//
// Every function here is pure and deterministic: it takes state, returns state or a value, and
// draws randomness only from the seeded `rng` passed in. Nothing imports React, and nothing
// calls Math.random.
//
// The central idea: research moves BELIEF, customers move MONEY, and the two can disagree for
// a long time. A player can hold high confidence in a correct, disappointing conclusion.

import type {
  CustomerCohort,
  ActiveExperiment,
  CareerPMFState,
  CausalExplanation,
  DecisionJournalEntry,
  EvidenceItem,
  ExperimentType,
  MetricBelief,
  PmfStatus,
  PricingStrategy,
  ProductFocus,
  SegmentBeliefs,
  SegmentId,
  SegmentTruth,
  TruthMetric,
} from './types'
import { generateAllTruth, segmentCeiling, segmentDef, segmentsForSector } from './segments'

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const TRUTH_METRICS: TruthMetric[] = [
  'needIntensity',
  'willingnessToPay',
  'retentionPotential',
  'acquisitionAccessibility',
  'productRequirement',
  'marketSize',
  'expansionPotential',
]

export const METRIC_LABEL: Record<TruthMetric, string> = {
  needIntensity: 'Problem intensity',
  willingnessToPay: 'Willingness to pay',
  retentionPotential: 'Retention potential',
  acquisitionAccessibility: 'Reachability',
  productRequirement: 'Product bar',
  marketSize: 'Market size',
  expansionPotential: 'Expansion potential',
}

// ---------- experiments ----------

export interface ExperimentDef {
  type: ExperimentType
  name: string
  blurb: string
  weeks: number
  cashCost: number
  productCapacityCost: number // 0–1 share of weekly engineering output consumed
  marketingCapacityCost: number // $ of marketing budget consumed per week
  /** How trustworthy this instrument is at its best. Behaviour beats opinion. */
  baseReliability: number
  metrics: TruthMetric[]
  sampleSize: number
}

// The hierarchy the brief asks for: stated intent is cheap and weak, behaviour is slow and strong.
export const EXPERIMENTS: ExperimentDef[] = [
  {
    type: 'interview',
    name: 'Customer interviews',
    blurb: 'Talk to twelve of them. Cheap, fast, and people are generous with opinions they never act on.',
    weeks: 2,
    cashCost: 4_000,
    productCapacityCost: 0,
    marketingCapacityCost: 0,
    baseReliability: 0.34,
    metrics: ['needIntensity', 'productRequirement', 'willingnessToPay'],
    sampleSize: 12,
  },
  {
    type: 'landing_page',
    name: 'Landing page test',
    blurb: 'Put up a promise and count who bites. Measures interest and reachability — not value.',
    weeks: 2,
    cashCost: 6_000,
    productCapacityCost: 0,
    marketingCapacityCost: 3_000,
    baseReliability: 0.44,
    metrics: ['acquisitionAccessibility', 'needIntensity', 'marketSize'],
    sampleSize: 400,
  },
  {
    type: 'prototype',
    name: 'Prototype test',
    blurb: 'Put something real in their hands. Costs engineering weeks; shows whether it actually helps.',
    weeks: 3,
    cashCost: 12_000,
    productCapacityCost: 0.35,
    marketingCapacityCost: 0,
    baseReliability: 0.62,
    metrics: ['productRequirement', 'needIntensity', 'retentionPotential'],
    sampleSize: 30,
  },
  {
    type: 'pricing_test',
    name: 'Pricing test',
    blurb: 'Ask for money. The fastest way to find out that enthusiasm was free.',
    weeks: 3,
    cashCost: 9_000,
    productCapacityCost: 0.1,
    marketingCapacityCost: 2_000,
    baseReliability: 0.7,
    metrics: ['willingnessToPay', 'acquisitionAccessibility'],
    sampleSize: 60,
  },
  {
    type: 'pilot',
    name: 'Paid pilot',
    blurb: 'A real deployment with a real customer paying real money. Slow, expensive, and the only thing that truly proves retention.',
    weeks: 7,
    cashCost: 28_000,
    productCapacityCost: 0.45,
    marketingCapacityCost: 0,
    baseReliability: 0.88,
    metrics: ['retentionPotential', 'willingnessToPay', 'productRequirement', 'expansionPotential'],
    sampleSize: 6,
  },
]

export const experimentDef = (t: ExperimentType): ExperimentDef => EXPERIMENTS.find((e) => e.type === t) ?? EXPERIMENTS[0]

/**
 * The headline question each instrument exists to answer, and the confidence at which that
 * question counts as answered.
 *
 * One table, two readers: `suggestedExperiment` uses it to decide what to recommend next, and the
 * standing-study renewal uses it to decide when to stop charging. They MUST agree — a rolling
 * study that keeps billing for a question the game has stopped recommending is a pure drain,
 * because `updateBelief` gains `reliability × 0.28 × (1 − confidence)` and so buys asymptotically
 * nothing once confidence is high.
 */
export const EXPERIMENT_ANSWERS: Record<ExperimentType, { metric: TruthMetric; bar: number }> = {
  interview: { metric: 'needIntensity', bar: 0.4 },
  landing_page: { metric: 'acquisitionAccessibility', bar: 0.4 },
  prototype: { metric: 'productRequirement', bar: 0.45 },
  pricing_test: { metric: 'willingnessToPay', bar: 0.55 },
  pilot: { metric: 'retentionPotential', bar: 0.65 },
}

/**
 * Has this study answered what it was for? A standing study that has cleared its bar is retired
 * rather than renewed — it is a programme that finishes, not a subscription.
 */
export function experimentAnswered(career: CareerPMFState, type: ExperimentType, segmentId: SegmentId): boolean {
  const { metric, bar } = EXPERIMENT_ANSWERS[type]
  const b = career.segmentBeliefs[segmentId]?.[metric]
  return !!b && b.confidence >= bar
}

// ---------- beliefs ----------

function belief(estimate: number, confidence: number): MetricBelief {
  return { estimate: clamp(Math.round(estimate)), confidence: clamp01(confidence), evidenceCount: 0 }
}

/**
 * Founders do not start from nothing — they start from an opinion, and it is often wrong.
 * Initial estimates are drawn wide around the truth with low confidence, and one metric per
 * segment is deliberately given a confident, badly-wrong reading so there is something real
 * to disprove.
 */
export function initialBeliefs(truth: SegmentTruth, rng: () => number): SegmentBeliefs {
  const out = {} as SegmentBeliefs
  const overconfidentMetric = TRUTH_METRICS[Math.floor(rng() * TRUTH_METRICS.length)]
  for (const m of TRUTH_METRICS) {
    const trueValue = truth[m]
    if (m === overconfidentMetric) {
      // a strong prior pointing the wrong way — the assumption worth killing
      const wrongWay = trueValue > 50 ? -1 : 1
      out[m] = belief(trueValue + wrongWay * (22 + rng() * 20), 0.42)
    } else {
      out[m] = belief(trueValue + (rng() * 2 - 1) * 30, 0.1 + rng() * 0.12)
    }
  }
  return out
}

/** Human-readable band for a belief — never the exact hidden number. */
export function beliefBand(b: MetricBelief): { lo: number; hi: number; label: string } {
  const width = Math.round(38 * (1 - b.confidence) + 6)
  const lo = clamp(b.estimate - width / 2)
  const hi = clamp(b.estimate + width / 2)
  const mid = (lo + hi) / 2
  const label = mid < 25 ? 'Low' : mid < 45 ? 'Modest' : mid < 65 ? 'Moderate' : mid < 82 ? 'High' : 'Very high'
  return { lo: Math.round(lo), hi: Math.round(hi), label }
}

export function confidenceLabel(c: number): string {
  return c < 0.25 ? 'Very low' : c < 0.45 ? 'Low' : c < 0.65 ? 'Medium' : c < 0.82 ? 'High' : 'Very high'
}

/**
 * Bayesian-ish update: evidence pulls the estimate toward its signal in proportion to how much
 * it should be trusted relative to what we already believe. Strong instruments move belief a
 * long way; twelve enthusiastic interviews barely move it once you already have pilot data.
 */
export function updateBelief(prev: MetricBelief, ev: EvidenceItem): MetricBelief {
  const priorWeight = prev.confidence * 2.2 + 0.35
  const evWeight = ev.reliability * 1.6
  const estimate = (prev.estimate * priorWeight + ev.signal * evWeight) / (priorWeight + evWeight)
  // confidence rises with corroboration but saturates — you can never be certain from a chair
  const gain = ev.reliability * 0.28 * (1 - prev.confidence)
  return {
    estimate: clamp(estimate),
    confidence: clamp01(prev.confidence + gain),
    evidenceCount: prev.evidenceCount + 1,
  }
}

// ---------- running experiments ----------

export function canRunExperiment(
  career: CareerPMFState,
  type: ExperimentType,
  segmentId: SegmentId,
  cash: number,
): { ok: boolean; reason?: string } {
  const def = experimentDef(type)
  if (career.activeExperiments.some((e) => e.status === 'active' && e.type === type && e.segmentId === segmentId))
    return { ok: false, reason: 'Already running on this segment' }
  if (career.activeExperiments.filter((e) => e.status === 'active').length >= 3)
    return { ok: false, reason: 'Three experiments at once is already too many' }
  if (cash < def.cashCost) return { ok: false, reason: `Costs $${def.cashCost.toLocaleString()}` }
  return { ok: true }
}

export function startExperiment(
  career: CareerPMFState,
  week: number,
  type: ExperimentType,
  segmentId: SegmentId,
  id: string,
  standing = false,
): ActiveExperiment {
  const def = experimentDef(type)
  const exp: ActiveExperiment = {
    id,
    type,
    segmentId,
    startWeek: week,
    completionWeek: week + def.weeks,
    cashCost: def.cashCost,
    productCapacityCost: def.productCapacityCost,
    marketingCapacityCost: def.marketingCapacityCost,
    sampleSize: def.sampleSize,
    expectedEvidenceMetrics: def.metrics,
    status: 'active',
    standing,
  }
  career.activeExperiments.push(exp)
  return exp
}

/**
 * Turn a finished experiment into evidence. Reliability degrades with a weak instrument, a
 * hard-to-reach segment (your sample is whoever answered) and poor execution. Low reliability
 * is exactly when the signal is allowed to lie — a small sample of enthusiasts really does
 * mislead people, and that is the lesson.
 */
export function resolveExperiment(
  exp: ActiveExperiment,
  truth: SegmentTruth,
  executionQuality: number, // 0–1, from product quality / team strength
  rng: () => number,
  uid: () => string,
  week: number,
): EvidenceItem[] {
  const def = experimentDef(exp.type)
  const sampleQuality = clamp01(0.55 + Math.log10(Math.max(2, exp.sampleSize)) / 6)
  const accessPenalty = clamp01(0.55 + truth.acquisitionAccessibility / 220)
  const reliability = clamp01(def.baseReliability * sampleQuality * (0.6 + executionQuality * 0.4) * accessPenalty)

  return def.metrics.map((metric) => {
    const trueValue = truth[metric]
    // noise shrinks as reliability rises; a pilot lands close, interviews scatter
    const noise = (1 - reliability) * 46
    let signal = trueValue + (rng() * 2 - 1) * noise
    let misleading = false

    // Stated-preference bias: cheap instruments systematically overstate enthusiasm and
    // willingness to pay. This is the "9 of 12 said they'd pay, 2 actually did" moment.
    if ((exp.type === 'interview' || exp.type === 'landing_page') && (metric === 'willingnessToPay' || metric === 'needIntensity')) {
      signal += 10 + rng() * 16
      if (signal > trueValue + 20) misleading = true
    }
    // A weak product makes a good market look bad — the classic false negative.
    if (exp.type === 'prototype' && executionQuality < 0.45 && metric === 'needIntensity') {
      signal -= 12 + rng() * 14
      if (signal < trueValue - 15) misleading = true
    }

    signal = clamp(signal)
    const direction: EvidenceItem['direction'] = signal > trueValue + 8 ? 'positive' : signal < trueValue - 8 ? 'negative' : 'mixed'
    return {
      id: uid(),
      week,
      segmentId: exp.segmentId,
      source: exp.type,
      metric,
      signal: Math.round(signal),
      reliability: Number(reliability.toFixed(3)),
      direction,
      summary: evidenceSummary(exp.type, metric, signal, exp.sampleSize),
      misleading,
    }
  })
}

function evidenceSummary(type: ExperimentType, metric: TruthMetric, signal: number, sample: number): string {
  const strength = signal < 30 ? 'weak' : signal < 55 ? 'mixed' : signal < 75 ? 'encouraging' : 'strong'
  switch (type) {
    case 'interview':
      return `${Math.round((signal / 100) * sample)}/${sample} interviews pointed to ${strength} ${METRIC_LABEL[metric].toLowerCase()}.`
    case 'landing_page':
      return `Landing page converted ${(signal / 12).toFixed(1)}% — ${strength} signal on ${METRIC_LABEL[metric].toLowerCase()}.`
    case 'prototype':
      return `${Math.round((signal / 100) * sample)}/${sample} testers used it more than once. ${strength[0].toUpperCase() + strength.slice(1)} read on ${METRIC_LABEL[metric].toLowerCase()}.`
    case 'pricing_test':
      return `${Math.round((signal / 100) * sample)}/${sample} accepted the price. ${strength[0].toUpperCase() + strength.slice(1)} ${METRIC_LABEL[metric].toLowerCase()}.`
    case 'pilot':
      return `The pilot ran to completion with ${Math.round((signal / 100) * sample)}/${sample} customers still active. ${strength[0].toUpperCase() + strength.slice(1)} ${METRIC_LABEL[metric].toLowerCase()}.`
  }
}

// ---------- fit ----------

/** How well the current product serves this segment's bar, given what it's optimised for. */
export function segmentProductFit(
  truth: SegmentTruth,
  productQuality: number,
  focus: ProductFocus,
  sector: string,
  segmentId: SegmentId,
): number {
  const def = segmentDef(sector, segmentId)
  const rank = def.values.indexOf(focus)
  const focusBonus = rank === 0 ? 18 : rank === 1 ? 9 : -8
  // quality is measured against the segment's requirement, not in the abstract:
  // 55 quality is plenty for freelancers and nowhere near enough for a bank
  return clamp(50 + (productQuality - truth.productRequirement) * 0.85 + focusBonus)
}

const PRICE_LEVEL: Record<PricingStrategy, number> = { low: 26, market: 52, premium: 82 }

/** 100 = priced right for this segment. Overpricing hurts far more than underpricing. */
export function segmentPriceFit(truth: SegmentTruth, pricing: PricingStrategy): number {
  const asked = PRICE_LEVEL[pricing]
  const gap = asked - truth.willingnessToPay
  return gap <= 0 ? clamp(100 + gap * 0.35) : clamp(100 - gap * 1.5)
}

export function revenueMultiplier(pricing: PricingStrategy): number {
  return pricing === 'low' ? 0.55 : pricing === 'premium' ? 1.75 : 1
}

/**
 * Account expansion: a retained customer is worth more the longer they stay, and how much more is
 * the segment's `expansionPotential`. That metric was generated, believed, and measured by a $28k
 * paid pilot — and then read by no formula anywhere, so players were paying for evidence about a
 * number the simulation ignored. It is the difference between a segment you farm and one you
 * merely hold.
 *
 * Deliberately gentle and capped: this multiplies revenue that is already calibrated, and the
 * point is to reward retention, not to open a second growth engine.
 */
export function expansionMultiplier(cohorts: CustomerCohort[], truth: Record<SegmentId, SegmentTruth>, week: number): number {
  const live = cohorts.filter((c) => c.activeCustomers > 0)
  const heads = live.reduce((a, c) => a + c.activeCustomers, 0)
  if (heads === 0) return 1
  // customer-weighted mean of each cohort's own maturity, so one old cohort cannot carry the company
  const lift = live.reduce((a, c) => {
    const potential = (truth[c.segmentId]?.expansionPotential ?? 50) / 100
    const years = Math.min(2, Math.max(0, week - c.acquiredWeek) / 52)
    return a + c.activeCustomers * (1 + potential * 0.45 * years)
  }, 0)
  return lift / heads
}

// ---------- acquisition & retention ----------

export interface WeeklySegmentResult {
  acquired: number
  churned: number
  activeCustomers: number
  revenue: number
}

/**
 * How many new customers each existing customer refers per week, at perfect reachability.
 *
 * Deliberately below every segment's weekly churn rate: referrals amplify growth, they never
 * sustain it on their own, so there is no configuration in which a company grows by standing
 * still. The worked case is SaaS Freelancers, the most referral-friendly segment in the game —
 * reachability 84, so ~2.0%/wk of the base refers, against ~6%/wk churning out. `room` caps it
 * again at the segment ceiling.
 */
export const REFERRAL_RATE = 0.05

/** New customers from the targeted segment this week. */
export function resolveSegmentAcquisition(args: {
  truth: SegmentTruth
  productFit: number
  priceFit: number
  marketingSpend: number
  hype: number
  currentCustomers: number
  ceiling: number
  marketingPenalty: number
  /** sector.acqBase / 5 — keeps a social app's scale different from a B2B tool's. */
  acqScale: number
  rng: () => number
}): number {
  const { truth, productFit, priceFit, marketingSpend, hype, currentCustomers, ceiling, marketingPenalty, acqScale, rng } = args
  const room = Math.pow(Math.max(0, 1 - currentCustomers / Math.max(1, ceiling)), 1.3)
  const reach = 0.25 + (truth.acquisitionAccessibility / 100) * 1.5
  // Calibrated against Quick Play: a funded company running real campaigns should reach
  // thousands of customers, not hundreds, or revenue can never cover payroll.
  const spendEffect = Math.sqrt(Math.max(0, marketingSpend) / 6) * reach * acqScale
  const organic = (hype / 2.2) * reach * (0.4 + truth.needIntensity / 140) * acqScale
  // Referrals: the customers you already have bring more, and how many depends on how reachable
  // their peers are — not on your budget. This is the ONE advantage a high-reach, low-paying
  // segment collects every week.
  //
  // It exists because the compensating advantage those segments were designed with — market-size
  // headroom — is never actually collected inside a campaign. Measured over 24 seeds × 5 sectors,
  // a low-end run reaches ~2% of its ceiling by week 90 (SaaS Freelancers: ~2,000 customers
  // against a median ceiling of 88,636), so `room` sits at 0.97–0.99 all game at BOTH ends of the
  // market. The low end was paying its retention, price and expansion penalties every single week
  // for a benefit worth about one percentage point of acquisition. That is why `low` pricing —
  // which is only ever correct on those segments — came last on founder net in all five sectors.
  //
  // Note this is NOT multiplied by priceFit here: `conversion` below already carries it, and that
  // is the whole trade-off. Underprice a reachable segment and the referral engine converts;
  // charge premium at the same people and it stalls.
  const referral = currentCustomers * (truth.acquisitionAccessibility / 100) * REFERRAL_RATE * (0.4 + truth.needIntensity / 140)
  // a promise you can't price is a promise nobody buys
  const conversion = clamp01(0.18 + (priceFit / 100) * 0.7) * clamp01(0.35 + (productFit / 100) * 0.75)
  const competition = clamp01(1 - truth.competitiveIntensity / 190)
  const raw = (spendEffect + organic + referral) * conversion * competition * room * marketingPenalty
  return Math.max(0, Math.round(raw * (0.85 + rng() * 0.3)))
}

/** Weekly probability a customer in this cohort stays. Slow-burning, not instant. */
export function resolveCohortRetention(args: {
  truth: SegmentTruth
  productFit: number
  priceFit: number
  bugs: number
  weeksSinceAcquired: number
}): number {
  const { truth, productFit, priceFit, bugs, weeksSinceAcquired } = args
  // WEEKLY keep rate. A healthy subscription business loses low single digits a week, so the
  // usable band is roughly 0.85 (haemorrhaging) to 0.99 (excellent) — not 0.5.
  // The spread between a well-matched segment and a badly-matched one has to be wide enough to
  // compound: ~1%/wk churn when everything fits (a base that grows), ~15-20%/wk when it doesn't
  // (a bucket with a hole). A narrow band makes every strategy converge on the same plateau.
  const base = 0.925 + (truth.retentionPotential / 100) * 0.07
  const fit = 0.93 + (productFit / 100) * 0.085
  const price = 0.95 + (priceFit / 100) * 0.058
  const reliability = 1 - bugs / 900
  // the first weeks are the dangerous ones; survivors settle
  const honeymoon = weeksSinceAcquired < 4 ? 0.985 : 1.004
  return clamp01(Math.min(0.995, base * fit * price * reliability * honeymoon))
}

// ---------- derived PMF ----------

export interface SegmentPmf {
  segmentId: SegmentId
  status: PmfStatus
  score: number // 0–100, for internal use (valuation, fundraising)
  retention4wk: number
  customers: number
}

/**
 * Below this many retained customers in a segment there is nothing real to read, so the score
 * is capped at "problem validated" however confident the research is. The UI shows this number
 * to the player, so it lives here rather than as a literal in two places.
 */
export const PMF_CUSTOMER_FLOOR = 15

/**
 * PMF is an OUTPUT, never an input. It is read off real behaviour — customers who stayed and
 * paid — with only a small contribution from evidence confidence. Research alone can never
 * manufacture it, which is the single most important rule in this system.
 */
export function derivePmfForSegment(args: {
  segmentId: SegmentId
  customers: number
  retention4wk: number
  priceFit: number
  productFit: number
  truth: SegmentTruth
  beliefs: SegmentBeliefs
  ceiling: number
}): SegmentPmf {
  const { segmentId, customers, retention4wk, priceFit, productFit, truth, beliefs, ceiling } = args
  if (customers < PMF_CUSTOMER_FLOOR) {
    // Nothing real yet: research can raise this only to 'problem validated', never further.
    const confidence = TRUTH_METRICS.reduce((a, m) => a + beliefs[m].confidence, 0) / TRUTH_METRICS.length
    const believedNeed = beliefs.needIntensity.estimate
    const score = Math.round(confidence * 28 + (believedNeed / 100) * 12)
    const status: PmfStatus = confidence < 0.3 ? 'unproven' : believedNeed > 55 && confidence > 0.5 ? 'problem_validated' : 'early_signal'
    return { segmentId, status, score, retention4wk, customers }
  }

  const retentionScore = clamp01((retention4wk - 0.4) / 0.5) * 46
  const payingScore = (priceFit / 100) * 20
  const fitScore = (productFit / 100) * 14
  const scaleScore = clamp01(customers / Math.max(200, ceiling * 0.12)) * 12
  const headroom = clamp01(truth.marketSize / 60) * 8
  const score = Math.round(clamp(retentionScore + payingScore + fitScore + scaleScore + headroom))

  let status: PmfStatus = 'no_demand'
  if (score >= 80 && retention4wk > 0.8) status = 'scalable'
  else if (score >= 66 && retention4wk > 0.72) status = 'strong'
  else if (score >= 52 && retention4wk > 0.62) status = 'emerging'
  else if (score >= 38) status = 'showing_value'
  else if (score >= 24) status = 'problem_validated'
  else if (customers > 40) status = 'early_signal'
  return { segmentId, status, score, retention4wk, customers }
}

export const PMF_LABEL: Record<PmfStatus, string> = {
  unproven: 'Unproven',
  no_demand: 'No clear demand',
  early_signal: 'Early signal',
  problem_validated: 'Problem validated',
  showing_value: 'Showing value',
  emerging: 'Emerging PMF',
  strong: 'Strong PMF',
  scalable: 'Scalable PMF',
}

/** A segment as the weekly tick scores it, plus the presentation bits the UI needs. */
export interface SegmentSnapshot extends SegmentPmf {
  name: string
  blurb: string
  isTarget: boolean
  productFit: number
  priceFit: number
  ceiling: number
}

/**
 * Read-only view of every segment, scored exactly the way `tickCareerPMF` scores it. Pure — it
 * calls the same functions the simulation does and mutates nothing. It exists so the UI can
 * show the player what the tick already computed without duplicating a single formula.
 */
export function segmentSnapshots(args: {
  career: CareerPMFState
  sector: string
  quality: number
  sectorTam: number
}): SegmentSnapshot[] {
  const { career, sector, quality, sectorTam } = args
  const out: SegmentSnapshot[] = []
  for (const def of segmentsForSector(sector)) {
    const truth = career.segmentTruth[def.id]
    const beliefs = career.segmentBeliefs[def.id]
    if (!truth || !beliefs) continue // a save from before this segment existed
    const productFit = segmentProductFit(truth, quality, career.focus, sector, def.id)
    const priceFit = segmentPriceFit(truth, career.pricing)
    const ceiling = segmentCeiling(truth, sectorTam)
    const pmf = derivePmfForSegment({
      segmentId: def.id,
      customers: totalCustomers(career, def.id),
      retention4wk: career.retentionBySegment[def.id] ?? 0,
      priceFit,
      productFit,
      truth,
      beliefs,
      ceiling,
    })
    out.push({
      ...pmf,
      name: def.name,
      blurb: def.blurb,
      isTarget: career.primaryTargetSegmentId === def.id,
      productFit,
      priceFit,
      ceiling,
    })
  }
  return out
}

/**
 * The one sentence that answers "why isn't PMF moving?" for a segment. Reads only what the
 * player can already see — customers and retention — and never reveals the hidden truth.
 */
export function pmfBlocker(s: SegmentSnapshot): string | null {
  if (s.customers < PMF_CUSTOMER_FLOOR)
    return `Under ${PMF_CUSTOMER_FLOOR} retained customers — the score is capped here however good the research looks.`
  if (s.retention4wk > 0 && s.retention4wk < 0.62)
    return 'Retention is most of the score, and below roughly 62% a cohort drains faster than marketing can refill it.'
  if (s.priceFit < 45) return 'Priced above what this segment pays, so most of the interest never converts.'
  if (s.productFit < 50) return "The product doesn't clear this segment's bar yet."
  return null
}

// ---------- creation & migration ----------

function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createCareerPMF(seed: number, sector: string, scenario: string | undefined): CareerPMFState {
  const segs = segmentsForSector(sector)
  const truth = generateAllTruth(seed, sector, scenario)
  const rng = prng((seed ^ 0x5bf03635) >>> 0)
  const beliefs: Record<SegmentId, SegmentBeliefs> = {}
  for (const s of segs) beliefs[s.id] = initialBeliefs(truth[s.id], rng)
  // Start targeting the segment the founder *believes* is best — often the wrong one.
  const target = [...segs].sort((a, b) => beliefs[b.id].needIntensity.estimate - beliefs[a.id].needIntensity.estimate)[0]
  return {
    segmentTruth: truth,
    segmentBeliefs: beliefs,
    evidence: [],
    activeExperiments: [],
    cohorts: [],
    primaryTargetSegmentId: target.id,
    journal: [
      {
        id: 'j-start',
        week: 1,
        category: 'strategy',
        title: `Starting assumption: ${segmentDef(sector, target.id).name}`,
        description:
          'You believe this segment feels the problem most sharply. You have no evidence yet — only an opinion, which is where every company starts.',
        relatedSegmentId: target.id,
      },
    ],
    pricing: 'market',
    focus: segmentDef(sector, target.id).values[0],
    retentionBySegment: Object.fromEntries(segs.map((s) => [s.id, 0])),
    lastExplanations: [],
  }
}

/**
 * An older Career save predates this system. Rebuild the market from the same seed (so the
 * truth is what it always would have been), seed belief confidence from research already done,
 * and fold existing users into a starting cohort rather than deleting them.
 */
export function migrateCareerSave(args: {
  seed: number
  sector: string
  scenario: string | undefined
  week: number
  users: number
  researchSignal: number
  pmf: number
}): CareerPMFState {
  const { seed, sector, scenario, week, users, researchSignal, pmf } = args
  const st = createCareerPMF(seed, sector, scenario)
  // prior research becomes broad, shallow confidence rather than free knowledge
  const priorConfidence = clamp01(researchSignal / 90) * 0.3
  for (const segId of Object.keys(st.segmentBeliefs)) {
    for (const m of TRUTH_METRICS) {
      const b = st.segmentBeliefs[segId][m]
      st.segmentBeliefs[segId][m] = { ...b, confidence: clamp01(b.confidence + priorConfidence) }
    }
  }
  if (users > 0) {
    st.cohorts.push({
      id: 'cohort-legacy',
      acquiredWeek: Math.max(1, week - 4),
      segmentId: st.primaryTargetSegmentId,
      startingCustomers: users,
      activeCustomers: users,
      acquisitionCost: 0,
      priceAtAcquisition: 52,
      productQualityAtAcquisition: clamp(pmf),
    })
    st.retentionBySegment[st.primaryTargetSegmentId] = 0.7
  }
  st.journal.push({
    id: 'j-migrated',
    week,
    category: 'milestone',
    title: 'Career PMF system activated',
    description: 'Existing market progress has been converted into segments, beliefs and a starting customer cohort.',
  })
  return st
}

// ---------- journal & explanation helpers ----------

export function addJournal(
  career: CareerPMFState,
  entry: Omit<DecisionJournalEntry, 'id'> & { id?: string },
): void {
  career.journal.unshift({ id: entry.id ?? `j-${career.journal.length}-${entry.week}`, ...entry })
  if (career.journal.length > 80) career.journal.length = 80
}

export function totalCustomers(career: CareerPMFState, segmentId?: SegmentId): number {
  return career.cohorts.reduce((a, c) => (segmentId && c.segmentId !== segmentId ? a : a + c.activeCustomers), 0)
}

/** The one question worth answering next: important, and least well understood. */
export function biggestUncertainty(career: CareerPMFState, sector: string): string {
  const target = career.primaryTargetSegmentId
  const name = segmentDef(sector, target).name
  const b = career.segmentBeliefs[target]
  if (!b) return 'Which customer segment actually needs this?'
  const customers = totalCustomers(career, target)
  const retention = career.retentionBySegment[target] ?? 0
  // strategic weighting: what you don't know AND depends on your current bet
  const ranked = TRUTH_METRICS.map((m) => ({ m, gap: 1 - b[m].confidence })).sort((a, z) => z.gap - a.gap)
  const worst = ranked[0].m
  if (customers > 60 && retention > 0 && retention < 0.6)
    return `${name} are churning. Is the product wrong for them, or is the price?`
  if (customers > 40 && b.willingnessToPay.confidence < 0.5) return `Will ${name} actually pay, or are they just using it?`
  switch (worst) {
    case 'retentionPotential':
      return `Is ${name} retention strong enough to justify scaling acquisition?`
    case 'willingnessToPay':
      return `What will ${name} genuinely pay — not what they say they'd pay?`
    case 'acquisitionAccessibility':
      return `Can ${name} be reached efficiently at scale?`
    case 'productRequirement':
      return `Is the product good enough for ${name} yet?`
    case 'marketSize':
      return `Are there enough ${name} to build a company on?`
    case 'expansionPotential':
      return `Will ${name} grow their spend over time, or is this the ceiling?`
    default:
      return `How badly do ${name} really feel this problem?`
  }
}

/**
 * The next question worth paying to answer — across ALL segments, not just the target.
 *
 * It must never repeat itself: anything already in flight on a segment is excluded, so the
 * recommendation moves on as soon as you act on it. When the target is well understood it
 * starts pointing at the segments you have ignored, which is usually where the surprise is.
 */
export function suggestedExperiment(
  career: CareerPMFState,
  sector: string,
): { type: ExperimentType; segmentId: SegmentId; why: string } | null {
  const running = new Set(career.activeExperiments.filter((e) => e.status === 'active').map((e) => `${e.segmentId}:${e.type}`))
  // Each rung: the belief it answers, the instrument that answers it, and the bar to clear.
  // Bars come from EXPERIMENT_ANSWERS so the recommendation and the standing-study renewal can
  // never drift apart; only the prose lives here.
  const WHY: Record<ExperimentType, (n: string) => string> = {
    interview: (n) => `You have almost no read on whether ${n} feel this problem at all. Start cheap.`,
    landing_page: (n) => `You think there's a need, but nothing tells you whether ${n} can be reached affordably.`,
    prototype: (n) => `Opinions say the need is there. Put something real in front of ${n} and watch what they do.`,
    pricing_test: (n) => `Interest without proof of payment. Ask ${n} for money and see who stays.`,
    pilot: (n) => `Everything short of a real deployment looks good. Only a pilot proves ${n} stay.`,
  }
  const LADDER = (['interview', 'landing_page', 'prototype', 'pricing_test', 'pilot'] as ExperimentType[]).map((type) => ({
    type,
    metric: EXPERIMENT_ANSWERS[type].metric,
    bar: EXPERIMENT_ANSWERS[type].bar,
    why: WHY[type],
  }))

  const target = career.primaryTargetSegmentId
  const candidates: { type: ExperimentType; segmentId: SegmentId; why: string; score: number }[] = []

  for (const seg of segmentsForSector(sector)) {
    const b = career.segmentBeliefs[seg.id]
    if (!b) continue
    const isTarget = seg.id === target
    const customers = totalCustomers(career, seg.id)
    for (const rung of LADDER) {
      if (running.has(`${seg.id}:${rung.type}`)) continue
      const gap = rung.bar - b[rung.metric].confidence
      if (gap <= 0) continue
      // The segment you are betting on matters most; an unexamined segment is worth more than
      // one you have already studied, because that is where a wrong assumption still hides.
      const weight = isTarget ? 1 : 0.55 + (1 - b.needIntensity.confidence) * 0.35
      candidates.push({ type: rung.type, segmentId: seg.id, why: rung.why(segmentDef(sector, seg.id).name), score: gap * weight })
      break // one rung per segment: answer the cheapest open question first
    }
    // A target that retains badly needs a pilot regardless of confidence.
    if (isTarget && customers > 40 && (career.retentionBySegment[seg.id] ?? 0) < 0.7 && !running.has(`${seg.id}:pilot`)) {
      candidates.push({
        type: 'pilot',
        segmentId: seg.id,
        why: `${segmentDef(sector, seg.id).name} are churning. A pilot is the only way to find out whether that is the product or the price.`,
        score: 0.9,
      })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  const { type, segmentId, why } = candidates[0]
  return { type, segmentId, why }
}

export function explanationText(e: CausalExplanation): string {
  const arrow = e.direction === 'up' ? '↑' : e.direction === 'down' ? '↓' : '→'
  return `${e.metric.toUpperCase()} ${arrow} — ${e.primaryCause}`
}

export { segmentCeiling, segmentDef, segmentsForSector }
