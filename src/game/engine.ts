import {
  EVENTS,
  INVESTORS,
  RIVAL_NAMES,
  RNG,
  STAGES,
  STAGE_THRESHOLDS,
  avgMorale,
  pick,
  raiseDemandTarget,
  randomName,
  sectorById,
} from './data'
import { ARC_DEFS } from './arcs'
import { hasCapability, resolveGameRules, type CapabilityKey, type GameCapabilities, type GameConfig } from './modes'
import { careerMarketingDrain, careerProductDrag, tickCareerPMF } from './career/tick'
import { createCareerPMF, migrateCareerSave } from './career/pmf'
import { livingWorldActive, tickLivingWorld } from './world/tick'
import { noteBoardDefiance, noteColaAdjustment, noteFundingExpectations, noteRaiseOutcome } from './world/promises'
// Rival aggression routes "who and why" through the same living-world record every other company
// fact uses, rather than inventing a parallel one. `stableCastId` is the replay-stable id the
// world's own cast reconciliation keys rivals on (world/tick.ts), so the memory attaches to the
// persona the player already knows by name.
import { noteCompanyEvent } from './world/memory'
import { stableCastId } from './world/characters'
// Tokenisation / ICO — Slice 1, the capital fork. Every one of these reads `capitalPath(s)`, which
// is `institutional` unless a token slice exists, so a run that never tokenised takes the branch it
// always took. `founderStanding` is the one that touches every ending: with no token slice its
// token leg is 0 and it is character-for-character the payout expression it replaced.
import { tokenisationEligibility } from './token/eligibility'
import {
  defyGovernanceMandate as defyMandateInner,
  founderRemovalPassed,
  setGovernanceStance as setStanceInner,
  type GovernanceActionResult,
} from './token/governance'
import { employeeTokenComp, setIncentiveShares, tokenCompMoraleDelta, type IncentiveShares } from './token/incentives'
import { sellTreasuryTokens, type TreasurySaleResult } from './token/treasury'
import { launchToken, type LaunchDraft, type LaunchResult } from './token/launch'
import { TOKEN_ACQUISITION, acquisitionDiscounted, institutionalRoundsClosed, ipoClosed } from './token/restrictions'
import { founderStanding, networkExitPremium, realisableTokenValue } from './token/scoring'
import { isTokenised, tokenActive } from './token/state'
import { tickToken } from './token/tick'
import { tickTokenNarrative } from './token/narrative'
import { TOKEN_ENDING_FACES, networkEndingProgress, tokenEndingKind } from './token/endings'
import { sellFounderPosition, type FounderSaleResult } from './token/founder'
import { incentivisedUsers } from './token/users'
import { TOKEN_ENDINGS, TOKEN_SCORING } from './token/types'
import { CONCEDE_USER_SHARE, PRICE_WAR_COOLDOWN, PR_BASE_COST, prSourceHidden, PR_CAMPAIGN_WEEKS, PRICE_WAR_COST, PRICE_WAR_WEEKS, prBackfired, tickPvpEffects } from './pvp'
import type {
  Candidate,
  Choice,
  Effects,
  Employee,
  FounderKind,
  GameState,
  HistoryPoint,
  Message,
  Rival,
  Role,
  SectorId,
  Stage,
  TermSheet,
} from './types'

let idCounter = 0
export const uid = () =>
  `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rand = (lo: number, hi: number) => lo + RNG.next() * (hi - lo)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Run fn with a seeded RNG, then restore true randomness. Used to deal identical starting worlds.
export function withSeed<T>(seed: number | undefined, fn: () => T): T {
  if (seed === undefined) return fn()
  const prev = RNG.next
  RNG.next = mulberry32(seed)
  try {
    return fn()
  } finally {
    RNG.next = prev
  }
}

// ---------- capabilities ----------
// The engine never asks which mode it is running. It asks whether a capability is on, and
// the answer was resolved once from the run's config (see ./modes).

/** Legacy bridge: old saves and older multiplayer clients still speak the 10-key Ruleset. */
export function capabilitiesFromLegacyRules(r: Partial<import('./types').Ruleset> | undefined | null): Partial<GameCapabilities> {
  if (!r || typeof r !== 'object') return {}
  const map: [keyof import('./types').Ruleset, CapabilityKey][] = [
    ['arcs', 'storyArcs'],
    ['oneOnOnes', 'oneOnOnes'],
    ['catastrophes', 'catastrophes'],
    ['energy', 'founderEnergy'],
    ['board', 'boardReviews'],
    ['debt', 'bankDebt'],
    ['ventures', 'multipleVerticals'],
    ['ipo', 'ipoEndgame'],
    ['macroShocks', 'macroShocks'],
    ['pvp', 'pvpActions'],
  ]
  const out: Partial<GameCapabilities> = {}
  for (const [from, to] of map) if (typeof r[from] === 'boolean') out[to] = r[from] as boolean
  return out
}

/**
 * Local shorthand for the one question the engine is allowed to ask. It is an ALIAS, not a second
 * implementation: it must keep delegating to `hasCapability` so there is exactly one definition of
 * what "on" means. It used to read `s.capabilities?.[k]` itself, which is the same expression today
 * and a silent divergence the first time `hasCapability` gains a rule (a default, a legacy fallback,
 * a dev-mode warning) that this copy does not.
 */
const can = (s: GameState, k: CapabilityKey): boolean => hasCapability(s, k)

function drainEnergy(s: GameState, n: number) {
  if (can(s, 'founderEnergy')) s.energy = clamp(s.energy - n, 0, 100)
}


// ---------- legacy save migration (brief §31) ----------
// Saves written before the mode/format model carry no config. Solo runs become Quick Play
// Standard, dated challenges become Daily, scenario saves keep their scenario, and anything
// labelled an online match becomes Arena. Career is NEVER assigned automatically — it is an
// explicit player choice, so an old save must not silently become one.
export function migrateLegacySave(g: GameState): GameState {
  if (!g.config) {
    const label = typeof g.challenge?.label === 'string' ? g.challenge.label : ''
    const wasDaily = label.startsWith('Daily')
    const wasOnline = label === 'Online match'
    g.config = {
      mode: wasOnline ? 'arena' : 'quick',
      format: wasDaily ? 'daily_challenge' : g.scenario && g.scenario !== 'standard' ? 'scenario' : 'standard',
      sector: g.sector,
      scenario: g.scenario ?? undefined,
      seed: 0, // unknown for an in-flight legacy run; only shapes freshly dealt worlds
      overrides: capabilitiesFromLegacyRules((g as unknown as { rules?: import('./types').Ruleset }).rules),
    }
  }
  if (!g.capabilities) g.capabilities = resolveGameRules(g.config).capabilities
  // A Career save from before PMF Discovery 2.0 has no subsystem: rebuild the market from the
  // same seed so its truth is what it always would have been, and fold existing users into a
  // starting cohort rather than deleting them.
  if (g.capabilities.detailedPMF && !g.career) {
    g.career = migrateCareerSave({
      seed: g.config.seed,
      sector: g.sector,
      scenario: g.config.scenario,
      week: g.week,
      users: g.users,
      researchSignal: g.researchSignal,
      pmf: g.pmf,
    })
  }
  return g
}

// ---------- deterministic simulation (brief §39) ----------
// The same seed + mode + format + scenario + decisions must produce the same outcome, so
// EVERY draw has to come from the run's seed rather than Math.random(). Each entry point
// reseeds from (config.seed, week, tick) and bumps the tick, so repeated actions in the same
// week still differ from each other while remaining reproducible on replay.
function mixSeed(seed: number, week: number, tick: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ week, 0x85ebca6b) >>> 0
  h = Math.imul(h ^ tick, 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** Wrap a mutating engine entry point so its randomness is reproducible. Do not nest. */
function seeded<T>(s: GameState, fn: () => T): T {
  const base = s.config?.seed
  if (base === undefined) return fn() // legacy in-flight save with no config: behave as before
  s.flags.rngTick = (s.flags.rngTick ?? 0) + 1
  return withSeed(mixSeed(base, s.week, s.flags.rngTick), fn)
}

// ---------- new game ----------

export interface NewGameOpts {
  seed?: number // deal the same world to everyone with this seed
  challenge?: { label: string; cap: number } | null // capped run (daily / multiplayer match)
  aiRivals?: boolean // false in multiplayer — the other players ARE the rivals
  scenario?: string // scenario id from SCENARIOS
  /** Preferred: the whole run configuration. Capabilities are resolved from it. */
  config?: GameConfig
  /** Escape hatch for tests/bots that want to force individual capabilities on or off. */
  capabilities?: Partial<GameCapabilities>
}

// Alternate starting worlds — same rules, different hand.
export const SCENARIOS: { id: string; name: string; blurb: string }[] = [
  { id: 'standard', name: 'Standard', blurb: '$200k, a neutral market, three hungry rivals.' },
  { id: 'winter', name: 'Funding Winter', blurb: 'The market is frozen solid. Investors hibernate — survive on customers, not term sheets.' },
  { id: 'richkid', name: 'Rich Kid', blurb: 'Start with $1M of family money — they kept 40% of the company. Comfortable, and it costs you.' },
  { id: 'secondtime', name: 'Second-Time Founder', blurb: 'Less cash ($120k), but a name that opens doors and instincts that tilt every demand roll.' },
  { id: 'late', name: 'Late Entrant', blurb: 'The market already has funded winners. $350k to catch rivals 10x your size.' },
]

function applyScenario(s: GameState, id: string) {
  s.scenario = id
  switch (id) {
    case 'winter':
      s.cash = 180_000
      s.climate = -0.95
      break
    case 'richkid':
      s.cash = 1_000_000
      s.founderEquity = 0.6
      s.reputation = 20
      break
    case 'secondtime':
      s.cash = 120_000
      s.totalResearch = 220 // pivotBonus starts near its cap — you have taste
      s.reputation = 30
      s.hype = 15
      break
    case 'late':
      s.cash = 350_000
      for (const r of s.rivals) {
        r.users = Math.round(r.users * rand(8, 14))
        r.stage = Math.min(4, r.stage + 2)
        r.product = clamp(r.product + 20, 0, 100)
      }
      break
  }
}

export function newGame(companyName: string, sector: SectorId, founderKind: FounderKind, opts: NewGameOpts = {}): GameState {
  // A run is fully described by its config, and the config decides the seed — so the same
  // config always deals the same world. Callers that pass only the legacy options get a
  // Quick Play standard config built for them.
  const config: GameConfig = opts.config ?? {
    mode: 'quick',
    format: opts.challenge?.label?.startsWith('Daily') ? 'daily_challenge' : opts.scenario && opts.scenario !== 'standard' ? 'scenario' : 'standard',
    sector,
    scenario: opts.scenario,
    seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
  }
  if (opts.capabilities) config.overrides = { ...config.overrides, ...opts.capabilities }
  return withSeed(config.seed, () => buildGame(companyName, sector, founderKind, { ...opts, config }))
}

function buildGame(companyName: string, sector: SectorId, founderKind: FounderKind, opts: NewGameOpts): GameState {
  const sec = sectorById(sector)
  // Resolved ONCE. Four separate calls used to answer this, which is four chances for a future
  // caller to pass a different config to one of them and hand out a game whose `capabilities`
  // disagree with the rivals and the career subsystem built alongside it.
  const rules = resolveGameRules(opts.config!)
  const state: GameState = {
    companyName,
    sector,
    founderKind,
    week: 1,
    cash: 200_000,
    users: 0,
    hype: 8,
    reputation: 10,
    features: 5,
    quality: 30,
    bugs: 5,
    pmf: 5,
    resonance: rand(0.45, 1.4),
    researchSignal: 0,
    totalResearch: 0,
    pivots: 0,
    milestones: [],
    allocation: { features: 50, quality: 20, bugs: 10, research: 20, bet: 0 },
    marketingSpend: 1000,
    employees: [],
    candidates: [],
    offersOut: [],
    pendingHires: [],
    rivals: (opts.aiRivals ?? rules.capabilities.aiRivals) ? makeRivals(sec.tam) : [],
    climate: rand(-0.3, 0.5),
    inbox: [],
    termSheets: [],
    stage: 'Pre-seed',
    board: null,
    founderEquity: 1,
    lastPostMoney: 0,
    raiseCooldown: 0,
    bridgeUsed: false,
    lastRevenue: 0,
    lastExpenses: 0,
    flash: null,
    challenge: opts.challenge ?? null,
    ipo: null,
    ipoCooldown: 0,
    ventures: [],
    maCooldown: 0,
    scenario: null,
    pitchCooldown: 0,
    rally: null,
    macro: { index: 100, rate: rand(3, 6), inflation: rand(2, 4) },
    debt: null,
    flags: {},
    arcs: [],
    energy: 80,
    vacationCooldown: 0,
    bankedPayout: 0,
    config: opts.config!,
    capabilities: rules.capabilities,
    // Career only: the deep discovery subsystem. Its market truth is generated once, here,
    // from the run's seed — and never regenerated for the life of the campaign.
    career: rules.capabilities.detailedPMF
      ? createCareerPMF(opts.config!.seed, sector, opts.config!.scenario)
      : undefined,
    history: [],
    gameOver: null,
  }
  if (opts.scenario && opts.scenario !== 'standard') applyScenario(state, opts.scenario)
  // Career: research has no path to PMF, so shipping a default that points a fifth of engineering
  // at it taught the wrong causal model from week 1. Quality is the lever that actually reaches
  // fit, and through fit, retention — so the freed share goes there.
  if (can(state, 'detailedPMF')) state.allocation = { features: 45, quality: 35, bugs: 20, research: 0, bet: 0 }
  state.candidates = Array.from({ length: 5 }, () => makeCandidate(state))
  state.inbox.push({
    id: uid(),
    week: 1,
    kind: 'system',
    title: `Welcome to ${companyName}`,
    body:
      `You quit your job, pooled $200k from savings and friends & family, and founded ${companyName}. ` +
      (can(state, 'detailedPMF')
        ? `Nobody knows if the market wants what you are building. Discovery is where you find out who to build for; ` +
          `product quality is how you earn them. PMF is the score you get for customers who stay. `
        : `Nobody knows if the market wants what you are building — that is what user research is for. `) +
      `Find product-market fit before the money runs out, outgrow your rivals, and reach a $1B valuation. Good luck, founder.`,
  })
  return state
}

// Last line of defence against NaN/Infinity: once one enters the state it propagates through
// every formula, and `cash < 0` stops being true so the run can never even end. Anything
// non-finite is snapped back to a sane value rather than silently poisoning the save.
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback)

function sanitize(s: GameState) {
  s.cash = finite(s.cash, 0)
  s.users = Math.max(0, finite(s.users, 0))
  s.marketingSpend = Math.max(0, finite(s.marketingSpend, 0))
  s.hype = clamp(finite(s.hype, 0), 0, 100)
  s.pmf = clamp(finite(s.pmf, 0), 0, 100)
  s.features = clamp(finite(s.features, 0), 0, 100)
  s.quality = clamp(finite(s.quality, 50), 0, 100)
  s.bugs = clamp(finite(s.bugs, 0), 0, 100)
  s.reputation = clamp(finite(s.reputation, 50), 0, 100)
  s.energy = clamp(finite(s.energy, 80), 0, 100)
  s.resonance = clamp(finite(s.resonance, 1), 0.1, 2)
  s.founderEquity = clamp(finite(s.founderEquity, 1), 0, 1)
  s.lastRevenue = Math.max(0, finite(s.lastRevenue, 0))
  s.lastExpenses = Math.max(0, finite(s.lastExpenses, 0))
  for (const e of s.employees) e.morale = clamp(finite(e.morale, 60), 0, 100)
  for (const v of s.ventures) v.users = Math.max(0, finite(v.users, 0))
}

function makeRivals(tam: number): Rival[] {
  // seeded shuffle — daily challenges and online matches must build identical worlds
  const pool = [...RIVAL_NAMES]
  const names: string[] = []
  for (let i = 0; i < 3; i++) names.push(pool.splice(Math.floor(RNG.next() * pool.length), 1)[0])
  return names.map((name) => ({
    id: uid(),
    name,
    users: Math.round(tam * rand(0.0008, 0.006)),
    stage: RNG.next() < 0.5 ? 0 : 1,
    product: rand(20, 45),
    momentum: rand(0.5, 1.5),
    alive: true,
  }))
}

// ---------- people ----------

const ROLE_BASE: Record<Role, number> = { engineer: 62_000, designer: 55_000, marketer: 50_000, sales: 52_000 }

/**
 * What someone of this role and skill is worth on the open market, before any premium, discount or
 * noise. Exported because it is the reference point `offerAcceptChance` prices an offer against —
 * a test that wants to ask "what happens at the asking price?" must get the number from here rather
 * than transcribing `ROLE_BASE` and the `13_000` slope into itself.
 */
export function marketSalary(role: Role, skill: number): number {
  return ROLE_BASE[role] + skill * 13_000
}

function rollTrait(skill: number): import('./types').TraitId | null {
  if (skill >= 8 && RNG.next() < 0.2) return 'tenx'
  if (RNG.next() < 0.4) return pick<import('./types').TraitId>(['craftsman', 'mercenary', 'culture', 'drama'])
  return null
}

/** One founder's sealed offer for a shared-pool candidate. */
export interface HiringBid {
  playerId: string
  company: string
  /** % over the candidate's asking salary. 0 means "asking price". */
  premiumPct: number
  reputation: number
  runwayWeeks: number
}

/**
 * Who the candidate picks when several founders want them.
 *
 * Deliberately NOT first-come-first-served: a click race rewards reflexes and network latency,
 * not judgement. The candidate weighs the money against the company — so a contested hire is won
 * either by paying over the odds or by having built somewhere people want to work, and you commit
 * your number without seeing anyone else's.
 *
 * Pure and seeded, so every client resolves the same auction to the same winner.
 */
export function pickHiringWinner(c: Candidate, bids: HiringBid[], seed: number, week: number): HiringBid | null {
  if (bids.length === 0) return null
  // The better someone is, the more options they have, and the less a pay bump alone moves them.
  const moneyWeight = 1 - (clamp(c.skill, 1, 10) - 1) / 22
  const scored = withSeed(mixSeed(seed, week, 0xb1d), () =>
    // sort first so the jitter draw order is stable regardless of message arrival order
    [...bids]
      .sort((a, b) => a.playerId.localeCompare(b.playerId))
      .map((b) => ({
        bid: b,
        score:
          b.premiumPct * moneyWeight + // money talks loudest
          (b.reputation - 50) / 2 + // but a good name is worth roughly 25 points of salary
          (b.runwayWeeks < 10 ? -30 : b.runwayWeeks > 40 ? 8 : 0) + // nobody joins a company that looks doomed
          rand(-6, 6), // and people are not spreadsheets
      })),
  )
  scored.sort((x, y) => y.score - x.score || x.bid.playerId.localeCompare(y.bid.playerId))
  return scored[0].bid
}

/**
 * The room's shared candidate market, for Arena. Derived purely from the match seed and the week
 * so every client renders the identical five people with identical ids — a pool built from each
 * player's own state (stage, reputation, `uid()`) would give everyone a different market and there
 * would be nothing to contest. The pool is replaced wholesale each week: in a fast PvP format,
 * hesitating should cost you the hire.
 */
export function sharedCandidates(seed: number, week: number): Candidate[] {
  return withSeed(mixSeed(seed, week, 0x51ce), () =>
    Array.from({ length: 5 }, (_, i) => {
      const role = pick<Role>(['engineer', 'engineer', 'engineer', 'designer', 'marketer', 'sales'])
      // no stage/reputation term: the market is the room's, not any one founder's
      const skill = clamp(Math.round(rand(2, 8)), 1, 10)
      const salary = Math.round((marketSalary(role, skill) + rand(-6000, 6000)) / 1000) * 1000
      return {
        id: `mk-${week}-${i}`, // stable across clients; the id IS the thing being contested
        name: randomName(),
        role,
        skill,
        salary,
        weeksLeft: 1,
        notice: Math.round(rand(1, 3)),
        trait: rollTrait(skill),
      }
    }),
  )
}

export function makeCandidate(s: GameState): Candidate {
  const role = pick<Role>(['engineer', 'engineer', 'engineer', 'designer', 'marketer', 'sales'])
  const stageBonus = STAGES.indexOf(s.stage) * 0.7
  const skill = clamp(Math.round(rand(1, 6) + s.reputation / 25 + stageBonus), 1, 10)
  const salary = Math.round((marketSalary(role, skill) + rand(-6000, 6000)) / 1000) * 1000
  return {
    id: uid(),
    name: randomName(),
    role,
    skill,
    salary,
    weeksLeft: Math.round(rand(2, 5)),
    notice: Math.round(rand(1, 3)),
    trait: rollTrait(skill),
  }
}

export const recruiterFee = (c: Candidate) => Math.round(c.salary * 0.15)

/**
 * The odds a candidate says yes to the offer sitting in `offersOut`.
 *
 * Exported so it can be TESTED rather than transcribed: the regression suite used to carry its own
 * copy of this arithmetic, which meant deleting the `overPay` term from the engine left every
 * assertion about it green. A formula the tests re-implement is a formula with no coverage.
 *
 * `runwayNow` is passed in rather than derived because the weekly tick already has the exact
 * revenue and expenses for the week being simulated; `runwayWeeks(s)` is a *projection* off
 * `marketingSpend` and would answer a slightly different question.
 */
export function offerAcceptChance(s: GameState, c: Candidate, runwayNow: number): number {
  // A company burning cash it does not have is the WORST case, not an exempt one. The guard used
  // to read `runwayNow > 0 && runwayNow < 10`, and a negative runway (cash already below zero)
  // failed the first half — so a founder who was bankrupt next week had the same 74.5% acceptance
  // as a healthy one, while a founder with nine weeks of cash was punished 25 points.
  const looksDoomed = runwayNow < 10
  // Money on the table moves people. Without this the Arena sealed-bid auction was incoherent: you
  // could win a contested hire by committing +100% — doubling both salary and the recruiter fee —
  // and the candidate would still decline a quarter of the time for reasons that had nothing to do
  // with the number you had just bid. Derived from the offer itself rather than from a stored bid,
  // so it works identically for a Quick Play offer at the asking price.
  const marketRate = marketSalary(c.role, c.skill)
  const overPay = clamp((c.salary - marketRate) / Math.max(1, marketRate), -0.2, 1)
  // A business founder closes: the third leg of the deal-game column (term sheets, exits, hires).
  const closer = s.founderKind === 'business' ? 0.08 : 0
  return clamp(0.72 + s.reputation / 400 + overPay * 0.18 + closer - (looksDoomed ? 0.25 : 0) + (s.climate < -0.2 ? 0.08 : 0), 0.05, 0.97)
}

// Every one-off payment the player has already set in motion — no hidden bills.
export function committedCosts(s: GameState): { due: number; potential: number; recommended: number } {
  const due = s.pendingHires.reduce((a, p) => a + recruiterFee(p.candidate), 0) // signed, will definitely hit
  const potential = s.offersOut.reduce((a, c) => a + recruiterFee(c), 0) // hits if the candidate accepts
  // sensible cash cushion: everything committed + a typical worst-case surprise (infra spikes scale with users)
  const recommended = due + potential + Math.max(20_000, Math.round(s.users * 8))
  return { due, potential, recommended }
}

// ---------- valuation ----------

/**
 * A QUARTER. The window every term in `valuation()` is read over.
 *
 * THE PROBLEM THIS CONSTANT EXISTS TO FIX. `valuation()` used to be a pure SPOT reading: it
 * annualised `s.lastRevenue` — one week — by 52, and it took the growth for both of its growth
 * terms from `growthRate(s)`, the trailing FOUR-week change in `s.users`. Every quantity it read
 * was one a player can move with one week's cash, and two of the three ways it read them are
 * multipliers on the WHOLE company rather than on the thing that moved:
 *
 *   multiple    = clamp(8 + growth × 150, 5, 25)   — a 5x band, multiplying all revenue
 *   growthMania = 1 + clamp(growth × 12, 0, 4)     — a 5x band, multiplying all users
 *
 * So the marginal value of a marketing dollar scaled with the SIZE of the business rather than
 * with what the dollar bought, and it peaked at the horizon, because the run ends on a fixed week
 * and the score is a snapshot of that week (`gameOver.payout ?? founderStanding(s)`).
 *
 * MEASURED, this session, by test/endgame-pump-probe.ts — 24 seeds × 90 weeks of Quick Play on the
 * calibrated policy, deviating to `marketingMax` for the last K weeks and pricing the deviation as
 * Δ founder standing ÷ Δ marketing dollars:
 *
 *     K=1   saas 20.6x · devtools 24.8x · ecommerce 97.4x · fintech 46.8x · social 27.0x · aiml 38.1x
 *     K=4   saas 21.3x · devtools 26.3x · ecommerce 106.4x · fintech 51.2x · social 26.3x · aiml 43.0x
 *
 * One extra week of ad spend at the horizon returned twenty to ninety-seven times its cost. That
 * is not a strategy, it is a clock exploit: hoard, then dump at the buzzer. Decomposed on
 * E-commerce at K=1 — $25k bought 152 users, worth $76k in `userPart` and $419k of extra revenue at
 * the old multiple, and then moved the multiple enough to add **$1.22M to revenue that was already
 * there**. Three quarters of the return was the re-pricing, not the purchase. The same
 * decomposition priced a bought user at $12,007 of valuation against a CAC of $126 and the sector's
 * own `perUserVal` of $350.
 *
 * THE FIX IS A DENOMINATION, NOT A COEFFICIENT. Not one number in the model above changes. What
 * changes is what the numbers are read OVER: a price is a claim about a quarter of trading, not
 * about the last seven days. `annualRev` becomes 52 × the trailing quarter's mean weekly revenue,
 * and the growth term becomes the change in the trailing MONTH's mean user count across a quarter.
 * A single pumped week then enters the growth signal at 1/52 of its old weight and the revenue
 * level at 1/13, while a company that genuinely compounded for a quarter reads exactly as before.
 */
export const VALUATION_WINDOW = 13

/**
 * A MONTH. Every level `valuation()` reads is this month's mean rather than this week's number —
 * the revenue it annualises, and the user count at each end of the growth comparison. It is also
 * the convention the thing is named after: a run-rate is a month annualised, not a week.
 */
export const VALUATION_SMOOTHING = 4

/**
 * Mean of a per-week series over the `span` weeks ending `back` weeks before the current one.
 *
 * The current week is not in `s.history` until the tick that produced it finishes — `advanceWeek`
 * prices acquisition offers before it pushes — so it is taken from the live field when history has
 * not caught up. Short histories (a new run, a migrated save, the 300-entry cap) read whatever
 * window exists, which is the same answer the spot reading gave when there was only one week.
 */
function trailing(s: GameState, pick: (p: HistoryPoint) => number, live: number, span: number, back: number): number {
  const h = s.history
  // `valuation` is called several times a tick and `history` runs to 300 entries, so this indexes
  // rather than mapping and slicing. `caught` is whether history already holds the current week.
  const caught = h.length > 0 && h[h.length - 1].week >= s.week
  const len = h.length + (caught ? 0 : 1)
  const end = len - back
  const from = Math.max(0, end - span)
  if (end <= from) return live
  let sum = 0
  for (let i = from; i < end; i++) sum += i < h.length ? pick(h[i]) : live
  return sum / (end - from)
}

/** Mean weekly revenue over the `span` weeks ending `back` weeks before the current one. */
function trailingRevenue(s: GameState, span: number, back = 0): number {
  return trailing(s, (p) => p.revenue, s.lastRevenue, span, back)
}

/** `trailingRevenue`'s twin on the user count. */
function trailingUsers(s: GameState, span: number, back = 0): number {
  return trailing(s, (p) => p.users, s.users, span, back)
}

/**
 * Average weekly growth in the trailing MONTH's mean user count, against the same mean `back` weeks
 * ago. Both ends are month-means rather than spot counts, which is the whole point: `s.users` takes
 * step changes that are not growth at all — paid acquisition, a dead rival's refugees, users won
 * off a PvP raid — and a stock difference read as a rate prices every one of them as a permanent
 * trend. A one-week step enters this at `1 / (4 × back)` of its weight.
 */
function smoothedGrowth(s: GameState, back: number): number | null {
  const then = trailingUsers(s, VALUATION_SMOOTHING, back)
  if (then <= 0) return null
  return clamp((trailingUsers(s, VALUATION_SMOOTHING) - then) / then / back, -0.5, 0.5)
}

/**
 * Growth the company has HELD — the only kind a multiple is a claim about. See `VALUATION_WINDOW`.
 *
 * The WEAKER of month-over-month and quarter-over-quarter. The quarter leg is what stops a bought
 * month from being extrapolated into a permanent multiple; the month leg is what keeps the
 * mark-DOWN fast, so a company that has stalled is priced as stalled without waiting a quarter for
 * the long window to catch up.
 *
 * BOTH legs are smoothed, and the first version of this function got that wrong in a way worth
 * recording. It was `min(growthRate(s), quarterOverQuarter)` — the raw four-week spot rate as the
 * fast leg. That is exactly backwards: `min` selects the spot rate precisely when the spot rate is
 * LOW, which is precisely when it is cheapest to buy. Measured on E-commerce, one week at
 * `marketingMax`: seed 22 went -0.0075 → +0.0076 (the full spot move — the quarter leg never
 * bound), and seeds 11 and 55 had the pump lift them off a low spot read and onto the quarter,
 * paying 0.0086 and 0.0041. The quarter window itself only ever moved 0.0011–0.0017, which is what
 * it was built to do. A guard that stops binding under attack is not a guard.
 *
 * Deliberately NOT applied to `growthRate`'s other readers. The board target, the IPO book and the
 * Dashboard are all asking "are we growing right now", and buying growth with ad spend is a
 * legitimate way to answer that. Only the people writing a cheque get the long look.
 */
export function sustainedGrowthRate(s: GameState): number {
  // Under a quarter plus the month it is compared against there is no long window to read, and
  // `growthRate` is already the whole of the history. Nothing is exploitable this early either:
  // `valuation` is on its $400k floor and the acquisition trigger wants $8M.
  if (s.history.length < VALUATION_WINDOW + VALUATION_SMOOTHING) return growthRate(s)
  const month = smoothedGrowth(s, VALUATION_SMOOTHING)
  const quarter = smoothedGrowth(s, VALUATION_WINDOW)
  if (month === null || quarter === null) return growthRate(s)
  return Math.min(month, quarter)
}

export function valuation(s: GameState): number {
  const sector = sectorById(s.sector)
  const annualRev = trailingRevenue(s, VALUATION_SMOOTHING) * 52
  const growth = sustainedGrowthRate(s)
  const multiple = clamp(8 + growth * 150, 5, 25) * (1 + 0.4 * s.climate)
  const revPart = annualRev * multiple
  // Investors pay up for growth: a fast-growing user base is worth a multiple of a stagnant one.
  const growthMania = 1 + clamp(growth * 12, 0, 4)
  const ventureUserVal = s.ventures.reduce((a, v) => (v.launched ? a + v.users * sectorById(v.sector).perUserVal : a), 0)
  // ICO Slice 3, docs/ico-architecture.md §1.5 — THE ONLY TOKEN-AWARE TERM `valuation()` EVER GETS,
  // and it is a DISCOUNT, never an addition. Enterprise value stays enterprise value: no token
  // market cap ever reaches this function, because the moment it did a founder with a speculative
  // float would buy rivals with inflated paper and price secondaries against a bubble.
  //
  // Incentivised users are still users — they sit in `s.users`, they pay, they cost servers — so a
  // mercenary-growth company would otherwise show exactly the inflated valuation §53 exists to
  // expose. An acquirer discounts a rented user, so this counts them at 0.35× per-user value.
  //
  // `incentivisedUsers(s)` is 0 for every run with no token slice, which makes this term
  // `s.users - 0` — the identical expression, bit for bit, so the golden traces and every existing
  // payout are untouched. The factor is exactly 1 when tokens are off, by subtraction of zero
  // rather than by multiplication by one.
  const rentedUsers = incentivisedUsers(s)
  const effectiveUsers = s.users - rentedUsers * (1 - TOKEN_SCORING.incentivisedUserValuationDiscount)
  const userPart = (effectiveUsers * sector.perUserVal + ventureUserVal) * 0.5 * growthMania
  const vibePart = (s.hype * 12_000 + s.reputation * 10_000 + productScore(s) * 8_000) * (1 + 0.3 * s.climate)
  return Math.max(400_000, Math.round(revPart + userPart + vibePart))
}

export function growthRate(s: GameState): number {
  const h = s.history
  if (h.length < 5) return 0.05
  const now = h[h.length - 1].users
  const then = h[h.length - 5].users
  if (then <= 0) return now > 0 ? 0.2 : 0
  return clamp((now - then) / then / 4, -0.5, 0.5) // avg weekly growth over last 4 weeks
}

export function productScore(s: GameState): number {
  const bugPenalty = s.sector === 'fintech' ? 1.0 : 0.6
  return clamp(s.features * 0.5 + s.quality * 0.5 - s.bugs * bugPenalty, 0, 100)
}

/**
 * Effective weekly churn as surfaced to the player — the sector's base churn scaled by a
 * product-health multiplier, clamped to [0.3, 3]. The drivers: PMF is the dominant retainer
 * (each point shaves 1/45 off the multiplier), quality helps at 1/250 per point, and bugs hurt
 * at 1/200 per point. Pure read — no writes, no RNG — and unused by the simulation itself: the
 * weekly tick's internal churnMult (see the tick, ~line 1755). The constants here MUST match the
 * tick's — this estimate spent months at the pre-rebalance values (2.4, quality/250, bugs/200),
 * quietly under-weighting quality 2x and bugs 2.2x against what the simulation actually charges,
 * so the one screen explaining churn was mis-explaining it. If the tick is rebalanced again,
 * change this line in the same commit. (Kept as a separate pure function rather than folded into
 * the tick: the tick's version runs inside the RNG-seeded weekly step and this one must stay
 * callable from any render without touching simulation state.)
 */
export function effectiveChurn(s: GameState): number {
  return sectorById(s.sector).churn * clamp(2.5 - s.pmf / 45 - s.quality / 120 + s.bugs / 90, 0.3, 3)
}

// A qualitative read on demand, unlocked by doing user research.
export function demandSignal(s: GameState): 'unknown' | 'weak' | 'mixed' | 'strong' {
  if (s.researchSignal < 14) return 'unknown'
  if (s.resonance < 0.75) return 'weak'
  if (s.resonance < 1.05) return 'mixed'
  return 'strong'
}

// The measurable range of idea quality (what the demand gauge is drawn against).
export const RESONANCE_RANGE = { min: 0.45, max: 1.6, weakBelow: 0.75, strongAbove: 1.05 }

// Your team's estimate of the idea's true demand, as a confidence band.
// More research narrows the band; it is never perfectly precise.
export function resonanceEstimate(s: GameState): { lo: number; hi: number } | null {
  if (s.researchSignal < 14) return null
  const width = clamp(0.36 - s.researchSignal * 0.004, 0.1, 0.36)
  return {
    lo: Math.max(RESONANCE_RANGE.min, s.resonance - width / 2),
    hi: Math.min(RESONANCE_RANGE.max, s.resonance + width / 2),
  }
}

export function pmfLabel(pmf: number): string {
  if (pmf < 20) return 'Nobody cares yet'
  if (pmf < 40) return 'Polite interest'
  if (pmf < 60) return 'Lukewarm traction'
  if (pmf < 80) return 'Real pull'
  return 'Escape velocity'
}

// ---------- finances ----------

export function weeklyPayroll(s: GameState): number {
  return Math.round(s.employees.reduce((a, e) => a + e.salary, 0) / 52)
}

export function weeklyOffice(s: GameState): number {
  return 300 + s.employees.length * 150
}

export function weeklyInfra(s: GameState): number {
  const ventures = s.ventures.reduce((a, v) => a + v.users * sectorById(v.sector).infraCost, 0)
  return Math.round(s.users * sectorById(s.sector).infraCost + ventures)
}

// Users across every product line — what the board, the press, and the valuation see.
export function totalUsers(s: GameState): number {
  return s.users + s.ventures.reduce((a, v) => a + v.users, 0)
}

/**
 * What the marketing budget can be raised to — the larger of the fundraising ladder and what the
 * company can actually fund out of its own business.
 *
 * IT USED TO BE THE LADDER ALONE, and `s.stage` moves in exactly one place: `acceptTermSheet`. So
 * a company that never raised was frozen at $30k/wk forever, however profitable — a bootstrapped
 * founder on $7.9M of cash, +$171k/wk of net income and infinite runway had the same budget as a
 * company in its first week. That ties spending power to *fundraising stage* rather than to
 * *ability to fund*, and those two come apart exactly when a company becomes self-sustaining,
 * which is the moment the game most wants to reward.
 *
 * THE LADDER IS KEPT AS A FLOOR, because institutional muscle is real: a Series C war chest can be
 * spent at a rate a profitable seed-stage company cannot match, and that is worth something. It is
 * now a floor rather than the whole answer.
 *
 * WHY THIS CANNOT BECOME "BURN FASTER TO WIN". docs/balance-baseline.md §1 measured LTV/CAC by
 * retention band (SaaS 0.28 → 0.33 → 0.68 → 6.28, crossing 1.0 in all five sectors): marketing is
 * correctly net-negative until retention is real. A cap keyed to *appetite* would let a leaky
 * company reach the losing strategy faster. Both terms here are keyed to ABILITY instead, and
 * neither can be manufactured by a company that is losing money:
 *
 *   * `earned` is operating profit BEFORE marketing, floored at zero. A company can spend what it
 *     makes — at a multiple of exactly 1, so pushing the slider to the cap takes net income to
 *     zero and never below it. A company that loses money earns no headroom at all.
 *   * `treasury` is a bounded weekly slice of the bank, AND IT IS GATED ON BEING PROFITABLE. A
 *     profitable company has infinite runway, so committing 2%/wk of the bank is money operations
 *     will refill. For a company that is losing money the bank is life support, not a war chest,
 *     and ungating it measurably handed a burning company with $8M in the bank a 5.3x budget for
 *     nothing. It is a cliff at break-even and the cliff is the point: the week the business
 *     starts paying for itself, the treasury becomes deployable.
 *
 * So the division of labour is clean. The ladder governs the funded-but-not-yet-profitable
 * company, which is exactly the company it was designed for and which still cannot exceed it.
 * Ability-to-fund governs the self-sustaining one, which the ladder had no way to see at all.
 *
 * Marketing is excluded from the operating figure deliberately. Reading `weeklyBurn` — which
 * includes `s.marketingSpend` — would make the cap fall as the player approached it, so the slider
 * would shrink under their hand.
 */
export const MARKETING_CAP = {
  /** The fundraising ladder, kept as a floor. */
  byStage: {
    'Pre-seed': 30_000,
    Seed: 50_000,
    'Series A': 150_000,
    'Series B': 500_000,
    'Series C': 1_500_000,
  } as Record<Stage, number>,
  /** Share of weekly operating profit (before marketing) that can be redirected into growth. */
  earnedShare: 1,
  /** Share of the bank committable per week — only while operations are refilling it. */
  treasuryShare: 0.02,
} as const

/** Weekly operating profit BEFORE marketing — what the business itself throws off. */
export function operatingProfit(s: GameState): number {
  return s.lastRevenue - (weeklyPayroll(s) + weeklyOffice(s) + weeklyInfra(s) + weeklyInterest(s))
}

export function marketingMax(s: GameState): number {
  const floor = MARKETING_CAP.byStage[s.stage]
  const profit = operatingProfit(s)
  if (profit <= 0) return floor
  const earned = profit * MARKETING_CAP.earnedShare
  const treasury = Math.max(0, s.cash) * MARKETING_CAP.treasuryShare
  return Math.round(Math.max(floor, earned + treasury))
}

// Paid acquisition price per user: rises as the market saturates and falls with PMF.
export function estimatedCac(s: GameState): number {
  const sector = sectorById(s.sector)
  return Math.max(1, (sector.perUserVal / 4) * (1 + 2 * marketSaturation(s)) * (1.7 - s.pmf / 100))
}

// Channels saturate: every extra dollar past ~$150k/wk buys fewer users than the last.
export function paidUsersPerWeek(s: GameState, spend: number): number {
  return spend / (estimatedCac(s) * (1 + spend / 150_000))
}

/**
 * The unit economics — CAC, LTV, payback — read straight off what the simulation already charges.
 *
 * These exist because the owner's direction is that a startup simulator should TEACH the
 * vocabulary of one (glossary: cac / ltv / payback), and the honest way to teach a metric is to
 * derive it from the engine rather than invent it for the dashboard:
 *
 *   cac      — `estimatedCac`, the price the tick actually charges per paid user this week.
 *   ltv      — weekly revenue per user × expected weeks retained, where expected weeks is
 *              1 / effectiveChurn: the standard geometric-lifetime identity, priced with the same
 *              churn multiplier the tick uses.
 *   payback  — cac / weekly revenue per user: how many weeks a bought user takes to repay their
 *              own acquisition. Infinity before revenue exists, and the UI must say "no revenue
 *              yet", never render the symbol.
 *   ratio    — ltv / cac, the health number the trade talks in (3x is the folk threshold).
 *
 * ARPU is `sector.arpuPerCustomer` with the same 1-cent floor as `revenuePerUser` in
 * token/users.ts — mirrored rather than imported because that module imports from this one and
 * the reverse edge would be a cycle. If the ARPU definition ever changes, change both (the token
 * module's docblock carries the same note).
 *
 * Pure read, no RNG, unused by the simulation itself — the bots trace must not move.
 */
export function unitEconomics(s: GameState): { cac: number; ltv: number; paybackWeeks: number; ratio: number } {
  const arpu = Math.max(0.01, sectorById(s.sector).arpuPerCustomer)
  const cac = estimatedCac(s)
  const ltv = arpu / effectiveChurn(s)
  const paybackWeeks = s.lastRevenue > 0 ? cac / arpu : Infinity
  return { cac, ltv, paybackWeeks, ratio: ltv / cac }
}

export function weeklyBurn(s: GameState): number {
  return weeklyPayroll(s) + weeklyOffice(s) + weeklyInfra(s) + s.marketingSpend + weeklyInterest(s)
}

export function runwayWeeks(s: GameState): number {
  const net = weeklyBurn(s) - s.lastRevenue
  if (net <= 0) return Infinity
  return s.cash / net
}

// What the runway becomes if this candidate joins (their weekly salary added to burn).
export function runwayAfterHire(s: GameState, c: Candidate): number {
  const committed = [...s.offersOut, ...s.pendingHires.map((p) => p.candidate)].reduce((a, x) => a + x.salary / 52, 0)
  const net = weeklyBurn(s) + committed + c.salary / 52 - s.lastRevenue
  if (net <= 0) return Infinity
  return (s.cash - recruiterFee(c)) / net
}

// ---------- market ----------

// Markets are not static: the addressable market itself grows ~25% a year.
export function effectiveTam(s: GameState): number {
  return Math.round(sectorById(s.sector).tam * (1 + (s.week / 52) * 0.25))
}

export function marketSaturation(s: GameState, externalUsers = 0): number {
  const total = s.users + externalUsers + s.rivals.filter((r) => r.alive).reduce((a, r) => a + r.users, 0)
  return clamp(total / effectiveTam(s), 0, 1)
}

export function rivalValuation(r: Rival, s: GameState): number {
  const sector = sectorById(s.sector)
  return Math.round(r.users * sector.perUserVal * (0.5 + r.product / 150) + r.stage * 2_000_000)
}

// ---------- effects ----------

export function applyEffects(s: GameState, fx: Effects) {
  if (fx.cash) s.cash += fx.cash
  if (fx.hype) s.hype = clamp(s.hype + fx.hype, 0, 100)
  if (fx.reputation) s.reputation = clamp(s.reputation + fx.reputation, 0, 100)
  if (fx.features) s.features = clamp(s.features + fx.features, 0, 100)
  if (fx.quality) s.quality = clamp(s.quality + fx.quality, 0, 100)
  if (fx.bugs) s.bugs = clamp(s.bugs + fx.bugs, 0, 100)
  if (fx.pmf) s.pmf = clamp(s.pmf + fx.pmf, 0, 100)
  if (fx.energy) s.energy = clamp(s.energy + fx.energy, 0, 100)
  if (fx.users) {
    // Fractional values mean "percent of current users", whole numbers are absolute.
    const delta = Math.abs(fx.users) < 1 ? Math.round(s.users * fx.users) : Math.round(fx.users)
    s.users = Math.max(0, s.users + delta)
  }
  if (fx.morale) {
    for (const e of s.employees) e.morale = clamp(e.morale + fx.morale, 0, 100)
  }
  if (fx.special === 'lose-best' && s.employees.length > 0) {
    const best = [...s.employees].sort((a, b) => b.skill - a.skill)[0]
    s.employees = s.employees.filter((e) => e.id !== best.id)
  }
  if (fx.special === 'accelerator') {
    s.founderEquity *= 1 - 0.07
  }
  if (fx.special === 'angel') {
    s.founderEquity *= 1 - 0.08
  }
  if (fx.special === 'grant-raise') {
    const star = raiseDemandTarget(s)
    if (star) {
      star.salary = Math.round((star.salary * 1.2) / 1000) * 1000
      star.morale = clamp(star.morale + 18, 0, 100)
    }
  }
  if (fx.special === 'refuse-raise') {
    const star = raiseDemandTarget(s)
    if (star) star.morale = clamp(star.morale - 20, 0, 100)
  }
  if (fx.special === 'acquihire') {
    s.flags.acquihired = 1
    for (let i = 0; i < 2; i++) {
      const role: Role = i === 0 ? 'engineer' : pick<Role>(['engineer', 'designer', 'marketer'])
      const skill = clamp(Math.round(rand(5, 8)), 1, 10)
      s.employees.push({
        id: uid(),
        name: randomName(),
        role,
        skill,
        salary: Math.round(marketSalary(role, skill) / 1000) * 1000,
        morale: 62, // their startup just died under them
        weeks: 0,
      })
    }
  }
  if (fx.special === 'board-layoffs' && s.board) {
    const toCut = Math.max(1, Math.floor(s.employees.length * 0.3))
    const cut = [...s.employees].sort((a, b) => a.skill - b.skill).slice(0, toCut)
    s.employees = s.employees.filter((e) => !cut.includes(e))
    s.board.strikes = 1
    applyEffects(s, { morale: -12 })
  }
  if (fx.special === 'board-defy' && s.board) {
    s.board.defied = true
  }
  if (fx.special === 'refinance' && s.debt) {
    s.debt.apr = Math.round((s.macro.rate + 2) * 10) / 10
  }
  if (fx.special === 'rate-hike-debt' && s.debt) {
    s.debt.apr = Math.round((s.debt.apr + 1) * 10) / 10
  }
  if (fx.special === 'cola-raise') {
    for (const e of s.employees) e.salary = Math.round((e.salary * 1.05) / 1000) * 1000
  }
  if (fx.special === 'talent-influx') {
    for (let i = 0; i < 2; i++) {
      const c = makeCandidate(s)
      c.skill = clamp(c.skill + 2, 1, 10)
      s.candidates.unshift(c)
    }
  }
  if (fx.special === 'bet-insight') {
    const bet = s.ventures.find((v) => !v.launched)
    if (bet) {
      bet.pmf = clamp(bet.pmf + 5, 0, 100)
      bet.researchSignal += 5
    }
  }
  if (fx.special === 'line-surge') {
    for (const v of s.ventures) if (v.launched) v.users = Math.round(v.users * 1.08)
  }
  if (fx.special === 'lose-mercenary') {
    const merc = s.employees.find((e) => e.trait === 'mercenary')
    if (merc) s.employees = s.employees.filter((e) => e.id !== merc.id)
  }
  if (fx.special === 'poach-rival') {
    const skill = clamp(Math.round(rand(8, 9.4)), 1, 10)
    s.candidates.unshift({
      id: uid(),
      name: randomName(),
      role: 'engineer',
      skill,
      salary: Math.round((ROLE_BASE.engineer + skill * 16_000) / 1000) * 1000,
      weeksLeft: 2,
      notice: 1,
    })
  }
}

// ---------- milestones ----------

export interface MilestoneDef {
  id: string
  title: string
  goal: string // shown in the "next goals" list
  cond: (s: GameState) => boolean
  effects: Effects
}

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'first-hire',
    title: 'First employee',
    goal: 'Hire your first employee',
    cond: (s) => s.employees.length >= 1,
    effects: { morale: 3 },
  },
  {
    id: 'first-revenue',
    title: 'First real revenue',
    goal: 'Earn $250+ in a week',
    cond: (s) => s.lastRevenue >= 250,
    effects: { morale: 5, hype: 2 },
  },
  {
    id: 'users-100',
    title: '100 users',
    goal: 'Reach 100 users',
    cond: (s) => s.users >= 100,
    effects: { hype: 3 },
  },
  {
    id: 'pmf-60',
    title: 'Product-market fit!',
    goal: 'Reach 60 PMF — the moment it clicks',
    cond: (s) => s.pmf >= 60,
    effects: { hype: 12, morale: 10, reputation: 6 },
  },
  {
    id: 'users-1k',
    title: '1,000 users',
    goal: 'Reach 1,000 users',
    cond: (s) => s.users >= 1000,
    effects: { hype: 5, reputation: 3 },
  },
  {
    id: 'ramen',
    title: 'Ramen profitable',
    goal: 'Revenue covers your weekly burn',
    cond: (s) => s.week > 4 && s.lastRevenue >= s.lastExpenses,
    effects: { morale: 10, reputation: 6 },
  },
  {
    id: 'users-10k',
    title: '10,000 users',
    goal: 'Reach 10,000 users',
    cond: (s) => s.users >= 10_000,
    effects: { hype: 6, reputation: 4 },
  },
  {
    id: 'market-leader',
    title: 'Market leader',
    goal: 'Have more users than every living rival',
    cond: (s) =>
      s.users > 100 && s.rivals.some((r) => r.alive) && s.rivals.filter((r) => r.alive).every((r) => s.users > r.users),
    effects: { hype: 8, reputation: 8, morale: 6 },
  },
  {
    id: 'users-100k',
    title: '100,000 users',
    goal: 'Reach 100,000 users',
    cond: (s) => s.users >= 100_000,
    effects: { hype: 8, reputation: 5 },
  },
  {
    id: 'centaur',
    title: 'Centaur: $100M company',
    goal: 'Reach a $100M valuation',
    cond: (s) => valuation(s) >= 100_000_000,
    effects: { hype: 10, reputation: 8, morale: 8 },
  },
]

const MILESTONE_FLAVOR: Record<string, string> = {
  'first-hire': 'Someone believed in this enough to quit their job for it. Now you owe them a company worth joining.',
  'first-revenue': 'Actual money, from actual strangers, for the thing you built. Frame the invoice.',
  'users-100': 'One hundred people use your product. You could fit them in a room — and you know some by name.',
  'pmf-60': 'Something changed. Users complain when you are down, sign-ups arrive you cannot explain, and the product is getting pulled out of your hands. This is product-market fit — pour it on.',
  'users-1k': 'A thousand users. The support inbox is no longer quiet, and neither is the market.',
  ramen: 'Revenue now covers the burn. Nobody can kill this company but you.',
  'users-10k': 'Ten thousand users. Strangers mention your product in threads you were not tagged in.',
  'market-leader': 'The comparison articles now list YOU first. Rivals study your changelog.',
  'users-100k': 'Six figures of users. Your cloud bill is a small salary, and your logo shows up in slide decks.',
  centaur: 'A hundred-million-dollar company. The unicorn is visible from here.',
}

function checkMilestones(s: GameState) {
  for (const m of MILESTONES) {
    if (s.milestones.includes(m.id)) continue
    if (!m.cond(s)) continue
    s.milestones.push(m.id)
    applyEffects(s, m.effects)
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `🏁 Milestone: ${m.title}`,
      body: MILESTONE_FLAVOR[m.id] ?? m.goal,
    })
    if (!s.flash) s.flash = `🏁 Milestone reached: ${m.title}`
  }
}

// ---------- new ventures: the multi-product company ----------

export function canStartVenture(s: GameState): { ok: boolean; reason?: string } {
  if (!can(s, 'multipleVerticals')) return { ok: false, reason: 'New verticals are disabled in this match' }
  if (STAGES.indexOf(s.stage) < 2) return { ok: false, reason: 'Reach Series A first — new bets need a real company underneath them' }
  if (s.pmf < 60) return { ok: false, reason: 'Find product-market fit on your core product first (PMF 60+)' }
  if (s.ventures.some((v) => !v.launched)) return { ok: false, reason: 'One un-launched bet at a time — focus is a feature' }
  return { ok: true }
}

export function availableVentureSectors(s: GameState) {
  const taken = new Set<string>([s.sector, ...s.ventures.map((v) => v.sector)])
  return SECTORS_IDS().filter((id) => !taken.has(id))
}

function SECTORS_IDS(): SectorId[] {
  return ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
}

export function startVenture(s: GameState, sector: SectorId) {
  return seeded(s, () => startVentureInner(s, sector))
}
function startVentureInner(s: GameState, sector: SectorId) {
  if (!canStartVenture(s).ok) return
  if (!availableVentureSectors(s).includes(sector)) return
  s.ventures.push({
    id: uid(),
    sector,
    features: 5,
    pmf: 5,
    // everything the company has learned tilts the new market's demand roll, same as a pivot
    resonance: clamp(rand(0.5, 1.45) + pivotBonus(s), 0.45, 1.6),
    researchSignal: 0,
    launched: false,
    users: 0,
    startedWeek: s.week,
  })
  if (s.allocation.bet === 0) s.allocation.bet = 25
  const name = sectorById(sector).name
  s.flash = `New bet started: ${name}. Point the "New bet" slider at it — the team explores the new market while the core business runs. It launches as a product line when its PMF reaches 50.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `New vertical: ${s.companyName} explores ${name}`,
    body: 'A tiger team peels off to chase a second S-curve. New market, new demand roll, new everything — the discovery loop starts again, funded by a business that already works.',
  })
}

export function ventureSignal(v: import('./types').Venture): 'unknown' | 'weak' | 'mixed' | 'strong' {
  if (v.researchSignal < 14) return 'unknown'
  if (v.resonance < 0.75) return 'weak'
  if (v.resonance < 1.05) return 'mixed'
  return 'strong'
}

export function killVenture(s: GameState, ventureId: string) {
  const v = s.ventures.find((x) => x.id === ventureId)
  if (!v || v.launched) return
  s.ventures = s.ventures.filter((x) => x.id !== ventureId)
  s.allocation.bet = 0
  applyEffects(s, { morale: -4 })
  s.flash = `The ${sectorById(v.sector).name} bet is shelved. The tiger team returns to the mothership with lessons learned.`
}

// ---------- pivot ----------

// Everything the company has LEARNED raises the floor of the next idea's demand roll.
// Deliberately keyed on research alone: rewarding pivot count made re-rolling on week 1
// — before you know anything — the strongest opening in the game.
export function pivotBonus(s: GameState): number {
  return Math.min(0.35, s.totalResearch * 0.0018)
}

export const PIVOT_COOLDOWN = 4
export const PIVOT_COST = 15_000

export function canPivot(s: GameState): { ok: boolean; reason?: string } {
  // A Quick Play pivot rerolls `resonance` — the hidden number it exists to escape. Career has no
  // resonance: demand lives in segmentTruth, which a pivot never touches, and neither does it
  // change sector or target. So it only ever destroyed progress (measured PMF 57 → 23) with no
  // upside available. Career's real instrument is repositionTo, on Discovery.
  if (can(s, 'detailedPMF'))
    return { ok: false, reason: 'Career changes direction by repositioning on a different customer segment — see Discovery.' }
  if ((s.flags.pivotCooldown ?? 0) > 0) return { ok: false, reason: `The team is still absorbing the last pivot — ${s.flags.pivotCooldown} wk` }
  if (s.cash < PIVOT_COST) return { ok: false, reason: `A pivot costs ${PIVOT_COST.toLocaleString()} in wind-down and rebuild` }
  return { ok: true }
}

export function pivot(s: GameState) {
  return seeded(s, () => pivotInner(s))
}
function pivotInner(s: GameState) {
  const gate = canPivot(s)
  if (!gate.ok) {
    s.flash = `Pivot unavailable — ${gate.reason}.` // never let a button silently do nothing
    return
  }
  const bonus = pivotBonus(s)
  s.pivots += 1
  // a real cost in every ruleset — energy is switched off in PvP matches, so it cannot be the only one
  s.cash -= PIVOT_COST
  s.flags.pivotCooldown = PIVOT_COOLDOWN
  drainEnergy(s, 12) // rewriting your own conviction is exhausting
  s.features = Math.round(s.features * 0.5)
  s.quality = Math.round(s.quality * 0.7)
  s.hype = Math.round(s.hype * 0.6)
  s.pmf = Math.round(s.pmf * 0.4)
  s.users = Math.round(s.users * 0.7)
  s.researchSignal = 0
  s.resonance = clamp(rand(0.5, 1.45) + bonus, 0.45, 1.6)
  applyEffects(s, { morale: -8 })
  s.flash =
    `Pivot #${s.pivots} is underway. Features, hype, users and PMF all took the hit — and the market's appetite for ` +
    `the new idea is a fresh unknown. Put effort into user research to read the new demand signal.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `Pivot #${s.pivots}: a new direction`,
    body:
      'You stood in front of the whiteboard and said the sentence every startup dreads: "What if we did something different?" ' +
      'Half the codebase survives. Some users wander off. Whether the new idea resonates — only research will tell.',
  })
}

// ---------- fundraising ----------

export function nextStage(s: GameState): Stage | null {
  const i = STAGES.indexOf(s.stage)
  return i < STAGES.length - 1 ? STAGES[i + 1] : null
}

export function pitchInvestors(s: GameState): { sheets: TermSheet[]; message: Message } {
  return seeded(s, () => pitchInvestorsInner(s))
}
function pitchInvestorsInner(s: GameState): { sheets: TermSheet[]; message: Message } {
  // Brief §5/§47. The fork closed this door. It is EXPLAINED rather than hidden: the Fundraising
  // screen shows a disabled button carrying this reason, and a player who gets here anyway is told
  // why instead of watching nothing happen. No RNG is drawn on this path.
  const rounds = institutionalRoundsClosed(s)
  if (rounds.closed) {
    const message: Message = {
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'The institutional path is closed',
      body: rounds.reason!,
    }
    s.flash = rounds.reason!
    return { sheets: [], message }
  }
  if (s.ipo) {
    const message: Message = {
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'Quiet period',
      body: 'You are mid-IPO — securities law says no private fundraising until the process ends, one way or the other.',
    }
    s.flash = 'Quiet period: no private fundraising while the IPO is in progress.'
    return { sheets: [], message }
  }
  const val = valuation(s)
  const target = nextStage(s)
  const threshold = STAGE_THRESHOLDS[s.stage]
  s.raiseCooldown = 10
  drainEnergy(s, 10) // the roadshow grind is real

  const frozenOut = s.climate < -0.5 && RNG.next() < 0.7
  if (!target || val < threshold || frozenOut) {
    s.raiseCooldown = 4 // a failed roadshow stings, but you can get back out there fast
    const message: Message = {
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'Investors passed',
      body: !target
        ? 'You are already at Series C. The next step is a $1B valuation — or an exit.'
        : frozenOut && val >= threshold
          ? 'The funding market is frozen solid. Partners nod politely over Zoom, then ghost you. "Great story — timing is tough." Try again when the climate thaws.'
          : `You pitched a dozen funds. The feedback: "too early." Come back when the company is worth ` +
            `$${threshold / 1e6}M (currently $${(val / 1e6).toFixed(1)}M). Traction talks.`,
    }
    s.flash = `${message.title} — ${message.body}`
    return { sheets: [], message }
  }

  const baseN = val > threshold * 2 ? 3 : 2
  const n = clamp(Math.round(baseN + (s.climate > 0.4 ? 1 : 0) - (s.climate < -0.2 ? 1 : 0)), 1, 4)
  // Funds have minimum check sizes per stage — a tiny company raising a "real" round pays for it in dilution.
  const ROUND_FLOORS: Record<Stage, number> = {
    'Pre-seed': 0,
    Seed: 800_000,
    'Series A': 4_000_000,
    'Series B': 15_000_000,
    'Series C': 40_000_000,
  }
  // NOT `.sort(() => RNG.next() - 0.5)`. That is not a shuffle: it feeds a random comparator to
  // Array.prototype.sort, whose output depends on V8's internal sort algorithm, so a Node upgrade
  // silently changes which investors every seed deals. `makeRivals` above already does it properly.
  // Fixed now, deliberately: this changes the investors each seed produces, and the leaderboard has
  // never accepted a score (see BACKLOG 1.3), so there is no historical replay to invalidate. This
  // is the cheapest moment this fix will ever have.
  const pool = [...INVESTORS]
  const investors: string[] = []
  for (let i = 0; i < n && pool.length > 0; i++) investors.push(pool.splice(Math.floor(RNG.next() * pool.length), 1)[0])
  // The long look, for the same reason `valuation()` takes it — see `VALUATION_WINDOW`. This one is
  // the sharper hole of the two, because the PLAYER picks the week: pitching is a button, so a spot
  // metric here is an invitation to buy a month of growth and then press it.
  //
  // MEASURED on the spot read, 24 seeds, four weeks at `marketingMax` before pitching at week 40
  // (best sheet offered, held → pumped, for a median $103k of extra ad spend):
  //
  //   saas $1.19M → $2.44M · devtools $1.88M → $3.46M · ecommerce $1.42M → $4.03M
  //   fintech $1.23M → $3.56M · social $1.65M → $4.67M · aiml $2.07M → $3.80M
  //
  // — a 10-28x return on the spend, because `growthAppetite` saturates at 0.3 and four bought weeks
  // moved SPOT growth from 0.014-0.025 to 0.095-0.159. The pre-money is unchanged, so this is not a
  // better price; it is a much bigger round at the same price, and capital is the strongest lever
  // in the game (raising is worth 4-8x on the deep-balance budget sweep). Bought for $103k.
  //
  // `offeredVal` is already safe — it is `valuation(s)`, which took the long look in the same pass.
  const growth = sustainedGrowthRate(s)
  const sheets: TermSheet[] = investors.map((investor) => {
    // Each fund prices you differently around your "fair" valuation; a cold market prices everyone down.
    const climateMult = 1 + 0.35 * s.climate
    // The business founder's trade is the DEAL GAME, and this is its biggest table. A technical
    // founder gets 5 engineering points against 1.5 — direct access to the PMF engine, which four
    // downstream terms read — and was measured beating business in all five sectors, 1.6-2.7x
    // (docs/balance-deep-dive.md finding 4). The compensating column has to be one the product
    // engine cannot buy: rounds priced 18% higher (less dilution for the same cheque), richer exit
    // processes, and closed candidates. A multiplier on the offered valuation, so it changes no
    // draw and no order.
    const pitchMult = s.founderKind === 'business' ? 1.18 : 1
    const offeredVal = val * rand(0.7, 1.25) * climateMult * pitchMult
    // Investors chase growth: a company compounding fast gets offered a bigger check.
    const growthAppetite = 1 + clamp(growth, 0, 0.3) * 4
    const amount = Math.round(Math.max(ROUND_FLOORS[target], offeredVal * rand(0.15, 0.25) * growthAppetite) / 10_000) * 10_000
    const equity = clamp(amount / (offeredVal + amount), 0.05, 0.4)
    return { id: uid(), investor, amount, equity, weeksLeft: 3 }
  })
  const message: Message = {
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `Term sheets for your ${target}`,
    body: `${n} fund${n === 1 ? '' : 's'} want${n === 1 ? 's' : ''} in. Review the offers on the Fundraising screen — they expire in 3 weeks.`,
  }
  s.flash = `${n} term sheet${n === 1 ? '' : 's'} on the table — offers below expire in 3 weeks.`
  return { sheets, message }
}

export function acceptTermSheet(s: GameState, sheetId: string) {
  if (isTokenised(s)) return // brief §5: the community path does not sign equity term sheets
  if (s.ipo) return // quiet period: the S-1 is out, private rounds are off the table
  const sheet = s.termSheets.find((t) => t.id === sheetId)
  if (!sheet) return
  const target = nextStage(s)
  if (!target) return
  const postMoney = sheet.amount / sheet.equity
  const downRound = s.lastPostMoney > 0 && postMoney < s.lastPostMoney
  s.flash =
    `${target} closed: $${(sheet.amount / 1e6).toFixed(1)}M from ${sheet.investor} at $${(postMoney / 1e6).toFixed(1)}M post-money` +
    `${downRound ? ' — a DOWN round. The team felt that.' : '. The war chest is full — spend it wisely.'}`
  s.cash += sheet.amount
  s.founderEquity *= 1 - sheet.equity
  s.stage = target
  s.termSheets = []
  s.raiseCooldown = 12
  s.lastPostMoney = postMoney
  s.reputation = clamp(s.reputation + (downRound ? -6 : 8), 0, 100)
  s.hype = clamp(s.hype + (downRound ? 2 : 10), 0, 100)
  // New money, new masters: the board resets its expectations for the new stage.
  if (can(s, 'boardReviews')) {
    s.board = { targetGrowth: BOARD_TARGETS[target], nextReview: s.week + 12, strikes: 0, defied: false }
    // Living World Phase 7 (§34): the round IS a growth expectation. Noted here because this is
    // where the expectation becomes fact — the board installs with the target and the review date
    // that will judge it. World-only; a no-op without the promises capability.
    noteFundingExpectations(s, sheet.investor)
  }
  if (downRound) applyEffects(s, { morale: -8 })
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: downRound
      ? `Down round: ${target} at $${(postMoney / 1e6).toFixed(1)}M`
      : `${target} closed: $${(sheet.amount / 1e6).toFixed(1)}M from ${sheet.investor}`,
    body: downRound
      ? `You took ${sheet.investor}'s money at a valuation below your last round. The cash saves the company, ` +
        `but early employees watch their paper wealth shrink, and the press headline writes itself. You now own ${(s.founderEquity * 100).toFixed(1)}%.`
      : `The wire hit the account. ${sheet.investor} takes ${(sheet.equity * 100).toFixed(1)}% of the company. ` +
        `You now own ${(s.founderEquity * 100).toFixed(1)}%. The press writes you up; candidates take notice.`,
  })
}

// ---------- the capital fork (ICO brief §3, §4) ----------

/**
 * Take the token path. Irreversible.
 *
 * Seeded like every other player action, for the reason recorded above `seeded()`: the launch
 * draws nothing today, but wrapping it now means a later slice that wants a roll does not have to
 * come back and change the RNG contract. This is unreachable without the `tokenisation` capability
 * and without passing eligibility, so no traditional run bumps `rngTick` here.
 */
export function tokeniseCompany(s: GameState, draft: LaunchDraft = {}): LaunchResult {
  if (!can(s, 'tokenisation')) return { ok: false, reason: 'Tokenisation is not part of this mode.' }
  if (s.gameOver) return { ok: false, reason: 'The run is over.' }
  const eligibility = tokenisationEligibility(s)
  if (!eligibility.eligible) return { ok: false, reason: eligibility.blockers[0]?.label ?? 'Not ready to tokenise.' }
  return seeded(s, () => launchToken(s, draft))
}

/**
 * ICO Slice 4, brief §13. Point the treasury at the six categories.
 *
 * NOT wrapped in `seeded()`, deliberately, and this is the opposite call from `tokeniseCompany`
 * above: setting an allocation draws nothing and never will — it is a standing order, resolved by
 * the weekly tick inside the `tokenActive` gate. Bumping `s.flags.rngTick` for a slider move would
 * mean the RNG stream depended on how many times a player dragged it, which is the one thing the
 * determinism contract cannot survive.
 */
export function setTokenIncentives(s: GameState, shares: Partial<IncentiveShares>): IncentiveShares {
  return setIncentiveShares(s, shares)
}

/**
 * ICO Slice 4, brief §6 and §30. Sell treasury tokens for company cash — the token path's
 * fundraising, and the only recurring capital decision it has.
 *
 * Unseeded for the same reason as `setTokenIncentives`: the sale is a pure function of state and the
 * size chosen, so the quote the player was shown is exactly what they get, and opening the panel
 * cannot shift the RNG stream.
 */
// ---------- ICO Slice 7: the network ending, offered ----------

/** Weeks before a declined network exit is put back on the table. */
export const NETWORK_OFFER_COOLDOWN = 12

/**
 * docs/ico-architecture.md §1.4 and brief §44. The token path's own success state, and the ONLY one
 * it has: tokenising closes the IPO permanently and prices acquisitions off a discounted valuation,
 * so without this a token run's whole ceiling is `unicorn` (which no run in ~9,000 has ever reached)
 * or the clock running out.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS A CHOICE, AND THAT IS A MEASUREMENT RESULT RATHER THAN A PREFERENCE
 *
 * The first build of this ended the run automatically the week the gate closed, exactly as
 * `unicorn` does. `npx tsx test/token-balance-probe.ts counterfactual` priced that against the
 * same seed played on to week 90 with Slice 7 off, and it was a **trap in 17 of 25 firing runs**:
 * median ratios of 0.57×–1.53× and only 8 of 25 seeds better off. The gate closes around week
 * 65–70, and a network that has just cleared it is usually still compounding — so imposing the
 * ending confiscated the back third of the run and called it a win.
 *
 * A founder who has built something that no longer needs them can step back. That is what §44's
 * five success states all describe, and it is a decision, not an event. So the run offers it, the
 * player answers, and a declined offer comes back in `NETWORK_OFFER_COOLDOWN` weeks — the same
 * shape an acquisition offer already has, resolved through the same `special` channel.
 *
 * The default (option 0) is **keep building**, which is also what makes this measurable: every bot
 * in the harness answers 0, so the probe's core table is unchanged by this ending to the last
 * digit, and the whole balance question becomes "what is it worth when a player DOES take it".
 */
function offerNetworkEnding(s: GameState): void {
  if (s.gameOver) return
  const prog = networkEndingProgress(s)
  if (!prog.reached) return
  // One offer at a time, and a declined one waits out the cooldown. Derived from the inbox rather
  // than stored: the inbox is never trimmed, so it is a memory that cannot desync from a reload.
  const last = s.inbox.find((m) => typeof m.id === 'string' && m.id.startsWith('token-network-offer-'))
  if (last && (!last.resolved || s.week - last.week < NETWORK_OFFER_COOLDOWN)) return

  const face = TOKEN_ENDING_FACES[prog.kind]
  const payout = Math.round(founderStanding(s, { tokenMultiplier: networkExitPremium(s) }))
  const premium = networkExitPremium(s)
  s.inbox.unshift({
    id: `token-network-offer-${s.week}`,
    week: s.week,
    kind: 'choice',
    title: `The network no longer needs you — ${face.name}`,
    body:
      `${face.line}\n\n` +
      `It cleared its own bar and held it for ${TOKEN_ENDINGS.sustainWeeks} straight weeks: real utility, users who arrived on ` +
      `their own, a community that still trusts you, and more value in the network than in the company that started it. Nobody is ` +
      `going to ring a bell or wire you a number — this path does not have those. This is the version of finishing it has.\n\n` +
      `Step back now and your position clears INTO that network rather than being dumped into a float you dominate: your token leg ` +
      `is realised at a ${premium.toFixed(2)}× premium on its ordinary exit discount, for a standing of ` +
      `$${payout.toLocaleString('en-US')}.\n\n` +
      `Or keep building. The offer comes back in ${NETWORK_OFFER_COOLDOWN} weeks if the network still qualifies, and a network that ` +
      `keeps growing is worth more when you do step back. It can also stop qualifying.`,
    choices: [
      {
        label: 'Keep building — it is not finished with you yet',
        resultText:
          'You stay. The network keeps running and so do you, and the same door will be open again in a few months — assuming it still is.',
        effects: {},
      },
      {
        label: `Step back — hand the network over for $${Math.round(payout / 1e6)}M`,
        resultText: `${face.line}`,
        effects: { special: 'network-exit' },
      },
    ],
  })
}

export function sellTokenTreasury(s: GameState, tokens: number): TreasurySaleResult {
  if (!can(s, 'tokenIncentives')) return { ok: false, reason: 'Treasury sales are not part of this mode.' }
  return sellTreasuryTokens(s, tokens)
}

/**
 * ICO Slice 7, brief §42. Sell from your OWN vested position for personal cash — the token path's
 * secondary, and the only route by which `bankedPayout` is reachable on it at all.
 *
 * Unseeded for the same reason as the two calls above: a sale is a pure function of state and the
 * size chosen, so the quote the player read is exactly what they get, and dragging the slider
 * cannot shift the RNG stream.
 */
export function sellFounderTokens(s: GameState, tokens: number): FounderSaleResult {
  if (!can(s, 'tokenNarrative')) return { ok: false, reason: 'Founder token sales are not part of this mode.' }
  return sellFounderPosition(s, tokens)
}

/**
 * ICO Slice 6, brief §36–§37. Take a public position on an active governance proposal — the
 * campaign. Unseeded like the two calls above and for the same reason: a position is a pure write,
 * priced once in energy (and reputation when opposing), and it shifts the WEEKLY tally through the
 * sway term from the next tick. It never re-rolls a vote, so the RNG stream cannot depend on it.
 */
export function setGovernanceStance(s: GameState, proposalId: string, stance: 'support' | 'oppose'): GovernanceActionResult {
  if (!can(s, 'tokenGovernance')) return { ok: false, reason: 'Governance is not part of this mode.' }
  return setStanceInner(s, proposalId, stance)
}

/**
 * ICO Slice 6. Tear up a standing mandate — the priced defiance. Unseeded: pure function of state
 * and the choice, so the confirmation the player read is exactly what they get.
 */
export function defyGovernance(s: GameState, proposalId: string): GovernanceActionResult {
  if (!can(s, 'tokenGovernance')) return { ok: false, reason: 'Governance is not part of this mode.' }
  return defyMandateInner(s, proposalId)
}

// ---------- weekly tick ----------

// externalUsers: other human players' users in the same market (multiplayer).
export function advanceWeek(prev: GameState, externalUsers = 0): GameState {
  // seeded on (seed, the week being simulated) so a replay of the same decisions matches
  const base = prev.config?.seed
  if (base === undefined) return advanceWeekInner(prev, externalUsers)
  return withSeed(mixSeed(base, prev.week + 1, 0), () => advanceWeekInner(prev, externalUsers))
}

function advanceWeekInner(prev: GameState, externalUsers = 0): GameState {
  const s: GameState = structuredClone(prev)
  const sector = sectorById(s.sector)
  s.week += 1
  s.flash = null
  sanitize(s) // a non-finite number anywhere would spread through every formula below and brick the save

  // --- the real economy turns over: rates, inflation, the market — and they drive the funding climate ---
  const m = s.macro
  const rateShift = rand(-0.12, 0.12) + (m.inflation > 5 ? 0.06 : m.inflation < 2 ? -0.04 : 0)
  m.rate = clamp(m.rate + rateShift, 0.5, 12)
  m.inflation = clamp(m.inflation + rand(-0.15, 0.15) + (m.rate < m.inflation - 2 ? 0.08 : m.rate > m.inflation + 2 ? -0.08 : 0), 0, 12)
  const marketReturn = rand(-0.025, 0.028) + (5 - m.rate) * 0.0015 - Math.max(0, m.inflation - 4) * 0.001
  m.index = Math.max(20, m.index * (1 + marketReturn))
  // Mean reversion. Without it climate is a pure random walk against a hard clamp, and a clamp is
  // an absorbing boundary: a run that wandered into the frozen band (< -0.6) had nothing pulling it
  // back and could stay there for the rest of the game. Measured over 40 seeds x 104 weeks before
  // this line existed: 8 runs stuck 20+ consecutive frozen weeks, worst 49 — with fundraising 70%
  // blocked throughout, which reads to the player as a broken game rather than a hard market.
  // Funding markets are cyclical, not absorbing, so the pull scales with distance from neutral.
  const reversion = -s.climate * 0.07
  s.climate = clamp(s.climate + reversion + rand(-0.08, 0.08) + marketReturn * 6 - rateShift * 0.5, -1, 1)
  if (can(s, 'macroShocks')) macroShocks(s)

  // --- inflation quietly eats payroll: salaries drift up with the cost of living ---
  for (const e of s.employees) e.salary = Math.round(e.salary * (1 + m.inflation / 100 / 52))

  // --- engineering & research ---
  const moraleFactor = (e: Employee) => 0.55 + (e.morale / 100) * 0.55
  const traitMult = (e: Employee) => (e.trait === 'tenx' ? 1.7 : e.trait === 'mercenary' ? 1.15 : e.trait === 'craftsman' ? 1.1 : 1)
  // Communication overhead: every head past the first ~8 makes the whole org slightly slower.
  // Without this, headcount has no cost but payroll, and "hire everyone you can afford" is
  // strictly optimal forever — which removes the central question of how big to get.
  const coordination = coordinationDrag(s)
  const eff = (e: Employee) => e.skill * moraleFactor(e) * traitMult(e) * coordination
  // an IPO process eats founder and team attention; a landed pitch lifts everything for a while.
  // The founder's own contribution runs on their energy tank — an exhausted founder is half a founder.
  const ipoDrag = s.ipo ? 0.85 : 1
  const rallyMult = s.rally ? s.rally.mult : 1
  const energyMult = can(s, 'founderEnergy') ? 0.4 + 0.6 * (s.energy / 100) : 1
  // Career: running experiments and repositioning both cost real engineering weeks. Without
  // this, experiments were free in product terms and the repositioning penalty did nothing.
  const careerDrag = can(s, 'detailedPMF') && s.career ? careerProductDrag(s) : 1
  const engPoints =
    (s.employees.filter((e) => e.role === 'engineer').reduce((a, e) => a + eff(e), 0) +
      (s.founderKind === 'technical' ? 5 : 1.5) * energyMult) *
    ipoDrag *
    rallyMult *
    careerDrag
  const designPoints =
    s.employees.filter((e) => e.role === 'designer').reduce((a, e) => a + eff(e), 0) * rallyMult * careerDrag
  const craftsmen = s.employees.filter((e) => e.trait === 'craftsman').length
  const careerOn = can(s, 'detailedPMF') && !!s.career
  const a = s.allocation
  const hasBet = s.ventures.some((v) => !v.launched)
  const betAlloc = hasBet ? a.bet : 0
  // Career derives PMF from segments and cohorts, so the research slider has no path to it —
  // tickCareerPMF overwrites s.pmf later in this same tick. Left in the denominator it was worse
  // than useless: it silently stole allocation share from quality, which IS the only lever on
  // product fit, so raising research measurably LOWERED PMF. Zero it there.
  const researchAlloc = careerOn ? 0 : a.research
  const allocSum = Math.max(1, a.features + a.quality + a.bugs + researchAlloc + betAlloc)
  const af = a.features / allocSum
  const aq = a.quality / allocSum
  const ab = a.bugs / allocSum
  const ar = researchAlloc / allocSum
  const abet = betAlloc / allocSum

  const featureGain = engPoints * af * 0.32 * (1 - s.features / 130)
  s.features = clamp(s.features + featureGain, 0, 100)
  s.quality = clamp(s.quality + (engPoints * aq * 0.28 + designPoints * 0.22) * (1 - s.quality / 120), 0, 100)
  // Shipping fast creates bugs; bug-fixing focus burns them down; big codebases decay a little on their own.
  // Craftsmen scrub proportionally: decisive when the codebase is a mess, negligible when it's
  // clean. A flat rate let one hire permanently solo the bug mechanic.
  s.bugs = clamp(s.bugs + featureGain * 0.55 + s.features * 0.012 - engPoints * ab * 0.5 - craftsmen * s.bugs * 0.04, 0, 100)

  // --- product-market fit: build the right thing, not just more things ---
  // Skipped entirely in Career, where tickCareerPMF derives PMF from segments and cohorts and
  // overwrites s.pmf a few lines below. Running it anyway was not merely wasted work: the interim
  // s.pmf it wrote was read by the milestone checks, so the research slider could tip a milestone
  // like `users-100` in one run and not another and quietly change hype for the rest of the game.
  if (!careerOn) {
    const researchPoints = engPoints * ar + designPoints * 0.3 + 0.5
    s.researchSignal += researchPoints
    s.totalResearch += researchPoints
    // RESEARCH DISCOVERS; BUILDING DELIVERS. Research's own fiction is already in the state:
    // `researchSignal` is "accumulated user-research on the current idea", and its only other
    // reader (`resonanceEstimate`) treats it as how much you have LEARNED about what resonates.
    // But this line used to credit research at 0.35/point forever, against features' effective
    // 0.32 × 0.25 = 0.08 with a saturation term on top — so "ship nothing, research everything"
    // was the measured optimum in all five sectors, monotone to 80-100% of the allocation
    // (docs/balance-deep-dive.md finding 2). The `learn` factor is the same saturation features
    // already had, on the stock research itself accumulates: early interviews are gold, the
    // hundredth interview about the same idea is a rerun. A pivot resets `researchSignal`, so a
    // new idea makes research young again — which is exactly the loop the game wants taught.
    // Building keeps paying because a filling product is new information to USERS, not to you.
    const learn = 1 - clamp(s.researchSignal / 130, 0, 0.9)
    // Three gain terms, three different clocks: research pays FAST and saturates (learn), shipping
    // pays WHILE you ship (featureGain is a flow), and quality pays FOREVER (a stock — a polished
    // product keeps earning fit at every scale). The stock term is what lets a mature, well-built
    // company hold high PMF against proportional decay after research has gone stale and the
    // feature surface has filled in — without it, every equilibrium compressed into the mid-30s
    // and no configuration could reach the acquisition gate again.
    const pmfGain =
      (0.3 + researchPoints * 0.35 * learn + featureGain * 0.6 + (s.quality / 100) * 0.35) *
      s.resonance *
      (1 - s.pmf / 110)
    // Decay proportional to the fit you have, not a flat tax. The old −0.5/wk flat decay is what
    // made saturating research impossible to afford: with every gain term bounded, only a term
    // with NO saturation could outrun a constant drain forever, so the measured optimum was 80-100%
    // research and nothing else could reach high PMF at all. Proportional decay turns the whole
    // block into an equilibrium system — sustained effort G settles at G/(G/110 + 0.012), so a
    // solo coasting founder drifts to the 20s, a real team with a good mix holds the 50s-70s, and
    // the market drifting away from a shipped product is priced the same at every scale. It also
    // takes the boot off early-game throats: at PMF 8 the old rule charged 0.5/wk against gains a
    // low-resonance seed could not produce (finding 5's death spiral); now it charges 0.1.
    s.pmf = clamp(s.pmf + pmfGain - s.pmf * 0.012, 0, 100)
  }

  const pScore = productScore(s)

  // --- the new bet: a second discovery loop, run by the tiger team ---
  const bet = s.ventures.find((v) => !v.launched)
  if (bet && abet > 0) {
    const betPoints = engPoints * abet
    const betFeatureGain = betPoints * 0.3 * (1 - bet.features / 130)
    bet.features = clamp(bet.features + betFeatureGain, 0, 100)
    bet.researchSignal += betPoints
    s.totalResearch += betPoints * 0.5 // exploring new markets teaches the whole company
    bet.pmf = clamp(bet.pmf + (0.2 + betPoints * 0.3 + betFeatureGain * 0.2) * bet.resonance * (1 - bet.pmf / 110) - 0.4, 0, 100)
    if (bet.pmf >= 50) {
      bet.launched = true
      bet.users = Math.round(50 + s.hype * 10)
      s.allocation.bet = 0
      const name = sectorById(bet.sector).name
      s.flash = `🚀 ${name} line launched! A second product is live with its own market — a fresh S-curve for the growth chart.`
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${s.companyName} launches its ${name} product`,
        body: 'The press calls it "an ambitious expansion". Your early users call it useful. The growth team calls it a brand-new TAM.',
      })
      applyEffects(s, { hype: 10, morale: 8, reputation: 5 })
    }
  }

  // --- launched product lines grow in their own markets ---
  for (const v of s.ventures) {
    if (!v.launched) continue
    const vs = sectorById(v.sector)
    const vTam = vs.tam * (1 + (s.week / 52) * 0.25)
    const vRoom = Math.pow(Math.max(0, 1 - v.users / vTam), 1.2)
    const vAcq = vs.acqBase * Math.pow(s.hype / 10, 1.25) * 0.5 * (0.35 + (0.65 * v.pmf) / 100) * vRoom * rand(0.8, 1.2)
    const vWom = v.users * vs.viral * Math.pow(v.pmf / 100, 1.5) * vRoom * rand(0.8, 1.2)
    const vChurn = v.users * vs.churn * clamp(2.4 - v.pmf / 45 - s.quality / 250 + s.bugs / 200, 0.3, 3)
    v.users = Math.max(0, Math.round(v.users + vAcq + vWom - vChurn))
    v.pmf = clamp(v.pmf + 0.2, 0, 100) // the line keeps maturing slowly after launch
  }

  // --- hype & marketing (noisy, saturating) ---
  const marketerPoints =
    (s.employees.filter((e) => e.role === 'marketer').reduce((a2, e) => a2 + eff(e), 0) +
      (s.founderKind === 'business' ? 4 : 1) * energyMult) *
    rallyMult
  s.hype *= 0.92
  const adSpend = Math.max(0, s.marketingSpend) // sqrt of a negative budget would NaN the whole run
  const hypeGain =
    (Math.sqrt(adSpend / 250) * (1 + marketerPoints / 12) + marketerPoints * 0.35) *
    (1 - s.hype / 115) *
    rand(0.7, 1.3)
  s.hype = clamp(s.hype + hypeGain, 0, 100)

  // --- CAREER: segment-based discovery replaces the single-number PMF model -------------
  // Everything else in this function (cash, product work, events, board, valuation) is shared;
  // only the customer/PMF step differs, and only when the capability is on.
  let careerRevenueMult = 1
  let room = 1 // remaining market headroom, consumed later by tickRivals
  if (careerOn) {
    const r = tickCareerPMF(s, {
      sectorTam: sector.tam,
      sectorAcqBase: sector.acqBase,
      marketingSpend: Math.max(0, adSpend - careerMarketingDrain(s)),
      rng: () => RNG.next(),
      uid,
    })
    s.users = r.customers
    s.pmf = clamp(r.companyPmfScore, 0, 100) // downstream systems still read a single number
    careerRevenueMult = r.revenueMultiplier
    room = Math.pow(1 - marketSaturation(s, externalUsers), 1.2)
  } else {

  // --- users: acquisition is gated by PMF, and the market is finite ---
  const saturation = marketSaturation(s, externalUsers)
  room = Math.pow(1 - saturation, 1.2)
  const pmfAcq = 0.35 + (0.65 * s.pmf) / 100
  // paid acquisition: big budgets buy users directly, at a CAC that worsens with saturation and channel fatigue
  const paid = paidUsersPerWeek(s, adSpend) * room * rand(0.8, 1.2)
  const acquired = sector.acqBase * Math.pow(s.hype / 10, 1.25) * (0.4 + pScore / 130) * pmfAcq * room * rand(0.8, 1.2) + paid
  const wordOfMouth = s.users * sector.viral * Math.pow(s.pmf / 100, 1.5) * (1 + s.hype / 150) * room * rand(0.8, 1.2)
  // The craft terms are real money now: quality's full range is worth 0.83 of churn and bugs' is
  // worth 1.11, against PMF's 2.2 — they used to be 0.4 and 0.5, weak enough that the measured
  // optimum was to never allocate a point to either (finding 2's other half: `productScore` was
  // read by ONE term while s.pmf was read by four, so every craft slider bought the cheap
  // currency). The base moves 2.4 → 2.5 so a mid product (quality 55, bugs 20) churns the same as
  // before — the CENTRE is preserved, the spread between a polished product and a neglected one
  // roughly doubles.
  const churnMult = clamp(2.5 - s.pmf / 45 - s.quality / 120 + s.bugs / 90, 0.3, 3)
  const churned = s.users * sector.churn * churnMult
  s.users = Math.max(0, Math.round(s.users + acquired + wordOfMouth - churned))
  } // end Quick Play / Arena acquisition path

  // --- revenue & costs: people only pay for things they need ---
  const salesPoints = s.employees.filter((e) => e.role === 'sales').reduce((a2, e) => a2 + eff(e), 0) * rallyMult
  // 0.18, up from 0.08: the one direct revenue edge a business founder has, and at 8% it was
  // decoration against a 3.3x engineering-point gap.
  const salesBoost = 1 + salesPoints / 40 + (s.founderKind === 'business' ? 0.18 : 0)
  const conversion = 0.25 + (0.75 * s.pmf) / 100
  // Ad-driven models only monetize at scale: CPMs and fill rates climb with network size.
  const scaleBoost = s.sector === 'social' ? 1 + Math.log10(Math.max(10, s.users)) / 3 : 1
  // ONE rate, both modes. See `arpuPerCustomer` in types.ts: the Quick Play rate was calibrated
  // for a scale the mode does not reach, which bankrupted E-commerce, Fintech and Social at every
  // setting a player could choose (docs/balance-deep-dive.md finding 1).
  const arpu = sector.arpuPerCustomer
  // A running hit piece bleeds hype and reputation weekly; a price war cuts revenue on both sides.
  const pvp = tickPvpEffects(s)
  if (pvp.prDamage) applyEffects(s, pvp.prDamage)
  const coreRevenue =
    s.users * arpu * salesBoost * conversion * scaleBoost * (0.6 + pScore / 150) * careerRevenueMult * pvp.revenueMultiplier
  const ventureRevenue = s.ventures.reduce((acc, v) => {
    if (!v.launched) return acc
    const vs = sectorById(v.sector)
    const vScale = v.sector === 'social' ? 1 + Math.log10(Math.max(10, v.users)) / 3 : 1
    return acc + v.users * vs.arpuPerCustomer * salesBoost * (0.25 + (0.75 * v.pmf) / 100) * vScale * (0.6 + pScore / 150)
  }, 0)
  const revenue = Math.round(coreRevenue + ventureRevenue)
  // ICO Slice 4, brief §16. Token compensation SUBSTITUTES for cash pay — it does not add a second
  // compensation system. `employeeTokenComp` is a pure read of the token state and returns 0 for
  // every run without the capability, so this line is `weeklyPayroll(s)` exactly for a traditional
  // company. It is read here, before `tickToken`, and the treasury and price it reads do not move
  // between this line and the release: one release of tokens, one week of payroll saved.
  const tokenComp = employeeTokenComp(s)
  const payroll = Math.max(0, weeklyPayroll(s) - tokenComp.offset)
  const office = weeklyOffice(s)
  const infra = weeklyInfra(s)
  const interest = weeklyInterest(s)
  const expenses = payroll + office + infra + s.marketingSpend + interest
  const cashAtStart = s.cash
  s.cash += revenue - expenses
  const cashAfterOperations = s.cash // everything below here (fees, events) is a one-off hit
  // Career's founder briefing reports a revenue move; it can only be known here, after the
  // shared revenue formula has run. Previously left at 0, so the briefing always claimed flat.
  if (s.career?.lastBriefing) {
    const prevRevenue = prev.lastRevenue
    s.career.lastBriefing.revenueDeltaPct =
      prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : revenue > 0 ? 100 : 0
  }
  s.lastRevenue = revenue
  s.lastExpenses = expenses
  covenantCheck(s)

  // --- offers out: candidates make up their minds ---
  const offerNews: string[] = []
  for (const c of [...s.offersOut]) {
    const runwayNow = s.cash / Math.max(1, expenses - revenue)
    if (RNG.next() < offerAcceptChance(s, c, runwayNow)) {
      s.pendingHires.push({ candidate: c, weeksUntilStart: c.notice })
      offerNews.push(`${c.name} accepted (starts in ${c.notice} wk)`)
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: `${c.name} accepted your offer`,
        body: `${c.name} (${c.role}) signed. They start in ${c.notice} week${c.notice === 1 ? '' : 's'} after serving notice. Recruiter fee due on start: $${recruiterFee(c).toLocaleString()}.`,
      })
    } else {
      offerNews.push(`${c.name} declined${runwayNow < 10 ? ' — your runway scared them off' : ''}`)
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${c.name} declined your offer`,
        body:
          runwayNow < 10
            ? `${c.name} passed. "I loved the team, but I looked at your runway and I have a mortgage." Word gets around when a startup looks shaky.`
            : `${c.name} took a counter-offer from their current employer. The search continues.`,
      })
    }
    s.offersOut = s.offersOut.filter((x) => x.id !== c.id)
  }
  if (offerNews.length > 0) s.flash = `Hiring: ${offerNews.join(' · ')}`

  // --- pending hires: notice periods tick down ---
  for (const p of [...s.pendingHires]) {
    p.weeksUntilStart -= 1
    if (p.weeksUntilStart <= 0) {
      const c = p.candidate
      s.employees.push({ id: c.id, name: c.name, role: c.role, skill: c.skill, salary: c.salary, morale: 75, weeks: 0, trait: c.trait ?? null })
      s.cash -= recruiterFee(c)
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: `${c.name} started today`,
        body: `${c.name} (${c.role}) picked a desk and shipped their first commit. Recruiter fee paid: $${recruiterFee(c).toLocaleString()}.`,
      })
      s.pendingHires = s.pendingHires.filter((x) => x.candidate.id !== c.id)
    }
  }

  // --- morale ---
  const runway = s.cash / Math.max(1, expenses - revenue)
  const cultureCarriers = s.employees.filter((e) => e.trait === 'culture').length
  const dramaMagnets = s.employees.filter((e) => e.trait === 'drama').length
  // ICO Slice 4, decision 4's loop D. A team paid partly in tokens watches the chart: the delta is
  // scaled by how much of the package is in tokens and clamped to ±3/wk, so it biases morale and
  // never dominates runway, bugs or shipping. Exactly 0 without the capability.
  const tokenMorale = tokenCompMoraleDelta(s)
  for (const e of s.employees) {
    e.weeks += 1
    let d = (70 - e.morale) * 0.06 + tokenMorale // drift toward 70
    if (expenses > revenue && runway < 8) d -= 5
    if (s.bugs > 55) d -= 2
    if (featureGain > 2.5) d += 1.5
    if (s.hype > 60) d += 1
    if (s.pmf > 60) d += 1
    d += cultureCarriers * 0.8 - dramaMagnets * 0.8
    if (e.trait === 'mercenary' && expenses > revenue && runway < 12) d -= 3
    d += rand(-2, 2)
    e.morale = clamp(e.morale + d, 0, 100)
  }
  // Quits — mercenaries jump ship well before anyone else
  const quitters = s.employees.filter(
    (e) => e.morale < (e.trait === 'mercenary' ? 55 : 32) && RNG.next() < 0.22, // mercenaries walk early — that IS the trade for their output
  )
  for (const q of quitters) {
    s.employees = s.employees.filter((e) => e.id !== q.id)
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `${q.name} resigned`,
      body: `${q.name} (${q.role}) handed in their notice, citing burnout and "a lack of direction". The rest of the team is watching how you respond.`,
    })
    applyEffects(s, { morale: -5 })
  }

  // --- rivals make their moves ---
  tickRivals(s, room)

  // --- candidates rotate ---
  if (can(s, 'sharedHiringPool') && s.config?.seed !== undefined) {
    // Arena: one market for the room, refreshed whole every week. Anyone already claimed this
    // week is gone from it, because the claim resolution pulled them out before the week ran.
    s.candidates = sharedCandidates(s.config.seed, s.week)
  } else {
    s.candidates = s.candidates.filter((c) => (c.weeksLeft -= 1) > 0)
    while (s.candidates.length < 5) s.candidates.push(makeCandidate(s))
  }

  // --- term sheets & cooldowns expire ---
  s.termSheets = s.termSheets.filter((t) => (t.weeksLeft -= 1) > 0)
  if (s.raiseCooldown > 0) s.raiseCooldown -= 1
  if (s.ipoCooldown > 0) s.ipoCooldown -= 1
  if (s.maCooldown > 0) s.maCooldown -= 1
  if (s.pitchCooldown > 0) s.pitchCooldown -= 1
  if (s.vacationCooldown > 0) s.vacationCooldown -= 1
  if (s.rally && (s.rally.weeksLeft -= 1) <= 0) s.rally = null

  // --- founder energy: slow recovery, faster erosion under stress ---
  const stressed = expenses > revenue && runway < 8
  if (can(s, 'founderEnergy')) s.energy = clamp(s.energy + 3 - (s.ipo ? 4 : 0) - (stressed ? 3 : 0), 0, 100)
  if (can(s, 'founderEnergy') && s.energy <= 5) {
    // the body files its own board ultimatum
    s.energy = 35
    applyEffects(s, { morale: -3, features: -1 })
    s.flash = '🛌 You hit the wall. Two days in bed, phone off — the doctor used the word "mandatory". You\'re back on your feet, but the warning was clear: manage your energy like you manage your runway.'
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'Founder burnout',
      body: 'Everyone saw it coming except you. The team covered, badly. Take recharge weeks before the tank hits empty — an exhausted founder is half a founder.',
    })
  }

  // --- one-on-ones: your people have asks of their own ---
  if (can(s, 'oneOnOnes')) maybeOneOnOne(s)

  // --- PvP attack cooldown & shield expiry ---
  if ((s.flags.attackCooldown ?? 0) > 0) s.flags.attackCooldown -= 1
  if ((s.flags.priceWarCooldown ?? 0) > 0) s.flags.priceWarCooldown -= 1
  if ((s.flags.shield ?? 0) > 0) s.flags.shield -= 1
  if ((s.flags.pivotCooldown ?? 0) > 0) s.flags.pivotCooldown -= 1

  // --- IPO process ---
  tickIPO(s)

  // --- random event ---
  maybeFireEvent(s)

  // --- story arcs: chapters open, chapters resolve ---
  if (can(s, 'storyArcs')) {
    maybeStartArc(s)
    tickArcs(s)
  }

  // --- acquisition offers: only credible companies get bought ---
  const val = valuation(s)
  // docs/ico-architecture.md §7.5. Acquisition stays POSSIBLE on the token path but is materially
  // worse: offers arrive less often and from a lower premium band, because an acquirer buying a
  // company whose users can be rented and whose community co-owns the roadmap pays less. Only the
  // COEFFICIENTS change — the draw and its order are identical, so no institutional run moves.
  const maDiscounted = acquisitionDiscounted(s)
  if (
    val > 8_000_000 &&
    s.pmf > 50 &&
    RNG.next() < (maDiscounted ? TOKEN_ACQUISITION.offerChance : 0.03) &&
    !s.inbox.some((m) => !m.resolved && m.kind === 'choice')
  ) {
    // Premium tracks momentum: a hot company gets bid up ~2x, a stalling one gets a lowball.
    // Flat noise made every offer strictly worse than holding, so the button was pure bait.
    const premium =
      (maDiscounted ? TOKEN_ACQUISITION.premiumBase : 1.1) + (maDiscounted ? TOKEN_ACQUISITION.premiumSpan : 0.9) * clamp(growthRate(s) * 20, 0, 1)
    // A business founder runs the sale as a process — competing bidders, a banker, a deadline —
    // and processes clear higher. Part of the deal-game column that offsets the technical
    // founder's engineering points; see the term-sheet note.
    const processMult = s.founderKind === 'business' ? 1.15 : 1
    const amount = Math.round((val * premium * processMult * rand(0.92, 1.12)) / 1e6) * 1e6
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'choice',
      title: `Acquisition offer: $${(amount / 1e6).toFixed(0)}M`,
      body:
        `A strategic acquirer wants to buy ${s.companyName} outright for $${(amount / 1e6).toFixed(0)}M in cash. ` +
        `Your ${(s.founderEquity * 100).toFixed(0)}% stake would be worth $${((amount * s.founderEquity) / 1e6).toFixed(1)}M. ` +
        `Take the money, or keep building?`,
      meta: { acquisitionAmount: amount },
      choices: [
        { label: 'Sell the company', resultText: 'You sign the papers. Champagne — and a strange emptiness.', effects: { special: 'acquired' } },
        { label: 'Keep building', resultText: 'You are not done yet. The team cheers.', effects: { morale: 6, reputation: 3 } },
      ],
    })
  }

  // --- history ---
  s.history.push({
    week: s.week,
    cash: Math.round(s.cash),
    users: totalUsers(s),
    revenue,
    expenses,
    payroll,
    marketing: s.marketingSpend,
    office,
    infra,
    interest,
    macroIndex: Math.round(s.macro.index * 10) / 10,
    valuation: val,
    pmf: Math.round(s.pmf),
  })
  if (s.history.length > 300) s.history.shift()

  // --- board review ---
  boardReview(s)

  // --- milestones ---
  checkMilestones(s)

  // --- the token economy (ICO Slice 2) ---
  // Runs after the week's fundamentals exist — revenue, users, product — because `fairValue` is
  // built from them, and BEFORE the endings, because `realisableTokenValue` prices the founder's
  // position at this week's close.
  // Guarded rather than called unconditionally, for the reason recorded above the living-world
  // line below and in docs/ico-architecture.md §3.2: `seeded` bumps s.flags.rngTick, so an
  // unconditional call would shift the RNG stream for every daily challenge, Arena match, replay
  // and golden trace — even for a run that never tokenised. `tokenActive` is false when there is
  // no token slice or when no token capability is on, so those runs draw exactly zero times.
  // ICO Slice 7: the narrative layer runs INSIDE the same guard and the same `seeded` call, right
  // after the tick that produced the week it narrates. It draws nothing, so the one-draw contract
  // `tickToken` documents is untouched and the RNG stream is bit-identical to Slice 6's; putting it
  // inside the existing call rather than adding a second `seeded()` is what keeps `s.flags.rngTick`
  // unchanged, which is the thing the golden traces actually hash.
  if (tokenActive(s))
    seeded(s, () => {
      tickToken(s)
      tickTokenNarrative(s)
    })

  // ICO Slice 6, brief §43's Community Revolt at its terminus — docs/ico-architecture.md §7.9:
  // a revolt that removes the founder routes to the EXISTING `fired` ending, in exactly the
  // board's shape. The vote itself resolved inside the tick, from state, never from a roll; this
  // is only the engine honouring it, because terminating a run is engine territory. Being removed
  // halves what your EQUITY is worth — it does not confiscate your token position, which is the
  // same disjoint-legs rule every other ending follows.
  if (!s.gameOver && founderRemovalPassed(s)) {
    s.gameOver = {
      type: 'fired',
      week: s.week,
      payout: Math.round(founderStanding(s, { equityMultiplier: 0.5 })),
      detail:
        'The community that funded the network voted you out of it. You were warned — the brewing notice, the tabling, four weeks of a tally you could read — and the state the vote read never changed.',
    }
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'The vote of no confidence passed',
      body:
        'The network keeps running — it was never yours to keep. You leave with half of what your equity was worth and every token you had vested. The community governs what remains.',
    })
  }

  // A tokenised company can never raise, and `s.stage` is written in exactly one place —
  // acceptTermSheet, which returns early once tokenised. So the fork silently froze the company at
  // whatever stage it launched from, forever. That matters because marketingMax() is purely
  // stage-based: a tokenised founder was capped at $30k/wk against a traditional median of $50k,
  // no matter how large the treasury. Measured on identical seeds over 60 weeks, 3x the cap is
  // +44% enterprise value and 10x is +116% — a 1.7x-5x handicap that has nothing to do with
  // tokenomics and would have decided any comparison between the two paths.
  //
  // The community path earns its stage the way it earns everything else: by being worth it. The
  // thresholds are already valuation-denominated, so this reuses them rather than inventing a
  // second ladder.
  //
  // ONLY THE COMMUNITY PATH, AND THE GATE IS LOAD-BEARING RATHER THAN CAUTIOUS.
  //
  // `STAGE_THRESHOLDS[s.stage]` is not "the valuation of a ${up} company". It is the bar
  // `pitchInvestorsInner` checks before it will offer term sheets for the NEXT round — the same
  // constant, compared against the same `valuation(s)`. So for any company that can still raise,
  // advancing the stage here consumes the round instead of enabling it: the week the company
  // becomes worth $1.5M it is promoted to Seed for free, and from then on `pitchInvestors` compares
  // against Seed's $12M bar. The Seed round becomes unreachable in the entire $1.5M-$12M band where
  // it is exactly what the company should be raising.
  //
  // Measured, ungated, against this same tree: 6 of 12 Career companies sat at stage Seed on
  // $0.6M-$3.4M of valuation with no round closed and no cash; `npm run bots` went from 2/24, 0/24,
  // 1/24, 6/24, 2/24, 3/24 bankruptcies to 11/24, 9/24, 19/24, 10/24, 12/24, 16/24, and median SaaS
  // revenue from $16.1k/wk to $4.9k/wk. Four assertions in test/career-balance.test.ts went red.
  // The promotion is not free: `makeCandidate` prices every candidate off `STAGES.indexOf(s.stage)`,
  // so the company buys the stage's salaries with none of the stage's money.
  //
  // A tokenised company is the one case where the constant means what this block needs it to mean,
  // because `institutionalRoundsClosed` has already taken the round away — there is no raise left
  // to consume. The bootstrapped traditional founder on $25M and a $30k/wk budget is a real
  // complaint and the measurements above are real, but the answer is to stop `marketingMax` reading
  // a fundraising ladder, not to hand out rungs of that ladder for free.
  if (!s.gameOver && isTokenised(s)) {
    const up = nextStage(s)
    if (up && valuation(s) >= STAGE_THRESHOLDS[s.stage]) {
      s.stage = up
      s.flash = `📈 ${up}. The network is worth what a ${up} company is worth — you did not raise it, you built it.`
      // No investors, no board. A raise still installs one; growing into the stage does not.
      if (can(s, 'boardReviews')) s.board = null
    }
  }

  // ICO Slice 7. The `network` ending is OFFERED here, never imposed — see `offerNetworkEnding`.
  offerNetworkEnding(s)

  // --- endings (skip if the IPO already decided this week) ---
  if (s.gameOver) return s
  if (s.cash < 0) {
    // A bridge exists for companies worth saving: real valuation, or fundamentals that basically work.
    const nearProfitable = revenue >= expenses * 0.85
    if (!s.bridgeUsed && (val > 3_000_000 || nearProfitable)) {
      s.bridgeUsed = true
      const bridge = Math.max(Math.round(weeklyBurn(s) * 10), Math.abs(Math.round(s.cash)) + 25_000)
      s.cash += bridge
      s.founderEquity *= 0.85
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: 'Emergency bridge round',
        body:
          `The bank account hit zero. ${nearProfitable && val <= 3_000_000 ? 'Your fundamentals are close enough to working that an angel took the call. They' : 'An existing investor'} wired a $${(bridge / 1000).toFixed(0)}k bridge loan to keep the lights on — ` +
          `in exchange for 15% of the company. This will not happen twice. Fix the burn.`,
      })
      s.flash = `⚠️ The account hit zero — a $${(bridge / 1000).toFixed(0)}k emergency bridge saved you, for 15% of the company. There is no second bridge.`
    } else {
      const oneOffs = Math.round(cashAfterOperations - s.cash)
      const fmt = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString()}`
      // Secondaries survive the wreck — and so does the token leg, because the two legs are
      // disjoint: the equity is worthless, the position in the network is a separate asset.
      // `realisableTokenValue` is 0 without a token slice, so this is `s.bankedPayout` exactly.
      const wreckage = s.bankedPayout + realisableTokenValue(s)
      s.gameOver = {
        type: 'bankrupt',
        week: s.week,
        payout: wreckage > 0 ? wreckage : undefined,
        detail:
          `The final week: you went in with ${fmt(cashAtStart)}, earned ${fmt(revenue)} in revenue, paid ${fmt(expenses)} in running costs` +
          (oneOffs > 0 ? `, and took ${fmt(oneOffs)} in one-off hits (recruiter fees, event costs, severance)` : '') +
          `. That left the account at −${fmt(s.cash)}${s.bridgeUsed ? ', and the bridge loan was already spent' : ', and no investor would bridge it'}.`,
      }
    }
  } else if (val >= 1_000_000_000 && !s.ipo) {
    // mid-IPO, the run continues — ringing the bell at a $1B+ price beats the plain unicorn ending
    s.gameOver = { type: 'unicorn', week: s.week, payout: Math.round(founderStanding(s, { exitValue: val })) }
  } else if (s.challenge && s.week >= s.challenge.cap) {
    s.gameOver = { type: 'timeup', week: s.week, payout: Math.round(founderStanding(s, { exitValue: val })) }
  }

  // The living world runs LAST, once every fact for the week exists — including the ending, so a
  // postmortem can read it. It interprets; it never decides. With its capabilities off it returns
  // immediately, which is what keeps this line invisible to Quick Play and Arena.
  // Guarded rather than called unconditionally: `seeded` bumps s.flags.rngTick, so an
  // unconditional call would shift the RNG stream for every mode and silently change Quick Play
  // and Arena outcomes even with the whole system switched off.
  if (livingWorldActive(s)) seeded(s, () => tickLivingWorld(s))

  return s
}

// ---------- IPO ----------

export const IPO_COST = 2_000_000
// Raised from $300M: filing the moment you were eligible HALVED the median payout
// ($166M vs $313M for riding to the unicorn). The checklist told you that you could,
// never that you shouldn't.
export const IPO_MIN_VAL = 500_000_000
export const IPO_MIN_ANNUAL_REV = 10_000_000

// The street doesn't care how many rounds you raised — only scale, revenue, and readiness.
export function ipoChecklist(s: GameState): { label: string; met: boolean }[] {
  return [
    { label: `Valuation ≥ $${IPO_MIN_VAL / 1e6}M`, met: valuation(s) >= IPO_MIN_VAL },
    { label: `Revenue ≥ $${IPO_MIN_ANNUAL_REV / 1e6}M/yr`, met: s.lastRevenue * 52 >= IPO_MIN_ANNUAL_REV },
    { label: 'Bankers will answer your calls', met: s.ipoCooldown === 0 },
    { label: `$${IPO_COST / 1e6}M for bankers & lawyers`, met: s.cash >= IPO_COST },
  ]
}

// When the IPO path should appear on screen: close enough to start planning for it.
export function ipoVisible(s: GameState): boolean {
  if (!can(s, 'ipoEndgame')) return false
  // Brief §48: "Do not silently hide it without explanation." A tokenised company ALWAYS sees this
  // panel, precisely so the panel can say the path is closed and why. Hiding it would let a player
  // reach the end of a run without ever learning what the fork cost them.
  if (ipoClosed(s).closed) return true
  return valuation(s) >= IPO_MIN_VAL / 2 || s.stage === 'Series B' || s.stage === 'Series C'
}

export function ipoEligible(s: GameState): boolean {
  if (!can(s, 'ipoEndgame')) return false
  if (ipoClosed(s).closed) return false // brief §48: ipoEligible = false once tokenised
  return !s.ipo && !s.gameOver && ipoChecklist(s).every((c) => c.met)
}

export function startIPO(s: GameState) {
  if (!ipoEligible(s)) return
  s.cash -= IPO_COST
  drainEnergy(s, 10)
  s.ipo = { phase: 'filing', weeksLeft: 4, demand: 50 }
  s.flash =
    'The S-1 is filed. Four weeks of regulatory scrutiny, then a four-week roadshow — and then the market decides what you are worth. ' +
    'Fundraising is frozen during the quiet period, and the process will eat some of your attention.'
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `${s.companyName} files to go public`,
    body:
      'The confidential S-1 hits the SEC. Analysts start building models, journalists start digging, and every bug report ' +
      'is suddenly a "material risk factor". Keep the product clean and the growth curve pointing up.',
  })
}

function tickIPO(s: GameState) {
  if (!s.ipo) return
  const ipo = s.ipo
  ipo.weeksLeft -= 1

  if (ipo.phase === 'filing') {
    // scrutiny: the street reads everything
    let d = 0
    if (s.bugs > 50) d -= 4
    if (s.reputation > 60) d += 2
    if (s.reputation < 35) d -= 3
    if (growthRate(s) > 0.02) d += 2
    ipo.demand = clamp(ipo.demand + d + rand(-2, 2), 0, 100)
    if (ipo.weeksLeft <= 0) {
      ipo.phase = 'roadshow'
      ipo.weeksLeft = 4
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: 'The roadshow begins',
        body: 'Eight cities, forty meetings, one deck. Fund managers squint at your churn curve and ask about "the path to profitability". Every strong week adds demand for the stock.',
      })
    }
    return
  }

  // roadshow: demand builds (or leaks) week by week
  ipo.demand = clamp(ipo.demand + 3 + growthRate(s) * 60 + s.climate * 4 + s.hype / 30 + rand(-3, 3), 0, 100)
  s.hype = clamp(s.hype + 4, 0, 100)
  if (ipo.weeksLeft <= 0) priceIPO(s)
}

function priceIPO(s: GameState) {
  const val = valuation(s)
  // pricing day: investor demand meets the market's mood
  // Wider spread: a well-prepared book should clearly beat grinding to $1B, a sloppy one should sting.
  const mult = 0.65 + (s.ipo!.demand / 100) * 0.85 + 0.3 * s.climate + rand(-0.08, 0.12)
  s.ipo = null
  if (mult >= 0.95) {
    const pop = mult >= 1.15
    // The IPO multiplier applies to the EQUITY LEG ONLY — a pop prices shares, not tokens. Passing
    // the priced valuation as `exitValue` keeps the arithmetic in the order it was written in, so
    // every existing IPO pays out to the last bit.
    const payout = Math.round(founderStanding(s, { exitValue: val * mult }))
    s.gameOver = { type: 'ipo', week: s.week, payout }
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: pop ? `📈 ${s.companyName} pops ${Math.round((mult - 1) * 100)}% on debut` : `${s.companyName} is a public company`,
      body: pop
        ? 'The bell rings, the ticker climbs, and CNBC mispronounces your name. A very good day.'
        : 'A steady, respectable debut. The bankers look relieved, which is their version of joy.',
    })
  } else {
    s.ipoCooldown = 25
    s.reputation = clamp(s.reputation - 10, 0, 100)
    applyEffects(s, { morale: -8 })
    s.flash =
      `IPO pulled. Demand priced the offering ${Math.round((1 - mult) * 100)}% below your last round and the board refused to go out at that price. ` +
      'The street will not look at you again for a while — build the numbers, then come back.'
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `${s.companyName} shelves its IPO`,
      body: '"Market conditions", says the press release. Everyone knows what that means. The team watched the ticker that never was.',
    })
  }
}

// ---------- macro shocks: the world happens to you ----------

function macroShocks(s: GameState) {
  if (RNG.next() > 0.03) return
  const m = s.macro
  const roll = RNG.next()
  const push = (title: string, body: string) =>
    s.inbox.unshift({ id: uid(), week: s.week, kind: 'news', title, body })
  if (roll < 0.25) {
    m.inflation = clamp(m.inflation + 1.5, 0, 12)
    m.index *= 0.94
    s.climate = clamp(s.climate - 0.15, -1, 1)
    push(
      '🛢 Oil shock',
      'Energy prices spike overnight. Inflation jumps, markets wobble, and your cloud provider is already drafting a "pricing update" email. Expect salaries and costs to climb faster for a while.',
    )
  } else if (roll < 0.5) {
    m.rate = clamp(m.rate + 1, 0.5, 12)
    s.climate = clamp(s.climate - 0.25, -1, 1)
    push(
      '🏦 Central bank hikes rates',
      'Money just got more expensive. Venture funds mark down their models, debt costs more, and every board meeting adds a slide about "efficiency".',
    )
  } else if (roll < 0.75) {
    m.rate = clamp(m.rate - 1.2, 0.5, 12)
    s.climate = clamp(s.climate + 0.25, -1, 1)
    push(
      '🏦 Surprise rate cut',
      'The central bank blinks. Cheap money returns, valuations inflate, and investors remember your phone number.',
    )
  } else if (roll < 0.9) {
    m.index *= 1.08
    s.climate = clamp(s.climate + 0.15, -1, 1)
    push('📈 Markets rally', 'The index rips upward. Risk is back in fashion, and so are term sheets.')
  } else {
    m.index *= 0.85
    s.climate = clamp(s.climate - 0.45, -1, 1)
    push(
      '📉 Market crash',
      'A red day for the ages. Funds freeze new deals, acquirers vanish, and LinkedIn fills with "personal news". Survive this and the survivors inherit the market.',
    )
  }
}

// ---------- bank debt: leverage with conditions ----------

export function debtCapacity(s: GameState): number {
  if (!can(s, 'bankDebt')) return 0
  const annual = s.lastRevenue * 52
  if (annual < 250_000) return 0
  return Math.round(Math.min(annual * 0.5, 10_000_000) / 10_000) * 10_000
}

export function debtApr(s: GameState): number {
  return Math.round((s.macro.rate + (s.lastRevenue >= s.lastExpenses ? 3 : 6)) * 10) / 10
}

export function weeklyInterest(s: GameState): number {
  return s.debt ? Math.round((s.debt.principal * s.debt.apr) / 100 / 52) : 0
}

export function drawDebt(s: GameState, amount: number) {
  const cap = debtCapacity(s) - (s.debt?.principal ?? 0)
  amount = Math.min(amount, cap)
  if (amount <= 0) return
  const apr = debtApr(s)
  s.cash += amount
  s.flags.tookDebt = 1
  s.debt = {
    principal: (s.debt?.principal ?? 0) + amount,
    apr,
    // A covenant ratchets up, never down. Re-baselining it on every draw was a free pass:
    // a growing company could top up its line each week and never risk a breach.
    covenantRevenue: Math.max(s.debt?.covenantRevenue ?? 0, Math.round(s.lastRevenue * 0.7)),
  }
  s.flash =
    `🏦 Drew $${(amount / 1000).toFixed(0)}k of bank debt at ${apr}% APR. No dilution — but read the covenant: if weekly revenue drops below ` +
    `$${s.debt.covenantRevenue.toLocaleString()}, the bank calls the loan.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `Credit line drawn: $${(amount / 1000).toFixed(0)}k at ${debtApr(s)}%`,
    body: 'Non-dilutive money, priced off the central-bank rate. Interest hits the burn every week; the covenant watches your revenue. Banks are lovely right up until they are not.',
  })
}

export function repayDebt(s: GameState, amount: number) {
  if (!s.debt) return
  amount = Math.min(amount, s.debt.principal, s.cash)
  if (amount <= 0) return
  s.cash -= amount
  s.debt.principal -= amount
  if (s.debt.principal <= 0) {
    s.debt = null
    s.flash = '🏦 Debt fully repaid. The covenant dies with it — your revenue is yours again.'
  } else {
    s.flash = `🏦 Repaid $${(amount / 1000).toFixed(0)}k. Remaining principal: $${(s.debt.principal / 1000).toFixed(0)}k.`
  }
}

/**
 * What a forced conversion costs, per dollar actually defaulted on.
 *
 * The old rule was a flat `founderEquity *= 0.85` that never read `shortfall`, so defaulting on
 * $10M and defaulting on $250k cost a founder exactly the same 15%. That makes the dominant line
 * "max the credit line, spend it the week it lands, breach" — the bank can only seize cash that
 * still exists, and the conversion is a fixed price whatever the hole.
 *
 * docs/balance-deep-dive.md finding 7 measured it and found it NOT currently exploitable: zero
 * breaches in any cell, because `debtCapacity` needs revenue Quick Play cannot generate today. It
 * goes live the moment that is fixed, which is why this lands first.
 *
 * Priced like every other conversion of capital into ownership in this codebase — the same shape as
 * `saleDilution` in token/launch.ts — with two differences that are the point:
 *
 *   • A DISTRESS PREMIUM. A negotiated round prices at `raised / enterprise`; a bank taking equity
 *     from a founder who just broke a covenant does not offer those terms. That is what default is.
 *   • A FLOOR, so a small default is never free. Without it, the fix would trade one exploit for
 *     another: draw a small line, spend it, breach, pay nothing.
 */
export const COVENANT_DEFAULT = {
  distressPremium: 1.5,
  floor: 0.03,
  cap: 0.6,
} as const

/** 0–1 of the founder's stake, for a shortfall of `shortfall` against an enterprise value. */
export function covenantConversion(shortfall: number, enterprise: number): number {
  if (!(shortfall > 0)) return 0
  if (!(enterprise > 0)) return COVENANT_DEFAULT.cap
  const priced = (shortfall / enterprise) * COVENANT_DEFAULT.distressPremium
  return clamp(priced, COVENANT_DEFAULT.floor, COVENANT_DEFAULT.cap)
}

function covenantCheck(s: GameState) {
  if (!s.debt || s.lastRevenue >= s.debt.covenantRevenue) return
  const owed = s.debt.principal
  // cash can already be negative this week — the bank can only seize what exists
  const paid = Math.max(0, Math.min(s.cash, owed))
  s.cash -= paid
  const shortfall = owed - paid
  s.debt = null
  if (shortfall > 0) {
    const converted = covenantConversion(shortfall, valuation(s))
    s.founderEquity *= 1 - converted
    applyEffects(s, { morale: -8, reputation: -6 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: '🏦 Covenant breach — the bank calls the loan',
      body:
        `Revenue fell below the covenant. The bank seized $${(paid / 1000).toFixed(0)}k of cash and, for the remaining ` +
        `$${(shortfall / 1000).toFixed(0)}k, forced an equity conversion — ${(converted * 100).toFixed(0)}% of your stake, priced off the ` +
        `size of the hole rather than a flat rate. The bigger the line you could not cover, the more of the company it costs. ` +
        `This is why debt is cheap: it bites.`,
    })
  } else {
    applyEffects(s, { reputation: -3 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: '🏦 Covenant breach — loan called and repaid',
      body: `Revenue fell below the covenant and the bank called the loan. $${(paid / 1000).toFixed(0)}k left the account in one wire. The credit line is gone.`,
    })
  }
}

// ---------- one-on-ones: targeted asks from named people ----------

interface OneOnOne {
  id: string
  cond: (e: Employee, s: GameState) => boolean
  body: (e: Employee) => string
  accept: Choice
  refuse: Choice
}

const ONE_ON_ONES: OneOnOne[] = [
  {
    id: 'promotion',
    cond: (e) => e.weeks >= 16 && e.skill >= 6,
    body: (e) => `${e.name} books a 1:1 and comes prepared: a doc titled "My Next Chapter". They want a lead title and the salary to match. They've earned a hearing — and the rest of the team will hear the outcome either way.`,
    accept: {
      label: 'Promote them (+15% salary)',
      resultText: 'A new lead is born. Two teammates quietly wonder why it wasn\'t them.',
      effects: { morale: -2 },
      target: { morale: 15, salaryMult: 1.15 },
    },
    refuse: {
      label: 'Not yet — revisit next quarter',
      resultText: 'They close the doc slowly. "Next quarter," they repeat, in a tone you\'ll remember.',
      effects: {},
      target: { morale: -12 },
    },
  },
  {
    id: 'remote',
    cond: (e) => e.weeks >= 6,
    body: (e) => `${e.name} asks to go fully remote — moving closer to family. The work will travel; the whiteboard sessions won't.`,
    accept: {
      label: 'Bless the move',
      resultText: 'They pack the desk plant. Their first remote week ships more than their last office month.',
      effects: { features: -1 },
      target: { morale: 12 },
    },
    refuse: {
      label: 'The team needs you here',
      resultText: 'They nod and stay. Something in their calendar starts filling with blocks marked "private".',
      effects: {},
      target: { morale: -8 },
    },
  },
  {
    id: 'sideproject',
    cond: (e) => (e.role === 'engineer' || e.role === 'designer') && e.skill >= 5,
    body: (e) => `${e.name} wants your blessing for a weekend side project — an open-source tool adjacent to your product. "It'll make me sharper," they argue. It might also make them a founder.`,
    accept: {
      label: 'Bless it — sharp people need outlets',
      resultText: 'The side project earns stars, and the lessons flow back into your codebase.',
      effects: { pmf: 1, features: -1 },
      target: { morale: 10 },
    },
    refuse: {
      label: 'All focus here, please',
      resultText: 'They nod. The side project continues in a private repo, which everyone silently understands.',
      effects: {},
      target: { morale: -6 },
    },
  },
  {
    id: 'conference',
    cond: (e) => e.skill >= 5,
    body: (e) => `${e.name} got accepted to speak at a conference — about work they did here. Travel and a ticket come to $3,000, plus a week of lighter output.`,
    accept: {
      label: 'Send them ($3,000)',
      resultText: 'The talk lands. Their slides carry your logo, and two attendees ask if you\'re hiring.',
      effects: { cash: -3000, hype: 3 },
      target: { morale: 8 },
    },
    refuse: {
      label: 'Not in this budget',
      resultText: 'They present the same talk at a meetup for free, to eleven people and one dog.',
      effects: {},
      target: { morale: -4 },
    },
  },
  {
    id: 'sabbatical',
    cond: (e) => e.weeks >= 40,
    body: (e) => `${e.name} — ${e.weeks} weeks on the grind, longer than most marriages survive at this pace — asks for a four-week unpaid sabbatical. "I'll come back better. Or I'll come back gone, eventually, if I don't go now."`,
    accept: {
      label: 'Grant the sabbatical',
      resultText: 'Four weeks later they return with a tan, a sketchbook of product ideas, and frightening energy.',
      effects: { features: -3 },
      target: { morale: 20 },
    },
    refuse: {
      label: 'We can\'t spare you',
      resultText: '"Understood." The word does a lot of work in that sentence.',
      effects: {},
      target: { morale: -15 },
    },
  },
]

/**
 * ICO Slice 7. Two anti-repeat guards below read a WINDOW of the most recent inbox messages —
 * "have I shown this in the last 8/12" — and a window counted in messages gets shorter in weeks
 * every time some other system adds mail. Slice 7's narrative layer adds a lot of mail, and the
 * first build of it measurably moved token-run outcomes for exactly that reason: a colour beat
 * about the token price pushed a 1:1 out of the window and a different employee got picked.
 *
 * A NARRATIVE LAYER MUST NOT BE ABLE TO CHANGE THE SIMULATION. Its beats therefore carry this
 * prefix and are skipped by both windows, which restores them to the message counts they had
 * before the layer existed. Nothing that predates Slice 7 is affected — no traditional run, no
 * golden trace, and no token run at Slice 6, because nothing else writes this prefix.
 *
 * Any future purely-cosmetic mail belongs behind this prefix for the same reason.
 */
export const NARRATIVE_MAIL_PREFIX = 'token-beat-'
const isColourMail = (m: Message) => typeof m.id === 'string' && m.id.startsWith(NARRATIVE_MAIL_PREFIX)

function maybeOneOnOne(s: GameState) {
  if (s.employees.length < 2 || RNG.next() > 0.1) return
  if (s.inbox.some((m) => m.kind === 'choice' && !m.resolved)) return
  const window12 = s.inbox.filter((m) => !isColourMail(m)).slice(0, 12)
  const candidates = s.employees.filter((e) => !window12.some((m) => m.meta?.employeeId === e.id))
  if (candidates.length === 0) return
  const e = candidates[Math.floor(RNG.next() * candidates.length)]
  const eligible = ONE_ON_ONES.filter((o) => o.cond(e, s))
  if (eligible.length === 0) return
  const o = eligible[Math.floor(RNG.next() * eligible.length)]
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'choice',
    title: `1:1 — ${e.name} has an ask`,
    body: o.body(e),
    choices: [o.accept, o.refuse],
    meta: { employeeId: e.id },
  })
}

// ---------- founder self-care & personal finance ----------

export function takeVacation(s: GameState) {
  if (!can(s, 'founderEnergy')) return
  if (s.vacationCooldown > 0 || s.gameOver) return
  s.energy = clamp(s.energy + 30, 0, 100)
  s.features = clamp(s.features - 1.5, 0, 100)
  s.vacationCooldown = 10
  applyEffects(s, { morale: 2 })
  s.flash = '🏝 A real week off — phone in a drawer, laptop at home. You come back with a full tank and one big idea scribbled on a napkin. The team, trusted alone, did fine.'
}

export function canSellSecondary(s: GameState): { ok: boolean; reason?: string } {
  if (STAGES.indexOf(s.stage) < 3) return { ok: false, reason: 'Available from Series B — early secondaries scare investors' }
  if (s.flags[`secondary-${s.stage}`]) return { ok: false, reason: `Already sold once this stage — again would read as fleeing` }
  if (s.founderEquity <= 0.1) return { ok: false, reason: 'Your remaining stake is too thin to sell down further' }
  return { ok: true }
}

export function secondaryProceeds(s: GameState): number {
  return Math.round(valuation(s) * 0.02 * 0.7) // 2% of the company, at a 30% secondary discount
}

export function sellSecondary(s: GameState) {
  if (!canSellSecondary(s).ok) return
  const proceeds = secondaryProceeds(s)
  s.founderEquity = Math.max(0, s.founderEquity - 0.02)
  s.bankedPayout += proceeds
  s.flags[`secondary-${s.stage}`] = 1
  s.reputation = clamp(s.reputation - 3, 0, 100)
  applyEffects(s, { morale: -2 })
  s.energy = clamp(s.energy + 8, 0, 100) // sleeping better is worth something
  s.flash =
    `💼 Secondary sale: 2% of your stake for $${(proceeds / 1e6).toFixed(1)}M in personal cash — banked no matter how this ends. ` +
    'The board notes it "without judgment", which is how boards judge.'
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: 'Founder takes money off the table',
    body: 'A fund bought a sliver of your personal stake at a discount. De-risked founders make braver decisions — or complacent ones. The team watches which you become.',
  })
}

// ---------- PvP: what founders do to each other ----------

// Headcount past this many people starts costing the org 1.5%/head in effectiveness.
export const COORDINATION_FREE_HEADS = 8

export function coordinationDrag(s: GameState): number {
  return clamp(1 - Math.max(0, s.employees.length - COORDINATION_FREE_HEADS) * 0.015, 0.6, 1)
}

export const ATTACK_COOLDOWN = 5

export interface AttackDef {
  id: 'poach' | 'smear' | 'raid' | 'hitpiece' | 'pricewar'
  name: string
  emoji: string
  cost: number
  blurb: string
}

export const ATTACKS: AttackDef[] = [
  { id: 'poach', name: 'Poach talent', emoji: '🎣', cost: 30_000, blurb: 'Recruiters target their team. Their best engineer walks — and lands in your hiring pool.' },
  { id: 'smear', name: 'Smear campaign', emoji: '🗞', cost: 24_000, blurb: 'Anonymous briefings to journalists. Their hype and reputation take a hit; a little mud sticks to you too.' },
  { id: 'raid', name: 'User raid', emoji: '⚔️', cost: 40_000, blurb: 'A targeted campaign at their customer base. Punching UP at a bigger rival pays far more than punching down.' },
  { id: 'hitpiece', name: 'Hit piece', emoji: '📰', cost: PR_BASE_COST, blurb: 'A three-week campaign that keeps running. It might be traced back to you — and the odds get worse every time you try it.' },
  { id: 'pricewar', name: 'Price war', emoji: '📉', cost: PRICE_WAR_COST, blurb: 'Undercut them for six weeks. It cuts your revenue too — start one because you can outlast them, not because you can afford it.' },
]

// Costs scale with your stage: $40k is a real decision at pre-seed and noise at
// Series C, so the multiplier keeps dirty tricks a real decision all game long.
export function attackCost(s: GameState, kind: AttackDef['id']): number {
  const def = ATTACKS.find((a) => a.id === kind)
  if (!def) return Infinity
  // Softer than linear: full stage scaling made attacks unaffordable exactly when they mattered.
  return Math.round(def.cost * (1 + STAGES.indexOf(s.stage) * 0.5))
}

/**
 * Users a raid moves. Costs are absolute and stage-scaled; damage was purely proportional, so a
 * raid was invisible across the whole range an Arena match actually occupies. Measured on a real
 * match: a $120k raid against a 120-user rival moved FIVE users. The floor makes an attack always
 * worth its price, and the 15% cap stops it flattening a small company outright.
 */
export const RAID_FLOOR_USERS = 18

export function raidMagnitude(victimUsers: number): number {
  if (!Number.isFinite(victimUsers) || victimUsers <= 0) return 0
  const proportional = victimUsers * 0.1
  return Math.round(Math.max(proportional, Math.min(victimUsers * 0.15, RAID_FLOOR_USERS)))
}

/**
 * Who may use the attack layer at all.
 *
 * `pvpActions` is Arena's flag — human founders hitting each other. `rivalAggression` earns the
 * same right for the same reason: the moment AI rivals can come for you, refusing you the shield
 * and the counter-punch would make their attacks unanswerable, and an attack you cannot answer is
 * noise rather than difficulty. One predicate, so the offensive and defensive gates cannot drift.
 */
function combatEnabled(s: GameState): boolean {
  return can(s, 'pvpActions') || can(s, 'rivalAggression')
}

export function canAttack(s: GameState, kind?: AttackDef['id']): { ok: boolean; reason?: string } {
  if (!combatEnabled(s)) return { ok: false, reason: 'PvP is disabled in this match' }
  if (kind === 'pricewar' && (s.flags.priceWarCooldown ?? 0) > 0)
    return { ok: false, reason: `Margins still recovering from the last war — ${s.flags.priceWarCooldown} wk` }
  if ((s.flags.attackCooldown ?? 0) > 0) return { ok: false, reason: `Ops team recovering — ${s.flags.attackCooldown} wk` }
  return { ok: true }
}

// The attacker's side: pay the cost, collect the spoils. targetUsers is the victim's
// last-known user count (from presence) — spoils are computed from it.
export function applyAttackOutgoing(s: GameState, kind: AttackDef['id'], targetCompany: string, rawTargetUsers: number): boolean {
  return seeded(s, () => applyAttackOutgoingInner(s, kind, targetCompany, rawTargetUsers))
}
function applyAttackOutgoingInner(s: GameState, kind: AttackDef['id'], targetCompany: string, rawTargetUsers: number): boolean {
  const def = ATTACKS.find((a) => a.id === kind)
  if (!def) return false
  const targetUsers = Number.isFinite(rawTargetUsers) && rawTargetUsers > 0 ? Math.min(rawTargetUsers, 1e10) : 0
  const cost = attackCost(s, kind)
  if (!canAttack(s, kind).ok || s.cash < cost) return false
  s.cash -= cost
  s.flags.attackCooldown = ATTACK_COOLDOWN
  drainEnergy(s, 2)
  if (kind === 'poach') applyEffects(s, { special: 'talent-influx' })
  if (kind === 'smear') s.reputation = clamp(s.reputation - 2, 0, 100)
  if (kind === 'hitpiece') {
    const used = s.flags.hitPiecesRun ?? 0
    s.flags.hitPiecesRun = used + 1
    // Verifiable, not rolled: a local roll could be retried until it came up clean.
    if (prBackfired(s.config?.seed ?? 0, s.week, s.flags.myPlayerHash ? String(s.flags.myPlayerHash) : targetCompany, used)) {
      s.flags.prTarget = PR_CAMPAIGN_WEEKS // the story is about US
      s.flags.prSelfInflicted = 1
      s.flash = `📰 It got traced back. The story is about ${'you'} — planting it, not the thing you planted.`
      return true
    }
  }
  if (kind === 'pricewar') {
    s.flags.priceWar = PRICE_WAR_WEEKS
    s.flags.priceWarInitiator = 1
    s.flags.priceWarCooldown = PRICE_WAR_WEEKS + PRICE_WAR_COOLDOWN
  }
  if (kind === 'raid') {
    // Relative, not absolute: raiding the leader pays up to 3x, kicking a straggler pays half.
    // Absolute spoils meant raids only paid at a scale a 52-week match never reaches.
    const leverage = clamp(targetUsers / Math.max(1, s.users), 0.5, 3)
    const won = Math.round(raidMagnitude(targetUsers) * leverage)
    s.users += won
    s.flags.lastRaidWon = won // surfaced in the flash, so the spend has a visible result
  }
  s.flash =
    `${def.emoji} ${def.name} launched against ${targetCompany}. ` +
    (kind === 'raid'
      ? `${(s.flags.lastRaidWon ?? 0).toLocaleString()} of their users are yours by the end of the week.`
      : kind === 'poach'
        ? 'Your recruiters are working their team — expect a strong candidate in your pool.'
        : 'The stories run tomorrow.')
  return true
}

// The counterplay: a retainer that silently eats EVERY incoming attack while it lasts.
// The attacker still pays and still goes on cooldown — they just hit a wall.
// It is priced as a real commitment, because that is the decision: spend big on defence
// during the window you expect to be hit, or spend it on growth and take the hits.
/**
 * Buy your way out of a price war early: you stop undercutting, and the customers you were holding
 * with the low price walk. Without this a war is pure mutual bleeding with no decision in it — the
 * concede is what turns it into a negotiation with a clock.
 *
 * The customers move to the founder who started the war — the store broadcasts a `concede` event
 * and their client credits them. In single player (no room) there is nobody to credit and they
 * simply leave.
 */
export function canConcedePriceWar(s: GameState): { ok: boolean; reason?: string } {
  if ((s.flags.priceWar ?? 0) <= 0) return { ok: false, reason: 'No price war running' }
  if ((s.flags.priceWarInitiator ?? 0) === 1) return { ok: false, reason: 'You started this one — you cannot concede it' }
  return { ok: true }
}

export function concedePriceWar(s: GameState): number {
  if (!canConcedePriceWar(s).ok) return 0
  const lost = Math.round(s.users * CONCEDE_USER_SHARE)
  if (lost > 0) applyEffects(s, { users: -lost })
  delete s.flags.priceWar
  delete s.flags.priceWarInitiator
  s.flash = `📉 You raised prices back and stepped out of the war. ${lost.toLocaleString()} customers went with the cheaper option — but your margin is yours again.`
  return lost
}

/** The other side of a concession: the founder who started the war takes the customers. */
export function applyConcedeGain(s: GameState, fromCompany: string, users: number): void {
  const won = Math.max(0, Math.min(Math.floor(users), 1e7))
  if (won > 0) applyEffects(s, { users: won })
  delete s.flags.priceWar
  delete s.flags.priceWarInitiator
  s.flash = `📈 ${fromCompany} blinked and raised their prices. ${won.toLocaleString()} of their customers came to you.`
}

export const SHIELD_WEEKS = 8
// $35k → $25k, measured in test/arena-ffa-probe.ts + test/arena-duel-probe.ts (2026-08-12).
// At $35k the retainer never EARNED its price anywhere: 1v1 turtle 46% vs 49% bare, and even in
// a 4-player lobby with three gang-the-leader aggressors it sat inside the noise (turtle 32-37%
// vs bare 30-33% at 200 matches a row). The shield's value scales with the rate of incoming fire
// while its price is flat, so a price cut moves the break-even down into the fire rate an ambient
// lobby actually produces. Re-measured at $25k: under ambient fire turtle wins 36-37% vs bare's
// 30-33% (par 25%) and carries ~$1.1M more median valuation; 1v1 turtle-vs-aggressor flips from
// 46% to 55% (bare 49%); and always-shielding in a PEACEFUL lobby still loses badly (13% vs par
// 25%, $7.5M vs $8.8M) — bought when the lobby is hot, skipped when it is not, which is what
// "a real decision" means.
export const SHIELD_BASE_COST = 25_000

export function shieldCost(s: GameState): number {
  // The same soft stage curve attacks pay, for the same reason — and it used to be steeper than
  // theirs (x(stage+1) against their x(1+stage/2)), so defence outpaced offence with every round
  // raised. Measured before the reprice: turtling against a full-time aggressor WON LESS than
  // standing bare (45% vs 68%) — the retainer cost more than every attack it deflected.
  return Math.round(SHIELD_BASE_COST * (1 + STAGES.indexOf(s.stage) * 0.5))
}

export function canBuyShield(s: GameState): { ok: boolean; reason?: string } {
  if (!combatEnabled(s)) return { ok: false, reason: 'PvP is disabled in this match' }
  if ((s.flags.shield ?? 0) > 0) return { ok: false, reason: `Crisis team already on retainer — ${s.flags.shield} wk left` }
  return { ok: true }
}

export function buyShield(s: GameState): boolean {
  const cost = shieldCost(s)
  if (!canBuyShield(s).ok || s.cash < cost) return false
  s.cash -= cost
  s.flags.shield = SHIELD_WEEKS
  s.flash = `🛡 Crisis team on retainer for ${SHIELD_WEEKS} weeks — attacks on you fizzle until it lapses. Your rivals don't know.`
  return true
}

/**
 * Options an AI rival's strike carries that a human's never did.
 *
 * Both default to the human's behaviour, so an Arena attack arriving off the wire is
 * byte-for-byte what it was before this existed.
 */
export interface IncomingAttackOpts {
  /** Raid leverage. 1 for a peer; `applyAttackOutgoingInner` computes the same term for the player. */
  magnitudeScale?: number
  /** The attacker's stated reason, from `rivalStance`. Appended so the hit is never inexplicable. */
  why?: string
}

// The victim's side, applied when the attack broadcast arrives.
export function applyAttackIncoming(s: GameState, kind: AttackDef['id'], rawFrom: string, opts: IncomingAttackOpts = {}) {
  const def = ATTACKS.find((a) => a.id === kind)
  if (!def) return // unknown attack kind off the wire
  const fromCompany = String(rawFrom ?? 'A rival').slice(0, 30)
  const scale = Number.isFinite(opts.magnitudeScale) ? clamp(opts.magnitudeScale!, 0, 3) : 1
  if ((s.flags.shield ?? 0) > 0) {
    // the retainer runs for its full term — it is a duration you bought, not a single charge
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      meta: { rivalAttack: kind, rivalName: fromCompany, deflected: true },
      title: `🛡 Crisis team deflected ${fromCompany}'s ${def.name.toLowerCase()}`,
      body: `${fromCompany} came at you — and your retainer earned every dollar. The attack fizzled before it touched morale, press, or users. The team is on call for another ${s.flags.shield} week${s.flags.shield === 1 ? '' : 's'}.`,
    })
    s.flash = `🛡 Your crisis team deflected ${fromCompany}'s ${def.name.toLowerCase()}!`
    return
  }
  if (kind === 'poach') applyEffects(s, { morale: -6, special: 'lose-best' }) // they take a person, not just a mood
  if (kind === 'smear') applyEffects(s, { hype: -16, reputation: -5 })
  if (kind === 'hitpiece') s.flags.prTarget = PR_CAMPAIGN_WEEKS
  if (kind === 'pricewar') {
    s.flags.priceWar = PRICE_WAR_WEEKS
    delete s.flags.priceWarInitiator // we did not start it, so we take the deeper cut
  }
  if (kind === 'raid') {
    const lost = Math.round(raidMagnitude(s.users) * scale)
    if (lost > 0) applyEffects(s, { users: -lost })
    s.flags.lastRaidLost = lost
  }
  const what =
    kind === 'hitpiece'
      ? // The decoy: while the source is still hidden the target sees the STORY, not the hand
        // behind it. Naming the attacker immediately made a three-week campaign read like every
        // other instant hit, and made prSourceHidden dead code.
        prSourceHidden(s)
        ? `A story about you is running, and it is not going away. Nobody will say who briefed it.`
        : `${fromCompany} briefed the story about you. It has been running for weeks.`
      : kind === 'poach'
        ? `${fromCompany}'s recruiters are calling your team, one by one. Nothing personal — this is the game you're all playing.`
        : kind === 'smear'
          ? `Unflattering stories about your company are circulating, and the fingerprints belong to ${fromCompany}. The market notices.`
          : kind === 'pricewar'
            ? `${fromCompany} has undercut you across the board. Your revenue is cut for as long as it runs — step out and you keep your margin but lose the customers who stayed for the price.`
            : `${fromCompany} is running aggressive ads squarely at your users — and some of them are converting.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'news',
    meta: { rivalAttack: kind, rivalName: fromCompany },
    title: `${def.emoji} ${fromCompany} hit you: ${def.name.toLowerCase()}`,
    // The reason first, when there is one. An AI rival's strike is only fair if the sentence that
    // announces it also says what provoked it — and `rivalStance` is where that sentence comes
    // from, so the inbox and the rival table give the same account of the same decision.
    body: opts.why ? `${opts.why}\n\n${what}` : what,
  })
  // The living world's record of it: who, why, and how hard. `noteCompanyEvent` is a no-op without
  // `companyMemory`, and it writes only to `s.world` — narrative interprets facts, never decides
  // them (world/tick.ts, brief §64).
  noteCompanyEvent(s, 'major_loss', {
    importance: kind === 'raid' ? 60 : 45,
    characterIds: [stableCastId('rival', fromCompany)],
    metadata: { rival: fromCompany, attack: kind, usersLost: s.flags.lastRaidLost ?? 0 },
  })
  s.flash = `${def.emoji} ${fromCompany} launched a ${def.name.toLowerCase()} against you!`
}

/**
 * The counter-punch: the player's own attack, pointed at an AI rival instead of another founder.
 *
 * Everything about the attacker's side is `applyAttackOutgoing` — same cost, same cooldown, same
 * energy, same reputation hit for a smear, same backfire odds for a hit piece. What this adds is
 * the target actually FEELING it, which in Arena is the other client's job and here is nobody's.
 * Deliberately not a second attack economy: it is the calibrated one, aimed somewhere new.
 */
/**
 * The most you can win from ONE raid, as a share of the company you already have.
 *
 * MEASURED DEFECT, and it was mine. `applyAttackOutgoing` pays `raidMagnitude(target) × leverage`
 * with `leverage = clamp(targetUsers / yourUsers, 0.5, 3)` — "punching up at the leader pays 3x",
 * calibrated in test/arena-duel-probe.ts against PEERS, where the size gap in a 40-week match is a
 * small multiple. Pointed at an AI rival it meets a gap of 10–350x, and 10% of a 19,000-user
 * incumbent times 3 is 5,700 customers for one $40k cheque against a 434-user company. The
 * counterplay probe found exactly that: shield+raid returned $868M–$1.05B of founder net against
 * the bare policy's $13–36M, on 40k–99k users. An infinite-money glitch, not a counter-punch.
 *
 * The cap is on the RAIDER's own size because that is the real constraint — you can only onboard,
 * serve and keep so many new customers in a week, however many the campaign reached. 15% is the
 * same order as what a raid takes FROM you (10–20%), so answering in kind is a fair trade rather
 * than a better business than the business.
 *
 * Applied HERE and not inside `applyAttackOutgoing`: Arena's numbers are measured and balanced,
 * a 3x leverage against a 3x-larger peer already pays 90% of your own user base there, and this
 * cap would silently rebalance every duel in the file that calibrated it.
 */
export const RIVAL_RAID_GAIN_CAP = 0.15

/**
 * How much a raid still yields after you have run this many. The cap above was necessary and not
 * sufficient: ANY cap proportional to your own size compounds, because the 5-week ops cooldown lets
 * a 200-week run stack forty of them — 1.15^40 is 267x, and the probe duly reported $183M against
 * a bare policy's $13–36M even with the cap in place.
 *
 * So it decays, for the same reason `backfireChance` escalates and `learn` saturates: the second
 * campaign against a market is aimed at the customers who ignored the first one. The lifetime
 * product converges to roughly 1.6x rather than diverging, which makes the counter-raid a way to
 * claw back what was taken from you instead of a better business than the business.
 */
export const RIVAL_RAID_FATIGUE = 0.7

export function rivalRaidYield(raidsRun: number): number {
  return RIVAL_RAID_GAIN_CAP * Math.pow(RIVAL_RAID_FATIGUE, Math.max(0, raidsRun))
}

export function attackRival(s: GameState, kind: AttackDef['id'], rivalId: string): boolean {
  const r = s.rivals.find((x) => x.id === rivalId && x.alive)
  if (!r) return false
  const before = s.users
  if (!applyAttackOutgoing(s, kind, r.name, r.users)) return false
  if (kind === 'raid') {
    const run = s.flags.rivalRaidsRun ?? 0
    const won = Math.min(Math.max(0, s.users - before), Math.round(before * rivalRaidYield(run)))
    s.flags.rivalRaidsRun = run + 1
    s.users = before + won
    s.flags.lastRaidWon = won // the flash already quoted a number; it must be the one that landed
    // The other half of the transfer: they have to leave someone. Without this a raid mints
    // customers out of nothing.
    r.users = Math.max(0, r.users - won)
  }
  if (kind === 'smear') r.momentum *= 0.9
  if (kind === 'poach') r.product = clamp(r.product - 3, 0, 100)
  if (kind === 'pricewar') r.momentum *= 0.88
  return true
}

// ---------- the all-hands pitch: founder theater, with odds ----------

export const PITCH_COOLDOWN = 8

export interface PitchOption {
  id: 'vision' | 'numbers' | 'war'
  name: string
  blurb: string
  p: number // success probability, shown to the player up front
  winText: string
  loseText: string
}

// Odds are computed from the real state of the company — the team can smell whether a speech is earned.
export function pitchOptions(s: GameState): PitchOption[] {
  const growth = growthRate(s)
  const net = s.lastRevenue - s.lastExpenses
  const runway = runwayWeeks(s)
  return [
    {
      id: 'vision',
      name: 'The Vision',
      blurb: 'Unicorns, changing the world, the mission. Lands when the company is visibly winning — rings hollow when it isn\'t.',
      p: clamp(0.35 + s.pmf / 200 + s.hype / 300 + (growth > 0 ? 0.1 : 0), 0.25, 0.85),
      winText: 'wins: morale +12 and an inspired team ships 10% more for 4 weeks',
      loseText: 'flops: eye-rolls in the back row, morale −6',
    },
    {
      id: 'numbers',
      name: 'The Numbers',
      blurb: 'Full transparency: metrics on the big screen, questions welcome. Safe when the numbers are good; sobering when they aren\'t.',
      p: clamp(0.5 + (net >= 0 ? 0.25 : 0) + (growth >= 0.02 ? 0.15 : 0) - (runway !== Infinity && runway < 12 ? 0.2 : 0), 0.15, 0.95),
      winText: 'wins: morale +6, and honesty compounds (+1 reputation)',
      loseText: 'flops: the spreadsheet says what it says, morale −4',
    },
    {
      id: 'war',
      name: 'The War Speech',
      blurb: 'Rivals at the gates, ship or die, pizza\'s ordered. High-energy teams answer the call — tired ones resent it.',
      p: clamp(avgMorale(s) / 130, 0.2, 0.75),
      winText: 'wins: the team crunches happily — output +15% for 4 weeks, morale +4',
      loseText: 'flops: you asked for more with an empty tank, morale −10',
    },
  ]
}

export function pitchTeam(s: GameState, id: PitchOption['id']): void {
  return seeded(s, () => pitchTeamInner(s, id))
}
function pitchTeamInner(s: GameState, id: PitchOption['id']): void {
  if (s.pitchCooldown > 0 || s.employees.length === 0) return
  const opt = pitchOptions(s).find((o) => o.id === id)!
  s.pitchCooldown = PITCH_COOLDOWN
  drainEnergy(s, 8) // speeches cost something to give
  const won = RNG.next() < opt.p
  if (won) s.flags.pitchesLanded = (s.flags.pitchesLanded ?? 0) + 1

  if (id === 'vision') {
    if (won) {
      applyEffects(s, { morale: 12 })
      s.rally = { mult: 1.1, weeksLeft: 4 }
      s.flash = '🎤 The Vision landed. Someone changed their Slack status to the mission statement. Morale +12, output +10% for 4 weeks.'
    } else {
      applyEffects(s, { morale: -6 })
      s.flash = '🎤 The Vision flopped — you could hear the eye-rolls. "Cool, but did sprint planning move?" Morale −6.'
    }
  } else if (id === 'numbers') {
    if (won) {
      applyEffects(s, { morale: 6, reputation: 1 })
      s.flash = '🎤 The Numbers landed. Nothing motivates like a graph going up and a founder who shows it either way. Morale +6.'
    } else {
      applyEffects(s, { morale: -4 })
      s.flash = '🎤 The Numbers sobered the room. Transparency has a price when the chart points down. Morale −4.'
    }
  } else {
    if (won) {
      applyEffects(s, { morale: 4 })
      s.rally = { mult: 1.15, weeksLeft: 4 }
      s.flash = '🎤 The War Speech ignited the room — keyboards clattering before you finished. Output +15% for 4 weeks, morale +4.'
    } else {
      applyEffects(s, { morale: -10 })
      s.flash = '🎤 The War Speech backfired. You asked for more from an empty tank; the silence was the answer. Morale −10.'
    }
  }
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `All-hands: ${opt.name} ${won ? 'landed' : 'flopped'}`,
    body: won ? opt.winText.replace('wins: ', 'It ') : opt.loseText.replace('flops: ', 'It '),
  })
}

// ---------- M&A: buy your rivals ----------

// Exact asking price, visible before you offer — no hidden bills, even in M&A.
export function acquisitionPrice(s: GameState, r: Rival): number {
  return Math.round((rivalValuation(r, s) * 1.4) / 100_000) * 100_000
}

export function canAcquire(s: GameState, r: Rival): { ok: boolean; reason?: string } {
  if (!r.alive || r.acquired) return { ok: false, reason: 'Not on the market' }
  if (s.maCooldown > 0) return { ok: false, reason: `Integrating the last deal — ${s.maCooldown} wk` }
  if ((r.rebuffedUntil ?? 0) > s.week) return { ok: false, reason: `They won't take your calls until week ${r.rebuffedUntil}` }
  const val = valuation(s)
  if (val < rivalValuation(r, s) * 1.5) return { ok: false, reason: 'You need to be clearly the bigger company (1.5× their valuation)' }
  return { ok: true }
}

export function acquireRival(s: GameState, rivalId: string, method: 'cash' | 'stock'): boolean {
  return seeded(s, () => acquireRivalInner(s, rivalId, method))
}
function acquireRivalInner(s: GameState, rivalId: string, method: 'cash' | 'stock'): boolean {
  const r = s.rivals.find((x) => x.id === rivalId)
  if (!r || !canAcquire(s, r).ok) return false
  const price = acquisitionPrice(s, r)
  if (method === 'cash' && s.cash < price) return false
  drainEnergy(s, 8) // deal-making eats weekends

  // weak companies sell; strong ones believe their own deck
  const pAccept = clamp(0.55 + (productScore(s) > r.product ? 0.15 : -0.1) + s.reputation / 300 + (r.momentum < 1 ? 0.15 : -0.05), 0.25, 0.9)
  if (RNG.next() > pAccept) {
    r.rebuffedUntil = s.week + 20
    applyEffects(s, { hype: -3 })
    s.flash = `${r.name} rebuffed your offer — "We're just getting started," their CEO posts, with a screenshot of your term sheet. Awkward. They won't talk again for ~20 weeks.`
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `${r.name} rejects ${s.companyName}'s acquisition offer`,
      body: 'The leak makes the rounds. Their team wears it like a badge; your corp-dev slide gets quietly updated.',
    })
    return false
  }

  let soldEquity = 0
  if (method === 'cash') {
    s.cash -= price
  } else {
    soldEquity = price / (valuation(s) + price)
    s.founderEquity *= 1 - soldEquity
  }
  const migrated = Math.round(r.users * 0.7) // some of their users leave during the transition
  s.users += migrated
  s.features = clamp(s.features + 4, 0, 100)
  s.bugs = clamp(s.bugs + 8, 0, 100) // two codebases, one repo: integration pain is real
  s.maCooldown = 15
  r.alive = false
  r.acquired = true
  applyEffects(s, { hype: 8, reputation: 5, morale: -3 })
  // reuse the equity actually deducted above — recomputing here used the POST-deal valuation
  // and quoted the player a percentage that differed from what they really paid
  s.flash = `🤝 Acquired ${r.name} for ${method === 'cash' ? `$${(price / 1e6).toFixed(1)}M cash` : `${(soldEquity * 100).toFixed(1)}% of the company in stock`}. ${migrated.toLocaleString()} of their users migrated; their codebase brought features — and bugs.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'news',
    title: `${s.companyName} acquires ${r.name}`,
    body: `The market consolidates. Their users wake up to a "we're joining forces" email, your engineers wake up to their codebase. Integration is 15 weeks of glue work — worth it for the market share.`,
  })
  return true
}

// ---------- the board ----------

export const BOARD_TARGETS: Record<Stage, number> = {
  'Pre-seed': 0,
  Seed: 0.035,
  'Series A': 0.03,
  'Series B': 0.025,
  'Series C': 0.02,
}

// What the board actually expects right now: raw stage targets, tempered by market reality.
export function boardEffectiveTarget(s: GameState): number {
  if (!s.board) return 0
  return Math.max(0.008, s.board.targetGrowth * (1 - 0.5 * marketSaturation(s)))
}

// Trailing weekly revenue growth — the board's alternative yardstick for mature companies.
export function revenueGrowthRate(s: GameState): number {
  const h = s.history
  if (h.length < 5) return 0
  const now = h[h.length - 1].revenue
  const then = h[h.length - 5].revenue
  if (then <= 0) return now > 0 ? 0.2 : 0
  return clamp((now - then) / then / 4, -0.5, 0.5)
}

function boardReview(s: GameState) {
  if (s.gameOver) return // an ending this week (IPO pricing, acquisition) stands
  if (!can(s, 'boardReviews')) return
  if (!s.board || s.week < s.board.nextReview) return
  const growth = growthRate(s)
  const target = boardEffectiveTarget(s)
  s.board.nextReview = s.week + 10

  // Mature companies have two ways to make the board happy: grow users, or grow money.
  const revGrowth = revenueGrowthRate(s)
  const netMargin = s.lastExpenses > 0 ? (s.lastRevenue - s.lastExpenses) / Math.max(1, s.lastRevenue) : 0
  const passedByUsers = growth >= target
  const passedByRevenue = revGrowth >= target
  // Profitability only satisfies the board once you're big enough for it to be the point.
  const passedByProfit = netMargin > 0.15 && revGrowth >= target * 0.4 && STAGES.indexOf(s.stage) >= 3

  if (passedByUsers || passedByRevenue || passedByProfit) {
    if (s.board.defied) s.board.defied = false
    s.board.strikes = Math.max(0, s.board.strikes - 1)
    s.reputation = clamp(s.reputation + 2, 0, 100)
    applyEffects(s, { morale: 2 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: 'Board review: thumbs up',
      body: passedByUsers
        ? `Growth of ${(growth * 100).toFixed(1)}%/wk beats the ${(target * 100).toFixed(1)}% target. The board meeting ends early, which is the highest compliment a board can give.`
        : passedByRevenue
          ? `User growth is slowing, but revenue is compounding at ${(revGrowth * 100).toFixed(1)}%/wk — above target. "Monetization story," someone writes approvingly.`
          : `Users are mature, but a ${(netMargin * 100).toFixed(0)}% net margin with growing revenue is a business, not a bet. The board approves of money.`,
    })
    return
  }

  if (growth >= target * 0.8 || revGrowth >= target * 0.8) {
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: 'Board review: raised eyebrows',
      body: `Growth of ${(growth * 100).toFixed(1)}%/wk is under the ${(target * 100).toFixed(1)}% the board signed up for. "We are watching the next quarter closely." No strike — this time.`,
    })
    return
  }

  // A real miss.
  if (s.board.defied) {
    // Being removed halves what your EQUITY is worth. It does not halve your token position.
    s.gameOver = { type: 'fired', week: s.week, payout: Math.round(founderStanding(s, { equityMultiplier: 0.5 })) }
    return
  }
  s.board.strikes += 1
  // Three, not two: the ultimatum's own body says "Three reviews, three misses", the strike news
  // says "of 3", and the Dashboard renders three dots. The gate was the only place that said two,
  // so a player who had been promised one more chance got the ultimatum a review early.
  if (s.board.strikes >= 3) {
    drainEnergy(s, 5)
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'choice',
      title: 'Board ultimatum',
      body:
        `Three reviews, three misses. The board's patience is spent: "Cut the burn and refocus, or we will find a CEO who can." ` +
        `Submit, and they expect layoffs this week. Defy them, and you had better deliver ${(target * 100).toFixed(1)}%/wk growth by the next review — or clean out your desk.`,
      choices: [
        {
          label: 'Submit — emergency layoffs',
          resultText: 'The board nods grimly. The office is quieter now, in every sense.',
          effects: { special: 'board-layoffs' },
        },
        {
          label: 'Defy the board — bet on yourself',
          resultText: 'You tell them growth is coming. The team rallies behind you. The clock is ticking.',
          effects: { morale: 5, special: 'board-defy' },
        },
      ],
    })
  } else {
    applyEffects(s, { morale: -3 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `Board review: strike ${s.board.strikes} of 3`,
      body: `Growth of ${(growth * 100).toFixed(1)}%/wk badly misses the ${(target * 100).toFixed(1)}% target. Investors trade looks across the table. Three strikes brings an ultimatum.`,
    })
  }
}

// ---------- rival aggression (capability `rivalAggression`) ----------
//
// WHY THIS EXISTS. BACKLOG §4.1: "Late Entrant" won 97% of runs against Standard's 90%, at a
// median exit of week 165 — oversized rivals occupied TAM and never came for you, so the scenario
// was longer rather than harder. The whole attack economy already existed and was calibrated
// against human play (test/arena-duel-probe.ts, test/arena-ffa-probe.ts); AI rivals simply could
// not reach it. This connects them to it.
//
// WHY SITUATIONAL RATHER THAN TIMED. The Arena harnesses measured this and the answer was not
// close. Blind on-cooldown aggression is a SELF-OWN — the aggressor pays cash, cooldown and
// energy for damage that does not compound, and loses to a rival who simply builds. Situational
// aggression is a trade: it pays when the target is worth hitting and costs when it is not. A
// timer would therefore be both worse play and worse drama — a rival who attacks every N weeks is
// weather, and weather is what the player already correctly ignores. Every posture below is a
// reading of state the rival plausibly KNOWS: relative size (market share is public), your growth
// (press, hiring, usage), the product comparison (the threads write themselves — the existing
// siphon rule already reads it), how full the market is, and who out-raised whom.
//
// WHY IT COSTS THEM. `RIVAL_ATTACK_*_COST` charges a rival momentum and product for every strike,
// which is the same shape the player's own attacks have (cash, cooldown, energy, reputation). It
// is what stops the policy being a flat tax on the player: a rival who finds a reason to attack
// every cooldown falls behind the one who builds, gets overtaken, and eventually posts the
// "incredible journey" blog post. The pressure is real and it is paid for.

/** A rival's posture toward you. Pure — the rival table and the policy read the SAME function. */
export type RivalStanceId = 'calm' | 'watching' | 'hostile' | 'cornered'

export interface RivalStance {
  id: RivalStanceId
  label: string
  /** Why, in their terms. The rival table shows this; the inbox message uses it verbatim. */
  why: string
  /** The attack this posture reaches for, or null when they are not coming for you. */
  attack: AttackDef['id'] | null
}

/** No attack before this week: a company with nothing is not worth a campaign. */
export const RIVAL_AGGRO_MIN_WEEK = 12
/** Nor is one below this many users — the raid floor would be most of your company. */
export const RIVAL_AGGRO_MIN_USERS = 120
/**
 * Weeks between one rival's attacks.
 *
 * ITERATION 1 shipped 12 and measured 27 landed attacks per 200-week run (24 seeds, B2B SaaS) —
 * roughly one every seven weeks across three rivals. That is weather, and the player is right to
 * ignore weather. It is also the exact failure test/pricewar-probe.ts found in the Arena bots,
 * which sat at war 86% of all weeks until PRICE_WAR_COOLDOWN made a war an episode with a
 * beginning and an end. Same medicine: half a year between campaigns from any one rival.
 *
 * ITERATION 4 made it scale with grip, between these two bounds. Force alone could not separate
 * the scenarios far enough: "Late Entrant" hands the player $350k against Standard's $200k, and
 * that runway advantage is worth more bankruptcies-avoided than one harder raid every six months
 * costs. Frequency is the lever that compounds — a single big hit can be shielded, sustained
 * pressure has to be out-grown — and it is also the true thing: a company holding a fifth of the
 * market has the org to keep a campaign running, and one holding 3% runs it and goes back to work.
 */
export const RIVAL_AGGRO_COOLDOWN = 26
export const RIVAL_AGGRO_COOLDOWN_MIN = 14
/**
 * Weeks of public notice between a rival turning hostile and their first strike. This is the
 * fairness contract: an attack you could not have anticipated is noise, not difficulty. The
 * posture is on the rival table from the moment it changes AND announced in the inbox, so there is
 * always a week in which the crisis retainer can be bought.
 */
export const RIVAL_AGGRO_NOTICE = 1
/** Chance a hostile rival actually pulls the trigger in an eligible week. */
export const RIVAL_AGGRO_CHANCE = 0.22
/** Weekly user growth at which a big incumbent decides you are the problem. */
export const RIVAL_RAID_GROWTH = 0.02
/** Product-score lead at which the comparison threads become worth attacking. */
export const RIVAL_SMEAR_AHEAD = 8
/** Minimum hype for a smear to be worth briefing: nobody bothers to change a subject nobody raised. */
export const RIVAL_SMEAR_HYPE = 35

/**
 * A rival's grip on the market — their users as a share of the effective TAM.
 *
 * THIS IS THE VARIABLE THE WHOLE POLICY TURNS ON, and finding it was the measurement that mattered.
 * The obvious choice, "how many times your size are they", is useless: swept over 24 seeds x 200
 * weeks x 6 sectors, an AI rival is bigger than the player essentially ALWAYS, and by wildly
 * sector-dependent amounts — median 8.9x in B2B SaaS but 54x in Fintech, and 45x / 348x in the
 * same two under Late Entrant. A `ratio >= 2.5` gate is satisfied 92–100% of the time (so it gates
 * nothing), and a leverage term built on the ratio pins at its cap in every sector (so Standard
 * gets hit exactly as hard as Late Entrant, which is the defect, restated).
 *
 * Share of TAM is normalised by construction — it is a fraction of that sector's own market — and
 * it separates the scenarios cleanly. Median rival share, same sweep:
 *
 *     sector      standard   late
 *     saas          2.6%     11.8%
 *     devtools      5.1%     14.8%
 *     ecommerce     0.9%      6.7%
 *     fintech       1.7%      9.7%
 *     social        9.1%     18.5%
 *     aiml          2.5%     11.2%
 *
 * Standard's medians sit at 0.9–9.1% and Late Entrant's at 6.7–18.5%, with far less spread BETWEEN
 * sectors than the raw ratio had. Social is high in both, which is correct sector character rather
 * than a bug: a winner-take-all market has entrenched incumbents by design.
 */
export function rivalMarketShare(s: GameState, r: Rival): number {
  return clamp(r.users / Math.max(1, effectiveTam(s)), 0, 1)
}

/**
 * Grip at which a rival is entrenched enough to mount a raid worth the name, and the grip at which
 * they hit hardest. Read straight off the table above: 3% is above Standard's p25 in five of six
 * sectors and below Late Entrant's p25 in every one, so the same policy makes Standard's rivals
 * intermittently dangerous and Late Entrant's permanently so. That difference in FREQUENCY, on top
 * of the difference in force below, is what makes the scenario harder rather than longer.
 */
/**
 * 3% → 5% in iteration 5. At 3% a Standard market's UPPER quartile (saas p75 8.4%) cleared the
 * bar, so Standard took 9.8 attacks a run to Late Entrant's 11.2 and its median founder net fell
 * 42% — real collateral on the scenario that was supposed to move only modestly. 5% sits above
 * five of the six Standard medians (0.9–5.1%; Social's 9.1% is a concentrated market by design and
 * stays above it) and below every Late Entrant median. It is the line between "there are other
 * companies here" and "somebody owns this market".
 */
export const RIVAL_RAID_SHARE_FLOOR = 0.05
/** 0.18 → 0.14 → 0.13 across iterations 4 and 5, tracking the floor: at 0.18 the Late Entrant
 *  medians (6.7–18.5%) sat mid-ramp and the scenario never reached full force. With a 5% floor a
 *  13% cap puts the Late medians at 0.2–1.0 of the ramp and its median sector near the top, while
 *  a Standard market mostly never enters the ramp at all. */
export const RIVAL_RAID_SHARE_CAP = 0.13
export const RIVAL_RAID_LEVERAGE_MIN = 0.5
export const RIVAL_RAID_LEVERAGE_MAX = 2

/** Where a rival with this grip sits on the 3%→14% ramp. One definition, used by force and by
 *  frequency, so the two dials cannot disagree about who counts as entrenched. */
function rivalGrip(share: number): number {
  return clamp((share - RIVAL_RAID_SHARE_FLOOR) / (RIVAL_RAID_SHARE_CAP - RIVAL_RAID_SHARE_FLOOR), 0, 1)
}

/**
 * How hard a raid from a rival with this grip lands, as a multiplier on `raidMagnitude` (which is
 * already 10% of your users). Linear from a half-strength nuisance at the 3% floor to a
 * fifth-of-the-company hit at the cap. Exported so the rival table can warn with the number the
 * simulation will actually use.
 */
export function rivalRaidLeverage(share: number): number {
  return RIVAL_RAID_LEVERAGE_MIN + (RIVAL_RAID_LEVERAGE_MAX - RIVAL_RAID_LEVERAGE_MIN) * rivalGrip(share)
}

/** Weeks this rival waits between campaigns. Entrenched incumbents sustain pressure; small ones
 *  run one and go back to work. Exported so the rival table can say how often to expect them. */
export function rivalAggroCooldown(share: number): number {
  return Math.round(RIVAL_AGGRO_COOLDOWN - (RIVAL_AGGRO_COOLDOWN - RIVAL_AGGRO_COOLDOWN_MIN) * rivalGrip(share))
}

/** What a strike costs the attacker: a week of the growth team pointed at you instead of at users. */
export const RIVAL_ATTACK_MOMENTUM_COST = 0.94
export const RIVAL_ATTACK_PRODUCT_COST = 1.6
/** A price war is the expensive one to run — they are cutting their own prices too. */
export const RIVAL_WAR_MOMENTUM_COST = 0.88

/**
 * The rival's read on you. Deterministic, side-effect free, and the ONLY place a posture is
 * decided — `rivalAggressionStep` acts on it and `Market.tsx` renders it, so what the player is
 * shown and what drives the rival cannot drift apart.
 */
export function rivalStance(s: GameState, r: Rival): RivalStance {
  const calm: RivalStance = { id: 'calm', label: 'Building', why: 'Heads down on their own product.', attack: null }
  if (!r.alive || !can(s, 'rivalAggression')) return calm

  const share = rivalMarketShare(s, r)
  const ahead = productScore(s) - r.product
  const growth = growthRate(s)
  const saturation = marketSaturation(s)
  const visible = s.week >= RIVAL_AGGRO_MIN_WEEK && s.users >= RIVAL_AGGRO_MIN_USERS
  const watching: RivalStance = visible
    ? { id: 'watching', label: 'Watching', why: 'They know who you are. Nothing has provoked them yet.', attack: null }
    : calm
  if (!visible) return calm

  // 1. The incumbent and the upstart. THE Late Entrant case: they hold a real piece of the market
  //    and you are growing inside it anyway, which is the only thing a company that entrenched has
  //    to be afraid of. Both halves are load-bearing — grip alone would fire against a company
  //    standing still, and growth alone would let a rounding error declare war on you.
  if (share >= RIVAL_RAID_SHARE_FLOOR && growth >= RIVAL_RAID_GROWTH)
    return {
      id: 'hostile',
      label: 'Hostile',
      why:
        `They hold ${(share * 100).toFixed(0)}% of this market and you are growing ${(growth * 100).toFixed(1)}%/wk inside it. ` +
        `Their growth team has been pointed at your customers.`,
      attack: 'raid',
    }

  // 2. Freshly funded. Their round bought recruiters before it bought anything else, and your
  //    people are the ones taking the calls — the "raised a round" news item, made real.
  //
  //    ITERATION 2 tightened both this and the smear below. At `r.stage > yours && heads >= 3` and
  //    `ahead >= 8 OR hype >= 45` almost every rival was hostile almost always, which is how the
  //    first pass reached 27 landed attacks a run: a flat tax wearing a posture's clothes. Out-
  //    raising you by a full TWO rounds, with a team big enough to be worth raiding, is a fact
  //    about the run rather than the weather.
  if (r.stage > STAGES.indexOf(s.stage) + 1 && s.employees.length >= 4)
    return {
      id: 'hostile',
      label: 'Hostile',
      why: 'They out-raised you by two rounds, and the first thing that money bought was recruiters. Your team is taking the calls.',
      attack: 'poach',
    }

  // 3. Losing the comparison. Behind on the thing they are benchmarked against, and you are loud
  //    enough about it to be worth answering — so they go after the story rather than the product.
  //    AND, not OR: a quiet company that happens to have a better product is not a comms problem.
  //    No size band, because there is no size at which briefing against someone is impractical.
  if (ahead >= RIVAL_SMEAR_AHEAD && s.hype >= RIVAL_SMEAR_HYPE)
    return {
      id: 'hostile',
      label: 'Hostile',
      why: 'You are winning the comparison threads and everybody has noticed. Their comms team would rather change the subject.',
      attack: 'smear',
    }

  // 4. Cornered. Too small a piece of the market to raid with, behind on product, and no open
  //    market left to grow into — so the only lever left is price, and they pull it. LAST, because
  //    it is the move of a company that has run out of better ones.
  if (share < RIVAL_RAID_SHARE_FLOOR && ahead >= 0 && saturation >= 0.2)
    return {
      id: 'cornered',
      label: 'Cornered',
      why: 'A sliver of the market, behind on product, and nowhere left to grow. Price is the only lever they have left.',
      attack: 'pricewar',
    }

  return watching
}

/** Living rivals whose posture is currently pointed at you. Exported for the UI and the harness. */
export function hostileRivals(s: GameState): Rival[] {
  return s.rivals.filter((r) => r.alive && rivalStance(s, r).attack !== null)
}

/**
 * One rival's aggression, run inside `tickRivals` (and therefore inside the week's seeded stream).
 *
 * Draw discipline: this function draws AT MOST ONCE, and only for a rival who is both hostile and
 * off cooldown. With the capability off it is never called at all, so a run without
 * `rivalAggression` produces the identical RNG stream it always did — which is what lets the same
 * build play both sides of the A/B in test/rival-pressure-probe.ts and what keeps the recorded
 * golden traces meaningful as a baseline.
 */
function rivalAggressionStep(s: GameState, r: Rival): void {
  const stance = rivalStance(s, r)

  if (stance.attack === null) return

  // The notice. First time this rival turns on you, the market is told — and they cannot strike
  // in the same week they are announced, so there is always a window to buy the retainer.
  if (r.hostileSince === undefined) {
    r.hostileSince = s.week
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `${r.name} has you in their sights`,
      body:
        `${stance.why} Whatever they are planning, it is no longer a secret — the trade press has started ` +
        `asking your comms person for comment. A crisis retainer, a counter-punch, or a cheque for the whole ` +
        `company are the three answers anyone has ever found.`,
      meta: { rivalName: r.name },
    })
    noteCompanyEvent(s, 'crisis', {
      importance: 55,
      characterIds: [stableCastId('rival', r.name)],
      metadata: { rival: r.name, stance: stance.id, posture: stance.attack },
    })
    // Deliberately NO early return here. It would give one week of notice as a side effect of the
    // announcement and leave the guard below dead — mutation testing caught exactly that: deleting
    // the guard changed nothing, because the return had already done its job. The guard is the
    // notice, so RIVAL_AGGRO_NOTICE is a real dial rather than a comment on an accident.
  }
  if (s.week < r.hostileSince + RIVAL_AGGRO_NOTICE) return
  if (s.week < (r.aggroCooldown ?? 0)) return

  if (RNG.next() >= RIVAL_AGGRO_CHANCE) return

  // They pay for it, in the only currency a rival has: the week their growth team spent on you.
  const share = rivalMarketShare(s, r)
  r.aggroCooldown = s.week + rivalAggroCooldown(share)
  r.attacksLaunched = (r.attacksLaunched ?? 0) + 1
  r.momentum *= stance.attack === 'pricewar' ? RIVAL_WAR_MOMENTUM_COST : RIVAL_ATTACK_MOMENTUM_COST
  r.product = clamp(r.product - RIVAL_ATTACK_PRODUCT_COST, 0, 100)

  const leverage = rivalRaidLeverage(share)
  const before = s.users
  applyAttackIncoming(s, stance.attack, r.name, { magnitudeScale: leverage, why: stance.why })
  // A raid is a TRANSFER — the users that left are on their side of the board now, which is what
  // makes surviving one different from surviving a bad week.
  if (stance.attack === 'raid') r.users += Math.max(0, before - s.users)
}

// ---------- rivals ----------

function tickRivals(s: GameState, room: number) {
  const sector = sectorById(s.sector)
  for (const r of s.rivals) {
    if (!r.alive) continue
    r.product = clamp(r.product + rand(0.3, 1.1), 0, 100)
    // Rivals follow their own S-curve: fast while small, flattening as they saturate their niche.
    const sCurve = Math.max(0, 1 - r.users / (effectiveTam(s) * 0.35))
    const growth = (sector.viral * 0.8 + 0.01) * r.momentum * (1 + 0.3 * s.climate) * room * sCurve
    r.users = Math.max(0, Math.round(r.users * (1 + growth) + sector.acqBase * rand(0.5, 2) * (0.5 + r.product / 100)))

    // A rival with a better product siphons some of your least-happy users.
    if (r.product > productScore(s) + 15 && s.users > 50 && RNG.next() < 0.25) {
      const stolen = Math.round(s.users * rand(0.005, 0.02))
      s.users -= stolen
      r.users += stolen
    }

    const roll = RNG.next()
    if (roll < 0.03 && r.stage < 4 && r.users > sector.tam * 0.002 * (r.stage + 1)) {
      r.stage += 1
      r.momentum *= 1.15
      const stageName = STAGES[r.stage]
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${r.name} raised a ${stageName}`,
        body: `TechCrunch reports ${r.name} closed their ${stageName}. Their recruiters are suddenly everywhere, and your candidates have started mentioning them in interviews.`,
      })
      applyEffects(s, { hype: -3 })
    } else if (roll > 0.97) {
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${r.name} shipped a big launch`,
        body: `${r.name} announced a flashy new release. The comparison threads write themselves.`,
      })
      r.product = clamp(r.product + 6, 0, 100)
      applyEffects(s, { hype: -4 })
    } else if (roll > 0.955 && roll <= 0.97 && r.users < sector.tam * 0.001 && s.week > 20) {
      r.alive = false
      const refugees = Math.round(r.users * 0.1)
      s.users += refugees
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${r.name} shut down`,
        body: `${r.name} posted the "an incredible journey" blog post. ${refugees > 0 ? `Some of their orphaned users (${refugees.toLocaleString()}) migrated to you.` : 'One less name in the comparison threads.'}`,
      })
    }

    // Last, and only for a rival still standing: a company that shut down this week does not get
    // a parting shot. Gated so that a run without the capability draws exactly zero extra times.
    if (r.alive && can(s, 'rivalAggression')) rivalAggressionStep(s, r)
  }
}

function maybeFireEvent(s: GameState) {
  if (RNG.next() > 0.45) return
  if (s.inbox.some((m) => m.kind === 'choice' && !m.resolved)) return
  // Slice 7: the repeat window is counted over real mail only — see NARRATIVE_MAIL_PREFIX.
  const window8 = s.inbox.filter((m) => !isColourMail(m)).slice(0, 8)
  const eligible = EVENTS.filter(
    (e) =>
      (e.minWeek ?? 0) <= s.week &&
      (!e.id.startsWith('cat-') || can(s, 'catastrophes')) &&
      // Brief §33: cards may opt into a mode/format/capability. Unrestricted cards (the whole
      // deck today) behave exactly as before.
      (!e.modes || e.modes.includes(s.config?.mode ?? 'quick')) &&
      (!e.formats || e.formats.includes(s.config?.format ?? 'standard')) &&
      (!e.requiresCapabilities || e.requiresCapabilities.every((k) => can(s, k))) &&
      (!e.cond || e.cond(s)) &&
      !window8.some((m) => m.title === e.title), // avoid rapid repeats
  )
  if (eligible.length === 0) return
  const total = eligible.reduce((acc, e) => acc + e.weight, 0)
  let roll = RNG.next() * total
  const def = eligible.find((e) => (roll -= e.weight) <= 0) ?? eligible[0]
  const msg: Message = {
    id: uid(),
    week: s.week,
    kind: def.choices ? 'choice' : 'news',
    title: def.title,
    body: def.body(s),
    choices: def.choices?.(s),
  }
  s.inbox.unshift(msg)
  if (def.autoEffects) applyEffects(s, def.autoEffects(s))
}

// ---------- story arcs ----------

function maybeStartArc(s: GameState) {
  if (s.arcs.filter((a) => !a.done).length >= 2) return // at most two open storylines
  if (RNG.next() > 0.08) return
  const eligible = ARC_DEFS.filter((d) => d.cond(s) && !s.arcs.some((a) => a.id === d.id))
  if (eligible.length === 0) return
  const total = eligible.reduce((acc, d) => acc + d.weight, 0)
  let roll = RNG.next() * total
  const def = eligible.find((d) => (roll -= d.weight) <= 0) ?? eligible[0]
  s.arcs.push({ instanceId: uid(), id: def.id, stage: def.start, week: s.week, data: {} })
}

function tickArcs(s: GameState) {
  for (const arc of s.arcs) {
    if (arc.done || arc.waiting) continue
    const def = ARC_DEFS.find((d) => d.id === arc.id)
    const stage = def?.stages[arc.stage]
    if (!def || !stage) {
      arc.done = true
      continue
    }
    if (s.week - arc.week < stage.after) continue
    const built = stage.build(s, arc)
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: built.choices ? 'choice' : 'news',
      title: built.title,
      body: built.body,
      choices: built.choices,
      meta: { arcInstance: arc.instanceId },
    })
    if (built.autoEffects) applyEffects(s, built.autoEffects)
    if (built.choices) {
      arc.waiting = true
    } else if (built.goto) {
      arc.stage = built.goto
      arc.week = s.week
    } else {
      arc.done = true
    }
  }
}

// The single source of truth for answering an inbox decision — used by the UI store and by tests.
/**
 * Resolving a decision draws randomness — a choice that hires someone rolls skill and a name — so it
 * has to be seeded like every other player action. Left unwrapped it was the one hole in §39: the
 * same seed plus the same decisions produced different runs, which breaks replays and leaderboard
 * verification, not just the bot harness.
 */
export function resolveChoiceOnState(s: GameState, messageId: string, choiceIndex: number): void {
  seeded(s, () => resolveChoiceOnStateInner(s, messageId, choiceIndex))
}

function resolveChoiceOnStateInner(s: GameState, messageId: string, choiceIndex: number): void {
  const msg = s.inbox.find((x) => x.id === messageId)
  if (!msg || msg.resolved || !msg.choices) return
  const choice = msg.choices[choiceIndex]
  if (!choice) return
  msg.resolved = true
  msg.resultText = choice.resultText
  // Living World Phase 7: some choices ARE promises (§34), and they are noted at the moment of
  // the saying — before applyEffects, because the promise is what was SAID and the effects are
  // what then happened (raiseDemandTarget must be read before the raise moves the morale it
  // filters on). World-only writes; every hook no-ops without the promises capability.
  const special = choice.effects.special
  if (special === 'board-defy' && s.board) noteBoardDefiance(s, { target: boardEffectiveTarget(s) })
  if (special === 'grant-raise' || special === 'refuse-raise') {
    const star = raiseDemandTarget(s)
    if (star) noteRaiseOutcome(s, star, special === 'grant-raise')
  }
  if (special === 'cola-raise') noteColaAdjustment(s)
  if (choice.effects.special === 'acquired' && msg.meta?.acquisitionAmount) {
    // The offer prices the COMPANY. The token leg rides along untouched — disjoint legs.
    s.gameOver = {
      type: 'acquired',
      week: s.week,
      payout: Math.round(founderStanding(s, { exitValue: msg.meta.acquisitionAmount })),
    }
  } else if (choice.effects.special === 'network-exit') {
    // ICO Slice 7. The mirror of the line above, on the other capital path: the equity leg is
    // marked at plain enterprise value (there is no acquirer and no premium to negotiate) and the
    // TOKEN leg carries the one multiplier this path has. Disjoint legs, still — see
    // `networkExitPremium` in token/scoring.ts.
    //
    // The gate is re-checked at resolution rather than trusted from the offer: a message sits in
    // the inbox until it is answered, the run keeps ticking underneath it, and a network that fell
    // apart in the meantime must not still pay out an ending it no longer qualifies for.
    if (networkEndingProgress(s).reached) {
      const kind = tokenEndingKind(s)
      s.gameOver = {
        type: 'network',
        week: s.week,
        payout: Math.round(founderStanding(s, { tokenMultiplier: networkExitPremium(s) })),
        tokenEnding: kind,
        detail: TOKEN_ENDING_FACES[kind].line,
      }
    } else {
      s.flash =
        '🕸 Too late — the network stopped clearing its own bar while the offer sat in your inbox. You are still here, and so is the work.'
    }
  } else {
    applyEffects(s, choice.effects)
  }
  // targeted consequences for the person this 1:1 was about
  if (choice.target && msg.meta?.employeeId) {
    const emp = s.employees.find((e) => e.id === msg.meta!.employeeId)
    if (emp) {
      if (choice.target.morale) emp.morale = clamp(emp.morale + choice.target.morale, 0, 100)
      if (choice.target.salaryMult) emp.salary = Math.round((emp.salary * choice.target.salaryMult) / 1000) * 1000
    }
  }
  // arc bookkeeping: the story remembers
  if (msg.meta?.arcInstance) {
    const arc = s.arcs.find((a) => a.instanceId === msg.meta!.arcInstance)
    if (arc) {
      arc.waiting = false
      if (choice.arcSet) Object.assign(arc.data, choice.arcSet)
      if (choice.arcEnd) arc.done = true
      else if (choice.arcGoto) {
        arc.stage = choice.arcGoto
        arc.week = s.week
      } else {
        arc.done = true
      }
    }
  }
}

export function hasPendingDecision(s: GameState): boolean {
  return s.inbox.some((m) => m.kind === 'choice' && !m.resolved)
}

export function weekDate(week: number): string {
  const d = new Date(2025, 0, 6)
  d.setDate(d.getDate() + (week - 1) * 7)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export { avgMorale }
