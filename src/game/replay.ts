// Replay verification (BACKLOG §3.1 follow-through). A run is exactly reproducible from its
// config (seed, mode, format, sector, scenario) plus the ordered log of player actions, because
// every engine entry point is seeded on (config.seed, week, rngTick). This module owns:
//
//   1. THE REGISTRY — the one table of player actions that mutate simulation state, each with its
//      minimal JSON-safe payload. The store performs those actions THROUGH `applyJournaled`, so
//      the live game and a replay run literally the same functions. That is how coverage is
//      guaranteed: there is no second copy of the mutation logic to drift.
//   2. `replayRun(header, journal)` — rebuild the run from scratch by re-executing the log.
//   3. `verifyRun(save)` — replay and compare an end-state fingerprint. A mismatch is
//      'unverifiable_desync'; a save with no journal (legacy, arena, or an overflowed log) is
//      'legacy_no_journal'; only an exact fingerprint match is 'verified'.
//
// HONESTY RULE (the property the whole feature stands on): if any code path mutates simulation
// state without going through the registry, verification must go RED, never silently green. The
// fingerprint covers every leaderboard-relevant output (score, cash, users, week) plus the state
// that feeds them, so an unjournaled mutation either shows up directly or through the weeks it
// influences. test/replay.test.ts keeps a canary on exactly this.
//
// Deliberately NOT imported here: the store, anything in src/net, anything that touches the DOM.
// Payload references are INDICES into the arrays of the state at action time (candidates,
// employees, inbox, termSheets, …), never entity ids — ids come from `uid()`, which reads the
// wall clock and Math.random and is different on every replay. Positions are deterministic; ids
// are not.

import {
  acceptTermSheet,
  counterTermSheet,
  acquireRival,
  advanceWeek,
  applyEffects,
  concedePriceWar,
  defyGovernance,
  drawDebt,
  killVenture,
  marketingMax,
  newGame,
  pitchInvestors,
  pitchTeam,
  pivot,
  repayDebt,
  resolveChoiceOnState,
  sellSecondary,
  sellFounderTokens,
  sellTokenTreasury,
  setGovernanceStance,
  setTokenIncentives,
  startIPO,
  startVenture,
  takeVacation,
  tokeniseCompany,
  uid,
} from './engine'
import { sectorById } from './data'
import { addJournal, experimentDef, segmentDef, startExperiment } from './career/pmf'
import { repositionTo } from './career/tick'
import { chooseInteractionOption } from './world/interactions'
import { cancelInitiative, startInitiative } from './strategic/roadmap'
import { abandonBigBet, chooseBigBet } from './strategic/bigbets'
import { ATTENTION_AREA_MAX, ATTENTION_AREAS, ATTENTION_BUDGET, createDefaultAttention } from './strategic/attention'
import { cancelAIInitiative, startAIInitiative } from './strategic/ai'
import { startResearchV2 } from './sim2/research'
import { usesBusinessSimulationV2 } from './modes'
import type { FounderAttentionArea } from './strategic/types'
import { systemDepth } from './modes'
import type { GameConfig } from './modes'
import type { ExperimentType, PricingStrategy, ProductFocus } from './career/types'
import type { LaunchDraft } from './token/launch'
import type { IncentiveShares } from './token/incentives'
import type { FounderKind, GameState } from './types'

// ---------- journal ----------

/** JSON-safe payload: numbers, strings, booleans, and one level of the same for `tokenise`. */
export type JournalPayload = Record<string, unknown>

export interface JournalEntry {
  /** Week the action was taken in (informational — order is what replay executes). */
  w: number
  a: ReplayActionName
  p?: JournalPayload
}

/**
 * Past this the journal is dropped and the run honestly becomes unverifiable rather than
 * silently truncated (a truncated log would replay to a desync and read as tampering). A typical
 * 90-week run records a few hundred entries; 20k is ~50 actions a week for four years.
 */
export const JOURNAL_LIMIT = 20_000

/**
 * Append an action to the save's journal. No-op when journaling is off (`g.journal` absent:
 * arena runs, legacy saves, overflowed logs). Never reads or advances any RNG stream.
 *
 * Consecutive same-week writes to the same slider (`marketing`, or `allocation` on the same key)
 * coalesce into the final value — setting features=50 then 60 replays identically to setting 60
 * once, because a pure value-write draws nothing and only the last one survives to the tick.
 */
export function recordJournal(g: GameState, a: ReplayActionName, p?: JournalPayload): void {
  if (!Array.isArray(g.journal)) return
  // The payload is cloned so a caller mutating its object later cannot rewrite history.
  const entry: JournalEntry = p === undefined ? { w: g.week, a } : { w: g.week, a, p: structuredClone(p) }
  const last = g.journal[g.journal.length - 1]
  if (
    last &&
    last.w === entry.w &&
    last.a === a &&
    (a === 'marketing' || (a === 'allocation' && last.p?.k === p?.k))
  ) {
    g.journal[g.journal.length - 1] = entry
    return
  }
  g.journal.push(entry)
  if (g.journal.length > JOURNAL_LIMIT) g.journal = undefined
}

/** Journal round-tripped through user-writable storage: keep only entries shaped like entries. */
export function sanitizeJournal(v: unknown): JournalEntry[] | undefined {
  if (!Array.isArray(v)) return undefined
  // SECURITY (2026-08 review): the writer's ceiling has to be the reader's ceiling too.
  // `recordJournal` above drops the journal the moment it passes JOURNAL_LIMIT, so no honest
  // run can ever persist a longer one — but this function accepted any length, and localStorage
  // is user-writable. Every `advance` entry costs a full simulated week (~1.4ms measured) and
  // App.tsx replays the whole log synchronously inside a render `useMemo`, so length converts
  // straight into a frozen tab: 200k entries fit inside the storage quota and cost ~4.5 minutes.
  // Refusing (rather than truncating) matches what recordJournal already does with an overflow.
  if (v.length > JOURNAL_LIMIT) return undefined
  const ok = (e: unknown): e is JournalEntry =>
    !!e &&
    typeof e === 'object' &&
    typeof (e as JournalEntry).a === 'string' &&
    typeof (e as JournalEntry).w === 'number' &&
    ((e as JournalEntry).p === undefined || typeof (e as JournalEntry).p === 'object')
  // A malformed ENTRY is not silently dropped — dropping would change what replays and turn a
  // storage hiccup into a "tampered" verdict. The whole log is refused instead.
  return v.every(ok) ? (v as JournalEntry[]) : undefined
}

// ---------- the registry ----------

// Defensive coercers: a journal is user-writable localStorage, so a registry function must never
// crash on a hostile payload — it either applies the action or leaves a state that will simply
// fail the fingerprint. Live calls pass typed values, so coercion is a no-op on the honest path.
const idx = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : -1)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const clampSpend = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)))

const EXPERIMENTS: ReadonlySet<string> = new Set(['interview', 'landing_page', 'prototype', 'pricing_test', 'pilot'])
const PRICINGS: ReadonlySet<string> = new Set(['low', 'market', 'premium'])
const FOCUSES: ReadonlySet<string> = new Set(['simplicity', 'reliability', 'collaboration', 'enterprise_readiness', 'automation', 'performance'])
const RALLIES: ReadonlySet<string> = new Set(['vision', 'numbers', 'war'])
const ALLOC_KEYS = ['features', 'quality', 'bugs', 'research', 'bet'] as const

type ReplayFn = (g: GameState, p: JournalPayload) => { state?: GameState; result?: unknown } | void

/**
 * Action name → the exact mutation the store used to inline. Guards that read the live state and
 * bail WITHOUT mutating (cooldowns, eligibility, "already set") stay in the store — an action is
 * only journaled once it is actually going to run, and both sides then run this same function.
 */
const REPLAY_ACTIONS = {
  /** Advance one week (solo path — online matches are arena and never journal). */
  advance: (g) => ({ state: advanceWeek(g) }),

  /** Send a hiring offer (instant-offer path; the arena sealed-bid path never journals). */
  send_offer: (g, p) => {
    const c = g.candidates[idx(p.i)]
    if (!c) return
    // negotiation (engagement §6): the offered package is asking ± the premium, clamped; the
    // acceptance roll and the eventual payroll both price the ADJUSTED number
    const pm = Math.max(-15, Math.min(30, num(p.pm)))
    const offered = pm !== 0 ? { ...c, salary: Math.round((c.salary * (100 + pm)) / 100 / 500) * 500 } : c
    g.candidates = g.candidates.filter((x) => x.id !== c.id)
    g.offersOut.push(offered)
    g.flash = `Offer sent to ${c.name}${pm > 0 ? ` at +${pm}% over asking` : pm < 0 ? ` at ${pm}% under asking` : ''}. They'll answer when you advance the week — lowballs and thin runways both get cold feet.`
  },

  fire: (g, p) => {
    const e = g.employees[idx(p.i)]
    if (!e) return
    g.employees = g.employees.filter((x) => x.id !== e.id)
    g.cash -= Math.round(e.salary / 12) // one month severance
    applyEffects(g, { morale: -8 })
    g.inbox.unshift({
      id: uid(),
      week: g.week,
      kind: 'system',
      title: `${e.name} was let go`,
      body: `You paid one month of severance ($${Math.round(e.salary / 12).toLocaleString()}). The team is rattled.`,
    })
  },

  raise: (g, p) => {
    const e = g.employees[idx(p.i)]
    if (!e) return
    e.salary = Math.round((e.salary * 1.1) / 1000) * 1000
    e.morale = Math.min(100, e.morale + 12)
  },

  pivot: (g) => {
    pivot(g)
  },

  run_experiment: (g, p) => {
    const t = str(p.t)
    if (!EXPERIMENTS.has(t) || !g.career) return
    const type = t as ExperimentType
    const segmentId = str(p.s)
    const def = experimentDef(type)
    startExperiment(g.career, g.week, type, segmentId, uid(), p.st === true)
    g.cash -= def.cashCost
    const segName = segmentDef(g.sector, segmentId).name
    addJournal(g.career, {
      week: g.week,
      category: 'experiment',
      title: `Started: ${def.name} — ${segName}${p.st === true ? ' (standing)' : ''}`,
      description: def.blurb,
      relatedSegmentId: segmentId,
    })
    g.flash = `🔬 ${def.name} started on ${segName}. Results in ${def.weeks} weeks — research takes time, which is the point.`
  },

  experiment_standing: (g, p) => {
    const exp = g.career?.activeExperiments[idx(p.i)]
    if (!exp) return
    exp.standing = p.st === true
    g.flash =
      p.st === true
        ? `${experimentDef(exp.type).name} is now a standing study — it will renew itself while the cash lasts.`
        : `${experimentDef(exp.type).name} will finish and stop.`
  },

  concede_price_war: (g) => ({ result: concedePriceWar(g) }),

  target_segment: (g, p) => {
    if (!g.career) return
    repositionTo(g, str(p.s), g.week)
  },

  pricing: (g, p) => {
    const v = str(p.v)
    if (!PRICINGS.has(v) || !g.career) return
    const from = g.career.pricing
    g.career.pricing = v as PricingStrategy
    addJournal(g.career, {
      week: g.week,
      category: 'pricing',
      title: `Pricing: ${from} → ${v}`,
      description:
        v === 'premium'
          ? 'Asking for more. Fewer will convert; those who do are worth more — if they stay.'
          : v === 'low'
            ? 'Cheaper to say yes to. More customers, thinner economics.'
            : 'Priced at the middle of the market.',
    })
    g.flash = `💲 Pricing moved to ${v}. Conversion and retention will re-rate over the next few weeks.`
  },

  focus: (g, p) => {
    const v = str(p.v)
    if (!FOCUSES.has(v) || !g.career) return
    g.career.focus = v as ProductFocus
    addJournal(g.career, {
      week: g.week,
      category: 'strategy',
      title: `Product focus: ${v.replace('_', ' ')}`,
      description: 'What the roadmap optimises for. Segments value these differently.',
    })
    g.flash = `🧭 Product now optimised for ${v.replace('_', ' ')}.`
  },

  file_ipo: (g) => {
    startIPO(g)
  },

  start_bet: (g, p) => {
    startVenture(g, str(p.s) as GameState['sector'])
  },

  shelve_bet: (g, p) => {
    killVenture(g, g.ventures[idx(p.i)]?.id ?? '')
  },

  buy_rival: (g, p) => ({
    result: acquireRival(g, g.rivals[idx(p.i)]?.id ?? '', p.m === 'stock' ? 'stock' : 'cash'),
  }),

  rally: (g, p) => {
    const v = str(p.v)
    if (!RALLIES.has(v)) return
    pitchTeam(g, v as 'vision' | 'numbers' | 'war')
  },

  take_debt: (g, p) => {
    drawDebt(g, num(p.n))
  },

  pay_debt: (g, p) => {
    repayDebt(g, num(p.n))
  },

  recharge: (g) => {
    takeVacation(g)
  },

  secondary: (g) => {
    sellSecondary(g)
  },

  allocation: (g, p) => {
    const k = str(p.k) as (typeof ALLOC_KEYS)[number]
    if (!ALLOC_KEYS.includes(k)) return
    g.allocation = { ...g.allocation, [k]: num(p.v) }
  },

  /** Start (or queue) a roadmap initiative — Strategic Systems Expansion phase 1. Depth comes
   *  from the run's own config, so a replayed quick run sees the quick pool. */
  roadmap_start: (g, p) => {
    startInitiative(g, str(p.id), systemDepth(g, 'roadmap'))
  },

  roadmap_cancel: (g, p) => {
    cancelInitiative(g, str(p.id))
  },

  /** Commit the company to a Big Bet — phase 2. One active at a time; the guard is in the fn. */
  bet_choose: (g, p) => {
    chooseBigBet(g, str(p.t) as never, systemDepth(g, 'bigBets'))
  },

  bet_abandon: (g) => {
    abandonBigBet(g)
  },

  /** Set the Founder Focus (attention, light depths) — one area or null to clear. Depth-guarded
   *  so an arena journal can never smuggle an attention effect in (§ Attention — Off). */
  attention_focus: (g, p) => {
    if (systemDepth(g, 'founderAttention') === 'off') return
    const a = str(p.a) as FounderAttentionArea
    g.attention = { ...(g.attention ?? createDefaultAttention()), focus: ATTENTION_AREAS.includes(a) ? a : null }
  },

  /** Set the deep weekly attention allocation. Sanitized hard: only known areas, integer points
   *  0..AREA_MAX, cumulative total truncated at the budget in canonical area order — a hand-edited
   *  journal cannot allocate more founder than exists. */
  attention_allocate: (g, p) => {
    if (systemDepth(g, 'founderAttention') !== 'deep') return
    const raw = (p.alloc ?? {}) as Record<string, unknown>
    const alloc: Partial<Record<FounderAttentionArea, number>> = {}
    let total = 0
    for (const area of ATTENTION_AREAS) {
      const v = Math.min(ATTENTION_AREA_MAX, Math.max(0, Math.round(num(raw[area]))))
      const take = Math.min(v, ATTENTION_BUDGET - total)
      if (take > 0) {
        alloc[area] = take
        total += take
      }
    }
    g.attention = { ...(g.attention ?? createDefaultAttention()), allocated: alloc }
  },

  /** Commission a V2 market study (Business Simulation V2 phase 4). Bills cash, completes
   *  weeks later; gate-guarded — journals of classic runs cannot start one. */
  v2_research: (g, p) => {
    if (!usesBusinessSimulationV2(g)) return
    startResearchV2(g, str(p.k), str(p.seg))
  },

  /** Push back on a term sheet's price — once per sheet (negotiation, engagement §6). */
  counter_sheet: (g, p) => {
    const t = g.termSheets[idx(p.i)]
    if (t) counterTermSheet(g, t.id)
  },

  /** Set the V2 price DIAL (spec §13.4). Once touched, the dial is authoritative. Clamped to a
   *  fixed band around the IMMUTABLE sector reference price — never the current price. The first
   *  version anchored on `pricing.price` itself, which RATCHETS: each move allowed 20x the last,
   *  so a few pulls compounded to 8000x and a week-4 unicorn (owner-reported, reproduced). */
  v2_price: (g, p) => {
    if (!usesBusinessSimulationV2(g) || !g.simV2) return
    const v = num(p.v)
    if (!Number.isFinite(v) || v <= 0) return
    const ref = sectorById(g.sector).arpuPerCustomer
    g.simV2.pricing = { price: Math.min(Math.max(v, ref * 0.25, 0.1), ref * 6), lastChangedWeek: g.week, manual: true }
  },

  /** Declare positioning (spec §12): who the story is for. Null clears it. */
  v2_position: (g, p) => {
    if (!usesBusinessSimulationV2(g) || !g.simV2) return
    const seg = str(p.seg)
    g.simV2.positioning = { targetSegmentId: g.simV2.segments.some((x) => x.id === seg) ? seg : null }
  },

  /** Start an AI adoption rollout (phase 5). Depth-guarded inside startAIInitiative — an arena
   *  or quick journal cannot smuggle a transformation in while the system is off there. */
  ai_start: (g, p) => {
    startAIInitiative(g, str(p.id), systemDepth(g, 'aiAdoption'))
  },

  ai_cancel: (g, p) => {
    cancelAIInitiative(g, str(p.id))
  },

  /** Split the marketing budget between performance and brand (growth engine). Depth-guarded:
   *  in modes where the mix is off, marketing stays 100% performance — the classic model. */
  growth_mix: (g, p) => {
    if (systemDepth(g, 'growthMix') === 'off') return
    const share = typeof p.v === 'number' && Number.isFinite(p.v) ? Math.min(1, Math.max(0, p.v)) : 1
    g.growth = { ...(g.growth ?? { performanceShare: 1, lastMixWeek: 0, brand: { stock: 0, pending: [] } }), performanceShare: share, lastMixWeek: g.week }
  },

  marketing: (g, p) => {
    const v = typeof p.v === 'number' && Number.isFinite(p.v) ? p.v : 0
    g.marketingSpend = clampSpend(v, marketingMax(g))
  },

  resolve_choice: (g, p) => {
    resolveChoiceOnState(g, g.inbox[idx(p.i)]?.id ?? '', num(p.c))
  },

  pitch: (g) => {
    const { sheets, message } = pitchInvestors(g)
    g.termSheets = sheets
    g.inbox.unshift(message)
  },

  accept_sheet: (g, p) => {
    acceptTermSheet(g, g.termSheets[idx(p.i)]?.id ?? '')
  },

  decline_sheet: (g, p) => {
    const t = g.termSheets[idx(p.i)]
    if (!t) return
    g.termSheets = g.termSheets.filter((x) => x.id !== t.id)
  },

  tokenise: (g, p) => ({
    result: tokeniseCompany(g, (p.d && typeof p.d === 'object' ? p.d : undefined) as LaunchDraft | undefined),
  }),

  incentives: (g, p) => {
    setTokenIncentives(g, (p.s && typeof p.s === 'object' ? p.s : {}) as Partial<IncentiveShares>)
  },

  sell_treasury: (g, p) => ({ result: sellTokenTreasury(g, num(p.n)) }),

  sell_founder: (g, p) => ({ result: sellFounderTokens(g, num(p.n)) }),

  proposal_stance: (g, p) => ({
    result: setGovernanceStance(
      g,
      g.token?.governance.proposals[idx(p.i)]?.id ?? '',
      p.v === 'oppose' ? 'oppose' : 'support',
    ),
  }),

  defy_mandate: (g, p) => ({
    result: defyGovernance(g, g.token?.governance.mandates[idx(p.i)]?.proposalId ?? ''),
  }),

  /**
   * Living World Phase 8: answer one structured room (a question put to the interview panel, a
   * reply to an employee, a board decision).
   *
   * The ONE action in this registry keyed by ID rather than by index, and deliberately: a room's
   * id is a §67 narrative id built from (week, kind, character, topic) and is therefore identical
   * on a replay, while `world.interactions` is a capped array whose contents shift as settled
   * rooms are shed — the exact hazard indices exist to avoid everywhere else.
   *
   * It mutates `s.world` and nothing the fingerprint covers, so a desync can never come from
   * here. It is journaled anyway: which room a founder answered, and how, is part of what the run
   * DID, and a replay that skipped it would rebuild the same numbers under a different biography.
   */
  interaction: (g, p) => {
    chooseInteractionOption(g, str(p.r), str(p.o))
  },
} satisfies Record<string, ReplayFn>

export type ReplayActionName = keyof typeof REPLAY_ACTIONS

export const REPLAY_ACTION_NAMES = Object.keys(REPLAY_ACTIONS) as ReplayActionName[]

/** Run one registry action against a state. Throws on an unknown action name (verifyRun catches). */
export function applyReplayAction(
  g: GameState,
  a: string,
  p: JournalPayload = {},
): { state: GameState; result: unknown } {
  const fn = (REPLAY_ACTIONS as Record<string, ReplayFn | undefined>)[a]
  if (!fn) throw new Error(`unknown replay action "${a}"`)
  const out = fn(g, p) ?? {}
  return { state: out.state ?? g, result: out.result }
}

/**
 * THE store-side entry point: clone the live state, journal the action, apply it through the
 * registry. Every simulation-mutating player action in src/store.ts must go through here — the
 * caller keeps its guards, sounds and network side effects, but never mutates game state itself.
 * The caller decides whether to commit the returned state (some actions discard on failure,
 * e.g. tokenise when a blocker remains — the discarded clone takes its journal entry with it).
 */
export function applyJournaled(
  g: GameState,
  a: ReplayActionName,
  p?: JournalPayload,
): { state: GameState; result: unknown } {
  const game = structuredClone(g)
  recordJournal(game, a, p)
  return applyReplayAction(game, a, p)
}

// ---------- replay ----------

/** Everything `newGame` needs to deal the identical starting world, mirrored off the save. */
export interface ReplayHeader {
  companyName: string
  founderKind: FounderKind
  config: GameConfig
  challenge: { label: string; cap: number } | null
}

export function headerOf(save: GameState): ReplayHeader {
  return {
    companyName: save.companyName,
    founderKind: save.founderKind,
    config: save.config,
    challenge: save.challenge ?? null,
  }
}

/**
 * Reconstruct a run by re-executing the journal in order. Pure with respect to the store; the
 * only inputs are the header and the log. Mirrors the store's `startGame` call exactly.
 */
export function replayRun(header: ReplayHeader, journal: JournalEntry[]): GameState {
  let g = newGame(header.companyName, header.config.sector, header.founderKind, {
    config: structuredClone(header.config),
    challenge: header.challenge ? structuredClone(header.challenge) : null,
    scenario: header.config.scenario,
  })
  delete g.journal // the reconstruction must not journal itself
  for (const e of journal) g = applyReplayAction(g, e.a, e.p ?? {}).state
  return g
}

// ---------- fingerprint & verification ----------

/** Same FNV-1a the golden traces use. */
function fnv(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/**
 * End-state fingerprint. Full-precision doubles (String(x) round-trips exactly, and a replay is
 * bit-identical or it is not a replay) over every leaderboard-relevant output and the state that
 * feeds them. Excluded on purpose: entity ids and `flash` (wall-clock/Math.random artifacts that
 * never feed the simulation), and the journal itself.
 */
export function stateFingerprint(g: GameState): number {
  const n = (v: number | null | undefined) => String(v ?? 0)
  const parts: string[] = [
    n(g.week),
    n(g.cash),
    n(g.users),
    n(g.hype),
    n(g.reputation),
    n(g.features),
    n(g.quality),
    n(g.bugs),
    n(g.pmf),
    n(g.resonance),
    n(g.researchSignal),
    n(g.totalResearch),
    n(g.pivots),
    g.stage,
    n(g.founderEquity),
    n(g.lastPostMoney),
    n(g.raiseCooldown),
    n(g.lastRevenue),
    n(g.lastExpenses),
    n(g.marketingSpend),
    ALLOC_KEYS.map((k) => g.allocation[k] ?? 0).join(','),
    n(g.climate),
    n(g.energy),
    n(g.vacationCooldown),
    n(g.bankedPayout),
    n(g.macro.index),
    n(g.macro.rate),
    n(g.macro.inflation),
    g.debt ? `${g.debt.principal},${g.debt.apr},${g.debt.covenantRevenue}` : 'nodebt',
    `${g.employees.length}:${g.employees.reduce((a, e) => a + e.salary, 0)}:${g.employees.reduce((a, e) => a + e.morale, 0)}`,
    n(g.candidates.length),
    n(g.offersOut.length),
    n(g.pendingHires.length),
    g.rivals.map((r) => `${r.users},${r.stage},${r.product},${r.alive ? 1 : 0}${r.acquired ? 'a' : ''}`).join(';'),
    n(g.termSheets.length),
    n(g.inbox.length),
    n(g.milestones.length),
    n(g.history.length),
    g.ventures.map((v) => `${v.sector},${v.launched ? 1 : 0},${v.users},${v.pmf}`).join(';'),
    g.board ? `${g.board.targetGrowth},${g.board.strikes},${g.board.defied ? 1 : 0}` : 'noboard',
    g.ipo ? `${g.ipo.phase},${g.ipo.weeksLeft},${g.ipo.demand}` : 'noipo',
    g.career
      ? `${g.career.primaryTargetSegmentId},${g.career.pricing},${g.career.focus},${g.career.activeExperiments.length}`
      : 'nocareer',
    g.token
      ? `${g.token.market.price},${g.token.market.utility},${g.token.supply ? JSON.stringify(g.token.supply) : ''},${g.token.founder.sold},${g.token.founder.realisedProceeds},${g.token.treasurySales.proceeds},${g.token.governance.proposals.length},${g.token.governance.mandates.length}`
      : 'notoken',
    g.gameOver ? `${g.gameOver.type}@${g.gameOver.week}=${g.gameOver.payout ?? 0}` : 'live',
  ]
  return fnv(parts.join('|'))
}

export type VerifyState = 'verified' | 'unverifiable_desync' | 'legacy_no_journal'

export interface VerifyResult {
  state: VerifyState
  /** Fingerprint of the save as claimed. Absent when there was nothing to compare. */
  claimed?: number
  /** Fingerprint the journal actually replays to. Absent when there was no journal. */
  replayed?: number
}

/**
 * Verify a finished (or in-flight) save against its own decision log.
 *
 *   verified            — the journal replays to this exact end state. The claimed score is real.
 *   unverifiable_desync — there IS a journal and it does NOT reproduce this state: tampering,
 *                         a truncated/edited log, or an unjournaled mutation (a bug — see the
 *                         honesty rule at the top of this file).
 *   legacy_no_journal   — nothing to check: a save from before journaling, an arena/online run
 *                         (peer inputs are not in the log), or an overflowed log. Not an error.
 */
export function verifyRun(save: GameState): VerifyResult {
  if (!save?.config || save.config.mode === 'arena') return { state: 'legacy_no_journal' }
  const journal = sanitizeJournal(save.journal)
  if (!journal) return { state: 'legacy_no_journal' }
  const claimed = stateFingerprint(save)
  try {
    const replayed = stateFingerprint(replayRun(headerOf(save), journal))
    return replayed === claimed
      ? { state: 'verified', claimed, replayed }
      : { state: 'unverifiable_desync', claimed, replayed }
  } catch {
    // a journal that cannot even be executed does not verify anything
    return { state: 'unverifiable_desync', claimed }
  }
}
