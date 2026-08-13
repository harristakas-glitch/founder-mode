// The Living World — Promises (brief §34-§35, §77; tests §84). Phase 7.
//
// memory.ts has carried the full promise data layer (notePromise / settlePromise /
// expireDuePromises, capability-gated, bounded, persisted) since Phase 2. This module is the
// wiring: WHICH events constitute a promise, WHAT fact settles each one, and how the outcome is
// felt and surfaced. The lifecycle is
//
//   MADE     — at the moment of the player's own action (an inbox choice, a signed term sheet).
//              The promise is what was SAID, so it is noted where the saying happens, through the
//              capability-gated entry points memory.ts built for exactly this.
//   TRACKED  — the PromiseRecord carries its due week and the facts that will judge it.
//   SETTLED  — once per resolved week, inside tickLivingWorld's shouldGenerateForWeek guard,
//              from facts the simulation already computed: the board review's own verdict
//              (defied cleared, strikes added), a salary that actually changed, a window that
//              closed with no exception made. Never by narrative fiat.
//   FELT     — through the systems Phases 1-6 already built: the character's memory sours or
//              settles warm (memory.ts), trust moves through the promise_* RelationshipFacts
//              (relationships.ts), and the settlement facts ride the same weekly relationship
//              tick as everything else.
//   SURFACED — the §77 Active Commitments panel (a pure read of the ledger, below), the §35
//              advisor callback (a 'commitment' WeekFact handed to buildAdvisorPanel), and the
//              broken promise's memory resurfacing in the existing check-in beat.
//
// WHY NOTHING HERE WRITES TO THE INBOX. §35's callbacks are inbox-shaped, but the simulation
// READS the inbox: maybeOneOnOne filters candidates by the first 12 messages, the weekly event
// picker dedupes against the first 8 titles, and the acquisition offer checks for unresolved
// choices — all upstream of seeded draws. One extra message shifts those windows, changes an
// RNG draw count, and `npm run bots` stops being byte-identical with the capability on, which is
// the read-only rule failing in slow motion. So the callbacks live on surfaces the simulation
// never reads: the Dashboard panel, the advisor panel, and the memories the check-in beat
// already knows how to voice.
//
// Determinism: this module draws NO randomness at all. Promise ids derive from (week, key);
// the one generated artifact — a board counterparty who joins the cast when the first promise
// is made to them — comes from ensureCast, which is pure in (seed, spec). All prose is composed
// downstream through the (seed, narrative id) streams the composer already owns.

import type { Employee, GameState } from '../types'
import { hasCapability } from '../modes'
import { BOARD_SPEC, type WeekFact } from './advisors'
import { employeeSpec, ensureCast, fullName, stableCastId, type CharacterSpec } from './characters'
import { expireDuePromises, notePromise, openPromises, settlePromise } from './memory'
import {
  applyRelationshipFacts,
  relationshipWith,
  upsertRelationship,
  type RelationshipFact,
  type RelationshipFactKind,
} from './relationships'
import { PROMISE_KEYS } from './content/memory-cues'
import type { CharacterId, LivingWorldState, PromiseRecord } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/** Weeks the comp-bands stance stays open before holding the line counts as having held it. */
export const COMP_DISCIPLINE_WINDOW_WEEKS = 20
/** Settled commitments stay visible on the §77 panel this long, so outcomes are seen, not just felt. */
export const COMMITMENT_RECENT_WEEKS = 10
/** §77 is a panel, not an archive. */
export const COMMITMENT_PANEL_ROWS = 8

/** The promises whose counterparty is the board seat. A new round supersedes all of them. */
const BOARD_PROMISE_KEYS: readonly string[] = [PROMISE_KEYS.boardGrowth, PROMISE_KEYS.fundingGrowth]

// Stored facts are JSON forever, so the target is rounded once here rather than trusting float noise.
const round4 = (v: number) => Math.round(v * 10_000) / 10_000

/** '3.1%/wk growth' — formatted by hand for the same ICU reason advisors.ts formats by hand. */
function pctPerWeek(target: unknown): string {
  const v = typeof target === 'number' && Number.isFinite(target) ? target : 0
  return `${Math.round(v * 1000) / 10}%/wk growth`
}

// ---------- counterparties ----------

/**
 * A promise needs a person to be made to, and the person may not be in the cast yet — the first
 * term sheet installs a board in the same call that makes the promise. Insertion goes through
 * ensureCast so the generated person is byte-identical to the one the advisor panel would create
 * for the same seat, renames and all.
 */
function ensureCounterpart(s: GameState, spec: CharacterSpec): CharacterId | null {
  const world = s.world
  const seed = s.config?.seed
  if (!world || seed === undefined) return null
  if (!world.characters[spec.id]) world.characters = ensureCast(seed, world.characters, [spec], s.week)
  return world.characters[spec.id] ? spec.id : null
}

// ---------- feeling it (Phase 4) ----------

/**
 * Apply one promise fact to the relationship of the person who heard it. Used at the MOMENT a
 * promise is made or instantly settled — settlement inside the weekly tick threads its facts
 * through tickRelationship instead, so the decay-then-facts order there stays intact.
 */
function feelPromiseFact(s: GameState, characterId: CharacterId, kind: RelationshipFactKind, magnitude: number, sourceId: string): void {
  const world = s.world
  if (!world || !hasCapability(s, 'relationships')) return
  const character = world.characters[characterId]
  if (!character || character.status === 'departed') return
  const fact: RelationshipFact = { kind, week: s.week, magnitude, sourceId }
  const change = applyRelationshipFacts(relationshipWith(character, s.week), character, [fact], s.week)
  world.characters[characterId] = upsertRelationship(character, change.after)
}

/** How hard a settlement lands, scaled by how much the promise mattered. */
const settlementMagnitude = (p: PromiseRecord) => clamp(p.importance / 70, 0.5, 1.6)

// ---------- made: the events that constitute promises ----------

/**
 * A new expectation from the board supersedes the old one — the fact is that the board itself
 * reset its clock (a fresh round installs a fresh target), so the prior record closes as
 * 'expired', not 'broken': nobody is owed two contradictory growth numbers at once.
 */
function supersedeBoardPromises(s: GameState): void {
  const world = s.world
  if (!world) return
  for (const p of openPromises(world)) {
    if (BOARD_PROMISE_KEYS.includes(p.summaryKey)) settlePromise(s, p.id, 'expired')
  }
}

/**
 * "Defy the board — bet on yourself." The ultimatum's own body names the terms: deliver the
 * target by the next review or clean out your desk. That IS a promise, with the sharpest
 * deadline in the game. `target` is computed by the caller (boardEffectiveTarget) because it is
 * the number the ultimatum actually quoted — this module never re-derives simulation facts.
 */
export function noteBoardDefiance(s: GameState, facts: { target: number }): PromiseRecord | null {
  if (!s.world || !s.board || !hasCapability(s, 'promises')) return null
  const characterId = ensureCounterpart(s, BOARD_SPEC(s))
  if (!characterId) return null
  supersedeBoardPromises(s)
  const record = notePromise(s, characterId, {
    summaryKey: PROMISE_KEYS.boardGrowth,
    dueWeek: s.board.nextReview,
    importance: 95,
    emotionalImpact: 45,
    tags: ['promise', 'board', 'growth'],
    facts: { target: round4(facts.target), strikes: s.board.strikes },
  })
  // A defiant promise is a loud one: made in front of the whole board, magnitude to match.
  if (record) feelPromiseFact(s, characterId, 'promise_made', 1.5, record.id)
  return record
}

/**
 * Accepting a term sheet implies growth expectations (§34's list starts here): the board that
 * installs with the round carries targetGrowth and a first review date, and both go into the
 * record as the facts that will judge it. Kept when the first review passes without a strike.
 */
export function noteFundingExpectations(s: GameState, investor: string): PromiseRecord | null {
  if (!s.world || !s.board || !hasCapability(s, 'promises')) return null
  const characterId = ensureCounterpart(s, BOARD_SPEC(s))
  if (!characterId) return null
  supersedeBoardPromises(s)
  const record = notePromise(s, characterId, {
    summaryKey: PROMISE_KEYS.fundingGrowth,
    dueWeek: s.board.nextReview,
    importance: 80,
    emotionalImpact: 30,
    tags: ['promise', 'board', 'funding', 'growth'],
    facts: { target: round4(s.board.targetGrowth), strikes: s.board.strikes, investor },
  })
  if (record) feelPromiseFact(s, characterId, 'promise_made', 1, record.id)
  return record
}

/**
 * The raise demand, both answers, because both are promises:
 *
 *   GRANTED — "they shake your hand" is a commitment made and paid in the same breath. It is
 *   noted and settled 'kept' immediately, from the fact the simulation computed (the salary
 *   changed): the character remembers a kept promise, trust moves through promise_made +
 *   promise_kept, and the ledger shows a Kept row. Granting an exception also BREAKS every open
 *   comp-bands commitment — that is what an exception is.
 *
 *   REFUSED — "the comp bands are the comp bands" is a fairness commitment with a window: hold
 *   the line for COMP_DISCIPLINE_WINDOW_WEEKS and it settles 'kept' (the fact is the absence of
 *   an exception); grant anyone a special raise inside it and it settles 'broken'. No
 *   promise_made goodwill on this one — being told no buys the founder nothing up front.
 */
export function noteRaiseOutcome(s: GameState, star: Employee, granted: boolean): PromiseRecord | null {
  if (!s.world || !hasCapability(s, 'promises')) return null
  const characterId = stableCastId('emp', star.name, star.role)
  if (!ensureCounterpart(s, { ...employeeSpec(star, { week: s.week, sector: s.config?.sector }), id: characterId })) return null

  if (granted) {
    breakCompDiscipline(s)
    const record = notePromise(s, characterId, {
      summaryKey: PROMISE_KEYS.raise,
      importance: 70,
      emotionalImpact: 50,
      tags: ['promise', 'compensation'],
      facts: { pct: 20 },
    })
    if (record) {
      settlePromise(s, record.id, 'kept')
      feelPromiseFact(s, characterId, 'promise_made', 1, record.id)
      feelPromiseFact(s, characterId, 'promise_kept', 1, record.id)
    }
    return record
  }

  return notePromise(s, characterId, {
    summaryKey: PROMISE_KEYS.compDiscipline,
    dueWeek: s.week + COMP_DISCIPLINE_WINDOW_WEEKS,
    importance: 65,
    emotionalImpact: -35,
    tags: ['promise', 'compensation', 'fairness'],
    facts: {},
  })
}

/** An exception was just made. Every open "the bands are the bands" stance breaks, whoever heard it. */
function breakCompDiscipline(s: GameState): void {
  const world = s.world
  if (!world) return
  for (const p of openPromises(world)) {
    if (p.summaryKey !== PROMISE_KEYS.compDiscipline) continue
    const settled = settlePromise(s, p.id, 'broken')
    if (settled) feelPromiseFact(s, p.characterId, 'promise_broken', settlementMagnitude(settled), settled.id)
  }
}

/**
 * The company-wide cost-of-living adjustment ("They actually did it," someone writes) and the
 * published salary bands share the cola-raise special, and both are commitments delivered on the
 * spot. Recorded against the delegation's spokesperson — deterministically the strongest person
 * on payroll, the same tiebreak the advisor seats use — because the promise index is per-person
 * and the whole team's copy of the moment already lands through the memory the record carries.
 */
export function noteColaAdjustment(s: GameState): PromiseRecord | null {
  if (!s.world || !hasCapability(s, 'promises')) return null
  const spokesperson = [...s.employees].sort(
    (a, b) => b.skill - a.skill || a.name.localeCompare(b.name) || a.role.localeCompare(b.role),
  )[0]
  if (!spokesperson) return null
  const characterId = stableCastId('emp', spokesperson.name, spokesperson.role)
  if (!ensureCounterpart(s, { ...employeeSpec(spokesperson, { week: s.week, sector: s.config?.sector }), id: characterId })) return null
  const record = notePromise(s, characterId, {
    summaryKey: PROMISE_KEYS.cola,
    importance: 55,
    emotionalImpact: 40,
    tags: ['promise', 'compensation', 'fairness'],
    facts: { pct: 5 },
  })
  if (record) {
    settlePromise(s, record.id, 'kept')
    feelPromiseFact(s, characterId, 'promise_made', 0.8, record.id)
    feelPromiseFact(s, characterId, 'promise_kept', 0.8, record.id)
  }
  return record
}

// ---------- settled: once per resolved week, from facts ----------

/**
 * Settle everything the week's facts can judge. Runs inside tickLivingWorld's
 * shouldGenerateForWeek guard, AFTER the simulation resolved the week (the board review has
 * already spoken) and BEFORE the relationship stage, whose tick the returned facts ride so a
 * promise kept or broken this week is felt this week.
 *
 * The verdicts are the simulation's own:
 *   boardGrowth   — the review clears `defied` when the number was delivered; still-defied past
 *                   the due week means the number was not, however the founder survived it.
 *   fundingGrowth — a strike added since the round closed is the review saying "missed".
 *   compDiscipline— reaching the due week still open IS the fact: no exception was made.
 * A board that no longer exists (the token path dissolves it) moots its promises: 'expired'.
 * Anything else past due falls to expireDuePromises' grace, as the data layer always intended.
 */
export function settleWeeklyPromises(s: GameState, world: LivingWorldState): Record<CharacterId, RelationshipFact[]> {
  const felt: Record<CharacterId, RelationshipFact[]> = {}
  if (!hasCapability(s, 'promises')) return felt
  const add = (p: PromiseRecord, kind: RelationshipFactKind) => {
    ;(felt[p.characterId] ??= []).push({ kind, week: s.week, magnitude: settlementMagnitude(p), sourceId: p.id })
  }

  for (const p of openPromises(world)) {
    if (p.dueWeek === undefined || s.week < p.dueWeek) continue
    if (p.summaryKey === PROMISE_KEYS.boardGrowth) {
      if (!s.board) {
        settlePromise(s, p.id, 'expired')
        continue
      }
      const kept = s.gameOver?.type !== 'fired' && !s.board.defied
      const settled = settlePromise(s, p.id, kept ? 'kept' : 'broken')
      if (settled) add(settled, kept ? 'promise_kept' : 'promise_broken')
    } else if (p.summaryKey === PROMISE_KEYS.fundingGrowth) {
      if (!s.board) {
        settlePromise(s, p.id, 'expired')
        continue
      }
      const strikesThen = typeof p.facts?.strikes === 'number' ? p.facts.strikes : 0
      const kept = s.board.strikes <= strikesThen
      const settled = settlePromise(s, p.id, kept ? 'kept' : 'broken')
      if (settled) add(settled, kept ? 'promise_kept' : 'promise_broken')
    } else if (p.summaryKey === PROMISE_KEYS.compDiscipline) {
      const settled = settlePromise(s, p.id, 'kept')
      if (settled) add(settled, 'promise_kept')
    }
  }

  expireDuePromises(world, s.week)
  return felt
}

// ---------- the facts a promise reads with (shared by the panel and the advisors) ----------

/** Same four-week window the board review and the Dashboard already use, re-read from history. */
function monthlyUserGrowth(s: GameState): number {
  const h = s.history
  if (h.length < 5) return 0.05
  const now = h[h.length - 1].users
  const then = h[h.length - 5].users
  if (then <= 0) return now > 0 ? 0.2 : 0
  return clamp((now - then) / then / 4, -0.5, 0.5)
}

function monthlyRevenueGrowth(s: GameState): number {
  const h = s.history
  if (h.length < 5) return 0
  const now = h[h.length - 1].revenue
  const then = h[h.length - 5].revenue
  if (then <= 0) return now > 0 ? 0.2 : 0
  return clamp((now - then) / then / 4, -0.5, 0.5)
}

/** Is a dated board promise currently being delivered? Either yardstick the review accepts counts. */
function boardPromiseOnTrack(s: GameState, p: PromiseRecord): boolean {
  const target = typeof p.facts?.target === 'number' ? p.facts.target : 0
  return monthlyUserGrowth(s) >= target || monthlyRevenueGrowth(s) >= target
}

/** What the commitment is, in words that fit "the {commitment} commitment". */
function commitmentPhrase(p: PromiseRecord): string {
  switch (p.summaryKey) {
    case PROMISE_KEYS.boardGrowth:
      return pctPerWeek(p.facts?.target)
    case PROMISE_KEYS.fundingGrowth:
      return pctPerWeek(p.facts?.target)
    case PROMISE_KEYS.compDiscipline:
      return 'comp-bands'
    case PROMISE_KEYS.raise:
      return 'the raise'
    case PROMISE_KEYS.cola:
      return 'the cost-of-living adjustment'
    default:
      return 'the'
  }
}

// ---------- surfaced 1: the §35 advisor callback ----------

/**
 * At most ONE commitment fact per week, loudest first: this week's verdict if there is one,
 * otherwise the nearest dated commitment inside the warning window. Handed to buildAdvisorPanel
 * by tick.ts, so the seats weigh it like any other fact of the week — the CFO warns, the board
 * chair celebrates or turns cold, and a run without the capability never grows the topic.
 */
export function commitmentAdvisorFacts(s: GameState, world: LivingWorldState): WeekFact[] {
  if (!hasCapability(s, 'promises')) return []

  // A verdict is fresh for exactly one panel. Tick-settled records carry this week's number;
  // records settled by a CHOICE (a granted raise, a cola, a comp-bands stance broken by an
  // exception) resolved after last week's panel was already built, so they carry last week's —
  // and only the kinds a choice can settle are accepted from that window, which is what keeps a
  // tick-settled record from being voiced twice.
  const choiceSettled = (p: PromiseRecord) =>
    p.summaryKey === PROMISE_KEYS.raise ||
    p.summaryKey === PROMISE_KEYS.cola ||
    (p.summaryKey === PROMISE_KEYS.compDiscipline && p.status === 'broken')
  const settled = (world.promises ?? [])
    .filter((p) => p.status === 'kept' || p.status === 'broken')
    .filter((p) => p.resolvedWeek === s.week || (p.resolvedWeek === s.week - 1 && choiceSettled(p)))
    .sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : 1))[0]
  if (settled) {
    const kept = settled.status === 'kept'
    return [
      {
        topic: 'commitment',
        severity: kept ? clamp01(settled.importance / 120) : clamp01(0.5 + settled.importance / 150),
        direction: kept ? 1 : -1,
        slots: { commitment: commitmentPhrase(settled) },
        tags: ['settled'],
      },
    ]
  }

  const WARNING_WINDOW = 4
  const due = openPromises(world).filter(
    (p) =>
      BOARD_PROMISE_KEYS.includes(p.summaryKey) &&
      p.dueWeek !== undefined &&
      p.dueWeek - s.week <= WARNING_WINDOW &&
      p.dueWeek - s.week >= 0,
  )[0] // openPromises already sorts importance-first with a full tiebreak
  if (!due || due.dueWeek === undefined) return []
  const weeksLeft = due.dueWeek - s.week
  const onTrack = boardPromiseOnTrack(s, due)
  return [
    {
      topic: 'commitment',
      severity: onTrack ? 0.4 : clamp01((WARNING_WINDOW + 1 - weeksLeft) / (WARNING_WINDOW + 1)) * 0.9,
      direction: onTrack ? 1 : -1,
      slots: {
        commitment: commitmentPhrase(due),
        duein: weeksLeft === 0 ? 'this week' : weeksLeft === 1 ? 'in 1 week' : `in ${weeksLeft} weeks`,
      },
      tags: ['due'],
    },
  ]
}

// ---------- surfaced 2: the §77 Active Commitments panel ----------

export type CommitmentStatus = 'on_track' | 'at_risk' | 'kept' | 'broken' | 'expired'

export interface CommitmentView {
  /** The PromiseRecord id — stable, so the panel keys on it. */
  id: string
  /** "Deliver 3.1%/wk growth" — §77's first line. */
  title: string
  /** Who heard it. */
  toName: string
  madeWeek: number
  dueWeek?: number
  status: CommitmentStatus
}

function commitmentTitle(p: PromiseRecord): string {
  switch (p.summaryKey) {
    case PROMISE_KEYS.boardGrowth:
      return `Deliver ${pctPerWeek(p.facts?.target)}`
    case PROMISE_KEYS.fundingGrowth: {
      const investor = typeof p.facts?.investor === 'string' ? p.facts.investor : 'the round'
      return `Deliver ${pctPerWeek(p.facts?.target)} for ${investor}`
    }
    case PROMISE_KEYS.compDiscipline:
      return 'Hold the comp bands — no exceptions'
    case PROMISE_KEYS.raise:
      return 'A 20% raise for your star'
    case PROMISE_KEYS.cola:
      return 'A 5% cost-of-living adjustment'
    default:
      // A record from a future phase this build does not know: show its key rather than nothing.
      return p.summaryKey.replace(/_/g, ' ')
  }
}

/**
 * §77, as a pure read. Statuses are deterministic facts (a due week, a growth number, a stored
 * verdict), never seeded prose, so recomputing per render is §68-safe — nothing here can reword
 * itself on reload because nothing here is worded by a draw.
 */
export function commitmentLedger(s: GameState): CommitmentView[] {
  const world = s.world
  if (!world || !hasCapability(s, 'promises')) return []

  const open: CommitmentView[] = []
  const settled: CommitmentView[] = []
  for (const p of world.promises ?? []) {
    const character = world.characters[p.characterId]
    const toName = character ? fullName(character) : 'the board'
    if (p.status === 'open') {
      const dated = BOARD_PROMISE_KEYS.includes(p.summaryKey) && p.dueWeek !== undefined
      open.push({
        id: p.id,
        title: commitmentTitle(p),
        toName,
        madeWeek: p.week,
        dueWeek: p.dueWeek,
        status: dated && !boardPromiseOnTrack(s, p) ? 'at_risk' : 'on_track',
      })
    } else if (p.resolvedWeek !== undefined && s.week - p.resolvedWeek <= COMMITMENT_RECENT_WEEKS) {
      settled.push({
        id: p.id,
        title: commitmentTitle(p),
        toName,
        madeWeek: p.week,
        dueWeek: p.dueWeek,
        status: p.status,
      })
    }
  }

  // Open commitments first, nearest deadline first; then the freshest verdicts. Ids break ties
  // so two renders of the same save can never disagree about the order.
  open.sort((a, b) => (a.dueWeek ?? Infinity) - (b.dueWeek ?? Infinity) || (a.id < b.id ? -1 : 1))
  settled.sort((a, b) => b.madeWeek - a.madeWeek || (a.id < b.id ? -1 : 1))
  return [...open, ...settled].slice(0, COMMITMENT_PANEL_ROWS)
}
