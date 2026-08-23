// Strategic Systems Expansion — shared types (master brief v3; docs/strategic-systems-
// implementation.md is the execution contract). State slices are OPTIONAL on GameState:
// absent means default, so no save is ever invalidated.

import type { SegmentId } from '../career/types'

// ---------- depth model (brief §3) ----------

export type SystemDepth = 'off' | 'light' | 'deep' | 'competitive'

export interface SystemDepthConfig {
  roadmap: SystemDepth
  bigBets: SystemDepth
  aiAdoption: SystemDepth
  strategicCoherence: SystemDepth
  founderAttention: SystemDepth
  managementCapacity: SystemDepth
  livingWorld: SystemDepth
  boardMeetings: SystemDepth
}

// ---------- product roadmap (brief §6) ----------

export type RoadmapInitiativeType =
  | 'customer_feature'
  | 'cro'
  | 'platform'
  | 'infrastructure'
  | 'internal_system'
  | 'growth_system'
  | 'technical_debt'

/** Impact points are a BUDGET (0–3 per axis, ≤6 total per item) — the engine maps points to
 *  bounded effects through strategic/effects.ts, never raw multipliers in content. */
export interface RoadmapImpact {
  acquisition?: number
  retention?: number
  monetization?: number
  productQuality?: number
  reliability?: number
  developerVelocity?: number
  operatingEfficiency?: number
}

export interface RoadmapInitiativeDef {
  id: string
  sector: string
  type: RoadmapInitiativeType
  name: string
  blurb: string
  /** base build weeks at REFERENCE velocity (6 eng points/wk) — a stronger team beats this */
  weeks: number
  impact: RoadmapImpact
  /** value multiplier by target segment (career reads it; quick uses the mean) */
  segmentImpact: Partial<Record<SegmentId, number>>
  techDebtCreated?: number
  techDebtReduced?: number
  /** the ~4 iconic items Quick Run exposes */
  quickPool?: boolean
  /** only offered from Series A on */
  lateStage?: boolean
  /** CRO items: the funnel stage they optimise (presentation + future funnel work) */
  targetStage?: 'landing' | 'signup' | 'activation' | 'monetisation'
}

export interface ActiveRoadmapItem {
  id: string
  startedWeek: number
  /** accumulated effort points toward weeks×REFERENCE_VELOCITY */
  progress: number
}

export interface RoadmapState {
  active: ActiveRoadmapItem[]
  /** NEXT, in order — pulled into a free slot automatically */
  queued: string[]
  done: { id: string; week: number }[]
  /** 0–100 technical debt — fed by rushed work, paid down by debt items */
  debt: number
}

export const createDefaultRoadmap = (): RoadmapState => ({ active: [], queued: [], done: [], debt: 0 })

// ---------- big bets (brief §7) — phase 2 ----------

export type BigBetType =
  | 'enterprise_readiness'
  | 'consumer_viral_engine'
  | 'platform_play'
  | 'ai_transformation'
  | 'margin_expansion'
  | 'geographic_expansion'

export interface BigBetState {
  type: BigBetType
  startedWeek: number
  targetWeek: number
  status: 'active' | 'completed' | 'abandoned' | 'failed'
  progress: number // 0–100
  milestones: { id: string; doneWeek?: number }[]
  /** set on abandonment — a short strategic-confusion shadow reads it (effects.ts) */
  abandonedWeek?: number
}

// ---------- founder attention (brief §9) — phase 3 ----------

export type FounderAttentionArea =
  | 'product'
  | 'customers'
  | 'recruiting'
  | 'fundraising'
  | 'leadership'
  | 'operations'

export interface AttentionState {
  /** light depths: exactly one focus */
  focus: FounderAttentionArea | null
  /** deep: weekly point allocation (sums to the budget) */
  allocated?: Partial<Record<FounderAttentionArea, number>>
  /** 0–100 per area — grows with sustained direct involvement, relieved by delegation */
  dependency: Partial<Record<FounderAttentionArea, number>>
}

// ---------- growth engine (CRO + marketing mix brief) ----------

export interface GrowthState {
  /** 0–1 of the marketing budget going to PERFORMANCE; the rest builds BRAND. Default 1 —
   *  exactly the pre-expansion behaviour, so the system is inert until touched. */
  performanceShare: number
  lastMixWeek: number
  brand: {
    /** 0–100, the compounding demand-creation asset */
    stock: number
    /** investments in flight — they mature BRAND_LAG_WEEKS after the spend */
    pending: { week: number; gain: number }[]
  }
}

// ---------- AI adoption (brief §5) — phase 5 ----------

export type AIAdoptionArea = 'engineering' | 'marketing' | 'sales' | 'support' | 'operations'

/** 0 none · 1 tools · 2 workflow · 3 integrated · 4 ai_native */
export type AIMaturity = 0 | 1 | 2 | 3 | 4

export interface AIAdoptionState {
  areas: Partial<Record<AIAdoptionArea, { maturity: AIMaturity; quality: number; resistance: number }>>
  active: { id: string; area: AIAdoptionArea; progress: number; startedWeek: number }[]
}
