// Three experiences, one simulation platform.
//
//   MODE    — what kind of Founder Mode am I playing?   quick | career | arena
//   FORMAT  — what structure am I playing inside it?    standard | daily_challenge | scenario
//
// Everything that differs between experiences is expressed as CAPABILITIES, resolved once
// from the config. The engine never asks "which mode is this?" — it asks "is this capability
// on?", so a system can be moved between modes by editing one table instead of hunting
// through the simulation.
//
// Resolution order:  MODE base → FORMAT overrides → SCENARIO overrides → explicit overrides
//
// IMPORTANT: a capability is only `true` when the feature actually exists. Planned Career and
// Arena systems are listed here (so the shape is stable and the roadmap is legible) but stay
// `false` until they are built. The game must never claim functionality it does not have.

import type { SectorId } from './types'

export type GameMode = 'quick' | 'career' | 'arena'

// Daily Challenge is a FORMAT, not a mode. It is Quick Play with a fixed seed, a fixed
// length and one scored attempt.
export type GameFormat = 'standard' | 'daily_challenge' | 'scenario'

export type ScenarioId = string

export interface GameConfig {
  mode: GameMode
  format: GameFormat
  sector: SectorId
  scenario?: ScenarioId
  seed: number
  /** Host/player overrides applied last — e.g. the Arena lobby's rule toggles. */
  overrides?: Partial<GameCapabilities>
}

// ENFORCED vs DESCRIPTIVE — read this before assuming a flag does something.
//
// ENFORCED (flipping the flag changes behaviour): aiRivals, storyArcs, oneOnOnes,
//   catastrophes, founderEnergy, boardReviews, bankDebt, multipleVerticals, ipoEndgame,
//   macroShocks, pvpActions, leaderboard.
//
// DESCRIPTIVE (true statements about the experience, but nothing branches on them yet):
//   humanRivals   — Arena's opponents come from the room's presence list, not this flag.
//   seededWorld   — every run seeds from config.seed; the flag records that it is SHARED.
//   causalExplanations — the autopsy/benchmarks always explain; nothing gates them.
//   singleAttempt — enforced at the data layer (unique (day, player_id), keep-higher-score),
//                   not in the client. Replaying today is still allowed by design.
//
// PLANNED capabilities are all false and must stay false until the feature exists.
export interface GameCapabilities {
  // ---- implemented today -------------------------------------------------------------
  aiRivals: boolean // AI competitors in your market
  humanRivals: boolean // other players are the competition (Arena)
  storyArcs: boolean // multi-week narrative chains
  oneOnOnes: boolean // employees bring asks to your door
  catastrophes: boolean // sector-nightmare events
  founderEnergy: boolean // the founder's own tank; burnout and recharge weeks
  boardReviews: boolean // investor growth targets, strikes, ultimatums
  bankDebt: boolean // credit line with a revenue covenant
  multipleVerticals: boolean // second and third product lines
  ipoEndgame: boolean // S-1, roadshow, pricing day
  macroShocks: boolean // crashes, rate hikes, oil spikes (base macro drift always runs)
  pvpActions: boolean // direct attacks between players
  causalExplanations: boolean // the game tells you WHY something happened
  leaderboard: boolean // scores submitted to the global board
  seededWorld: boolean // everyone gets the identical starting world
  singleAttempt: boolean // one scored run, no retries

  // ---- planned: Career (see BACKLOG / Career Phase 1) ---------------------------------
  detailedPMF: boolean // segment-level demand instead of one PMF number
  customerSegments: boolean
  customerResearch: boolean // experiments that produce evidence
  hypothesisBoard: boolean
  advancedCohorts: boolean
  founderAttention: boolean // attention as an allocated resource
  founderDependency: boolean // the company's reliance on you personally
  founderCareer: boolean // persistence across runs
  cofounders: boolean
  deepEmployees: boolean // individual careers, growth, specialisation
  managementCapacity: boolean
  executives: boolean
  delegation: boolean
  emergentCulture: boolean
  investorPersonalities: boolean
  boardPolitics: boolean // coalitions, not just a growth target
  detailedFundraising: boolean
  detailedDebt: boolean
  deepDistribution: boolean
  productPortfolio: boolean
  technicalDebt: boolean
  detailedIPO: boolean
  decisionJournal: boolean
  educationalPostmortem: boolean
  livingWorld: boolean

  // ---- planned: Arena ----------------------------------------------------------------
  sharedCustomerMarket: boolean
  sharedTalentMarket: boolean
  sharedInvestorMarket: boolean
  negotiations: boolean
  playerAcquisitions: boolean
  simultaneousResolution: boolean
}

export type CapabilityKey = keyof GameCapabilities

export interface GameRules {
  mode: GameMode
  format: GameFormat
  capabilities: GameCapabilities
  turnUnit: 'week' | 'month' | 'quarter'
  /** Run ends here. Undefined = open-ended. */
  maxTurns?: number
  turnTimerSeconds?: number
  startingCash: number
  simulationDepth: 'simple' | 'standard' | 'deep'
  pmfDepth: 'simple' | 'deep'
  employeeDepth: 'simple' | 'deep'
  fundraisingDepth: 'simple' | 'deep'
}

// Everything off. Base rules switch on only what they actually provide.
const NO_CAPABILITIES: GameCapabilities = {
  aiRivals: false,
  humanRivals: false,
  storyArcs: false,
  oneOnOnes: false,
  catastrophes: false,
  founderEnergy: false,
  boardReviews: false,
  bankDebt: false,
  multipleVerticals: false,
  ipoEndgame: false,
  macroShocks: false,
  pvpActions: false,
  causalExplanations: false,
  leaderboard: false,
  seededWorld: false,
  singleAttempt: false,
  detailedPMF: false,
  customerSegments: false,
  customerResearch: false,
  hypothesisBoard: false,
  advancedCohorts: false,
  founderAttention: false,
  founderDependency: false,
  founderCareer: false,
  cofounders: false,
  deepEmployees: false,
  managementCapacity: false,
  executives: false,
  delegation: false,
  emergentCulture: false,
  investorPersonalities: false,
  boardPolitics: false,
  detailedFundraising: false,
  detailedDebt: false,
  deepDistribution: false,
  productPortfolio: false,
  technicalDebt: false,
  detailedIPO: false,
  decisionJournal: false,
  educationalPostmortem: false,
  livingWorld: false,
  sharedCustomerMarket: false,
  sharedTalentMarket: false,
  sharedInvestorMarket: false,
  negotiations: false,
  playerAcquisitions: false,
  simultaneousResolution: false,
}

export const ALL_CAPABILITY_KEYS = Object.keys(NO_CAPABILITIES) as CapabilityKey[]

// ---------- mode base rules ----------

// Quick Play IS the game as it exists today. Every system that shipped is on.
const QUICK_BASE_RULES: GameRules = {
  mode: 'quick',
  format: 'standard',
  turnUnit: 'week',
  startingCash: 200_000,
  simulationDepth: 'standard',
  pmfDepth: 'simple',
  employeeDepth: 'simple',
  fundraisingDepth: 'simple',
  capabilities: {
    ...NO_CAPABILITIES,
    aiRivals: true,
    storyArcs: true,
    oneOnOnes: true,
    catastrophes: true,
    founderEnergy: true,
    boardReviews: true,
    bankDebt: true,
    multipleVerticals: true,
    ipoEndgame: true,
    macroShocks: true,
    causalExplanations: true,
  },
}

// Career is the future flagship. Today it runs the same simulation as Quick Play — the
// point of this mode existing now is that its capabilities are configured independently,
// so Career Phase 1 can switch systems on without touching Quick Play or Arena.
const CAREER_BASE_RULES: GameRules = {
  ...QUICK_BASE_RULES,
  mode: 'career',
  simulationDepth: 'standard', // becomes 'deep' when the Career systems land
  capabilities: { ...QUICK_BASE_RULES.capabilities },
}

// Arena is the lean competitive format: the slow narrative systems are off so turns stay
// fast, the economic weapons stay on, and players can hit each other.
const ARENA_BASE_RULES: GameRules = {
  mode: 'arena',
  format: 'standard',
  turnUnit: 'week',
  startingCash: 200_000,
  maxTurns: 52,
  turnTimerSeconds: 150,
  simulationDepth: 'standard',
  pmfDepth: 'simple',
  employeeDepth: 'simple',
  fundraisingDepth: 'simple',
  capabilities: {
    ...NO_CAPABILITIES,
    humanRivals: true,
    bankDebt: true,
    multipleVerticals: true,
    ipoEndgame: true,
    macroShocks: true,
    pvpActions: true,
    causalExplanations: true,
    seededWorld: true,
  },
}

const BASE_RULES: Record<GameMode, GameRules> = {
  quick: QUICK_BASE_RULES,
  career: CAREER_BASE_RULES,
  arena: ARENA_BASE_RULES,
}

// ---------- format overrides ----------

interface RuleOverride {
  maxTurns?: number
  capabilities?: Partial<GameCapabilities>
}

// Daily Challenge inherits every Quick Play mechanic; only the challenge framing differs.
const DAILY_CHALLENGE_OVERRIDES: RuleOverride = {
  maxTurns: 104,
  capabilities: {
    leaderboard: true,
    seededWorld: true,
    singleAttempt: true,
  },
}

const FORMAT_OVERRIDES: Record<GameFormat, RuleOverride> = {
  standard: {},
  daily_challenge: DAILY_CHALLENGE_OVERRIDES,
  scenario: {}, // scenarios shape the STARTING STATE (cash, climate, rivals), not the ruleset
}

// ---------- resolution ----------

/**
 * MODE base → FORMAT overrides → SCENARIO overrides → explicit overrides.
 * Pure and deterministic: the same config always resolves to the same rules, which is why
 * the config can be part of the seeded simulation contract.
 */
export function resolveGameRules(config: GameConfig): GameRules {
  const base = BASE_RULES[config.mode] ?? QUICK_BASE_RULES
  const fmt = FORMAT_OVERRIDES[config.format] ?? {}
  const resolved: GameRules = {
    ...base,
    format: config.format,
    maxTurns: fmt.maxTurns ?? base.maxTurns,
    capabilities: {
      ...base.capabilities,
      ...fmt.capabilities,
      // Scenario overrides would slot in here; today no scenario changes the ruleset.
      ...sanitizeCapabilities(config.overrides),
    },
  }
  return Object.freeze(resolved)
}

/** Only known keys, only booleans — configs also arrive over the wire from other players. */
export function sanitizeCapabilities(raw: unknown): Partial<GameCapabilities> {
  const out: Partial<GameCapabilities> = {}
  if (!raw || typeof raw !== 'object') return out
  const src = raw as Record<string, unknown>
  for (const k of ALL_CAPABILITY_KEYS) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean
  }
  return out
}

export function defaultCapabilities(mode: GameMode, format: GameFormat = 'standard'): GameCapabilities {
  return resolveGameRules({ mode, format, sector: 'saas', seed: 0 }).capabilities
}

/** The one question the engine and UI should ask. Never `if (mode === 'career')`. */
export function hasCapability(source: { capabilities?: Partial<GameCapabilities> } | null | undefined, key: CapabilityKey): boolean {
  return source?.capabilities?.[key] ?? false
}

// ---------- presentation ----------

export const MODE_META: Record<GameMode, { name: string; promise: string; blurb: string; cta: string; meta: string; icon: string }> = {
  quick: {
    name: 'Quick Play',
    promise: 'Build a unicorn tonight.',
    blurb: 'Fast startup management. Start a company, make the big decisions and see how far you can take it.',
    cta: 'Play',
    meta: '30–60 min · Solo',
    icon: '⚡',
  },
  career: {
    name: 'Career',
    promise: 'Build the company. Become the CEO.',
    blurb: 'A deeper founder simulation about product, people, strategy and capital.',
    cta: 'Start Career',
    meta: 'Deep Simulation · Solo · Multi-session',
    icon: '🏛',
  },
  arena: {
    name: 'Arena',
    promise: 'Outbuild your friends.',
    blurb: 'Compete against other founders in the same market.',
    cta: 'Enter Arena',
    meta: '2–4 Players · Online',
    icon: '⚔️',
  },
}

export const QUICK_FORMAT_META: Record<Exclude<GameFormat, never>, { name: string; promise: string; blurb: string; cta: string }> = {
  standard: {
    name: 'Standard Run',
    promise: 'Start from zero.',
    blurb: 'Build the company and chase the best possible outcome.',
    cta: 'Start Run',
  },
  daily_challenge: {
    name: 'Daily Challenge',
    promise: 'Same world. Same seed. One shot.',
    blurb: "Everyone gets the same company today.",
    cta: "Play Today's Challenge",
  },
  scenario: {
    name: 'Scenarios',
    promise: 'Different starts. Different problems.',
    blurb: 'Take on special founder situations.',
    cta: 'Choose Scenario',
  },
}
