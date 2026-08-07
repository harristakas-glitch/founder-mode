// Character prose: names, the words that replace personality numbers, and biography templates.
//
// §7 is explicit that personality scores are never shown as numbers, so every dimension needs
// readable phrasings on both ends — that is what OBSERVATIONS is. §10 wants short procedural
// biographies, which is what the BIO_* tables build: one sentence of history, one of reputation,
// and an optional one about why they joined.
//
// Placeholders are `{slot}`, matching the FragmentSlots convention in ../types. Nothing here is
// persisted except a composed bio string, and nothing here is ever parsed back.

import type {
  BackgroundStrength,
  BackgroundWeakness,
  CharacterMotivation,
  CommunicationStyle,
  JoinMotivation,
  PersonalityDimension,
  PreviousEnvironment,
} from '../types'
import type { Role } from '../../types'

// 48 x 48 = 2304 combinations, which is enough that a full campaign cast rarely collides; the
// generator still de-duplicates first names inside a single cast, because two Priyas on a
// six-person team reads as a bug rather than a coincidence.
export const FIRST_NAMES: readonly string[] = [
  'Alex', 'Amara', 'Anna', 'Avery', 'Beatriz', 'Casey', 'Chidi', 'Dana',
  'Diego', 'Elena', 'Esther', 'Farah', 'Felix', 'Gabriel', 'Hana', 'Hugo',
  'Ingrid', 'Ivan', 'Jamie', 'Jonas', 'Jordan', 'Kenji', 'Lars', 'Leila',
  'Lucas', 'Mara', 'Marcus', 'Maya', 'Mei', 'Morgan', 'Nadia', 'Nina',
  'Noor', 'Omar', 'Oscar', 'Priya', 'Quinn', 'Rafael', 'Riley', 'Rosa',
  'Sam', 'Sofia', 'Tariq', 'Tomas', 'Vera', 'Wei', 'Yusuf', 'Zara',
]

export const LAST_NAMES: readonly string[] = [
  'Ali', 'Andersson', 'Berg', 'Brooks', 'Chen', 'Costa', 'Duarte', 'Eriksen',
  'Ferrari', 'Fischer', 'Garcia', 'Haddad', 'Ivanov', 'Kaur', 'Keller', 'Kim',
  'Kowalski', 'Larsson', 'Lindqvist', 'Marchetti', 'Mensah', 'Moreau', 'Nakamura', 'Navarro',
  'Nguyen', 'Novak', 'Okafor', 'Osei', 'Patel', 'Petrov', 'Reyes', 'Rossi',
  'Santos', 'Schneider', 'Silva', 'Sorensen', 'Tanaka', 'Torres', 'Vasquez', 'Vogel',
  'Wang', 'Weber', 'Whitfield', 'Yamamoto', 'Yilmaz', 'Zhang', 'Ziegler', 'Adeyemi',
]

export type ObservationBand = 'very_low' | 'low' | 'mid' | 'high' | 'very_high'

/**
 * Three phrasings per end of each dimension: 48 observations. The variant is chosen from the
 * character's own name and score, never from a live RNG, so the Team screen shows the same
 * wording every render without caching it.
 */
export const OBSERVATIONS: Record<PersonalityDimension, { high: readonly string[]; low: readonly string[] }> = {
  directness: {
    high: ['Direct communicator', 'Says the quiet part out loud', 'Gets to the point'],
    low: ['Diplomatic', 'Softens hard news', 'Reads the room before speaking'],
  },
  ambition: {
    high: ['Highly ambitious', 'Wants the next rung', 'Impatient for scope'],
    low: ['Content where they are', 'Unhurried about title', 'Not chasing a ladder'],
  },
  patience: {
    high: ['Patient', 'Plays a long game', 'Comfortable waiting for the right answer'],
    low: ['Impatient', 'Wants the decision today', 'Bores quickly'],
  },
  loyalty: {
    high: ['Strongly loyal', 'Sticks with people', 'Hard to poach'],
    low: ['Keeps their options open', 'Loyal to the work, not the company', 'Takes the recruiter calls'],
  },
  optimism: {
    high: ['Optimistic', 'Sees the upside first', 'Believes the plan'],
    low: ['Sceptical', 'Expects things to slip', 'Assumes the worst case'],
  },
  ego: {
    high: ['Status conscious', 'Needs the credit', 'Protective of their patch'],
    low: ['Low ego', 'Happy to be wrong in public', 'Gives the credit away'],
  },
  riskTolerance: {
    high: ['Risk tolerant', 'Comfortable betting big', 'Would rather move than be certain'],
    low: ['Risk averse', 'Wants the numbers first', 'Prefers the safe road'],
  },
  empathy: {
    high: ['Reads people well', 'Notices when morale slips', 'Takes it personally when people struggle'],
    low: ['Blunt about people', 'Treats teams as capacity', 'Misses the mood'],
  },
}

export const STYLE_OBSERVATION: Record<CommunicationStyle, string> = {
  direct: 'Direct communicator',
  warm: 'Warm communicator',
  formal: 'Formal communicator',
  analytical: 'Analytical communicator',
  enthusiastic: 'Enthusiastic communicator',
  blunt: 'Blunt communicator',
  cautious: 'Cautious communicator',
}

export const MOTIVATION_LABEL: Record<CharacterMotivation, string> = {
  money: 'Money',
  career_progression: 'Career progression',
  status: 'Status',
  autonomy: 'Autonomy',
  mission: 'Mission',
  learning: 'Learning',
  stability: 'Stability',
  power: 'Power',
  winning: 'Winning',
  recognition: 'Recognition',
  work_life_balance: 'Work-life balance',
}

/** Gerunds, because every opening template places them after a preposition or an auxiliary. */
export const WORK_PHRASE: Record<Role, readonly string[]> = {
  engineer: ['building backend systems', 'shipping product', 'writing infrastructure nobody thanks you for'],
  designer: ['designing product', 'shaping interfaces', 'turning half-formed ideas into screens'],
  marketer: ['running growth', 'buying and measuring demand', 'building an audience from nothing'],
  sales: ['selling enterprise software', 'carrying a number', 'closing deals with long cycles'],
}

export const GENERIC_WORK_PHRASE: readonly string[] = ['working in technology', 'building software companies', 'working close to product']

/** 4 per environment: 24 openings, in the §65 band. Slots: {first}, {years}, {work}. */
export const BIO_OPENINGS: Record<PreviousEnvironment, readonly string[]> = {
  startup: [
    '{first} spent {years} years {work} at early-stage startups.',
    '{first} has been {work} in startups for {years} years, mostly before product-market fit.',
    '{first} came up through {years} years of small teams, {work} with no safety net.',
    '{first} spent {years} years at startups nobody had heard of, {work}.',
  ],
  scaleup: [
    '{first} spent {years} years {work} at a company that tripled headcount underneath them.',
    '{first} has {years} years {work}, most of it during a scaleup’s messiest growth.',
    '{first} joined a Series B and spent {years} years {work} as it grew.',
    '{first} spent {years} years {work} at a scaleup, watching process arrive.',
  ],
  corporate: [
    '{first} spent {years} years {work} inside a large company.',
    '{first} has {years} years {work} at an incumbent, where the budget was never the problem.',
    '{first} spent {years} years {work} somewhere with a real org chart.',
    '{first} came out of {years} years {work} at a public company.',
  ],
  consulting: [
    '{first} spent {years} years consulting before {work} full time.',
    '{first} has {years} years of client work behind them, latterly {work}.',
    '{first} billed {years} years of consulting hours before moving to product.',
    '{first} spent {years} years advising other people’s companies, then started {work}.',
  ],
  agency: [
    '{first} spent {years} years at agencies, {work} for whoever was paying.',
    '{first} has {years} years of agency work behind them, {work} across a dozen brands.',
    '{first} did {years} years of client work at agencies before going in-house.',
    '{first} spent {years} years {work} on someone else’s brand.',
  ],
  university: [
    '{first} spent {years} years in research before {work} commercially.',
    '{first} left academia after {years} years and has been {work} since.',
    '{first} has a research background and {years} years of {work}.',
    '{first} spent {years} years in a lab before deciding to ship things instead.',
  ],
}

/** 3 per strength: 30 clauses. Each follows "{first} " and must read as a verb phrase. */
export const BIO_STRENGTHS: Record<BackgroundStrength, readonly string[]> = {
  ships_fast: [
    'is known for shipping faster than anyone expects',
    'has a reputation for getting things out of the door',
    'ships quickly and argues about the polish afterwards',
  ],
  deep_technical: [
    'goes deeper on the technical detail than anyone else in the room',
    'is the person people ask when the system stops making sense',
    'knows the stack down to the layer nobody else reads',
  ],
  closes_enterprise: [
    'is known for closing difficult accounts',
    'can carry a six-month enterprise cycle without losing the thread',
    'closes the deals everyone else had written off',
  ],
  operational_rigour: [
    'runs a tight process and it shows',
    'turns chaos into something with a checklist',
    'is the reason things happen on the day they were meant to',
  ],
  design_taste: [
    'has taste, and the confidence to defend it',
    'can see the version of the product that should exist',
    'makes things feel considered without slowing them down',
  ],
  data_driven: [
    'refuses to argue without the numbers',
    'builds the measurement before building the feature',
    'has never lost an argument to a louder opinion',
  ],
  recruits_well: [
    'can talk good people into joining',
    'has a network that keeps producing hires',
    'sells the company better than the deck does',
  ],
  calm_in_crisis: [
    'is unnervingly calm when things break',
    'gets quieter as the situation gets worse',
    'is the person you want on the call at 3am',
  ],
  first_principles: [
    'takes problems apart before agreeing to solve them',
    'asks the question everyone else skipped',
    'rebuilds the assumption rather than the answer',
  ],
  customer_obsessed: [
    'talks to customers more than anyone asked them to',
    'can quote real users from memory',
    'treats a support ticket as a design brief',
  ],
}

/** 3 per weakness: 30 clauses. Each follows ", but ". */
export const BIO_WEAKNESSES: Record<BackgroundWeakness, readonly string[]> = {
  avoids_conflict: [
    'avoids the hard conversation until it is overdue',
    'will agree in the room and disagree afterwards',
    'lets problems between people run too long',
  ],
  over_promises: [
    'commits to dates that were never real',
    'says yes before checking',
    'tends to promise the version of the plan that works',
  ],
  poor_delegation: [
    'has never learned to hand work over',
    'ends up doing it themselves',
    'holds on to work long after it should have moved',
  ],
  perfectionist: [
    'struggles to call anything finished',
    'will hold a release for something nobody else can see',
    'rewrites work that was already good enough',
  ],
  impatient: [
    'loses interest once the interesting part is done',
    'pushes for a decision before the evidence arrives',
    'reads deliberation as delay',
  ],
  process_heavy: [
    'reaches for process before judgement',
    'adds a meeting where a message would do',
    'wants a framework for problems that happen once',
  ],
  unproven_at_scale: [
    'has never built an organisation from scratch',
    'has not done this above thirty people',
    'is untested at the size the company is heading for',
  ],
  burns_out: [
    'works at a pace that has broken them before',
    'does not know how to run below full speed',
    'has a history of going too hard for too long',
  ],
  territorial: [
    'guards their patch harder than the work deserves',
    'treats overlap as a threat',
    'is difficult to work around once they have claimed something',
  ],
  weak_written_comms: [
    'writes updates nobody finishes reading',
    'loses half the argument on the way to the document',
    'is far better in a room than on a page',
  ],
}

/** 3 per join motivation: 27 closing sentences. */
export const BIO_JOIN_REASONS: Record<JoinMotivation, readonly string[]> = {
  equity: [
    'They joined for the equity and said so in the interview.',
    'They took a pay cut for the equity.',
    'They did the option maths before the second call.',
  ],
  mission: [
    'They joined because they believe the problem is worth solving.',
    'They wanted work that meant something.',
    'They said the mission was the only reason they left.',
  ],
  the_problem: [
    'They joined because the problem itself is interesting.',
    'They wanted this specific problem, not this specific company.',
    'They said the problem was the reason they took the call.',
  ],
  the_founder: [
    'They joined because of the founder.',
    'They said they were betting on the founder, not the plan.',
    'They joined for the person running it.',
  ],
  escaping_bigco: [
    'They left a large company to stop asking permission.',
    'They wanted out of somewhere nothing shipped.',
    'They joined to get away from the org chart.',
  ],
  title: [
    'They joined for the title and the scope that came with it.',
    'They wanted the step up the last place would not give them.',
    'They negotiated harder on scope than on salary.',
  ],
  money: [
    'They joined for the money and did not pretend otherwise.',
    'They took the highest offer on the table.',
    'They negotiated the salary to the last thousand.',
  ],
  learning: [
    'They joined to learn faster than they could anywhere else.',
    'They wanted to be the least experienced person in the room.',
    'They joined for the range, not the role.',
  ],
  reputation: [
    'They joined because of who else works here.',
    'They wanted this on their record.',
    'They joined for the name the company might have in two years.',
  ],
}

/** "spent six years" reads better than "spent 6 years". Beyond twenty, digits are fine. */
export const NUMBER_WORDS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
]
