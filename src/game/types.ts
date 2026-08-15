export type Role = 'engineer' | 'designer' | 'marketer' | 'sales'
export type SectorId = 'saas' | 'social' | 'fintech' | 'devtools' | 'ecommerce' | 'aiml'
export type FounderKind = 'technical' | 'business'
export type Stage = 'Pre-seed' | 'Seed' | 'Series A' | 'Series B' | 'Series C'

export interface Sector {
  id: SectorId
  name: string
  blurb: string
  /**
   * Revenue per active customer per week, at full PMF and conversion.
   *
   * ONE FIELD, AND THAT IS THE POINT. There used to be two — `arpuWeekly` for Quick Play and
   * `careerArpu` for Career — on the theory that "Career counts named accounts in the hundreds
   * where Quick Play counts raw users in the tens of thousands". Half of that was measured and
   * half was assumed. `careerArpu` was added because charging the Quick Play rate left every
   * Career company structurally unprofitable; nobody ever checked the other half, and
   * docs/balance-deep-dive.md finding 1 found Quick Play reaches 1,000–4,400 users, not tens of
   * thousands. It had exactly the same defect, unfixed: E-commerce and Fintech needed 1.9x the
   * users they could reach to cover a modest cost base, and Social needed 16.6x — which is why
   * those two sectors bankrupted 10–15 of every 16 runs at EVERY allocation, budget, hiring rule
   * and founder kind tested.
   *
   * A second rate did not describe a second scale, it described a second GUESS at the scale. So
   * there is one, and a third mode cannot inherit the bug by picking the wrong one. The sector's
   * character survives in the ratios: a social user is still worth a fraction of a B2B seat.
   */
  arpuPerCustomer: number
  acqBase: number // base user acquisition scale
  viral: number // word-of-mouth growth factor
  churn: number // weekly churn base
  perUserVal: number // valuation $ per user
  infraCost: number // $ per user per week (servers, support, payment rails)
  tam: number // total addressable users in this market
}

export type TraitId = 'tenx' | 'craftsman' | 'mercenary' | 'culture' | 'drama'

export interface Employee {
  id: string
  name: string
  role: Role
  skill: number // 1-10
  salary: number // yearly
  morale: number // 0-100
  weeks: number
  trait?: TraitId | null
}

export interface Candidate {
  id: string
  name: string
  role: Role
  skill: number
  salary: number
  weeksLeft: number
  notice: number // weeks between accepting and starting
  trait?: TraitId | null
}

export interface Board {
  targetGrowth: number // weekly user-growth rate the investors expect
  nextReview: number // week of the next board review
  strikes: number
  defied: boolean // defied an ultimatum — one more miss and you are out
}

export interface PendingHire {
  candidate: Candidate
  weeksUntilStart: number
}

export interface Rival {
  id: string
  name: string
  users: number
  stage: number // 0=preseed .. 4=series C
  product: number // 0-100
  momentum: number // growth personality
  alive: boolean
  acquired?: boolean // you bought them
  rebuffedUntil?: number // week until which they won't take your calls after a rejected offer
}

export interface Effects {
  cash?: number
  hype?: number
  morale?: number
  /** Founder energy. The price of every "say yes to exposure" event: a keynote week, a press
   *  cycle or a podcast circuit eats the founder, and `energyMult` scales everything they touch.
   *  Added when the event audit found the engage column was FREE in four events — pure
   *  hype/reputation gifts with no resource, which is half of why a state-blind "always engage"
   *  bot beat "always decline" 4-7x (docs/balance-deep-dive.md finding 6). */
  energy?: number
  users?: number
  bugs?: number
  quality?: number
  features?: number
  reputation?: number
  pmf?: number
  special?:
    | 'acquired'
    | 'lose-best'
    | 'accelerator'
    | 'grant-raise'
    | 'refuse-raise'
    | 'angel'
    | 'acquihire'
    | 'poach-rival'
    | 'board-layoffs'
    | 'board-defy'
    | 'refinance' // reprice existing debt at today's rates
    | 'rate-hike-debt' // bank passes a hike through to your APR
    | 'cola-raise' // cost-of-living adjustment: all salaries +5%
    | 'talent-influx' // two strong candidates join the pool
    | 'bet-insight' // the active new bet gains PMF and signal
    | 'line-surge' // every launched product line gains users
    | 'lose-mercenary' // a mercenary walks
}

export interface Choice {
  label: string
  resultText: string
  effects: Effects
  // targeted consequences for the employee this message is about (meta.employeeId)
  target?: { morale?: number; salaryMult?: number }
  // story-arc bookkeeping: what this choice does to the arc that asked the question
  arcGoto?: string // advance the arc to this stage
  arcSet?: Record<string, number> // remember facts inside the arc
  arcEnd?: boolean // the arc concludes here
}

export interface Message {
  id: string
  week: number
  kind: 'news' | 'choice' | 'system'
  title: string
  body: string
  choices?: Choice[]
  resolved?: boolean
  resultText?: string
  meta?: { acquisitionAmount?: number; arcInstance?: string; employeeId?: string }
}

// Legacy shape, kept only so old saves and older multiplayer clients can be migrated.
// The live model is GameCapabilities in ./modes — do not add fields here.
export interface Ruleset {
  arcs: boolean
  oneOnOnes: boolean
  catastrophes: boolean
  energy: boolean
  board: boolean
  debt: boolean
  ventures: boolean
  ipo: boolean
  macroShocks: boolean
  pvp: boolean
}

// A running story arc: a chain of events across weeks that remembers your choices.
export interface ActiveArc {
  instanceId: string
  id: string // ArcDef id
  stage: string
  week: number // week the current stage was entered
  waiting?: boolean // a choice message is out, the arc pauses until it's answered
  done?: boolean
  data: Record<string, number>
}

export interface TermSheet {
  id: string
  investor: string
  amount: number
  equity: number // fraction sold, e.g. 0.18
  weeksLeft: number
}

export interface HistoryPoint {
  week: number
  cash: number
  users: number
  revenue: number
  expenses: number
  payroll: number
  marketing: number
  office: number
  infra: number
  interest?: number
  macroIndex?: number
  valuation: number
  pmf: number
}

export interface GameOver {
  type: 'bankrupt' | 'unicorn' | 'acquired' | 'fired' | 'timeup' | 'ipo'
  week: number
  payout?: number
  detail?: string // the autopsy: what actually emptied the account
}

export interface IpoProcess {
  phase: 'filing' | 'roadshow'
  weeksLeft: number
  demand: number // 0-100 investor appetite, decides pop or flop
}

// A second (third, fourth…) product line: the escape hatch from a saturated S-curve.
export interface Venture {
  id: string
  sector: SectorId
  // pre-launch: the discovery loop, all over again
  features: number
  pmf: number
  resonance: number
  researchSignal: number
  launched: boolean
  users: number
  startedWeek: number
}

export interface GameState {
  companyName: string
  sector: SectorId
  founderKind: FounderKind
  week: number
  cash: number
  users: number
  hype: number // 0-100
  reputation: number // 0-100
  features: number // 0-100
  quality: number // 0-100
  bugs: number // 0-100
  // --- product-market fit ---
  pmf: number // 0-100: how much the market actually wants this
  resonance: number // hidden multiplier on PMF growth for the current idea (0.4-1.45)
  researchSignal: number // accumulated user-research on the current idea; unlocks a read on resonance
  totalResearch: number // lifetime research across all ideas — improves every future pivot
  pivots: number
  milestones: string[] // achieved milestone ids
  allocation: { features: number; quality: number; bugs: number; research: number; bet: number }
  marketingSpend: number // $/week
  employees: Employee[]
  candidates: Candidate[]
  offersOut: Candidate[] // offers awaiting the candidate's answer
  pendingHires: PendingHire[] // accepted, serving out their notice period
  rivals: Rival[]
  climate: number // funding market temperature, -1 (frozen) .. 1 (frothy)
  inbox: Message[]
  termSheets: TermSheet[]
  stage: Stage
  board: Board | null // appears once outside investors own a piece of you
  founderEquity: number // fraction 0-1
  lastPostMoney: number // post-money of last round, for down-round detection
  raiseCooldown: number // weeks until next pitch allowed
  bridgeUsed: boolean
  lastRevenue: number
  lastExpenses: number
  flash: string | null // one-shot banner shown after a player action; cleared on advance
  challenge: { label: string; cap: number } | null // capped run: daily challenge or multiplayer match
  ipo: IpoProcess | null // S-1 filed, in progress
  ipoCooldown: number // weeks until the street will look at you again after a pulled IPO
  ventures: Venture[] // additional product lines: one un-launched bet at a time, any number launched
  maCooldown: number // weeks until the next acquisition attempt (integrations take time)
  scenario: string | null // scenario id this run started with, for flavor & endgame display
  pitchCooldown: number // weeks until the team will sit through another all-hands pitch
  rally: { mult: number; weeksLeft: number } | null // temporary productivity buff from a landed pitch
  macro: { index: number; rate: number; inflation: number } // the real economy: stock index, central-bank rate %, inflation %
  debt: { principal: number; apr: number; covenantRevenue: number } | null // bank credit line with a revenue covenant
  flags: Record<string, number> // run-lifetime counters for achievements (tookDebt, pitchesLanded, …)
  arcs: ActiveArc[] // story arcs, active and concluded
  energy: number // 0-100: the founder's own tank — big moves drain it, low energy weakens everything you touch
  vacationCooldown: number // weeks until the next recharge week
  bankedPayout: number // personal money already taken off the table via secondary sales
  // What this run IS (mode, format, sector, scenario, seed) and, resolved from it, which
  // systems are switched on. See ./modes — the engine asks hasCapability(), never the mode.
  config: import('./modes').GameConfig
  capabilities: import('./modes').GameCapabilities
  /** Career only. Absent on Quick Play and Arena saves — the deep PMF subsystem. */
  career?: import('./career/types').CareerPMFState
  /**
   * The Procedural Living World: persistent people, what they remember, and what has already been
   * told. Absent on every save written before it existed and on any run whose livingWorldDepth is
   * 'off' — readers must tolerate undefined rather than assume it was built.
   */
  world?: import('./world/types').LivingWorldState
  /**
   * Tokenisation / ICO. Absent on every save written before it existed and on every run that
   * never tokenised — and its ABSENCE is what `capitalPath: 'institutional'` means, which is why
   * a legacy save needs no migration write at all (ICO brief §74). There is deliberately no
   * `capitalPath` field beside this one: two ways to say the same thing is one way to desync.
   * Read it through `capitalPath(s)`; readers must tolerate undefined.
   */
  token?: import('./token/types').TokenState
  /**
   * Replay verification (src/game/replay.ts): the ordered log of player actions this run has
   * taken, from which the whole run can be re-simulated and its score checked. Present only on
   * runs that record one (solo runs started after the feature shipped). Absent = legacy save or
   * arena run = unverifiable, never an error. User-writable localStorage — always re-validated
   * through `sanitizeJournal`, never trusted.
   */
  journal?: import('./replay').JournalEntry[]
  history: HistoryPoint[]
  gameOver: GameOver | null
}
