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
import type { LivingWorldDepth } from './world/types'
import type { SystemDepth, SystemDepthConfig } from './strategic/types'

// ---------- Strategic Systems Expansion: depth per mode (master brief v3 §3 table) ----------
// Quick = the strategic call, compressed. Simulation = run the company. Arena = outmanoeuvre
// other founders (attention and board meetings OFF there by design — arena's turn clock is its
// attention model, and board meetings interrupt competitive flow).
//
// OWNER SIMPLIFICATION (2026-08-23): roadmap, big bets and the growth mix are SIMULATION-ONLY
// for now. Quick and arena run the classic engine — with these depths 'off' the systems are
// provably inert (the golden traces are byte-identical), so the removal is exact, not
// approximate. The light/competitive content and gating all still exist behind these switches;
// re-adding a system to a mode is a one-word change here.
// … and AI adoption joined them when it shipped (phase 5): its light/competitive content exists
// behind these switches, but quick and arena launch with the classic engine until the owner
// asks otherwise.
const QUICK_SYSTEM_DEPTH: SystemDepthConfig = {
  roadmap: 'off', bigBets: 'off', growthMix: 'off', aiAdoption: 'off', strategicCoherence: 'light',
  founderAttention: 'light', managementCapacity: 'light', livingWorld: 'light', boardMeetings: 'light',
}
const SIMULATION_SYSTEM_DEPTH: SystemDepthConfig = {
  roadmap: 'deep', bigBets: 'deep', growthMix: 'deep', aiAdoption: 'deep', strategicCoherence: 'deep',
  founderAttention: 'deep', managementCapacity: 'deep', livingWorld: 'deep', boardMeetings: 'deep',
}
const ARENA_SYSTEM_DEPTH: SystemDepthConfig = {
  roadmap: 'off', bigBets: 'off', growthMix: 'off', aiAdoption: 'off', strategicCoherence: 'competitive',
  founderAttention: 'off', managementCapacity: 'light', livingWorld: 'competitive', boardMeetings: 'off',
}

/**
 * How much of the tokenisation path a mode is meant to offer (brief §113, §55, §57, §58).
 * Declares intent only — the token* capabilities decide what runs, and they are all false.
 * Same contract as LivingWorldDepth: depth sets the shape, capabilities are the switches.
 */
export type TokenDepth = 'off' | 'light' | 'deep'

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
  /** Business Simulation V2 (docs/business-sim-v2-implementation.md D1). Absent = the classic
   *  engine — every existing save, quick and arena, forever. 'v2' is opt-in on NEW Simulation
   *  runs while V2 is under construction; it becomes the Simulation default at the MVP boundary. */
  engine?: 'v1' | 'v2'
  /** Host/player overrides applied last — e.g. the Arena lobby's rule toggles. */
  overrides?: Partial<GameCapabilities>
}

/** THE V2 gate (spec §1). One predicate, imported everywhere — never a scattered mode check. */
export const usesBusinessSimulationV2 = (s: { config?: GameConfig }): boolean =>
  s.config?.mode === 'career' && s.config?.engine === 'v2'

// ENFORCED vs DESCRIPTIVE — read this before assuming a flag does something.
//
// This list is checkable: `grep -rn "'<key>'" src` should find a `hasCapability` call for every
// ENFORCED key and none for a DESCRIPTIVE one. It had drifted — three keys were listed as enforced
// with nothing branching on them, and the entire living-world set was missing.
//
// ENFORCED (flipping the flag changes behaviour): aiRivals, storyArcs, oneOnOnes, catastrophes,
//   founderEnergy, boardReviews, bankDebt, multipleVerticals, ipoEndgame, macroShocks, pvpActions,
//   sharedHiringPool, leaderboard, detailedPMF, customerResearch, hypothesisBoard,
//   persistentCharacters, characterMemory, companyMemory, relationships, proceduralNarrative,
//   advisorOpinions, promises, structuredInterviews, structuredEmployeeConversations,
//   proceduralBoardMeetings, tokenisation.
//
// DESCRIPTIVE (true statements about the experience, but nothing branches on them yet):
//   humanRivals   — Arena's opponents come from the room's presence list, not this flag.
//   seededWorld   — every run seeds from config.seed; the flag records that it is SHARED.
//   causalExplanations — the autopsy/benchmarks always explain; nothing gates them.
//   singleAttempt — enforced at the data layer (unique (day, player_id), keep-higher-score),
//                   not in the client. Replaying today is still allowed by design.
//   customerSegments, decisionJournal — implied by detailedPMF: the segment model and the journal
//                   are built into the Career subsystem itself, so `game.career` existing IS the
//                   switch. Turning either off alone does nothing.
//   tokenDepth (on GameRules, not a capability) — declares how much of the token path a mode is
//                   MEANT to get (brief §113 wants Quick Play "light" and Career "deep"). Depth is
//                   not a boolean, so it lives beside pmfDepth/livingWorldDepth. It reserves the
//                   shape; the seven token* capabilities decide what actually runs, and they are
//                   all still false. Branch on the capabilities, never on the depth string.
//   narrativeDirector, proceduralMedia — subordinate to proceduralNarrative. The Director scores
//                   every composed week and media-voiced coverage is how a company-level fact is
//                   narrated, so both run whenever proceduralNarrative does. They are declared true
//                   alongside it rather than left false, because a flag that says a running system
//                   is absent is worse than no flag at all.
//
// PLANNED capabilities are all false and must stay false until the feature exists.
export interface GameCapabilities {
  // ---- implemented today -------------------------------------------------------------
  aiRivals: boolean // AI competitors in your market
  /**
   * AI rivals use the attack layer against you, instead of only occupying market share.
   *
   * A SECOND flag rather than a widening of `aiRivals` because they answer different questions:
   * `aiRivals` asks whether there are other companies in your market at all (false in Arena, where
   * the other founders are), this asks whether those companies fight back. Splitting them is also
   * what lets `test/rival-pressure-probe.ts` play both worlds out of one build — the A/B that
   * BACKLOG §4.1's "oversized rivals occupy TAM without ever attacking you" is measured against.
   */
  rivalAggression: boolean
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
  sharedHiringPool: boolean // one candidate market for the whole room; earliest claim wins
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
  livingWorld: boolean // umbrella flag: the world has persistent people at all

  // ---- planned: Living World (docs/procedural-living-world-system.md §2) --------------
  // Every mode declares a livingWorldDepth, but these gate the actual systems: depth sets the
  // shape of the experience, capabilities decide which parts of it are switched on. Branch on
  // these, never on the depth string alone.
  proceduralNarrative: boolean // messages composed from fragments instead of prewritten prose
  proceduralMedia: boolean // headlines about you, your rivals and the market
  narrativeDirector: boolean // scores candidate stories and picks what deserves the week
  persistentCharacters: boolean // people are generated once and remembered, not re-rolled
  characterMemory: boolean // they remember what you did to them
  companyMemory: boolean // the company's own notable history, for "since the Series A" comparisons
  relationships: boolean // trust/respect/alignment/dependence, per person
  advisorOpinions: boolean // BUILT (Phase 6). Named advisors argue, with their own biases — Career only
  structuredInterviews: boolean // BUILT (Phase 8). §41's eight questions, answered in character — Career only
  structuredEmployeeConversations: boolean // BUILT (Phase 8). §38's rooms, with a real answer — Career only
  proceduralBoardMeetings: boolean // BUILT (Phase 8). §46's topics, read off the week — Career only
  promises: boolean // BUILT (Phase 7). Commitments the world holds you to — Career only
  longTermCallbacks: boolean // week 48 remembers week 18
  rivalArchetypes: boolean // rivals have a posture, not just momentum
  rivalNarrative: boolean // rivals get narrated, not just tabulated
  proceduralPostmortem: boolean // the ending is written from what actually happened

  // ---- Tokenisation / ICO (docs/ico-architecture.md) ----------------------------------
  // Seven switches, one per slice of docs/ico-implementation-plan.md, so the capability set
  // doubles as the rollout ratchet: each slice turns on exactly one, and the acceptance test
  // ("with tokenisation off, `npm run bots` is byte-identical") is checkable per slice.
  // All seven slices have shipped, so all seven are true in CAREER ONLY. Quick Play's simplified
  // fork was Slice 7's last item and was NOT reached — see the slice report — so every token
  // capability stays false there, and Arena is off for the whole feature (§58).
  tokenisation: boolean // BUILT (Slice 1). The capital fork: eligibility, the decision, VC/IPO restrictions
  tokenEconomy: boolean // BUILT (Slice 2). Price, supply, treasury, utility, community, speculation, volatility
  tokenUserComposition: boolean // BUILT (Slice 3). Organic vs incentivised users, split retention, PMF protection, the §53 warning
  tokenIncentives: boolean // BUILT (Slice 4). Tokenomics at launch, the six categories, vesting unlocks, employee token comp
  tokenCommunity: boolean // BUILT (Slice 5). The conduct-priced trust model, decentralisation demand, founder influence, the exodus
  tokenGovernance: boolean // BUILT (Slice 6). Proposals emerging from state, votes resolved from state, mandates that bind
  tokenNarrative: boolean // BUILT (Slice 7). The `network` ending, §42 founder token sales, token beats reaching the inbox, the tokenised postmortem

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
  /** Strategic Systems Expansion (master brief v3 §3): same simulation DNA, different depth
   *  by mode. Engine code asks depth, NEVER `mode === 'career'`. */
  systemDepth: SystemDepthConfig
  turnUnit: 'week' | 'month' | 'quarter'
  /** Run ends here. Undefined = open-ended. */
  maxTurns?: number
  turnTimerSeconds?: number
  startingCash: number
  /** Brief §9/§11. Reserved: 1 everywhere today; Career will slow progression when its
   *  longer-horizon systems land. Nothing multiplies by it yet. */
  progressionMultiplier: number
  simulationDepth: 'simple' | 'standard' | 'deep'
  pmfDepth: 'simple' | 'deep'
  employeeDepth: 'simple' | 'deep'
  fundraisingDepth: 'simple' | 'deep'
  /** Living World §1. How alive the world is meant to feel in this mode. Declares intent only —
   *  the livingWorld* capabilities above decide what actually runs, and they are all still false. */
  livingWorldDepth: LivingWorldDepth
  /** ICO brief §55/§57/§58. Career deep, Quick Play light, Arena off. Declares intent only —
   *  the token* capabilities decide what runs, and they are all still false. */
  tokenDepth: TokenDepth
}

// Everything off. Base rules switch on only what they actually provide.
const NO_CAPABILITIES: GameCapabilities = {
  aiRivals: false,
  rivalAggression: false,
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
  sharedHiringPool: false,
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
  proceduralNarrative: false,
  proceduralMedia: false,
  narrativeDirector: false,
  persistentCharacters: false,
  characterMemory: false,
  companyMemory: false,
  relationships: false,
  advisorOpinions: false,
  structuredInterviews: false,
  structuredEmployeeConversations: false,
  proceduralBoardMeetings: false,
  promises: false,
  longTermCallbacks: false,
  rivalArchetypes: false,
  rivalNarrative: false,
  proceduralPostmortem: false,
  tokenisation: false,
  tokenEconomy: false,
  tokenUserComposition: false,
  tokenIncentives: false,
  tokenCommunity: false,
  tokenGovernance: false,
  tokenNarrative: false,
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
  systemDepth: QUICK_SYSTEM_DEPTH,
  turnUnit: 'week',
  startingCash: 200_000,
  progressionMultiplier: 1,
  simulationDepth: 'standard',
  pmfDepth: 'simple',
  employeeDepth: 'simple',
  fundraisingDepth: 'simple',
  livingWorldDepth: 'light',
  // ICO brief §55: the bold, understandable version of the fork — no governance screen, no
  // tokenomics micro-management. Slice 7 builds it; the seven token capabilities stay false here.
  tokenDepth: 'light',
  capabilities: {
    ...NO_CAPABILITIES,
    // Brief §3. Only the Phase 1–3 systems are wired here; advisors (§32) and promises (§36) are
    // built but Career-only, and interviews and board meetings stay off until their own phases
    // land, so a capability is never on before the code that honours it exists. Quick Play gets
    // people and company history, not a relationship sim.
    proceduralNarrative: true,
    // Built and running (src/game/world/director.ts, src/game/world/content/composer-media.ts).
    // Nothing branches on either — they run because proceduralNarrative does — so these declare
    // what is actually happening rather than understating it.
    narrativeDirector: true,
    proceduralMedia: true,
    persistentCharacters: true,
    companyMemory: true,
    characterMemory: true,
    aiRivals: true,
    // BACKLOG §4.1. Rivals that only grow are scenery: "Late Entrant" won 97% of runs against
    // Standard's 90% because rivals 8–14x your size sat on the TAM and never came for you, which
    // made the scenario longer instead of harder. On wherever `aiRivals` is on — the companies in
    // your market act, and the player's answer is the shield, the counter-raid, or buying them.
    rivalAggression: true,
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
  systemDepth: SIMULATION_SYSTEM_DEPTH,
  simulationDepth: 'deep',
  pmfDepth: 'deep',
  livingWorldDepth: 'deep',
  // ICO brief §57: Career is where the full fork lives — eligibility, tokenomics, community,
  // treasury, governance, decentralisation. Slices 1–6 build it; each capability turns on with
  // the slice that honours it, and no earlier.
  tokenDepth: 'deep',
  capabilities: {
    ...QUICK_BASE_RULES.capabilities,
    // ICO Slice 1 — the capital fork. Eligibility with readable blockers, sector suitability that
    // moves with seed and strategy, the irreversible launch decision, and institutional rounds +
    // IPO closing with an explanation attached. Quick Play's simplified fork is Slice 7 and Arena
    // is off for the whole feature (§58), so this is true HERE and nowhere else.
    tokenisation: true,
    // ICO Slice 2 — the token economy core. Price against a fundamental anchor, supply, the
    // treasury's token-denominated spend cap, utility, community strength, speculation and
    // volatility, all ticking weekly. On HERE only, for the same reason `tokenisation` is: Quick
    // Play's simplified economy is Slice 7 and Arena is off for the whole feature (§58).
    tokenEconomy: true,
    // ICO Slice 3 — user composition, and the slice the whole feature exists for. Organic vs
    // incentivised users riding on the existing cohort list, retention tracked separately for each
    // plus the counterfactual (§12), `derivePmfForSegment` seeing ORGANIC ONLY so incentive spend
    // can never manufacture Strong PMF (§52), the token-driven-growth warning (§53), and the 0.35×
    // valuation discount on rented users. On HERE only: Quick Play's split is Slice 7 and Arena is
    // off for the whole feature (§58).
    tokenUserComposition: true,
    // ICO Slice 4 — tokenomics and incentives, and the slice that makes Slice 3 reachable by a
    // player. The launch screen's allocation band, vesting policy and primary utility model; the
    // six incentive categories as shares of one weekly treasury budget; vesting unlocks as supply
    // pressure; token compensation substituting for cash payroll. Until this, `t.incentives` was
    // empty in every played game and the entire user-composition mechanic could only be reached by
    // a probe writing state directly. On HERE only, for the same reason as the three above.
    tokenIncentives: true,
    // ICO Slice 5 — the community as a counterparty, and the COST side of the token path. The
    // trust target carries a conduct ledger (treasury sales remembered, bought growth, founder
    // overhang, unmet decentralisation demand); crash shocks land scaled by founderInfluence, so
    // §35's control-for-resilience trade is real; and trust reaches numbers the founder feels —
    // member growth, market depth (45% of the liquidity discount), and, at the trust floor, an
    // exodus that sells on the way out. On HERE only: Quick Play is Slice 7, Arena is off (§58).
    tokenCommunity: true,
    // ICO Slice 6 — governance, the mechanism that RESOLVES what Slice 5 created pressure for.
    // Proposals are tabled when the community state's own need for them crosses a threshold, the
    // weekly tally is a pure function of §37's inputs (never a roll), and passed votes BIND: budget
    // floors, treasury-sale freezes, monotone handovers of control — and, at the rare terminus, the
    // no-confidence vote that routes to the board's own `fired` ending. On HERE only: Quick Play's
    // simplified fork is Slice 7 and §113 explicitly keeps deep governance out of it; Arena is off
    // for the whole feature (§58).
    tokenGovernance: true,
    // ICO Slice 7 — the run becomes a story with an ending of its own. Three things ride this flag.
    // (1) The `network` ending (§1.4, §44): the token path's ONLY success state, since tokenising
    // closes the IPO permanently and prices acquisitions off a discounted valuation. Its gate was
    // re-cut against measurement — §1.4's $1B network bar fires in zero of ~450 measured runs — and
    // its payout carries the one premium the token path has, `networkExitPremium`, because §1.4's
    // specified payout was measured at a $0.00 delta. (2) §42 founder token sales, the mechanic
    // that makes vesting and the liquidity discount decisions rather than end-of-run arithmetic,
    // and the only route by which `bankedPayout` is reachable on this path. (3) The narrative
    // layer: the crashes, rallies, unlocks and milestones the ledger has always recorded and never
    // told anyone about during the run. On HERE only: Quick Play's simplified fork was the last
    // item of this slice and was not reached; Arena is off for the whole feature (§58).
    tokenNarrative: true,
    // Brief §3: Career is where the deep living world lives. It inherits Quick Play's characters,
    // company history and composed narrative, and adds the one system Quick Play deliberately
    // leaves off — a real relationship with each person, which is what makes them remember you.
    relationships: true,
    // Living World Phase 6 (brief §28-§33): named advisors read the same week through different
    // weights and argue about it on the Dashboard (§76). Career only — §32 keeps Quick Play's
    // advisor layer shallow and §33 keeps Arena's off entirely, because Arena's complexity is
    // the other players.
    advisorOpinions: true,
    // Living World Phase 7 (brief §34-§35): the choices that ARE promises — defying the board,
    // answering the raise demand, signing the term sheet — get noted, tracked against their own
    // deadlines, and settled from the simulation's verdicts, with the fallout flowing through
    // memory, relationships and the §77 commitments panel. Career only: §36 keeps Quick Play's
    // promises to whatever is already natural in its events (that is Phase 10's slice) and §37
    // keeps Arena's off entirely. Mode-table only, per the Slice 5 precedent — an in-flight save
    // keeps the frozen capability set it was created with and simply never grows a ledger.
    promises: true,
    // Living World Phase 8 (brief §38-§39, §41-§45, §46-§47): the three rooms where the founder
    // can finally answer back — §41's eight interview questions put to three procedurally
    // generated customers with hidden biases, §38's employee conversation opened by a genuinely
    // strained relationship, and §46's board meeting composed from the same week the advisors
    // read. Every answer lands in `s.world`: trust, memory and — where the answer was actually a
    // commitment — Phase 7's promise ledger, judged later against a simulation fact.
    //
    // Career only. §40 is explicit that Quick Play gets "lightweight reactions" and no deep
    // conversation chains (that is Phase 10's slice), and §33/§87 keep Arena's narrative
    // competitive-only. Mode-table only, per the Slice 5 / Phase 7 precedent: an in-flight save
    // keeps the frozen capability set it was created with and simply never opens a room.
    structuredInterviews: true,
    structuredEmployeeConversations: true,
    proceduralBoardMeetings: true,
    // Career Phase 1 — PMF Discovery 2.0. Segment truth, beliefs, evidence, cohorts.
    detailedPMF: true,
    customerSegments: true,
    customerResearch: true,
    hypothesisBoard: true,
    decisionJournal: true,
  },
}

// Arena is the lean competitive format: the slow narrative systems are off so turns stay
// fast, the economic weapons stay on, and players can hit each other.
const ARENA_BASE_RULES: GameRules = {
  mode: 'arena',
  format: 'standard',
  systemDepth: ARENA_SYSTEM_DEPTH,
  turnUnit: 'week',
  startingCash: 200_000,
  progressionMultiplier: 1,
  maxTurns: 52,
  turnTimerSeconds: 150,
  simulationDepth: 'standard',
  pmfDepth: 'simple',
  employeeDepth: 'simple',
  fundraisingDepth: 'simple',
  livingWorldDepth: 'competitive',
  // ICO brief §58: Arena tokenisation is off for this whole feature. The architecture stays
  // compatible (see docs/ico-architecture.md, "Arena compatibility") but no token PvP is built.
  tokenDepth: 'off',
  capabilities: {
    ...NO_CAPABILITIES,
    // Brief §3: Arena dramatises what the players did to each other. Characters and company
    // history yes; no deep character memory and no relationship simulation — humans create the
    // story here, and the narrative layer only has to make it visible.
    proceduralNarrative: true,
    narrativeDirector: true,
    proceduralMedia: true,
    persistentCharacters: true,
    companyMemory: true,
    humanRivals: true,
    bankDebt: true,
    multipleVerticals: true,
    ipoEndgame: true,
    macroShocks: true,
    pvpActions: true,
    sharedHiringPool: true,
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

/**
 * Strategic-system depth for a running game (master brief v3 §3.4): resolved from the run's
 * config so engine and UI ask DEPTH, never mode. A legacy save without a config plays as Quick.
 */
export function systemDepth(
  source: { config?: GameConfig | null } | null | undefined,
  system: keyof SystemDepthConfig,
): SystemDepth {
  const cfg = source?.config
  if (!cfg) return QUICK_SYSTEM_DEPTH[system]
  return resolveGameRules(cfg).systemDepth[system]
}

// ---------- presentation ----------

/**
 * The names the PLAYER sees. The keys stay `quick` / `career` / `arena` — a mode id is written into
 * every save, journal and shared Arena config, so renaming one to change a label would break saves
 * to fix a caption (home redesign brief §1/§2: new visible naming, untouched internal identifiers).
 */
export const MODE_META: Record<GameMode, { name: string; promise: string; blurb: string; cta: string; meta: string; icon: string }> = {
  quick: {
    name: 'Quick Run',
    promise: 'Build a unicorn tonight.',
    blurb: 'Fast startup management. Start a company, make the big decisions and see how far you can take it.',
    cta: 'Play',
    meta: '30–60 min · Solo',
    icon: '⚡',
  },
  career: {
    name: 'Simulation',
    promise: 'Build the company. Become the CEO.',
    blurb: 'A deeper founder simulation about product, people, strategy and capital.',
    cta: 'Start Simulation',
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
