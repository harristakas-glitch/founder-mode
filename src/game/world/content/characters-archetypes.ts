// Character generation content: the distributions a person is drawn from.
//
// Everything here is a WEIGHT, never an outcome. The generator turns (seed, identity key) into
// a stream of numbers; these tables decide what that stream is choosing between. Keeping them
// out of characters.ts means a designer can retune a role without reading the generator, and
// means the generator has no literals of its own to drift from.
//
// Personality coefficients are applied to the normalised value (v - 50) / 50, so a coefficient
// of 1.0 means "this dimension at 100 adds one whole unit of weight".

import type {
  BackgroundStrength,
  BackgroundWeakness,
  CareerStage,
  CharacterMotivation,
  CharacterPersonality,
  CharacterRole,
  CommunicationStyle,
  JoinMotivation,
  PersonalityDimension,
  PreviousEnvironment,
  RivalArchetype,
} from '../types'
import type { Role, SectorId } from '../../types'
import type { TraitId } from '../../types'

/** Alphabetical, and iterated in this order everywhere: draw order must not depend on key order. */
export const PERSONALITY_DIMENSIONS: readonly PersonalityDimension[] = [
  'ambition',
  'directness',
  'ego',
  'empathy',
  'loyalty',
  'optimism',
  'patience',
  'riskTolerance',
]

export const COMMUNICATION_STYLES: readonly CommunicationStyle[] = [
  'analytical',
  'blunt',
  'cautious',
  'direct',
  'enthusiastic',
  'formal',
  'warm',
]

export const MOTIVATIONS: readonly CharacterMotivation[] = [
  'autonomy',
  'career_progression',
  'learning',
  'mission',
  'money',
  'power',
  'recognition',
  'stability',
  'status',
  'winning',
  'work_life_balance',
]

export const PREVIOUS_ENVIRONMENTS: readonly PreviousEnvironment[] = [
  'agency',
  'consulting',
  'corporate',
  'scaleup',
  'startup',
  'university',
]

export type PersonalityWeights = Partial<Record<PersonalityDimension, number>>

/** Mean personality per role. Spread is applied on top, so these are centres and not ceilings. */
export const ROLE_PERSONALITY: Record<CharacterRole, CharacterPersonality> = {
  employee: { directness: 50, ambition: 52, patience: 52, loyalty: 55, optimism: 52, ego: 45, riskTolerance: 48, empathy: 55 },
  executive: { directness: 62, ambition: 72, patience: 45, loyalty: 48, optimism: 55, ego: 62, riskTolerance: 55, empathy: 48 },
  investor: { directness: 68, ambition: 70, patience: 40, loyalty: 35, optimism: 52, ego: 60, riskTolerance: 72, empathy: 40 },
  board_member: { directness: 60, ambition: 58, patience: 55, loyalty: 45, optimism: 45, ego: 58, riskTolerance: 45, empathy: 42 },
  customer: { directness: 55, ambition: 40, patience: 45, loyalty: 45, optimism: 45, ego: 42, riskTolerance: 32, empathy: 50 },
  rival_founder: { directness: 62, ambition: 80, patience: 35, loyalty: 40, optimism: 65, ego: 70, riskTolerance: 75, empathy: 38 },
  recruiter: { directness: 55, ambition: 58, patience: 50, loyalty: 35, optimism: 70, ego: 48, riskTolerance: 50, empathy: 62 },
  journalist: { directness: 70, ambition: 55, patience: 45, loyalty: 30, optimism: 40, ego: 55, riskTolerance: 50, empathy: 45 },
  advisor: { directness: 58, ambition: 45, patience: 70, loyalty: 60, optimism: 50, ego: 42, riskTolerance: 45, empathy: 65 },
  founder: { directness: 58, ambition: 78, patience: 40, loyalty: 55, optimism: 68, ego: 58, riskTolerance: 72, empathy: 50 },
}

/**
 * How far a role's people scatter from the mean. Employees and customers are the widest because
 * the player meets dozens of them and a narrow spread would make the cast feel interchangeable;
 * board members and investors are tighter because the archetype IS the point.
 */
export const ROLE_SPREAD: Record<CharacterRole, number> = {
  employee: 22,
  executive: 18,
  investor: 16,
  board_member: 16,
  customer: 24,
  rival_founder: 18,
  recruiter: 18,
  journalist: 18,
  advisor: 16,
  founder: 14,
}

/** The four sim roles bias the mean further — a salesperson is not an engineer with a quota. */
export const JOB_ROLE_PERSONALITY: Record<Role, PersonalityWeights> = {
  engineer: { directness: 4, patience: 6, ego: -2, empathy: -4, riskTolerance: -4 },
  designer: { empathy: 6, patience: 2, directness: -4, ego: 2 },
  marketer: { optimism: 8, directness: -2, riskTolerance: 6, empathy: 2 },
  sales: { directness: 8, ambition: 10, patience: -8, riskTolerance: 6, ego: 5 },
}

/**
 * Traits are the strongest single input, deliberately: the Team screen already tells the player
 * "Mercenary", and the living world must not then describe a fiercely loyal person.
 */
export const TRAIT_PERSONALITY: Record<TraitId, PersonalityWeights> = {
  tenx: { ambition: 12, ego: 16, patience: -10, directness: 6 },
  craftsman: { patience: 14, loyalty: 8, ego: -10, directness: -4 },
  mercenary: { loyalty: -22, ambition: 12, empathy: -8, riskTolerance: 8 },
  culture: { empathy: 16, loyalty: 12, optimism: 10, ego: -8 },
  drama: { ego: 14, patience: -12, empathy: -10, directness: 8, optimism: -6 },
}

export interface Affinity {
  base: number
  from: PersonalityWeights
}

export const STYLE_AFFINITY: Record<CommunicationStyle, Affinity> = {
  direct: { base: 1.0, from: { directness: 1.4, empathy: 0.2, patience: -0.3 } },
  blunt: { base: 0.7, from: { directness: 1.6, empathy: -1.0, patience: -0.6, ego: 0.4 } },
  warm: { base: 0.9, from: { empathy: 1.5, optimism: 0.5, directness: -0.3, ego: -0.4 } },
  formal: { base: 0.8, from: { patience: 0.6, ego: 0.4, directness: -0.2, empathy: -0.3, riskTolerance: -0.5 } },
  analytical: { base: 0.9, from: { patience: 0.8, riskTolerance: -0.7, optimism: -0.4, empathy: -0.3, directness: 0.2 } },
  enthusiastic: { base: 0.8, from: { optimism: 1.5, ambition: 0.5, patience: -0.3, empathy: 0.3 } },
  cautious: { base: 0.8, from: { riskTolerance: -1.3, patience: 0.5, optimism: -0.5, directness: -0.4 } },
}

/** A role's professional register, on top of personality — board members write like board members. */
export const STYLE_ROLE_BIAS: Partial<Record<CharacterRole, Partial<Record<CommunicationStyle, number>>>> = {
  investor: { direct: 0.5, analytical: 0.5, blunt: 0.3, warm: -0.3 },
  board_member: { formal: 0.7, analytical: 0.4, warm: -0.3 },
  journalist: { direct: 0.6, blunt: 0.4, formal: -0.2 },
  recruiter: { enthusiastic: 0.7, warm: 0.6, formal: -0.3 },
  customer: { cautious: 0.4, formal: 0.2 },
  advisor: { warm: 0.4, analytical: 0.3 },
  rival_founder: { blunt: 0.3, enthusiastic: 0.3 },
  executive: { direct: 0.3, formal: 0.3 },
}

export const MOTIVATION_AFFINITY: Record<CharacterMotivation, Affinity> = {
  money: { base: 1.0, from: { ambition: 0.5, loyalty: -0.4, empathy: -0.3 } },
  career_progression: { base: 1.0, from: { ambition: 1.0, patience: -0.2 } },
  status: { base: 0.8, from: { ego: 1.2, ambition: 0.4, empathy: -0.3 } },
  autonomy: { base: 0.9, from: { ego: 0.4, patience: -0.3, loyalty: -0.3, riskTolerance: 0.4 } },
  mission: { base: 0.9, from: { empathy: 0.9, loyalty: 0.6, optimism: 0.5, ego: -0.4 } },
  learning: { base: 0.9, from: { patience: 0.5, ego: -0.3, riskTolerance: 0.3 } },
  stability: { base: 0.9, from: { riskTolerance: -1.0, patience: 0.4, loyalty: 0.4, ambition: -0.4 } },
  power: { base: 0.6, from: { ego: 1.0, ambition: 0.8, empathy: -0.5 } },
  winning: { base: 0.7, from: { ambition: 1.0, riskTolerance: 0.5, empathy: -0.4 } },
  recognition: { base: 0.9, from: { ego: 0.9, empathy: 0.2, optimism: 0.2 } },
  work_life_balance: { base: 0.8, from: { ambition: -0.9, patience: 0.4, riskTolerance: -0.4 } },
}

export const MOTIVATION_ROLE_BIAS: Record<CharacterRole, Partial<Record<CharacterMotivation, number>>> = {
  employee: { learning: 0.3, stability: 0.2, work_life_balance: 0.2 },
  executive: { power: 0.5, career_progression: 0.4, money: 0.3, status: 0.3 },
  investor: { money: 0.9, winning: 0.6, status: 0.4, mission: -0.3 },
  board_member: { power: 0.5, status: 0.4, stability: 0.3 },
  customer: { stability: 0.6, autonomy: 0.3, money: 0.3, power: -0.6, career_progression: -0.5, winning: -0.4 },
  rival_founder: { winning: 1.0, status: 0.5, power: 0.4, stability: -0.6, work_life_balance: -0.8 },
  recruiter: { money: 0.5, recognition: 0.4, winning: 0.3 },
  journalist: { recognition: 0.7, status: 0.4, autonomy: 0.3, money: -0.2 },
  advisor: { mission: 0.5, recognition: 0.3, learning: 0.3, power: -0.4 },
  founder: { winning: 0.6, autonomy: 0.6, mission: 0.4, status: 0.3 },
}

/**
 * Pairs that would read as incoherent together. Applied to the secondary draw only: a character
 * whose primary is `power` should not also list `work_life_balance`, because the whole point of
 * motivations is that two people react differently to the same decision.
 */
export const MOTIVATION_CONFLICTS: readonly (readonly [CharacterMotivation, CharacterMotivation])[] = [
  ['work_life_balance', 'power'],
  ['work_life_balance', 'winning'],
  ['work_life_balance', 'career_progression'],
  ['stability', 'winning'],
  ['stability', 'power'],
  ['mission', 'money'],
  ['mission', 'status'],
]

/** Years of experience: [floor, span]. Career stage is derived from the result, never rolled. */
export const ROLE_YEARS: Record<CharacterRole, readonly [number, number]> = {
  employee: [2, 14],
  executive: [9, 14],
  investor: [8, 16],
  board_member: [12, 16],
  customer: [4, 16],
  rival_founder: [5, 14],
  recruiter: [3, 12],
  journalist: [3, 15],
  advisor: [12, 16],
  founder: [3, 10],
}

export const CAREER_STAGE_BOUNDS = { rising: 5, established: 12 } as const

export const ENV_BY_STAGE: Record<CareerStage, Record<PreviousEnvironment, number>> = {
  rising: { startup: 1.4, scaleup: 1.2, corporate: 0.9, consulting: 0.7, agency: 0.6, university: 1.1 },
  established: { startup: 1.2, scaleup: 1.4, corporate: 1.2, consulting: 1.0, agency: 0.8, university: 0.4 },
  veteran: { startup: 0.9, scaleup: 1.1, corporate: 1.5, consulting: 1.1, agency: 0.7, university: 0.5 },
}

export const ENV_BY_JOB_ROLE: Record<Role, Partial<Record<PreviousEnvironment, number>>> = {
  engineer: { startup: 0.3, university: 0.4, agency: -0.3 },
  designer: { agency: 0.8, startup: 0.2, corporate: -0.2 },
  marketer: { agency: 0.5, scaleup: 0.3, consulting: 0.2 },
  sales: { corporate: 0.5, scaleup: 0.4, university: -0.5 },
}

export const ENV_BY_ROLE: Partial<Record<CharacterRole, Partial<Record<PreviousEnvironment, number>>>> = {
  investor: { consulting: 0.6, corporate: 0.5, university: 0.2 },
  board_member: { corporate: 0.8, consulting: 0.4 },
  journalist: { agency: 0.4, university: 0.3 },
  advisor: { scaleup: 0.5, startup: 0.4 },
  customer: { corporate: 0.6 },
}

/** The market a person came out of. Fintech pulls from banks; devtools pulls from labs. */
export const ENV_BY_SECTOR: Record<SectorId, Partial<Record<PreviousEnvironment, number>>> = {
  saas: { corporate: 0.3, scaleup: 0.3 },
  social: { agency: 0.4, startup: 0.3, corporate: -0.3 },
  fintech: { corporate: 0.6, consulting: 0.4, agency: -0.3 },
  devtools: { university: 0.5, startup: 0.5, agency: -0.4 },
  ecommerce: { agency: 0.4, corporate: 0.2, university: -0.3 },
  aiml: { university: 0.6, startup: 0.3, corporate: 0.2, agency: -0.4 },
}

export interface BackgroundProfile {
  from: PersonalityWeights
  jobRoles?: readonly Role[]
  envs?: readonly PreviousEnvironment[]
  stages?: readonly CareerStage[]
  roles?: readonly CharacterRole[]
}

export const STRENGTH_PROFILE: Record<BackgroundStrength, BackgroundProfile> = {
  ships_fast: { from: { patience: -0.4, riskTolerance: 0.5, ambition: 0.3 }, jobRoles: ['engineer', 'designer'], envs: ['startup'] },
  deep_technical: { from: { patience: 0.5, empathy: -0.3, ego: 0.2 }, jobRoles: ['engineer'], envs: ['university', 'startup'] },
  closes_enterprise: {
    from: { directness: 0.6, ambition: 0.6, empathy: 0.2 },
    jobRoles: ['sales'],
    envs: ['corporate', 'consulting'],
    roles: ['executive', 'rival_founder'],
  },
  operational_rigour: {
    from: { patience: 0.6, riskTolerance: -0.4 },
    jobRoles: ['marketer', 'sales'],
    envs: ['corporate', 'consulting', 'scaleup'],
  },
  design_taste: { from: { empathy: 0.5, ego: 0.3, patience: 0.3 }, jobRoles: ['designer'], envs: ['agency', 'startup'] },
  data_driven: { from: { patience: 0.4, optimism: -0.3, empathy: -0.2 }, jobRoles: ['marketer', 'engineer'], envs: ['consulting', 'scaleup'] },
  recruits_well: { from: { empathy: 0.6, optimism: 0.5, directness: 0.3 }, jobRoles: ['sales', 'marketer'], envs: ['scaleup'], roles: ['recruiter'] },
  calm_in_crisis: { from: { patience: 0.7, optimism: 0.3, ego: -0.3 }, envs: ['corporate', 'scaleup'], roles: ['advisor', 'board_member'] },
  first_principles: { from: { ego: 0.3, riskTolerance: 0.4, patience: 0.3 }, jobRoles: ['engineer'], envs: ['university', 'startup'] },
  customer_obsessed: { from: { empathy: 0.8, loyalty: 0.3 }, jobRoles: ['designer', 'sales'], envs: ['startup', 'agency'] },
}

export const WEAKNESS_PROFILE: Record<BackgroundWeakness, BackgroundProfile> = {
  avoids_conflict: { from: { directness: -0.9, empathy: 0.4 } },
  over_promises: { from: { optimism: 0.8, directness: 0.3, patience: -0.3 } },
  poor_delegation: { from: { ego: 0.6, patience: -0.3, loyalty: 0.2 } },
  perfectionist: { from: { patience: 0.6, riskTolerance: -0.5, ego: 0.3 } },
  impatient: { from: { patience: -1.0, directness: 0.4 } },
  process_heavy: { from: { riskTolerance: -0.7, patience: 0.5 }, envs: ['corporate', 'consulting'] },
  unproven_at_scale: { from: { ambition: 0.4 }, stages: ['rising'] },
  burns_out: { from: { ambition: 0.6, patience: -0.4, riskTolerance: 0.2 } },
  territorial: { from: { ego: 0.8, empathy: -0.5, loyalty: -0.2 } },
  weak_written_comms: { from: { directness: 0.4, patience: -0.4, empathy: -0.3 } },
}

/** Chance a character has a weakness the world already knows about. The rest are still unknowns. */
export const WEAKNESS_CHANCE = 0.78

/** Roles that join YOUR company, and therefore have a reason for having done so. */
export const JOINING_ROLES: readonly CharacterRole[] = ['employee', 'executive', 'advisor']

export const JOIN_FROM_MOTIVATION: Record<CharacterMotivation, readonly JoinMotivation[]> = {
  money: ['money', 'equity'],
  career_progression: ['title', 'reputation', 'learning'],
  status: ['title', 'reputation'],
  autonomy: ['the_problem', 'escaping_bigco'],
  mission: ['mission', 'the_problem'],
  learning: ['learning', 'the_problem'],
  stability: ['money', 'escaping_bigco'],
  power: ['title', 'equity'],
  winning: ['equity', 'reputation'],
  recognition: ['reputation', 'title'],
  work_life_balance: ['escaping_bigco', 'mission'],
}

/** Someone always joins for the founder. Flat weight so it stays possible for anyone. */
export const JOIN_FOR_FOUNDER_WEIGHT = 0.45

export const EMPLOYEE_TITLES: Record<Role, Record<CareerStage, readonly string[]>> = {
  engineer: {
    rising: ['Software Engineer', 'Engineer', 'Product Engineer'],
    established: ['Senior Engineer', 'Staff Engineer', 'Senior Product Engineer'],
    veteran: ['Principal Engineer', 'Head of Engineering', 'Engineering Lead'],
  },
  designer: {
    rising: ['Product Designer', 'Designer', 'UX Designer'],
    established: ['Senior Product Designer', 'Design Lead', 'Senior Designer'],
    veteran: ['Principal Designer', 'Head of Design', 'Design Director'],
  },
  marketer: {
    rising: ['Marketing Associate', 'Growth Marketer', 'Content Marketer'],
    established: ['Senior Growth Marketer', 'Marketing Lead', 'Demand Generation Lead'],
    veteran: ['Head of Marketing', 'VP Marketing', 'Head of Growth'],
  },
  sales: {
    rising: ['Sales Development Rep', 'Account Executive', 'Commercial Associate'],
    established: ['Senior Account Executive', 'Sales Lead', 'Enterprise Account Executive'],
    veteran: ['Head of Sales', 'VP Sales', 'Chief Revenue Officer'],
  },
}

export const RIVAL_ARCHETYPES: readonly RivalArchetype[] = [
  'blitzscaler',
  'copycat',
  'discount_challenger',
  'incumbent',
  'niche_specialist',
  'research_lab',
  'roll_up',
]

/** A rival's posture follows its founder's personality — the archetype narrates, momentum decides. */
export const RIVAL_ARCHETYPE_AFFINITY: Record<RivalArchetype, Affinity> = {
  blitzscaler: { base: 1.0, from: { riskTolerance: 1.2, ambition: 0.8, patience: -0.6 } },
  copycat: { base: 0.9, from: { ego: -0.3, riskTolerance: -0.4, ambition: 0.3 } },
  incumbent: { base: 0.7, from: { patience: 0.8, riskTolerance: -0.7, ego: 0.4 } },
  niche_specialist: { base: 0.9, from: { patience: 0.6, empathy: 0.5, ambition: -0.4 } },
  discount_challenger: { base: 0.8, from: { riskTolerance: 0.5, ego: -0.2, empathy: -0.3 } },
  research_lab: { base: 0.7, from: { patience: 1.0, optimism: 0.3, directness: -0.4 } },
  roll_up: { base: 0.6, from: { ego: 0.6, ambition: 0.6, empathy: -0.5, patience: 0.3 } },
}

/** Applied to (momentum - 1): a company already compounding is read as a blitzscaler, not a lab. */
export const RIVAL_ARCHETYPE_MOMENTUM: Record<RivalArchetype, number> = {
  blitzscaler: 1.1,
  copycat: 0.2,
  incumbent: -0.7,
  niche_specialist: -0.4,
  discount_challenger: 0.5,
  research_lab: -0.8,
  roll_up: 0.3,
}

export const ROLE_TITLES: Record<CharacterRole, readonly string[]> = {
  employee: ['Team Member'],
  executive: ['VP Engineering', 'VP Sales', 'VP Marketing', 'Chief Operating Officer', 'Chief Technology Officer', 'Chief of Staff'],
  investor: ['Partner', 'Principal', 'General Partner', 'Managing Partner'],
  board_member: ['Board Member', 'Board Observer', 'Independent Director', 'Chair'],
  customer: ['Head of Operations', 'VP Engineering', 'Director of IT', 'Operations Manager', 'Head of Product', 'Founder'],
  rival_founder: ['Co-founder & CEO', 'Founder', 'Chief Executive'],
  recruiter: ['Talent Partner', 'Recruiter', 'Head of Talent', 'Executive Search Partner'],
  journalist: ['Reporter', 'Senior Correspondent', 'Editor', 'Contributing Writer'],
  advisor: ['Advisor', 'Board Advisor', 'Operating Partner', 'Executive Coach'],
  founder: ['Founder & CEO'],
}
