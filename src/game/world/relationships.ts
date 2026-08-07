// The Procedural Living World — relationships (§11).
//
// Four numbers per pair, all 0–100: trust, respect, alignment, dependence. They are stored on the
// character who HOLDS the opinion, so Anna's view of the founder and the founder's view of Anna
// are separate rows and are allowed to disagree.
//
// Three rules shape everything below:
//
//   FACTS ONLY      — the only thing that moves a relationship is a RelationshipFact, and every
//                     fact kind names something the simulation already resolved (a raise was
//                     paid, payroll was missed, a promise came due). Narrative reads these
//                     numbers; it never writes them (§64).
//   NO RANDOMNESS   — there is no rng in this file, deliberately. Variety comes from personality
//                     and background, which were themselves generated from the run seed, so the
//                     same run replayed produces the same relationships without this module
//                     having to consume draws and shift every later roll in the engine.
//   NEVER SHOWN     — values are surfaced as bands ("Trust: Strong"), never as numbers (§11).
//
// Call tickRelationship / tickRelationships exactly once per character per week: decay is applied
// per call, not recomputed from an elapsed-week count. LivingWorldState.lastGeneratedWeek is the
// guard that a reload does not run the same week twice.

import type {
  Character,
  CharacterId,
  CharacterPersonality,
  RelationshipDimension,
  RelationshipScores,
  RelationshipState,
} from './types'
import { FOUNDER_ID } from './types'
import {
  RELATIONSHIP_FACTS,
  type RelationshipFactDef,
  type RelationshipFactKind,
} from './content/relationships-facts'

export type { RelationshipFactKind } from './content/relationships-facts'

export const RELATIONSHIP_DIMENSIONS: readonly RelationshipDimension[] = [
  'trust',
  'respect',
  'alignment',
  'dependence',
]

export const RELATIONSHIP_TUNING = {
  min: 0,
  max: 100,
  /** Baselines never sit at the bounds, or decay would pin a relationship at 0 or 100 forever. */
  baselineMin: 8,
  baselineMax: 92,
  /** New arrivals start above their baseline, and the bonus fades over this many weeks. */
  honeymoonWeeks: 8,
  honeymoon: { trust: 7, respect: 3, alignment: 6, dependence: 2 } as RelationshipScores,
  /** Weeks of silence tolerated before drift toward baseline starts. */
  decayGraceWeeks: 4,
  /** Share of the gap to baseline closed per silent week. Dependence is structural, so it moves fastest. */
  decayPull: { trust: 0.06, respect: 0.05, alignment: 0.05, dependence: 0.08 } as RelationshipScores,
  maxDecayPerWeek: 3,
  /** Losses land harder than equivalent gains. Dependence is a fact about their options, not a feeling. */
  lossWeight: { trust: 1.6, respect: 1.35, alignment: 1.25, dependence: 1 } as RelationshipScores,
  /** A single week cannot swing a dimension further than this, however many facts land in it. */
  maxWeeklyMove: 22,
  /** Bounds on the combined personality/motivation multiplier, so no character is unreachable. */
  minModulation: 0.35,
  maxModulation: 2.2,
  primaryMotiveBonus: 0.5,
  secondaryMotiveBonus: 0.2,
  maxMagnitude: 3,
  /** Band cutoffs, ascending. */
  bands: [20, 40, 60, 80] as const,
} as const

// ---------- facts ----------

/**
 * One thing that happened, as the simulation recorded it. `facts` is carried for the memory and
 * composer modules and is ignored by the arithmetic here — a slot value must never change a score.
 */
export interface RelationshipFact {
  kind: RelationshipFactKind
  week: number
  /** How big it was relative to a typical instance. 0–3, default 1. A 3% raise is 0.4, a 25% raise is 2. */
  magnitude?: number
  /** The other person involved, for peer_departed / peer_laid_off. Not used by the arithmetic. */
  subjectId?: CharacterId
  /** Message.id, narrative id or promise id that produced this, for the postmortem trail. */
  sourceId?: string
  facts?: Record<string, string | number>
}

export interface RelationshipChange {
  before: RelationshipState
  after: RelationshipState
  /** Signed movement per dimension, after every cap. What the director reads to decide who speaks. */
  delta: RelationshipScores
  /** True when any dimension moved at all — the cheap test for "is this worth narrating". */
  moved: boolean
}

// ---------- reading ----------

export type RelationshipBand = 'critical' | 'weak' | 'mixed' | 'good' | 'strong'

export interface RelationshipDimensionSummary {
  dimension: RelationshipDimension
  band: RelationshipBand
  label: string
}

export interface RelationshipSummary {
  /**
   * 0–100 composite. For scoring inside the engine only — §11 forbids showing any of these
   * numbers to the player. Render `label` and the per-dimension labels instead.
   */
  overall: number
  band: RelationshipBand
  label: string
  /** 0–1: how likely this person is to make trouble. High dependence keeps quiet people quiet. */
  strain: number
  dimensions: Record<RelationshipDimension, RelationshipDimensionSummary>
  weeksSinceContact?: number
}

const DIMENSION_LABELS: Record<RelationshipDimension, Record<RelationshipBand, string>> = {
  trust: { critical: 'Broken', weak: 'Fragile', mixed: 'Cautious', good: 'Solid', strong: 'Strong' },
  respect: { critical: 'Lost', weak: 'Low', mixed: 'Measured', good: 'High', strong: 'Deep' },
  alignment: { critical: 'Opposed', weak: 'Drifting', mixed: 'Mixed', good: 'Aligned', strong: 'Committed' },
  dependence: { critical: 'Halfway out', weak: 'Loose', mixed: 'Settled', good: 'Invested', strong: 'All in' },
}

const OVERALL_LABELS: Record<RelationshipBand, string> = {
  critical: 'Hostile',
  weak: 'Strained',
  mixed: 'Neutral',
  good: 'Strong',
  strong: 'Loyal',
}

// ---------- arithmetic ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

/** Map a 0–100 personality dimension onto a multiplier in [1-k, 1+k]. */
const amp = (v: number, k: number) => 1 + ((clamp(v, 0, 100) - 50) / 50) * k

const scores = (r: RelationshipScores): RelationshipScores => ({
  trust: r.trust,
  respect: r.respect,
  alignment: r.alignment,
  dependence: r.dependence,
})

export function relationshipBand(value: number): RelationshipBand {
  const [a, b, c, d] = RELATIONSHIP_TUNING.bands
  if (value < a) return 'critical'
  if (value < b) return 'weak'
  if (value < c) return 'mixed'
  if (value < d) return 'good'
  return 'strong'
}

/** Trust dominates; dependence is barely goodwill at all, so it counts least. */
export function overallRelationship(r: RelationshipScores): number {
  return round2(r.trust * 0.4 + r.respect * 0.25 + r.alignment * 0.25 + r.dependence * 0.1)
}

export function relationshipStrain(r: RelationshipScores): number {
  const raw = ((100 - r.trust) * 0.45 + (100 - r.alignment) * 0.3 + (100 - r.respect) * 0.25) / 100
  // Someone with nowhere to go complains less, whatever they think of you.
  return round2(clamp(raw * (1.15 - r.dependence / 200), 0, 1))
}

export function weeksSinceContact(rel: RelationshipState, week: number): number | undefined {
  if (rel.lastMeaningfulInteractionWeek === undefined) return undefined
  return Math.max(0, week - rel.lastMeaningfulInteractionWeek)
}

export function describeRelationship(rel: RelationshipState, week?: number): RelationshipSummary {
  const overall = overallRelationship(rel)
  const dimensions = {} as Record<RelationshipDimension, RelationshipDimensionSummary>
  for (const d of RELATIONSHIP_DIMENSIONS) {
    const band = relationshipBand(rel[d])
    dimensions[d] = { dimension: d, band, label: DIMENSION_LABELS[d][band] }
  }
  const band = relationshipBand(overall)
  return {
    overall,
    band,
    label: OVERALL_LABELS[band],
    strain: relationshipStrain(rel),
    dimensions,
    weeksSinceContact: week === undefined ? undefined : weeksSinceContact(rel, week),
  }
}

// ---------- initialisation ----------

const STAGE_OFFSETS: Record<string, Partial<RelationshipScores>> = {
  rising: { trust: 2, respect: 4, dependence: 8 },
  established: {},
  veteran: { trust: -2, respect: -6, dependence: -8 },
}

const ENVIRONMENT_OFFSETS: Record<string, Partial<RelationshipScores>> = {
  startup: { alignment: 3, dependence: -3 },
  scaleup: {},
  corporate: { alignment: -3, dependence: 5 },
  consulting: { dependence: -4 },
  agency: { dependence: -2 },
  university: { alignment: 4, dependence: 2 },
}

const JOIN_OFFSETS: Record<string, Partial<RelationshipScores>> = {
  equity: { alignment: 2, dependence: 6 },
  mission: { alignment: 12 },
  the_problem: { alignment: 8 },
  the_founder: { trust: 8, alignment: 5, dependence: 4 },
  escaping_bigco: { alignment: 2, dependence: 6 },
  title: { alignment: -3, dependence: 2 },
  money: { alignment: -5, dependence: 2 },
  learning: { alignment: 3 },
  reputation: { respect: 4, alignment: 2 },
}

const MOTIVE_OFFSETS: Record<string, Partial<RelationshipScores>> = {
  money: { alignment: -4 },
  career_progression: { dependence: 3 },
  status: {},
  autonomy: { dependence: -6 },
  mission: { alignment: 6 },
  learning: { alignment: 2 },
  stability: { dependence: 6 },
  power: { respect: -2, dependence: -3 },
  winning: { respect: -2 },
  recognition: {},
  work_life_balance: { dependence: -2 },
}

// External parties owe the founder nothing: they start further away and need less from you.
const ROLE_OFFSETS: Record<string, Partial<RelationshipScores>> = {
  employee: {},
  executive: { respect: -2, dependence: -4 },
  investor: { trust: -8, alignment: -4, dependence: -15 },
  board_member: { trust: -8, alignment: -4, dependence: -15 },
  customer: { trust: -5, alignment: -8, dependence: -10 },
  rival_founder: { trust: -25, respect: 5, alignment: -30, dependence: -30 },
  recruiter: { trust: -8, dependence: -12 },
  journalist: { trust: -12, alignment: -12, dependence: -18 },
  advisor: { trust: 6, alignment: 4, dependence: -8 },
  founder: {},
}

function addOffsets(into: RelationshipScores, offsets: Partial<RelationshipScores> | undefined): void {
  if (!offsets) return
  for (const d of RELATIONSHIP_DIMENSIONS) {
    const v = offsets[d]
    if (v !== undefined) into[d] += v
  }
}

/**
 * Where this relationship settles when nothing is happening. Decay pulls toward it rather than
 * toward a flat 50, so a loyal true believer and a mercenary veteran drift to different places.
 *
 * Dependence carries a tenure term: the longer someone has been here, the more they have sunk
 * into it. That is why decay quietly raises dependence over a quiet year instead of lowering it.
 */
export function baselineRelationship(character: Character, week: number): RelationshipScores {
  const p = character.personality
  const b = character.background
  const out: RelationshipScores = {
    trust: 46 + (p.loyalty - 50) * 0.2 + (p.optimism - 50) * 0.14 - (p.ego - 50) * 0.06,
    // Big egos are harder to impress and slower to concede competence to anyone else.
    respect: 48 + (p.optimism - 50) * 0.1 - (p.ego - 50) * 0.12,
    alignment: 46 + (p.loyalty - 50) * 0.1 + (p.empathy - 50) * 0.08,
    dependence: 44 - (p.ambition - 50) * 0.14 - (p.riskTolerance - 50) * 0.16,
  }
  addOffsets(out, ROLE_OFFSETS[character.role])
  addOffsets(out, STAGE_OFFSETS[b.careerStage])
  addOffsets(out, ENVIRONMENT_OFFSETS[b.previousEnvironment])
  if (b.reasonForJoining) addOffsets(out, JOIN_OFFSETS[b.reasonForJoining])
  addOffsets(out, MOTIVE_OFFSETS[character.motivations.primary])
  for (const m of character.motivations.secondary) {
    const o = MOTIVE_OFFSETS[m]
    if (o) for (const d of RELATIONSHIP_DIMENSIONS) out[d] += (o[d] ?? 0) * 0.4
  }
  out.dependence -= Math.min(10, Math.max(0, b.yearsExperience) * 0.4)
  out.dependence += Math.min(14, Math.max(0, week - character.createdWeek) * 0.18)

  const { baselineMin, baselineMax } = RELATIONSHIP_TUNING
  for (const d of RELATIONSHIP_DIMENSIONS) out[d] = round2(clamp(out[d], baselineMin, baselineMax))
  return out
}

/**
 * The row a character starts with. Above baseline while the honeymoon lasts — people arrive
 * optimistic, and the fade is what makes an unattended good hire slowly stop being one.
 */
export function initialRelationship(
  character: Character,
  week: number,
  towardId: CharacterId = FOUNDER_ID,
): RelationshipState {
  const base = baselineRelationship(character, week)
  const elapsed = Math.max(0, week - character.createdWeek)
  const fade = Math.max(0, 1 - elapsed / RELATIONSHIP_TUNING.honeymoonWeeks)
  const { min, max, honeymoon } = RELATIONSHIP_TUNING
  const out: RelationshipState = {
    characterId: towardId,
    trust: round2(clamp(base.trust + honeymoon.trust * fade, min, max)),
    respect: round2(clamp(base.respect + honeymoon.respect * fade, min, max)),
    alignment: round2(clamp(base.alignment + honeymoon.alignment * fade, min, max)),
    dependence: round2(clamp(base.dependence + honeymoon.dependence * fade, min, max)),
    lastMeaningfulInteractionWeek: character.createdWeek,
  }
  return out
}

// ---------- access ----------

export function findRelationship(
  character: Character,
  towardId: CharacterId = FOUNDER_ID,
): RelationshipState | undefined {
  return character.relationships?.find((r) => r.characterId === towardId)
}

/**
 * The row, or a freshly derived one if the character has never had this relationship written.
 * Readers must never assume the row exists: characters generated before this module shipped, and
 * characters whose row was dropped by a save migration, both come back empty.
 */
export function relationshipWith(
  character: Character,
  week: number,
  towardId: CharacterId = FOUNDER_ID,
): RelationshipState {
  return findRelationship(character, towardId) ?? initialRelationship(character, week, towardId)
}

/** Pure: returns a new Character with this row replaced or added. Rows are kept sorted by id. */
export function upsertRelationship(character: Character, rel: RelationshipState): Character {
  const rest = (character.relationships ?? []).filter((r) => r.characterId !== rel.characterId)
  const relationships = [...rest, rel].sort((a, b) => (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0))
  return { ...character, relationships }
}

// ---------- movement ----------

/**
 * How hard this person feels a given fact. Personality decides the shape of the reaction and
 * motivation decides the volume; neither can flip the sign, because the sign is a fact.
 */
function modulation(
  p: CharacterPersonality,
  def: RelationshipFactDef,
  character: Character,
  dim: RelationshipDimension,
  sign: number,
): number {
  let m = 1
  const tags = def.tags
  if (tags.includes('status') || tags.includes('promotion')) m *= amp(p.ego, 0.35) * amp(p.ambition, 0.25)
  if (tags.includes('recognition')) m *= amp(p.ego, 0.25)
  if (tags.includes('peer')) m *= amp(p.empathy, 0.4)
  if (tags.includes('fairness')) m *= amp(p.directness, 0.15)

  if (sign < 0) {
    // Patience, optimism and loyalty are all forms of absorbing a bad week.
    m *= amp(100 - p.patience, 0.25)
    m *= amp(100 - p.optimism, 0.2)
    if (dim === 'trust') m *= amp(100 - p.loyalty, 0.3)
    if (tags.includes('risk')) m *= amp(100 - p.riskTolerance, 0.35)
    if (tags.includes('workload')) m *= amp(100 - p.patience, 0.2)
  } else {
    m *= amp(p.optimism, 0.15)
    if (dim === 'trust') m *= amp(p.loyalty, 0.15)
  }

  if (def.motives?.length) {
    const { primary, secondary } = character.motivations
    if (def.motives.includes(primary)) m *= 1 + RELATIONSHIP_TUNING.primaryMotiveBonus
    else if (secondary.some((s) => def.motives?.includes(s))) m *= 1 + RELATIONSHIP_TUNING.secondaryMotiveBonus
  }

  return clamp(m, RELATIONSHIP_TUNING.minModulation, RELATIONSHIP_TUNING.maxModulation)
}

/** The modulated movement one fact wants, before headroom scaling and weekly caps. */
export function factDelta(character: Character, fact: RelationshipFact): RelationshipScores {
  const def = RELATIONSHIP_FACTS[fact.kind] as RelationshipFactDef | undefined
  const out: RelationshipScores = { trust: 0, respect: 0, alignment: 0, dependence: 0 }
  if (!def) return out
  const magnitude = clamp(fact.magnitude ?? 1, 0, RELATIONSHIP_TUNING.maxMagnitude)
  if (magnitude === 0) return out
  for (const d of RELATIONSHIP_DIMENSIONS) {
    const base = def.base[d]
    if (!base) continue
    const sign = Math.sign(base)
    const loss = sign < 0 ? RELATIONSHIP_TUNING.lossWeight[d] : 1
    out[d] = round2(base * magnitude * loss * modulation(character.personality, def, character, d, sign))
  }
  return out
}

/**
 * Move a dimension, scaled by how much room is left in that direction. Going from 50 to 55 is
 * ordinary; going from 90 to 95 takes three times the event. Keeps the 0–100 bounds meaningful
 * instead of letting a run of good weeks park everyone at 100.
 */
function moveDimension(current: number, delta: number): number {
  if (delta === 0) return current
  const { min, max } = RELATIONSHIP_TUNING
  const headroom = delta > 0 ? (max - current) / (max - min) : (current - min) / (max - min)
  return clamp(current + delta * (0.4 + 0.6 * clamp(headroom, 0, 1)), min, max)
}

/**
 * Drift toward baseline during silence. Proportional, so it asymptotes instead of overshooting,
 * and loyal people hold their opinion of you far longer than fickle ones.
 */
export function decayRelationship(rel: RelationshipState, character: Character, week: number): RelationshipState {
  const last = rel.lastMeaningfulInteractionWeek ?? character.createdWeek
  const idle = week - last
  if (idle <= RELATIONSHIP_TUNING.decayGraceWeeks) return rel
  const base = baselineRelationship(character, week)
  const loyalty = amp(100 - character.personality.loyalty, 0.5)
  const out: RelationshipState = { ...rel }
  for (const d of RELATIONSHIP_DIMENSIONS) {
    const pull = RELATIONSHIP_TUNING.decayPull[d] * (d === 'trust' || d === 'alignment' ? loyalty : 1)
    const step = clamp(
      (base[d] - rel[d]) * pull,
      -RELATIONSHIP_TUNING.maxDecayPerWeek,
      RELATIONSHIP_TUNING.maxDecayPerWeek,
    )
    out[d] = round2(clamp(rel[d] + step, RELATIONSHIP_TUNING.min, RELATIONSHIP_TUNING.max))
  }
  return out
}

/**
 * Apply one week's facts. Facts are stable-sorted by week so a caller that merged several
 * sources cannot change the outcome by changing the merge order; within a week the caller's
 * order is preserved, because "promise broken then apologised for" is not the same story as the
 * reverse.
 */
export function applyRelationshipFacts(
  rel: RelationshipState,
  character: Character,
  facts: readonly RelationshipFact[],
  week: number,
): RelationshipChange {
  const before: RelationshipState = { ...rel }
  const working = scores(rel)
  let interacted = false

  for (const fact of [...facts].sort((a, b) => a.week - b.week)) {
    const def = RELATIONSHIP_FACTS[fact.kind] as RelationshipFactDef | undefined
    if (!def) continue
    const delta = factDelta(character, fact)
    for (const d of RELATIONSHIP_DIMENSIONS) working[d] = moveDimension(working[d], delta[d])
    if (def.interaction) interacted = true
  }

  const after: RelationshipState = { ...before }
  const delta: RelationshipScores = { trust: 0, respect: 0, alignment: 0, dependence: 0 }
  const cap = RELATIONSHIP_TUNING.maxWeeklyMove
  let moved = false
  for (const d of RELATIONSHIP_DIMENSIONS) {
    const capped = clamp(working[d] - before[d], -cap, cap)
    delta[d] = round2(capped)
    after[d] = round2(clamp(before[d] + capped, RELATIONSHIP_TUNING.min, RELATIONSHIP_TUNING.max))
    if (delta[d] !== 0) moved = true
  }
  if (interacted) after.lastMeaningfulInteractionWeek = week

  return { before, after, delta, moved }
}

/**
 * One character, one week: silence first, then whatever happened. Decay runs before the facts so
 * a week in which something finally happens is not also charged for the silence that preceded it.
 */
export function tickRelationship(
  character: Character,
  week: number,
  facts: readonly RelationshipFact[] = [],
  towardId: CharacterId = FOUNDER_ID,
): RelationshipChange {
  const start = relationshipWith(character, week, towardId)
  const decayed = decayRelationship(start, character, week)
  const change = applyRelationshipFacts(decayed, character, facts, week)
  // Report the delta against where the week started, not against the post-decay value: the
  // director wants to know how the week moved things, and drift is part of the week.
  const delta: RelationshipScores = { trust: 0, respect: 0, alignment: 0, dependence: 0 }
  let moved = false
  for (const d of RELATIONSHIP_DIMENSIONS) {
    delta[d] = round2(change.after[d] - start[d])
    if (delta[d] !== 0) moved = true
  }
  return { before: start, after: change.after, delta, moved }
}

export interface RelationshipTickInput {
  week: number
  /** Facts about one specific person, keyed by that person's CharacterId. */
  personal?: Record<CharacterId, readonly RelationshipFact[]>
  /**
   * Facts the whole company lived through. Applied to every active character at the player's
   * company who was already here when it happened — a hire who arrives after the layoffs did
   * not live through them.
   */
  company?: readonly RelationshipFact[]
}

export interface RelationshipTickResult {
  characters: Record<CharacterId, Character>
  /** Only characters whose relationship actually moved, so the director has a short list. */
  changes: Record<CharacterId, RelationshipChange>
}

/**
 * The whole cast, one week. Pure: returns new objects and never mutates the input.
 *
 * Keys are walked in sorted order rather than insertion order. There is no randomness here so it
 * cannot change the result today, but the rest of the subsystem holds that rule and a divergence
 * would be a silent one.
 */
export function tickRelationships(
  cast: Record<CharacterId, Character>,
  input: RelationshipTickInput,
): RelationshipTickResult {
  const { week } = input
  const characters: Record<CharacterId, Character> = {}
  const changes: Record<CharacterId, RelationshipChange> = {}

  for (const id of Object.keys(cast).sort()) {
    const character = cast[id]
    if (!character || id === FOUNDER_ID) {
      characters[id] = character
      continue
    }
    const personal = input.personal?.[id] ?? []
    const livesHere = !character.companyId && character.status === 'active'
    const shared = livesHere ? (input.company ?? []).filter((f) => f.week >= character.createdWeek) : []
    const facts = shared.length ? [...personal, ...shared] : personal

    const change = tickRelationship(character, week, facts)
    characters[id] = change.moved ? upsertRelationship(character, change.after) : character
    if (change.moved) changes[id] = change
  }

  return { characters, changes }
}

// ---------- save tolerance ----------

const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, RELATIONSHIP_TUNING.min, RELATIONSHIP_TUNING.max) : fallback

/**
 * Coerce one persisted row back into shape. Saves written by an older build, by a modified
 * localStorage blob or by a peer on a different version can carry anything; a row we cannot
 * identify is dropped rather than guessed at.
 */
export function normalizeRelationshipState(raw: unknown): RelationshipState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<RelationshipState>
  if (typeof r.characterId !== 'string' || !r.characterId) return null
  const week = r.lastMeaningfulInteractionWeek
  return {
    characterId: r.characterId,
    trust: finite(r.trust, 50),
    respect: finite(r.respect, 50),
    alignment: finite(r.alignment, 50),
    dependence: finite(r.dependence, 50),
    lastMeaningfulInteractionWeek:
      typeof week === 'number' && Number.isFinite(week) ? Math.max(0, Math.floor(week)) : undefined,
  }
}

/** Drops unreadable rows and de-duplicates by target, keeping the last row written for each. */
export function normalizeRelationships(raw: unknown): RelationshipState[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<CharacterId, RelationshipState>()
  for (const row of raw) {
    const rel = normalizeRelationshipState(row)
    if (rel) byId.set(rel.characterId, rel)
  }
  return [...byId.values()].sort((a, b) => (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0))
}
