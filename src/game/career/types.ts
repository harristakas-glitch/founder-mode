// Career PMF Discovery 2.0 — the type surface.
//
// The whole point of this subsystem is the gap between three different things:
//   TRUTH    — what the market actually is. Generated once from the seed, never rerolled.
//   BELIEF   — what the player currently thinks, with a confidence attached.
//   EVIDENCE — the observations that moved belief, of varying and imperfect reliability.
//
// Research moves BELIEF. Only customers move TRUTH into your bank account. A player can be
// highly confident and correctly conclude the idea is bad — that is a valid outcome.

export type SegmentId = string

/** The hidden reality of a customer segment. 0–100 throughout. Never shown directly. */
export interface SegmentTruth {
  needIntensity: number // how badly this segment feels the problem
  willingnessToPay: number // relative price tolerance
  retentionPotential: number // ceiling on how well they stick
  acquisitionAccessibility: number // how cheaply you can reach them
  productRequirement: number // the quality bar before they take you seriously
  marketSize: number // how many of them exist (scaled to the sector TAM)
  competitiveIntensity: number // how well-served they already are
  salesCycleWeeks: number // lag between interest and money
  expansionPotential: number // revenue growth per retained customer
}

export type TruthMetric = keyof Omit<SegmentTruth, 'salesCycleWeeks' | 'competitiveIntensity'>

export interface MetricBelief {
  estimate: number // current best guess, 0–100
  confidence: number // 0–1
  evidenceCount: number
}

export type SegmentBeliefs = Record<TruthMetric, MetricBelief>

export type ExperimentType = 'interview' | 'landing_page' | 'prototype' | 'pricing_test' | 'pilot'

export type EvidenceSource = ExperimentType | 'customer_behaviour' | 'renewal' | 'referral'

export interface EvidenceItem {
  id: string
  week: number
  segmentId: SegmentId
  source: EvidenceSource
  metric: TruthMetric
  /** What this observation suggested the metric is, 0–100. Not necessarily the truth. */
  signal: number
  reliability: number // 0–1: how much weight belief-updating gives it
  direction: 'positive' | 'negative' | 'mixed'
  summary: string
  misleading?: boolean // recorded for the postmortem; never surfaced live
}

export interface ActiveExperiment {
  id: string
  type: ExperimentType
  segmentId: SegmentId
  startWeek: number
  completionWeek: number
  cashCost: number
  productCapacityCost: number
  marketingCapacityCost: number
  sampleSize: number
  expectedEvidenceMetrics: TruthMetric[]
  status: 'active' | 'complete' | 'cancelled'
  /**
   * Keep this study running: when it completes, start the same one again on the same segment for
   * as long as the cash lasts. Discovery is a programme, not a button — re-clicking the same
   * experiment every three weeks was busywork that taught the player nothing.
   */
  standing?: boolean
}

export interface CustomerCohort {
  id: string
  acquiredWeek: number
  segmentId: SegmentId
  startingCustomers: number
  activeCustomers: number
  acquisitionCost: number
  priceAtAcquisition: number
  productQualityAtAcquisition: number
  /**
   * Unrounded survivor count. Customers are shown as whole people, but churn is a rate: rounding
   * 3 × 0.95 back to 3 every week meant a small cohort never lost anyone and reported 100%
   * retention forever — and retention is most of the PMF score, so PMF flattered the player
   * exactly when they had the least evidence. Decay runs on this; `activeCustomers` is its
   * rounded shadow. Absent on saves written before this existed — fall back to activeCustomers.
   */
  exactCustomers?: number
  /** Share of this cohort still active when it turned four weeks old. Snapshotted once. */
  retentionAt4wk?: number
}

export interface RepositioningState {
  previousSegmentId: SegmentId
  newSegmentId: SegmentId
  startWeek: number
  remainingWeeks: number
  productPenalty: number // 0–1 multiplier on product output
  marketingPenalty: number // 0–1 multiplier on acquisition
}

export interface DecisionJournalEntry {
  id: string
  week: number
  category: 'strategy' | 'experiment' | 'discovery' | 'pricing' | 'pivot' | 'milestone'
  title: string
  description: string
  relatedSegmentId?: SegmentId
}

export type PmfStatus =
  | 'no_demand'
  | 'early_signal'
  | 'problem_validated'
  | 'showing_value'
  | 'emerging'
  | 'strong'
  | 'scalable'
  | 'unproven'

export type PricingStrategy = 'low' | 'market' | 'premium'

/** What the company has chosen to optimise the product for. Segments value these differently. */
export type ProductFocus = 'simplicity' | 'reliability' | 'collaboration' | 'enterprise_readiness' | 'automation' | 'performance'

export interface CausalExplanation {
  metric: 'acquisition' | 'conversion' | 'retention' | 'revenue' | 'pmf'
  direction: 'up' | 'down' | 'flat'
  primaryCause: string
  secondaryCauses: string[]
}

/** Everything Career adds. Absent entirely on Quick Play and Arena saves. */
export interface CareerPMFState {
  segmentTruth: Record<SegmentId, SegmentTruth>
  segmentBeliefs: Record<SegmentId, SegmentBeliefs>
  evidence: EvidenceItem[]
  activeExperiments: ActiveExperiment[]
  cohorts: CustomerCohort[]
  primaryTargetSegmentId: SegmentId
  repositioning?: RepositioningState
  journal: DecisionJournalEntry[]
  pricing: PricingStrategy
  focus: ProductFocus
  /** Rolling per-segment behaviour, recomputed each week from the cohorts. */
  retentionBySegment: Record<SegmentId, number>
  lastExplanations: CausalExplanation[]
  /** Week-over-week deltas for the founder briefing. */
  lastBriefing?: {
    week: number
    customersDelta: number
    revenueDeltaPct: number
    retentionDeltaPct: number
    why: string
    learned: string | null
    uncertainty: string
  }
}
