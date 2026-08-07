// What the world considers memorable, and what each new event drags back up with it.
//
// Content, not state (§63): nothing here is persisted, only the keys that point into it. Numbers
// are the *default* weight of a fact — a caller that knows better (a layoff of 1 vs a layoff of 20)
// overrides them. They are not balance knobs: memory never changes a simulation outcome, it only
// decides which true fact gets retold first.

import type { CompanyMemoryType, MemoryTag, MemoryType } from '../types'

/**
 * The tag slugs the shipped cues use. Not a closed set — MemoryTag stays free-form so a new
 * fragment pool can invent its own — but matching against this list is what makes an event
 * recorded by the hiring code find a memory recorded by the layoff code.
 */
export const COMMON_MEMORY_TAGS = [
  'leadership',
  'engineering',
  'sales',
  'promotion',
  'compensation',
  'equity',
  'headcount',
  'layoff',
  'hiring',
  'departure',
  'trust',
  'recognition',
  'blame',
  'crisis',
  'outage',
  'quality',
  'strategy',
  'pivot',
  'funding',
  'growth',
  'revenue',
  'customers',
  'board',
  'rival',
  'burnout',
  'workload',
] as const satisfies readonly MemoryTag[]

export interface MemoryTypeDefault {
  importance: number
  /** Signed. Betrayal and recognition are the same magnitude with opposite valence. */
  emotionalImpact: number
  tags: MemoryTag[]
}

/**
 * Baseline weight per memory type. Betrayal and broken promises sit highest because they are the
 * memories that must still be reachable 60 weeks later; routine successes sit low so they fall out
 * of the per-character cap first.
 */
export const MEMORY_TYPE_DEFAULTS: Record<MemoryType, MemoryTypeDefault> = {
  promise: { importance: 85, emotionalImpact: 55, tags: ['trust'] },
  promotion: { importance: 75, emotionalImpact: 70, tags: ['promotion', 'recognition'] },
  rejection: { importance: 65, emotionalImpact: -55, tags: ['recognition'] },
  conflict: { importance: 60, emotionalImpact: -50, tags: ['trust'] },
  support: { importance: 45, emotionalImpact: 40, tags: ['trust'] },
  success: { importance: 40, emotionalImpact: 45, tags: ['recognition'] },
  failure: { importance: 45, emotionalImpact: -40, tags: ['blame'] },
  betrayal: { importance: 95, emotionalImpact: -90, tags: ['trust', 'blame'] },
  recognition: { importance: 55, emotionalImpact: 60, tags: ['recognition'] },
  layoff: { importance: 90, emotionalImpact: -75, tags: ['layoff', 'headcount'] },
  crisis: { importance: 70, emotionalImpact: -35, tags: ['crisis'] },
  hire: { importance: 35, emotionalImpact: 15, tags: ['hiring', 'headcount'] },
  strategy_change: { importance: 55, emotionalImpact: -15, tags: ['strategy'] },
}

export interface CompanyMemoryDefault {
  importance: number
  tags: MemoryTag[]
}

export const COMPANY_MEMORY_DEFAULTS: Record<CompanyMemoryType, CompanyMemoryDefault> = {
  first_customer: { importance: 80, tags: ['customers', 'growth'] },
  first_revenue: { importance: 80, tags: ['revenue'] },
  first_hire: { importance: 70, tags: ['hiring', 'headcount'] },
  funding_round: { importance: 90, tags: ['funding', 'board'] },
  pivot: { importance: 85, tags: ['pivot', 'strategy'] },
  major_customer: { importance: 65, tags: ['customers', 'revenue'] },
  major_loss: { importance: 70, tags: ['customers', 'revenue', 'blame'] },
  layoff: { importance: 95, tags: ['layoff', 'headcount'] },
  outage: { importance: 75, tags: ['outage', 'crisis', 'quality'] },
  acquisition: { importance: 90, tags: ['strategy', 'growth'] },
  profitability: { importance: 85, tags: ['revenue'] },
  pmf: { importance: 90, tags: ['customers', 'growth', 'strategy'] },
  record_growth: { importance: 55, tags: ['growth', 'customers'] },
  record_revenue: { importance: 55, tags: ['revenue', 'growth'] },
  crisis: { importance: 75, tags: ['crisis'] },
}

/**
 * Types that can only ever happen once. Recorded twice, the second one is dropped rather than
 * overwriting the first — "our first customer" must keep pointing at week 6 forever.
 */
export const ONCE_ONLY_COMPANY_MEMORY: readonly CompanyMemoryType[] = [
  'first_customer',
  'first_revenue',
  'first_hire',
  'pmf',
  'profitability',
]

/**
 * Types a "since the ..." comparison is allowed to anchor on. A record month is not an era; a
 * funding round, a pivot or a layoff is.
 */
export const ERA_COMPANY_MEMORY: readonly CompanyMemoryType[] = [
  'funding_round',
  'pivot',
  'layoff',
  'acquisition',
  'pmf',
  'first_customer',
  'profitability',
]

export interface MemoryCueDef {
  /** Tags the event itself carries into the matcher. */
  tags: MemoryTag[]
  /**
   * Specific summaryKeys this event dredges up regardless of tag overlap — §13's pairing.
   * Hiring an external CTO is what makes a 30-week-old leadership promise the loudest thing
   * in the room, and no amount of tag scoring alone gets there reliably.
   */
  recalls?: string[]
  /** Memory types this event makes salient even when the summaryKey does not match. */
  recallTypes?: MemoryType[]
}

/** Stable keys a promise can be filed under. Fragment pools key their wording off these. */
export const PROMISE_KEYS = {
  engineeringLeadership: 'promised_engineering_leadership',
  promotion: 'promised_promotion',
  raise: 'promised_raise',
  equity: 'promised_equity',
  headcount: 'promised_headcount',
  noLayoffs: 'promised_no_layoffs',
  betterHours: 'promised_better_hours',
  autonomy: 'promised_autonomy',
  shipDate: 'promised_ship_date',
} as const

/**
 * Event key → what happening now makes people remember. Callers pass an unknown key freely; an
 * unlisted key simply scores on its own tags, which is why the cue is a hint and not a schema.
 */
export const MEMORY_CUES: Record<string, MemoryCueDef> = {
  external_cto_hired: {
    tags: ['leadership', 'engineering', 'hiring', 'promotion'],
    recalls: [PROMISE_KEYS.engineeringLeadership, PROMISE_KEYS.promotion, PROMISE_KEYS.autonomy],
    recallTypes: ['promise', 'rejection'],
  },
  external_exec_hired: {
    tags: ['leadership', 'hiring', 'promotion'],
    recalls: [PROMISE_KEYS.promotion, PROMISE_KEYS.autonomy],
    recallTypes: ['promise'],
  },
  promotion_given: { tags: ['promotion', 'recognition', 'leadership'], recallTypes: ['promise', 'rejection'] },
  promotion_passed_over: {
    tags: ['promotion', 'recognition', 'leadership'],
    recalls: [PROMISE_KEYS.promotion, PROMISE_KEYS.engineeringLeadership],
    recallTypes: ['promise', 'support'],
  },
  raise_given: { tags: ['compensation', 'recognition'], recalls: [PROMISE_KEYS.raise] },
  raise_refused: { tags: ['compensation'], recalls: [PROMISE_KEYS.raise, PROMISE_KEYS.equity], recallTypes: ['promise'] },
  layoff: {
    tags: ['layoff', 'headcount', 'trust'],
    recalls: [PROMISE_KEYS.noLayoffs, PROMISE_KEYS.headcount],
    recallTypes: ['promise', 'support'],
  },
  employee_quit: { tags: ['departure', 'headcount', 'trust'], recallTypes: ['conflict', 'promise', 'support'] },
  employee_poached: { tags: ['departure', 'rival', 'compensation'], recalls: [PROMISE_KEYS.raise, PROMISE_KEYS.equity] },
  outage: { tags: ['outage', 'crisis', 'quality', 'blame'], recallTypes: ['crisis', 'support', 'failure'] },
  crunch: { tags: ['workload', 'burnout'], recalls: [PROMISE_KEYS.betterHours, PROMISE_KEYS.headcount] },
  missed_payroll: { tags: ['compensation', 'crisis', 'trust'], recallTypes: ['promise', 'betrayal'] },
  funding_round: { tags: ['funding', 'board', 'equity', 'growth'], recalls: [PROMISE_KEYS.equity, PROMISE_KEYS.headcount] },
  down_round: { tags: ['funding', 'equity', 'crisis'], recalls: [PROMISE_KEYS.equity] },
  pivot: { tags: ['pivot', 'strategy'], recallTypes: ['strategy_change', 'promise', 'conflict'] },
  strategy_change: { tags: ['strategy'], recallTypes: ['strategy_change', 'conflict'] },
  ship_slipped: { tags: ['quality', 'strategy', 'blame'], recalls: [PROMISE_KEYS.shipDate] },
  quality_collapse: { tags: ['quality', 'blame'], recallTypes: ['conflict', 'failure'] },
  rival_raised: { tags: ['rival', 'funding', 'strategy'], recallTypes: ['strategy_change'] },
  board_pressure: { tags: ['board', 'strategy', 'blame'], recallTypes: ['conflict', 'promise'] },
  hire_made: { tags: ['hiring', 'headcount'], recalls: [PROMISE_KEYS.headcount] },
  performance_review: { tags: ['recognition', 'promotion'], recallTypes: ['promise', 'recognition', 'rejection'] },
  one_on_one: { tags: ['trust'], recallTypes: ['promise', 'conflict', 'support'] },
  exit_interview: { tags: ['departure', 'trust'], recallTypes: ['promise', 'betrayal', 'conflict', 'rejection'] },
  postmortem: { tags: ['strategy', 'trust'], recallTypes: ['betrayal', 'promise', 'layoff', 'crisis'] },
}
