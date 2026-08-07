// What the simulation did, expressed as movement in four relationship dimensions.
//
// Every entry here is keyed by something the simulation ALREADY produced — a raise was paid, a
// round closed, payroll was missed. Narrative never appears in this table and never adds a fact:
// prose reads relationships, it does not write them (§64).
//
// The numbers are pre-modulation base deltas on the 0–100 scale, for a fact of typical size
// (magnitude 1). Personality, motivation, loss-aversion and headroom are applied on top in
// relationships.ts — keep this table about WHAT HAPPENED, not about who is feeling it.

import type { CharacterMotivation, MemoryTag, RelationshipScores } from '../types'

/** Personal facts are things the founder did to this person; company facts happened to everyone. */
export type RelationshipFactScope = 'personal' | 'company'

export interface RelationshipFactDef {
  scope: RelationshipFactScope
  /** Absent dimensions do not move. */
  base: Partial<RelationshipScores>
  /**
   * Read by the personality modulator, and reused verbatim as memory tags by the memory module
   * so the same event is described in the same vocabulary everywhere.
   */
  tags: MemoryTag[]
  /** Characters who want these things feel this fact harder — primary more than secondary. */
  motives?: CharacterMotivation[]
  /**
   * True when the fact is a direct exchange with the founder. Only these reset
   * lastMeaningfulInteractionWeek: living through the same funding round is not "we spoke".
   */
  interaction?: boolean
}

export type RelationshipFactKind =
  // ---- personal: things the founder did to this person
  | 'joined'
  | 'raise_given'
  | 'raise_denied'
  | 'pay_cut'
  | 'equity_granted'
  | 'promoted'
  | 'passed_over'
  | 'role_narrowed'
  | 'praised'
  | 'criticised'
  | 'one_on_one'
  | 'request_granted'
  | 'request_denied'
  | 'promise_made'
  | 'promise_kept'
  | 'promise_broken'
  | 'overworked'
  | 'workload_relieved'
  | 'counter_offer_matched'
  | 'outside_offer_declined'
  | 'peer_departed'
  | 'peer_laid_off'
  | 'survived_layoff'
  // ---- company: facts the whole company lived through
  | 'funding_round'
  | 'funding_failed'
  | 'missed_payroll'
  | 'runway_crisis'
  | 'layoff_round'
  | 'pivot'
  | 'strategy_change'
  | 'outage'
  | 'crisis_handled'
  | 'growth_record'
  | 'revenue_record'
  | 'pmf_reached'
  | 'major_customer_won'
  | 'major_customer_lost'
  | 'product_shipped'
  | 'board_strike'
  | 'board_defied'
  | 'ipo_filed'
  | 'acquisition'
  | 'rival_surged'

export const RELATIONSHIP_FACTS: Record<RelationshipFactKind, RelationshipFactDef> = {
  // ---------- personal ----------
  joined: {
    scope: 'personal',
    base: { trust: 8, respect: 4, alignment: 6, dependence: 10 },
    tags: ['hire', 'onboarding'],
    interaction: true,
  },
  raise_given: {
    scope: 'personal',
    base: { trust: 6, respect: 2, dependence: 5 },
    tags: ['money', 'fairness', 'compensation'],
    motives: ['money'],
    interaction: true,
  },
  raise_denied: {
    scope: 'personal',
    base: { trust: -7, respect: -3, alignment: -2, dependence: -3 },
    tags: ['money', 'fairness', 'compensation', 'rejection'],
    motives: ['money'],
    interaction: true,
  },
  pay_cut: {
    scope: 'personal',
    base: { trust: -12, respect: -6, alignment: -4, dependence: -6 },
    tags: ['money', 'fairness', 'compensation'],
    motives: ['money', 'stability'],
    interaction: true,
  },
  equity_granted: {
    scope: 'personal',
    base: { trust: 7, respect: 3, alignment: 6, dependence: 12 },
    tags: ['money', 'ownership', 'recognition'],
    motives: ['money', 'mission'],
    interaction: true,
  },
  promoted: {
    scope: 'personal',
    base: { trust: 10, respect: 5, alignment: 7, dependence: 10 },
    tags: ['promotion', 'status', 'recognition'],
    motives: ['career_progression', 'status', 'power'],
    interaction: true,
  },
  // Someone brought in above them. The single sharpest personal fact in the game — §93's whole story.
  passed_over: {
    scope: 'personal',
    base: { trust: -14, respect: -6, alignment: -8, dependence: -8 },
    tags: ['promotion', 'status', 'fairness', 'rejection'],
    motives: ['career_progression', 'status', 'recognition'],
    interaction: true,
  },
  role_narrowed: {
    scope: 'personal',
    base: { trust: -6, respect: -3, alignment: -6, dependence: -3 },
    tags: ['status', 'autonomy'],
    motives: ['autonomy', 'career_progression'],
    interaction: true,
  },
  praised: {
    scope: 'personal',
    base: { trust: 3, respect: 1, alignment: 2, dependence: 1 },
    tags: ['recognition', 'support'],
    motives: ['recognition'],
    interaction: true,
  },
  criticised: {
    scope: 'personal',
    base: { trust: -4, alignment: -2, dependence: -1 },
    tags: ['recognition', 'fairness', 'conflict'],
    motives: ['recognition'],
    interaction: true,
  },
  one_on_one: {
    scope: 'personal',
    base: { trust: 4, respect: 1, alignment: 3, dependence: 1 },
    tags: ['attention', 'support'],
    interaction: true,
  },
  request_granted: {
    scope: 'personal',
    base: { trust: 5, respect: 2, alignment: 3, dependence: 2 },
    tags: ['autonomy', 'fairness', 'support'],
    motives: ['autonomy'],
    interaction: true,
  },
  request_denied: {
    scope: 'personal',
    base: { trust: -6, respect: -2, alignment: -4, dependence: -2 },
    tags: ['autonomy', 'fairness', 'rejection'],
    motives: ['autonomy'],
    interaction: true,
  },
  // A promise buys goodwill up front — which is exactly why breaking one costs more than it bought.
  promise_made: {
    scope: 'personal',
    base: { trust: 3, alignment: 4, dependence: 2 },
    tags: ['promise', 'expectation'],
    interaction: true,
  },
  promise_kept: {
    scope: 'personal',
    base: { trust: 12, respect: 6, alignment: 5, dependence: 4 },
    tags: ['promise', 'fairness', 'support'],
    interaction: true,
  },
  promise_broken: {
    scope: 'personal',
    base: { trust: -20, respect: -8, alignment: -9, dependence: -6 },
    tags: ['promise', 'fairness', 'betrayal'],
    interaction: true,
  },
  overworked: {
    scope: 'personal',
    base: { trust: -5, respect: -2, alignment: -3, dependence: -2 },
    tags: ['workload'],
    motives: ['work_life_balance', 'stability'],
  },
  workload_relieved: {
    scope: 'personal',
    base: { trust: 4, respect: 2, alignment: 2, dependence: 1 },
    tags: ['workload', 'support'],
    motives: ['work_life_balance'],
    interaction: true,
  },
  counter_offer_matched: {
    scope: 'personal',
    base: { trust: 5, respect: 3, alignment: 1, dependence: 6 },
    tags: ['money', 'recognition', 'compensation'],
    motives: ['money'],
    interaction: true,
  },
  outside_offer_declined: {
    scope: 'personal',
    base: { trust: 6, respect: 2, alignment: 5, dependence: 8 },
    tags: ['loyalty'],
    interaction: true,
  },
  peer_departed: {
    scope: 'personal',
    base: { trust: -3, respect: -2, alignment: -3, dependence: -4 },
    tags: ['peer', 'departure'],
  },
  peer_laid_off: {
    scope: 'personal',
    base: { trust: -8, respect: -4, alignment: -5, dependence: -5 },
    tags: ['peer', 'layoff', 'stability', 'fairness'],
    motives: ['stability'],
  },
  // Keeping your job while others lose theirs binds you to the company and costs you sleep.
  survived_layoff: {
    scope: 'personal',
    base: { trust: -4, respect: -2, alignment: -2, dependence: 4 },
    tags: ['layoff', 'stability'],
    motives: ['stability'],
  },

  // ---------- company ----------
  funding_round: {
    scope: 'company',
    base: { trust: 5, respect: 10, alignment: 6, dependence: 6 },
    tags: ['funding', 'momentum', 'money'],
    motives: ['money', 'status', 'winning'],
  },
  funding_failed: {
    scope: 'company',
    base: { trust: -4, respect: -9, alignment: -4, dependence: -3 },
    tags: ['funding', 'risk', 'stability'],
    motives: ['stability'],
  },
  missed_payroll: {
    scope: 'company',
    base: { trust: -18, respect: -14, alignment: -8, dependence: -10 },
    tags: ['money', 'stability', 'risk', 'crisis'],
    motives: ['money', 'stability'],
  },
  runway_crisis: {
    scope: 'company',
    base: { trust: -6, respect: -8, alignment: -4, dependence: -4 },
    tags: ['risk', 'stability', 'crisis'],
    motives: ['stability'],
  },
  layoff_round: {
    scope: 'company',
    base: { trust: -12, respect: -7, alignment: -8, dependence: -6 },
    tags: ['layoff', 'peer', 'stability', 'fairness'],
    motives: ['stability'],
  },
  pivot: {
    scope: 'company',
    base: { trust: -3, respect: -4, alignment: -12, dependence: -3 },
    tags: ['strategy', 'risk', 'mission'],
    motives: ['mission'],
  },
  strategy_change: {
    scope: 'company',
    base: { trust: -1, respect: -2, alignment: -7, dependence: -1 },
    tags: ['strategy'],
    motives: ['mission', 'autonomy'],
  },
  outage: {
    scope: 'company',
    base: { trust: -2, respect: -6, alignment: -2, dependence: -1 },
    tags: ['crisis', 'competence'],
  },
  crisis_handled: {
    scope: 'company',
    base: { trust: 7, respect: 11, alignment: 5, dependence: 3 },
    tags: ['crisis', 'competence', 'support'],
    motives: ['winning', 'learning'],
  },
  growth_record: {
    scope: 'company',
    base: { trust: 2, respect: 7, alignment: 5, dependence: 3 },
    tags: ['momentum', 'competence'],
    motives: ['winning', 'status'],
  },
  revenue_record: {
    scope: 'company',
    base: { trust: 2, respect: 7, alignment: 4, dependence: 4 },
    tags: ['momentum', 'money'],
    motives: ['money', 'winning'],
  },
  pmf_reached: {
    scope: 'company',
    base: { trust: 4, respect: 9, alignment: 9, dependence: 5 },
    tags: ['momentum', 'mission', 'competence'],
    motives: ['mission', 'winning'],
  },
  major_customer_won: {
    scope: 'company',
    base: { trust: 2, respect: 6, alignment: 4, dependence: 2 },
    tags: ['momentum', 'customer'],
    motives: ['winning'],
  },
  major_customer_lost: {
    scope: 'company',
    base: { trust: -2, respect: -6, alignment: -4, dependence: -2 },
    tags: ['risk', 'customer'],
  },
  product_shipped: {
    scope: 'company',
    base: { trust: 1, respect: 3, alignment: 2, dependence: 1 },
    tags: ['competence', 'product'],
    motives: ['learning'],
  },
  board_strike: {
    scope: 'company',
    base: { trust: -4, respect: -8, alignment: -3, dependence: -3 },
    tags: ['board', 'risk', 'competence'],
  },
  // Standing up to the board reads as conviction to the people who work for you, and as risk to
  // the ones who wanted a quiet year. The personality modulator sorts out which is which.
  board_defied: {
    scope: 'company',
    base: { trust: 4, respect: 5, alignment: 5, dependence: -2 },
    tags: ['board', 'risk', 'autonomy'],
    motives: ['autonomy', 'power'],
  },
  ipo_filed: {
    scope: 'company',
    base: { trust: 4, respect: 9, alignment: 6, dependence: 9 },
    tags: ['momentum', 'money', 'status'],
    motives: ['money', 'status'],
  },
  // The exit is a win and an ending: respect goes up, the reason to stay goes away.
  acquisition: {
    scope: 'company',
    base: { trust: -2, respect: 7, alignment: -6, dependence: -12 },
    tags: ['money', 'stability', 'strategy'],
    motives: ['money'],
  },
  rival_surged: {
    scope: 'company',
    base: { respect: -4, alignment: -3, dependence: -2 },
    tags: ['rival', 'risk', 'competence'],
    motives: ['winning'],
  },
}

export const RELATIONSHIP_FACT_KINDS = Object.keys(RELATIONSHIP_FACTS).sort() as RelationshipFactKind[]
