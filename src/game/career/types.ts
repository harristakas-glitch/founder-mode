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
  /**
   * Cumulative survival factor of NON-CHURN losses charged to this cohort before its four-week
   * snapshot: rival raids, outages, event-driven user cuts — everything the reconciliation drain
   * removes, multiplied together as (exactAfter / exactBefore) per hit. ABSENT MEANS 1 (no
   * shocks), so no save needs a migration write.
   *
   * Exists for the operating-evidence instrument (BACKLOG §9.1): the retention read deconvolves
   * the measured snapshot through the retention model to recover the SEGMENT's character, and
   * shock losses are not segment character. Measured before this field existed, they depressed
   * the recovered signal by ~16 points (the model inversion has 1/0.07 leverage, so ~4.5pp of
   * raid damage reads as "this segment churns"). `retentionAt4wk` itself stays raw — PMF is
   * scored on what actually happened to the book, shocks included, exactly as before.
   */
  preSnapshotShockKeep?: number
  /**
   * Product of every NON-SEGMENT retention factor actually applied to this cohort before its
   * snapshot — each week the tick multiplies in `appliedKeep / segmentBaseTerm`, so this is
   * fit × price × bugs × honeymoon (and any keep-cap truncation) AS THEY WERE that week, not as
   * they can be reconstructed later. Written only for organic cohorts, only pre-snapshot; ABSENT
   * on old saves, and the operating read simply skips cohorts that lack it.
   *
   * This is the whole defence of the §9.1 retention instrument, found adversarially before it
   * ever shipped: deconvolving with CURRENT terms let a player flip pricing on a read week and
   * turn frozen snapshots into fabricated pilot-grade evidence (signal 50 → 87–100 at full
   * reliability, `experimentAnswered('pilot')` for free), and punished honest policy fixes with
   * a 20–40 point wrong-way bias — the 1/0.07 leverage of the inversion amplifies any mismatch.
   * Recording the factors as applied makes the inversion exact and the exploit meaningless:
   * `retentionAt4wk / preSnapshotShockKeep / preSnapshotNonSegmentKeep` IS `base^4`, whatever
   * the player does with the levers afterwards.
   */
  preSnapshotNonSegmentKeep?: number
  /**
   * Why these customers arrived. ICO Slice 3, docs/ico-architecture.md §5.2.
   *
   * ABSENT MEANS 'organic', which is what every cohort written before this existed is — so no save
   * needs a migration write, the same trick `capitalPath` uses. Event-awarded, viral and
   * referral-driven customers stay organic: an arc did not pay them.
   *
   * ONE LIST, NOT TWO. A parallel `incentivisedCohorts` array would desync against the
   * reconciliation block at the top of `tickCareerPMF`, which round-trips `s.users` against
   * `totalCustomers(career)` every week and absorbs stray users into a cohort. One list, one
   * invariant.
   *
   * This field is the whole of brief §52's enforcement: `derivePmfForSegment` sees organic cohorts
   * ONLY — exclusion, not a weighting.
   */
  origin?: import('../token/types').CohortOrigin
}

/**
 * Customers WON but not yet LANDED — `salesCycleWeeks` finally wired in (gameplay-review
 * finding 6: it was generated per segment per seed, believed, measured by paid pilots, and read
 * by nothing). A deal closed this week turns into a paying cohort `salesCycleWeeks − 1` weeks
 * later: a one-week cycle is interest and money inside the same tick — bit-identical to before
 * this existed — so the lag only bites where the cycle is genuinely long. It is what makes
 * Enterprise SLOW rather than merely expensive.
 *
 * The acquisition-week snapshot fields are taken when the deal is WON (that is when the price
 * was quoted and the product demoed), and carried until it lands.
 */
export interface PipelineEntry {
  landWeek: number
  segmentId: SegmentId
  customers: number
  acquisitionCost: number
  priceAtAcquisition: number
  productQualityAtAcquisition: number
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
  /**
   * The sales pipeline: deals won, money not yet in. ABSENT MEANS EMPTY — the same trick
   * `origin` and `exactCustomers` use, so a save written before this existed loads without a
   * migration write, and a run whose target has a one-week cycle never grows the key at all.
   */
  pipeline?: PipelineEntry[]
  primaryTargetSegmentId: SegmentId
  repositioning?: RepositioningState
  journal: DecisionJournalEntry[]
  pricing: PricingStrategy
  focus: ProductFocus
  /**
   * Rolling per-segment 4-week retention, recomputed each week from the ORGANIC cohorts.
   *
   * Existing key, existing meaning, and it is what feeds `derivePmfForSegment`. Keeping this name
   * pointed at the PMF-feeding number means every existing reader stays correct without being
   * visited — and, because a run with no incentivised cohorts has no other kind, it is
   * bit-identical to what it always was.
   */
  retentionBySegment: Record<SegmentId, number>
  /**
   * The same measure over INCENTIVISED cohorts. ICO Slice 3, docs/ico-architecture.md §5.4.
   *
   * Optional and token-only: it is created the first week an incentivised cohort snapshots a
   * four-week number and never before, so a traditional save never grows the key. Display, the §53
   * warning and the postmortem read it. IT NEVER FEEDS PMF.
   */
  retentionBySegmentIncentivised?: Record<SegmentId, number>
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
