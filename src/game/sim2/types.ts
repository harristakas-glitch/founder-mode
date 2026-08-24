// Business Simulation V2 — the shared contracts (spec §0A, §32; contract doc
// docs/business-sim-v2-implementation.md). Everything here is TYPES and pure shapes: the
// event contract every resolver emits, the explanation contract every surface consumes, the
// truth-vs-estimate wrapper, the root state, the weekly snapshot, and the evaluator
// interfaces. No logic, no imports from the engine — this file is the boundary both layers
// agree on.

// ---------- events (spec §0A.2) --------------------------------------------------------------

export type SimEventCategory =
  | 'market'
  | 'product'
  | 'pricing'
  | 'growth'
  | 'customer'
  | 'people'
  | 'capacity'
  | 'competitor'
  | 'finance'
  | 'board'
  | 'investor'
  | 'research'
  | 'milestone'
  | 'crisis'

export interface SimulationEvent {
  id: string
  week: number
  category: SimEventCategory
  type: string
  /** 0..1 — how big the change is in its own domain */
  magnitude: number
  /** 0..1 — how soon it needs attention */
  urgency: number
  /** 0..1 — how much it bears on the company's chosen strategy */
  strategicRelevance: number
  entityIds?: string[]
  /** FACTS, not prose — the engagement layer writes the words */
  facts: Record<string, number | string | boolean>
  explanationIds?: string[]
  visibility: 'hidden' | 'signal' | 'known'
  eligibleForMajorMoment?: boolean
}

// ---------- explanations (spec §0A.3) --------------------------------------------------------

export interface SimulationDriver {
  id: string
  label: string
  impact?: number
  percentImpact?: number
  sourceSystem: string
  sourceEntityId?: string
  sentiment: 'positive' | 'negative' | 'neutral'
}

export interface SimulationExplanation {
  id: string
  metricId?: string
  eventId?: string
  value?: number
  previousValue?: number
  direction: 'improving' | 'worsening' | 'neutral'
  drivers: SimulationDriver[]
  strategicMeaning?: string
}

/** What every resolver returns (spec §0A.1) — state moves, and the layer above learns why. */
export interface ResolverOut {
  events: SimulationEvent[]
  explanations: SimulationExplanation[]
}

// ---------- truth vs estimate (spec §14.2) ---------------------------------------------------

/** A hidden market variable as the PLAYER may know it. `truth` lives only inside simV2 state —
 *  no screen module may read it (enforced by test/sim2.test.ts's truth-isolation grep). */
export interface EstimatedValue {
  truth: number
  visibleEstimate: number
  /** 0..1 */
  confidence: number
  uncertaintyRange: [number, number]
  lastUpdatedWeek: number
}

// ---------- market (spec §8) -----------------------------------------------------------------

export interface SegmentAttributePreference {
  attributeId: string
  /** normalized weight 0..1 */
  importance: number
  /** ideal-point 0..100; monotonic prefs use ideal 100 */
  idealValue: number
  minimumThreshold?: number
  /** utility penalty 0..1 applied below the threshold */
  thresholdPenalty?: number
}

export interface MarketSegmentV2 {
  id: string
  name: string
  // truth
  potentialCustomers: number
  /** share of the pool actively in-market in a given year */
  activeDemandRate: number
  growthRateAnnual: number
  adoptionMaturity: number // 0..1 — feeds the outside option
  // economics (truth)
  baseWtp: number // $/week reference
  priceSensitivity: number // 0..1
  switchingFriction: number // 0..1
  retentionBaseline: number // weekly keep 0..1
  /** weekly revenue-per-customer growth potential for retained cohorts (spec §20.4) */
  expansionRate: number
  /** how cheaply paid channels can reach this segment (0..1 — enterprise is barely paid-reachable) */
  paidAccessibility: number
  /** whether winning them takes a human sales motion (capacity-gated, spec §18.6) */
  salesLed: boolean
  // preferences (truth)
  attributePreferences: SegmentAttributePreference[]
  brandImportance: number // 0..1
  // knowledge — what the player can see (estimates over the truths above)
  knowledge: {
    size: EstimatedValue
    wtp: EstimatedValue
    retention: EstimatedValue
  }
}

// ---------- product (spec §11) ---------------------------------------------------------------

export interface ProductAttributeV2 {
  id: string
  label: string
  value: number // 0..100
  technicalCeiling: number
  decayRate: number // weekly drift toward entropy without maintenance
}

// ---------- pricing (spec §13) ---------------------------------------------------------------

export interface PricingStateV2 {
  /** $/week per customer the player charges (derived from the pricing strategy until the
   *  dedicated dial ships) */
  price: number
  lastChangedWeek: number
}

// ---------- competitors (spec §21) -----------------------------------------------------------

export interface CompetitorV2 {
  id: string // matches s.rivals[].id so the two views never split
  name: string
  price: number
  /** product attribute levels 0..100, same attribute ids as the player's */
  attributes: Record<string, number>
  brand: number // 0..100
  /** which segments they actually court (weights 0..1) */
  segmentFocus: Record<string, number>
  /** last week's realized choice share by segment (for events + intel) */
  lastShare: Record<string, number>
  /** an aggressive reprice window: price runs 25% under posture until this week (phase 5) */
  discountUntil?: number
}

// ---------- cohorts (spec §20, filled in phase 2) --------------------------------------------

export interface CustomerCohortV2 {
  id: string
  segmentId: string
  acquiredWeek: number
  size: number
  priceAtAcquisition: number
  fitAtAcquisition: number
  /** revenue multiplier from seat/usage growth — retained customers deepen (spec §20.4) */
  expansion: number
}

// ---------- finance (spec §22, filled in phase 2) --------------------------------------------

export interface FinanceStateV2 {
  revenue: number
  cogs: number
  opex: number
  netIncome: number
  /** the week's revenue decomposition — the Capital P&L's driver panel reads THIS (spec §22.5) */
  revenueDrivers: { newBusiness: number; expansion: number; churnLoss: number }
}

export interface GtmStateV2 {
  /** EMA of recent paid spend — the saturation memory (spec §18.4): the channel remembers */
  paidSaturationEma: number
  /** last week's realized CAC (paid spend / new customers) — truth, not estimate */
  lastCac: number
}

// ---------- planning / confidence (phase 3 placeholders kept minimal on purpose) -------------

export interface PlanningStateV2 {
  /** management's rolling belief: each week we project revenue 4 weeks out from trailing
   *  growth; Plan vs Actual compares today against the projection made 4 weeks ago (spec §15.6) */
  forecastLog: { week: number; projectedRevenue: number; macroAtForecast: number }[]
  commitments: BoardCommitment[]
}

export interface BoardCommitment {
  id: string
  createdWeek: number
  dueWeek: number
  metricId?: string
  milestoneId?: string
  targetValue?: number
  importance: number
  ambition: number
  status: 'on_track' | 'at_risk' | 'missed' | 'delivered' | 'reforecasted'
}

export interface ConfidenceState {
  /** 0..100 */
  value: number
  driverHistory: { week: number; driverId: string; delta: number }[]
}

// ---------- research (phase 4) ---------------------------------------------------------------

export interface PendingResearchV2 {
  id: string
  kind: string
  startedWeek: number
  completesWeek: number
  targetId: string
}

// ---------- weekly snapshot (spec §0A.4) -----------------------------------------------------

/** The compact weekly record every engagement system reads: charts, chapters, milestones,
 *  objectives, identity, postmortem. Facts only — small enough to keep for a whole run. */
export interface SimV2Snapshot {
  week: number
  customers: number
  revenue: number
  netIncome: number
  cash: number
  price: number
  /** player choice share by segment (realized preference, not sales) */
  choiceShare: Record<string, number>
  newCustomers: number
  churnedCustomers: number
  paidSpend: number
  cac: number
  productFit: Record<string, number>
  attributes: Record<string, number>
  brand: number
  boardConfidence: number
  investorConfidence: number
  /** this week's actual vs the 4-week-old projection, as a fraction (0 = on plan) */
  planVariance: number
  serviceUtilization: number
  serviceQuality: number
  /** ids of this week's KNOWN events, for the postmortem's turning points */
  eventIds: string[]
}

// ---------- root state (spec §32) ------------------------------------------------------------

export interface BusinessSimulationV2State {
  version: 2
  segments: MarketSegmentV2[]
  attributes: ProductAttributeV2[]
  pricing: PricingStateV2
  gtm: GtmStateV2
  competitors: CompetitorV2[]
  cohorts: CustomerCohortV2[]
  finance: FinanceStateV2
  planning: PlanningStateV2
  boardConfidence: ConfidenceState
  investorConfidence: ConfidenceState
  pendingResearch: PendingResearchV2[]
  /** functional operating capacity, v1 domain: SERVICE (spec §19). Quality 0-100 degrades under
   *  sustained overload and heals under slack; folds into cohort retention exactly once. */
  serviceQuality: number
  overloadWeeks: number
  /** this week's emissions (replaced each resolution) */
  events: SimulationEvent[]
  explanations: SimulationExplanation[]
  /** capped rolling history — the engagement layer's raw material */
  weeklyHistory: SimV2Snapshot[]
  /** novelty memory for the ranker: event type → last week seen */
  lastSeen: Record<string, number>
  /** milestones already fired (once, ever) */
  firedMilestones: string[]
  chapter: string
}

// ---------- evaluator interfaces (spec §0A.8/9/15, phase 0 contracts) ------------------------

export interface MilestoneDef {
  id: string
  /** fires when false→true across consecutive snapshots; fires ONCE per run */
  reached: (prev: SimV2Snapshot | undefined, now: SimV2Snapshot) => boolean
  headline: (now: SimV2Snapshot) => string
}

export interface ChapterDef {
  id: string
  name: string
  /** entry condition, evaluated in order — the LAST satisfied chapter wins */
  entered: (now: SimV2Snapshot, history: SimV2Snapshot[]) => boolean
}

export interface ObjectiveDef {
  id: string
  source: 'chapter' | 'bigbet' | 'board' | 'crisis' | 'scenario'
  text: string
  /** 0..1 progress from real state */
  progress: (now: SimV2Snapshot, history: SimV2Snapshot[]) => number
  dueWeek?: number
}

export interface MajorMomentTrigger {
  id: string
  /** reads the week's events + state; returning true makes the moment ELIGIBLE — the
   *  engagement layer decides presentation. Never applies economics. */
  eligible: (events: SimulationEvent[], now: SimV2Snapshot, history: SimV2Snapshot[]) => boolean
}
