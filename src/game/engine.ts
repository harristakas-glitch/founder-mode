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
import { resolveGameRules, type CapabilityKey, type GameCapabilities, type GameConfig } from './modes'
import { careerMarketingDrain, careerProductDrag, tickCareerPMF } from './career/tick'
import { createCareerPMF, migrateCareerSave } from './career/pmf'
import { livingWorldActive, tickLivingWorld } from './world/tick'
import type {
  Candidate,
  Choice,
  Effects,
  Employee,
  FounderKind,
  GameState,
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

const can = (s: GameState, k: CapabilityKey): boolean => s.capabilities?.[k] ?? false

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
    rivals: (opts.aiRivals ?? resolveGameRules(opts.config!).capabilities.aiRivals) ? makeRivals(sec.tam) : [],
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
    capabilities: resolveGameRules(opts.config!).capabilities,
    // Career only: the deep discovery subsystem. Its market truth is generated once, here,
    // from the run's seed — and never regenerated for the life of the campaign.
    career: resolveGameRules(opts.config!).capabilities.detailedPMF
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
      const salary = Math.round((ROLE_BASE[role] + skill * 13_000 + rand(-6000, 6000)) / 1000) * 1000
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
  const salary = Math.round((ROLE_BASE[role] + skill * 13_000 + rand(-6000, 6000)) / 1000) * 1000
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

// Every one-off payment the player has already set in motion — no hidden bills.
export function committedCosts(s: GameState): { due: number; potential: number; recommended: number } {
  const due = s.pendingHires.reduce((a, p) => a + recruiterFee(p.candidate), 0) // signed, will definitely hit
  const potential = s.offersOut.reduce((a, c) => a + recruiterFee(c), 0) // hits if the candidate accepts
  // sensible cash cushion: everything committed + a typical worst-case surprise (infra spikes scale with users)
  const recommended = due + potential + Math.max(20_000, Math.round(s.users * 8))
  return { due, potential, recommended }
}

// ---------- valuation ----------

export function valuation(s: GameState): number {
  const sector = sectorById(s.sector)
  const annualRev = s.lastRevenue * 52
  const growth = growthRate(s)
  const multiple = clamp(8 + growth * 150, 5, 25) * (1 + 0.4 * s.climate)
  const revPart = annualRev * multiple
  // Investors pay up for growth: a fast-growing user base is worth a multiple of a stagnant one.
  const growthMania = 1 + clamp(growth * 12, 0, 4)
  const ventureUserVal = s.ventures.reduce((a, v) => (v.launched ? a + v.users * sectorById(v.sector).perUserVal : a), 0)
  const userPart = (s.users * sector.perUserVal + ventureUserVal) * 0.5 * growthMania
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

// Marketing budgets grow with the company: a Series C war chest can actually be spent.
export function marketingMax(s: GameState): number {
  const byStage: Record<Stage, number> = {
    'Pre-seed': 30_000,
    Seed: 50_000,
    'Series A': 150_000,
    'Series B': 500_000,
    'Series C': 1_500_000,
  }
  return byStage[s.stage]
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
        salary: Math.round((ROLE_BASE[role] + skill * 13_000) / 1000) * 1000,
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
  const investors = [...INVESTORS].sort(() => RNG.next() - 0.5).slice(0, n)
  const growth = growthRate(s)
  const sheets: TermSheet[] = investors.map((investor) => {
    // Each fund prices you differently around your "fair" valuation; a cold market prices everyone down.
    const climateMult = 1 + 0.35 * s.climate
    const offeredVal = val * rand(0.7, 1.25) * climateMult
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
  if (can(s, 'boardReviews')) s.board = { targetGrowth: BOARD_TARGETS[target], nextReview: s.week + 12, strikes: 0, defied: false }
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
  const coordination = clamp(1 - Math.max(0, s.employees.length - COORDINATION_FREE_HEADS) * 0.015, 0.6, 1)
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
    const pmfGain = (0.3 + researchPoints * 0.35 + featureGain * 0.25) * s.resonance * (1 - s.pmf / 110)
    s.pmf = clamp(s.pmf + pmfGain - 0.5, 0, 100)
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
  const churnMult = clamp(2.4 - s.pmf / 45 - s.quality / 250 + s.bugs / 200, 0.3, 3)
  const churned = s.users * sector.churn * churnMult
  s.users = Math.max(0, Math.round(s.users + acquired + wordOfMouth - churned))
  } // end Quick Play / Arena acquisition path

  // --- revenue & costs: people only pay for things they need ---
  const salesPoints = s.employees.filter((e) => e.role === 'sales').reduce((a2, e) => a2 + eff(e), 0) * rallyMult
  const salesBoost = 1 + salesPoints / 40 + (s.founderKind === 'business' ? 0.08 : 0)
  const conversion = 0.25 + (0.75 * s.pmf) / 100
  // Ad-driven models only monetize at scale: CPMs and fill rates climb with network size.
  const scaleBoost = s.sector === 'social' ? 1 + Math.log10(Math.max(10, s.users)) / 3 : 1
  // Career counts retained accounts in the hundreds where Quick Play counts users in the tens of
  // thousands, so it bills at its own per-customer rate. Charging the Quick Play rate left every
  // Career company structurally unprofitable in all five sectors — revenue ran far under payroll
  // and "surviving" only meant draining the starting $200k more slowly.
  const arpu = careerOn ? sector.careerArpu : sector.arpuWeekly
  const coreRevenue = s.users * arpu * salesBoost * conversion * scaleBoost * (0.6 + pScore / 150) * careerRevenueMult
  const ventureRevenue = s.ventures.reduce((acc, v) => {
    if (!v.launched) return acc
    const vs = sectorById(v.sector)
    const vScale = v.sector === 'social' ? 1 + Math.log10(Math.max(10, v.users)) / 3 : 1
    return acc + v.users * vs.arpuWeekly * salesBoost * (0.25 + (0.75 * v.pmf) / 100) * vScale * (0.6 + pScore / 150)
  }, 0)
  const revenue = Math.round(coreRevenue + ventureRevenue)
  const payroll = weeklyPayroll(s)
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
    // A company burning cash it does not have is the WORST case, not an exempt one. The guard
    // used to read `runwayNow > 0 && runwayNow < 10`, and a negative runway (cash already below
    // zero) failed the first half — so a founder who was bankrupt next week had the same 74.5%
    // acceptance as a healthy one, while a founder with nine weeks of cash was punished 25 points.
    const looksDoomed = runwayNow < 10
    // Money on the table moves people. Without this the Arena sealed-bid auction was incoherent:
    // you could win a contested hire by committing +100% — doubling both salary and the recruiter
    // fee — and the candidate would still decline a quarter of the time for reasons that had
    // nothing to do with the number you had just bid. Derived from the offer itself rather than
    // from a stored bid, so it works identically for a Quick Play offer at the asking price.
    const marketRate = ROLE_BASE[c.role] + c.skill * 13_000
    const overPay = clamp((c.salary - marketRate) / Math.max(1, marketRate), -0.2, 1)
    const acceptChance = clamp(
      0.72 + s.reputation / 400 + overPay * 0.18 - (looksDoomed ? 0.25 : 0) + (s.climate < -0.2 ? 0.08 : 0),
      0.05,
      0.97,
    )
    if (RNG.next() < acceptChance) {
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
  for (const e of s.employees) {
    e.weeks += 1
    let d = (70 - e.morale) * 0.06 // drift toward 70
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
  if (val > 8_000_000 && s.pmf > 50 && RNG.next() < 0.03 && !s.inbox.some((m) => !m.resolved && m.kind === 'choice')) {
    // Premium tracks momentum: a hot company gets bid up ~2x, a stalling one gets a lowball.
    // Flat noise made every offer strictly worse than holding, so the button was pure bait.
    const premium = 1.1 + 0.9 * clamp(growthRate(s) * 20, 0, 1)
    const amount = Math.round((val * premium * rand(0.92, 1.12)) / 1e6) * 1e6
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
      s.gameOver = {
        type: 'bankrupt',
        week: s.week,
        payout: s.bankedPayout > 0 ? s.bankedPayout : undefined, // secondaries survive the wreck
        detail:
          `The final week: you went in with ${fmt(cashAtStart)}, earned ${fmt(revenue)} in revenue, paid ${fmt(expenses)} in running costs` +
          (oneOffs > 0 ? `, and took ${fmt(oneOffs)} in one-off hits (recruiter fees, event costs, severance)` : '') +
          `. That left the account at −${fmt(s.cash)}${s.bridgeUsed ? ', and the bridge loan was already spent' : ', and no investor would bridge it'}.`,
      }
    }
  } else if (val >= 1_000_000_000 && !s.ipo) {
    // mid-IPO, the run continues — ringing the bell at a $1B+ price beats the plain unicorn ending
    s.gameOver = { type: 'unicorn', week: s.week, payout: Math.round(val * s.founderEquity + s.bankedPayout) }
  } else if (s.challenge && s.week >= s.challenge.cap) {
    s.gameOver = { type: 'timeup', week: s.week, payout: Math.round(val * s.founderEquity + s.bankedPayout) }
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
  return valuation(s) >= IPO_MIN_VAL / 2 || s.stage === 'Series B' || s.stage === 'Series C'
}

export function ipoEligible(s: GameState): boolean {
  if (!can(s, 'ipoEndgame')) return false
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
    const payout = Math.round(val * mult * s.founderEquity + s.bankedPayout)
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

function covenantCheck(s: GameState) {
  if (!s.debt || s.lastRevenue >= s.debt.covenantRevenue) return
  const owed = s.debt.principal
  // cash can already be negative this week — the bank can only seize what exists
  const paid = Math.max(0, Math.min(s.cash, owed))
  s.cash -= paid
  const shortfall = owed - paid
  s.debt = null
  if (shortfall > 0) {
    s.founderEquity *= 0.85
    applyEffects(s, { morale: -8, reputation: -6 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: '🏦 Covenant breach — the bank calls the loan',
      body:
        `Revenue fell below the covenant. The bank seized $${(paid / 1000).toFixed(0)}k of cash and, for the remaining ` +
        `$${(shortfall / 1000).toFixed(0)}k, forced an equity conversion — 15% of the company. This is why debt is cheap: it bites.`,
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

function maybeOneOnOne(s: GameState) {
  if (s.employees.length < 2 || RNG.next() > 0.1) return
  if (s.inbox.some((m) => m.kind === 'choice' && !m.resolved)) return
  const candidates = s.employees.filter((e) => !s.inbox.slice(0, 12).some((m) => m.meta?.employeeId === e.id))
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
  id: 'poach' | 'smear' | 'raid'
  name: string
  emoji: string
  cost: number
  blurb: string
}

export const ATTACKS: AttackDef[] = [
  { id: 'poach', name: 'Poach talent', emoji: '🎣', cost: 50_000, blurb: 'Recruiters target their team. Their best engineer walks — and lands in your hiring pool.' },
  { id: 'smear', name: 'Smear campaign', emoji: '🗞', cost: 40_000, blurb: 'Anonymous briefings to journalists. Their hype and reputation take a hit; a little mud sticks to you too.' },
  { id: 'raid', name: 'User raid', emoji: '⚔️', cost: 80_000, blurb: 'A targeted campaign at their customer base. Punching UP at a bigger rival pays far more than punching down.' },
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
  const proportional = victimUsers * 0.04
  return Math.round(Math.max(proportional, Math.min(victimUsers * 0.15, RAID_FLOOR_USERS)))
}

export function canAttack(s: GameState): { ok: boolean; reason?: string } {
  if (!can(s, 'pvpActions')) return { ok: false, reason: 'PvP is disabled in this match' }
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
  if (!canAttack(s).ok || s.cash < cost) return false
  s.cash -= cost
  s.flags.attackCooldown = ATTACK_COOLDOWN
  drainEnergy(s, 4)
  if (kind === 'poach') applyEffects(s, { special: 'talent-influx' })
  if (kind === 'smear') s.reputation = clamp(s.reputation - 2, 0, 100)
  if (kind === 'raid') {
    // Relative, not absolute: raiding the leader pays up to 3x, kicking a straggler pays half.
    // Absolute spoils meant raids only paid at a scale a 52-week match never reaches.
    const leverage = clamp(targetUsers / Math.max(1, s.users), 0.5, 3)
    const won = Math.round(raidMagnitude(targetUsers) * 0.8 * leverage)
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
export const SHIELD_WEEKS = 8
export const SHIELD_BASE_COST = 120_000

export function shieldCost(s: GameState): number {
  return SHIELD_BASE_COST * (STAGES.indexOf(s.stage) + 1)
}

export function canBuyShield(s: GameState): { ok: boolean; reason?: string } {
  if (!can(s, 'pvpActions')) return { ok: false, reason: 'PvP is disabled in this match' }
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

// The victim's side, applied when the attack broadcast arrives.
export function applyAttackIncoming(s: GameState, kind: AttackDef['id'], rawFrom: string) {
  const def = ATTACKS.find((a) => a.id === kind)
  if (!def) return // unknown attack kind off the wire
  const fromCompany = String(rawFrom ?? 'A rival').slice(0, 30)
  if ((s.flags.shield ?? 0) > 0) {
    // the retainer runs for its full term — it is a duration you bought, not a single charge
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `🛡 Crisis team deflected ${fromCompany}'s ${def.name.toLowerCase()}`,
      body: `${fromCompany} came at you — and your retainer earned every dollar. The attack fizzled before it touched morale, press, or users. The team is on call for another ${s.flags.shield} week${s.flags.shield === 1 ? '' : 's'}.`,
    })
    s.flash = `🛡 Your crisis team deflected ${fromCompany}'s ${def.name.toLowerCase()}!`
    return
  }
  if (kind === 'poach') applyEffects(s, { morale: -6, special: 'lose-best' }) // they take a person, not just a mood
  if (kind === 'smear') applyEffects(s, { hype: -10, reputation: -3 })
  if (kind === 'raid') {
    const lost = raidMagnitude(s.users)
    if (lost > 0) applyEffects(s, { users: -lost })
    s.flags.lastRaidLost = lost
  }
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'news',
    title: `${def.emoji} ${fromCompany} hit you: ${def.name.toLowerCase()}`,
    body:
      kind === 'poach'
        ? `${fromCompany}'s recruiters are calling your team, one by one. Nothing personal — this is the game you're all playing.`
        : kind === 'smear'
          ? `Unflattering stories about your company are circulating, and the fingerprints belong to ${fromCompany}. The market notices.`
          : `${fromCompany} is running aggressive ads squarely at your users — and some of them are converting.`,
  })
  s.flash = `${def.emoji} ${fromCompany} launched a ${def.name.toLowerCase()} against you!`
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
    s.gameOver = { type: 'fired', week: s.week, payout: Math.round(valuation(s) * s.founderEquity * 0.5 + s.bankedPayout) }
    return
  }
  s.board.strikes += 1
  if (s.board.strikes >= 2) {
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
  }
}

function maybeFireEvent(s: GameState) {
  if (RNG.next() > 0.45) return
  if (s.inbox.some((m) => m.kind === 'choice' && !m.resolved)) return
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
      !s.inbox.slice(0, 8).some((m) => m.title === e.title), // avoid rapid repeats
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
  if (choice.effects.special === 'acquired' && msg.meta?.acquisitionAmount) {
    s.gameOver = { type: 'acquired', week: s.week, payout: Math.round(msg.meta.acquisitionAmount * s.founderEquity + s.bankedPayout) }
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
