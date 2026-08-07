// The Procedural Living World — deterministic character generation (§5–§10).
//
// A person is a pure function of (campaign seed, identity key). Every function here is pure,
// takes no state, touches no React, and never calls Math.random or the global RNG hook — it
// builds its own mulberry32 stream from an FNV-1a hash the way career/segments.ts does. That is
// what makes "the same save reloaded" and "the same seed replayed" produce the identical person.
//
// The identity key is deliberately NOT the entity id. Employee and candidate ids come from
// `uid()`, which mixes Date.now() and Math.random() — keying on them would survive a reload but
// not a replay. The key is built instead from the facts the seeded simulation itself produced
// (name, role, discipline, skill, trait, sector, company), all of which are stable for the whole
// life of the person. See `characterIdentityKey`.
//
// Nothing here decides an outcome (§64). Personality, motivations and background are read by the
// composer to interpret events the simulation has already resolved.

import type { Candidate, Employee, FounderKind, Rival, Role, SectorId, TraitId } from '../types'
import {
  FOUNDER_ID,
  type BackgroundStrength,
  type BackgroundWeakness,
  type CareerStage,
  type Character,
  type CharacterBackground,
  type CharacterId,
  type CharacterMotivation,
  type CharacterMotivations,
  type CharacterPersonality,
  type CharacterRole,
  type CharacterStatus,
  type CommunicationStyle,
  type CompanyId,
  type JoinMotivation,
  type PersonalityDimension,
  type PreviousEnvironment,
  type RivalArchetype,
} from './types'
import {
  CAREER_STAGE_BOUNDS,
  COMMUNICATION_STYLES,
  EMPLOYEE_TITLES,
  ENV_BY_JOB_ROLE,
  ENV_BY_ROLE,
  ENV_BY_SECTOR,
  ENV_BY_STAGE,
  JOINING_ROLES,
  JOIN_FOR_FOUNDER_WEIGHT,
  JOIN_FROM_MOTIVATION,
  JOB_ROLE_PERSONALITY,
  MOTIVATIONS,
  MOTIVATION_AFFINITY,
  MOTIVATION_CONFLICTS,
  MOTIVATION_ROLE_BIAS,
  PERSONALITY_DIMENSIONS,
  PREVIOUS_ENVIRONMENTS,
  RIVAL_ARCHETYPES,
  RIVAL_ARCHETYPE_AFFINITY,
  RIVAL_ARCHETYPE_MOMENTUM,
  ROLE_PERSONALITY,
  ROLE_SPREAD,
  ROLE_TITLES,
  ROLE_YEARS,
  STRENGTH_PROFILE,
  STYLE_AFFINITY,
  STYLE_ROLE_BIAS,
  TRAIT_PERSONALITY,
  WEAKNESS_CHANCE,
  WEAKNESS_PROFILE,
  type Affinity,
  type BackgroundProfile,
  type PersonalityWeights,
} from './content/characters-archetypes'
import {
  BIO_JOIN_REASONS,
  BIO_OPENINGS,
  BIO_STRENGTHS,
  BIO_WEAKNESSES,
  FIRST_NAMES,
  GENERIC_WORK_PHRASE,
  LAST_NAMES,
  MOTIVATION_LABEL,
  NUMBER_WORDS,
  OBSERVATIONS,
  STYLE_OBSERVATION,
  WORK_PHRASE,
  type ObservationBand,
} from './content/characters-prose'

export { PERSONALITY_DIMENSIONS } from './content/characters-archetypes'

// ---------- deterministic plumbing ----------

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One independent stream per aspect. Splitting them means adding a background field later cannot
 * shift the personality of everyone already generated from the same seed — the draws for
 * 'personality' never advance the 'background' stream.
 */
function stream(key: string, aspect: string): () => number {
  return prng(hashString(`${key}|${aspect}`))
}

function pickOne<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]
}

interface Weighted<T> {
  value: T
  weight: number
}

/** Weights below the floor stay reachable: a table should bias the cast, never erase an option. */
function weightedPick<T>(entries: readonly Weighted<T>[], rng: () => number, floor = 0.05): T {
  let total = 0
  for (const e of entries) total += Math.max(floor, e.weight)
  let roll = rng() * total
  for (const e of entries) {
    roll -= Math.max(floor, e.weight)
    if (roll <= 0) return e.value
  }
  return entries[entries.length - 1].value
}

/** Personality scores enter every affinity table normalised to -1..1 around the neutral 50. */
function affinityScore(a: Affinity, p: CharacterPersonality): number {
  let score = a.base
  for (const dim of PERSONALITY_DIMENSIONS) {
    const coeff = a.from[dim]
    if (coeff !== undefined) score += coeff * ((p[dim] - 50) / 50)
  }
  return score
}

// ---------- identity ----------

export interface CharacterSpec {
  /** The entity's own id (Employee/Candidate/Rival). Used as the map key, not as the seed input. */
  id: CharacterId
  role: CharacterRole
  /** "Elena Novak" from the simulation. Split into first/last; generated when absent. */
  name?: string
  /** The sim's four-value discipline. Shapes personality, background and title. */
  jobRole?: Role
  skill?: number
  trait?: TraitId | null
  companyId?: CompanyId
  title?: string
  status?: CharacterStatus
  archetype?: RivalArchetype
  /** For anonymous cast members with no name: the §6 character index. */
  index?: number
  createdWeek?: number
  /**
   * Pass `config.sector`, never `state.sector`: a pivot changes the live sector, and a person's
   * history must not be rewritten because the company moved market.
   */
  sector?: SectorId
  /** Escape hatch when the caller has a better stable key than the derived one (Arena's `mk-w-i`). */
  identityKey?: string
}

export interface GenerateCharacterArgs extends CharacterSpec {
  seed: number
}

/**
 * The reproducibility anchor. Built from seed-derived, life-of-the-person-stable facts so a
 * replay of the same campaign produces the same cast even though `uid()` hands out different ids
 * every run. Falls back to the index (§6) and then to the raw id when there is no name.
 */
export function characterIdentityKey(args: GenerateCharacterArgs): string {
  if (args.identityKey) return `${args.seed}|${args.identityKey}`
  const who = args.name ?? (args.index !== undefined ? `idx${args.index}` : args.id)
  return [
    args.seed,
    args.sector ?? 'any',
    args.companyId ?? 'self',
    args.role,
    who,
    args.jobRole ?? '-',
    args.skill ?? '-',
    args.trait ?? '-',
  ].join('|')
}

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim()
  const cut = trimmed.indexOf(' ')
  if (cut < 0) return { firstName: trimmed, lastName: '' }
  return { firstName: trimmed.slice(0, cut), lastName: trimmed.slice(cut + 1).trim() }
}

function generateName(key: string): { firstName: string; lastName: string } {
  const rng = stream(key, 'name')
  return { firstName: pickOne(FIRST_NAMES, rng), lastName: pickOne(LAST_NAMES, rng) }
}

export const fullName = (c: Character): string => (c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName)

// ---------- personality ----------

function applyWeights(base: CharacterPersonality, w: PersonalityWeights | undefined): void {
  if (!w) return
  for (const dim of PERSONALITY_DIMENSIONS) {
    const delta = w[dim]
    if (delta !== undefined) base[dim] += delta
  }
}

function buildPersonality(args: GenerateCharacterArgs, rng: () => number): CharacterPersonality {
  const base: CharacterPersonality = { ...ROLE_PERSONALITY[args.role] }
  if (args.jobRole) applyWeights(base, JOB_ROLE_PERSONALITY[args.jobRole])
  if (args.trait) applyWeights(base, TRAIT_PERSONALITY[args.trait])
  // Skill is visible on the Team screen, so it has to be visible in the person: strong people
  // know it. Bounded deliberately — this nudges, the trait decides.
  if (args.skill !== undefined) {
    const edge = clamp(args.skill, 1, 10) - 5.5
    base.ambition += edge * 1.6
    base.ego += edge * 2.0
  }
  const spread = ROLE_SPREAD[args.role]
  const out = {} as CharacterPersonality
  for (const dim of PERSONALITY_DIMENSIONS) out[dim] = clamp(Math.round(base[dim] + (rng() * 2 - 1) * spread))
  return out
}

// ---------- communication style ----------

function buildStyle(p: CharacterPersonality, role: CharacterRole, rng: () => number): CommunicationStyle {
  const roleBias = STYLE_ROLE_BIAS[role]
  const entries = COMMUNICATION_STYLES.map((style) => ({
    value: style,
    weight: affinityScore(STYLE_AFFINITY[style], p) + (roleBias?.[style] ?? 0),
  }))
  return weightedPick(entries, rng, 0.12)
}

// ---------- motivations ----------

function conflictsWith(m: CharacterMotivation): CharacterMotivation[] {
  const out: CharacterMotivation[] = []
  for (const [a, b] of MOTIVATION_CONFLICTS) {
    if (a === m) out.push(b)
    else if (b === m) out.push(a)
  }
  return out
}

function buildMotivations(p: CharacterPersonality, role: CharacterRole, rng: () => number): CharacterMotivations {
  const roleBias = MOTIVATION_ROLE_BIAS[role]
  const scored = MOTIVATIONS.map((m) => ({ value: m, weight: affinityScore(MOTIVATION_AFFINITY[m], p) + (roleBias[m] ?? 0) }))
  const primary = weightedPick(scored, rng, 0.05)

  const blocked = new Set<CharacterMotivation>([primary, ...conflictsWith(primary)])
  const secondary: CharacterMotivation[] = []
  // Two secondaries most of the time: a single supporting motivation makes people read as
  // one-note, and the type caps the list at two anyway.
  const wanted = rng() < 0.7 ? 2 : 1
  for (let i = 0; i < wanted; i++) {
    const pool = scored.filter((s) => !blocked.has(s.value))
    if (pool.length === 0) break
    const next = weightedPick(pool, rng, 0.05)
    secondary.push(next)
    blocked.add(next)
    for (const c of conflictsWith(next)) blocked.add(c)
  }
  return { primary, secondary }
}

// ---------- background ----------

function careerStageFor(years: number): CareerStage {
  if (years < CAREER_STAGE_BOUNDS.rising) return 'rising'
  if (years < CAREER_STAGE_BOUNDS.established) return 'established'
  return 'veteran'
}

function profileWeight(
  profile: BackgroundProfile,
  p: CharacterPersonality,
  ctx: { jobRole?: Role; role: CharacterRole; env: PreviousEnvironment; stage: CareerStage },
): number {
  let w = 1 + affinityScore({ base: 0, from: profile.from }, p)
  if (profile.jobRoles && ctx.jobRole && profile.jobRoles.includes(ctx.jobRole)) w += 1.2
  if (profile.roles && profile.roles.includes(ctx.role)) w += 0.8
  if (profile.envs && profile.envs.includes(ctx.env)) w += 0.8
  if (profile.stages && !profile.stages.includes(ctx.stage)) w -= 0.9
  return w
}

function buildBackground(
  args: GenerateCharacterArgs,
  p: CharacterPersonality,
  motivations: CharacterMotivations,
  rng: () => number,
): CharacterBackground {
  const [floor, span] = ROLE_YEARS[args.role]
  const skillEdge = args.skill === undefined ? 0 : (clamp(args.skill, 1, 10) - 5.5) * 0.8
  const yearsExperience = Math.max(1, Math.min(40, Math.round(floor + rng() * span + skillEdge)))
  const careerStage = careerStageFor(yearsExperience)

  const envEntries = PREVIOUS_ENVIRONMENTS.map((env) => ({
    value: env,
    weight:
      ENV_BY_STAGE[careerStage][env] +
      (args.jobRole ? (ENV_BY_JOB_ROLE[args.jobRole][env] ?? 0) : 0) +
      (ENV_BY_ROLE[args.role]?.[env] ?? 0) +
      (args.sector ? (ENV_BY_SECTOR[args.sector][env] ?? 0) : 0),
  }))
  const previousEnvironment = weightedPick(envEntries, rng, 0.1)

  const ctx = { jobRole: args.jobRole, role: args.role, env: previousEnvironment, stage: careerStage }
  const notableStrength = weightedPick(
    (Object.keys(STRENGTH_PROFILE) as BackgroundStrength[])
      .sort()
      .map((s) => ({ value: s, weight: profileWeight(STRENGTH_PROFILE[s], p, ctx) })),
    rng,
    0.08,
  )

  const hasWeakness = rng() < WEAKNESS_CHANCE
  const knownWeakness = hasWeakness
    ? weightedPick(
        (Object.keys(WEAKNESS_PROFILE) as BackgroundWeakness[])
          .sort()
          .map((w) => ({ value: w, weight: profileWeight(WEAKNESS_PROFILE[w], p, ctx) })),
        rng,
        0.08,
      )
    : undefined

  const background: CharacterBackground = { careerStage, previousEnvironment, yearsExperience, notableStrength }
  if (knownWeakness) background.knownWeakness = knownWeakness
  if (JOINING_ROLES.includes(args.role)) background.reasonForJoining = buildJoinReason(motivations, rng)
  return background
}

function buildJoinReason(motivations: CharacterMotivations, rng: () => number): JoinMotivation {
  const weights = new Map<JoinMotivation, number>()
  const add = (j: JoinMotivation, w: number) => weights.set(j, (weights.get(j) ?? 0) + w)
  for (const j of JOIN_FROM_MOTIVATION[motivations.primary]) add(j, 1)
  for (const m of motivations.secondary) for (const j of JOIN_FROM_MOTIVATION[m]) add(j, 0.5)
  add('the_founder', JOIN_FOR_FOUNDER_WEIGHT)
  const entries = [...weights.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, weight]) => ({ value, weight }))
  return weightedPick(entries, rng, 0.05)
}

// ---------- titles ----------

function buildTitle(args: GenerateCharacterArgs, stage: CareerStage, rng: () => number): string {
  if (args.title) return args.title
  if ((args.role === 'employee' || args.role === 'executive') && args.jobRole) {
    // An executive is the top of their discipline's ladder whatever their years say.
    const band = args.role === 'executive' ? 'veteran' : stage
    return pickOne(EMPLOYEE_TITLES[args.jobRole][band], rng)
  }
  return pickOne(ROLE_TITLES[args.role], rng)
}

// ---------- generation ----------

/**
 * Build a person. Pure: the same arguments always return an identical object, so a caller may
 * regenerate rather than persist if it wants to — but §5 is explicit that the cast persists, and
 * `ensureCast` is the intended entry point for anything the player has already met.
 */
export function generateCharacter(args: GenerateCharacterArgs): Character {
  const key = characterIdentityKey(args)
  const { firstName, lastName } = args.name ? splitName(args.name) : generateName(key)
  const personality = buildPersonality(args, stream(key, 'personality'))
  const communicationStyle = buildStyle(personality, args.role, stream(key, 'style'))
  const motivations = buildMotivations(personality, args.role, stream(key, 'motivation'))
  const background = buildBackground(args, personality, motivations, stream(key, 'background'))

  const c: Character = {
    id: args.id,
    firstName,
    lastName,
    role: args.role,
    personality,
    motivations,
    communicationStyle,
    background,
    relationships: [],
    memories: [],
    status: args.status ?? 'active',
    createdWeek: args.createdWeek ?? 0,
  }
  if (args.companyId !== undefined) c.companyId = args.companyId
  c.title = buildTitle(args, background.careerStage, stream(key, 'title'))
  if (args.trait !== undefined) c.trait = args.trait
  if (args.archetype !== undefined) c.archetype = args.archetype
  return c
}

// ---------- mapping the simulation's people ----------
//
// The Employee/Candidate/Rival types are untouched: a character is derived from them and keyed
// by the SAME id, which is why hire (which reuses the candidate's id) needs no re-linking.

export interface DeriveOptions {
  week?: number
  /** `config.sector`, not `state.sector` — see CharacterSpec.sector. */
  sector?: SectorId
  title?: string
}

export function employeeSpec(e: Employee, opts: DeriveOptions = {}): CharacterSpec {
  return {
    id: e.id,
    role: 'employee',
    name: e.name,
    jobRole: e.role,
    skill: e.skill,
    trait: e.trait ?? null,
    status: 'active',
    // e.weeks is tenure, so the join week is recoverable without storing anything new.
    createdWeek: Math.max(0, (opts.week ?? e.weeks) - e.weeks),
    sector: opts.sector,
    title: opts.title,
  }
}

export function candidateSpec(c: Candidate, opts: DeriveOptions = {}): CharacterSpec {
  return {
    id: c.id,
    role: 'employee',
    name: c.name,
    jobRole: c.role,
    skill: c.skill,
    trait: c.trait ?? null,
    status: 'prospect',
    createdWeek: opts.week ?? 0,
    sector: opts.sector,
    title: opts.title,
  }
}

/**
 * Keyed on the rival's COMPANY NAME, not its id: `makeRivals` picks the name with a seeded draw
 * but hands out a `uid()` id, so the name is the only part of a rival that survives a replay.
 */
export function rivalSpec(seed: number, r: Rival, opts: DeriveOptions = {}): CharacterSpec {
  return {
    id: r.id,
    role: 'rival_founder',
    // r.name is the COMPANY. The founder behind it gets their own generated name.
    companyId: r.id,
    status: r.alive ? 'active' : 'departed',
    createdWeek: opts.week ?? 0,
    sector: opts.sector,
    // Momentum is a simulation fact, so it may only pick the label, never change the number.
    archetype: deriveRivalArchetype(seed, r.name, r.momentum),
    identityKey: `rival|${r.name}`,
    title: opts.title,
  }
}

export function founderSpec(kind: FounderKind, opts: DeriveOptions & { name?: string } = {}): CharacterSpec {
  return {
    id: FOUNDER_ID,
    role: 'founder',
    name: opts.name,
    jobRole: kind === 'technical' ? 'engineer' : 'sales',
    status: 'active',
    createdWeek: 0,
    sector: opts.sector,
    identityKey: `founder|${kind}`,
  }
}

export const characterFromEmployee = (seed: number, e: Employee, opts?: DeriveOptions): Character =>
  generateCharacter({ seed, ...employeeSpec(e, opts) })

export const characterFromCandidate = (seed: number, c: Candidate, opts?: DeriveOptions): Character =>
  generateCharacter({ seed, ...candidateSpec(c, opts) })

export const characterFromRival = (seed: number, r: Rival, opts?: DeriveOptions): Character =>
  generateCharacter({ seed, ...rivalSpec(seed, r, opts) })

export const createFounderCharacter = (seed: number, kind: FounderKind, opts?: DeriveOptions & { name?: string }): Character =>
  generateCharacter({ seed, ...founderSpec(kind, opts) })

/**
 * A rival's narrative posture. Derived from the founder the same seed would have produced, so a
 * rival's archetype is stable for the campaign and consistent with how their founder talks.
 */
export function deriveRivalArchetype(seed: number, rivalName: string, momentum: number): RivalArchetype {
  // Same key and same aspect as the generated founder, so the posture matches the person.
  const key = `${seed}|rival|${rivalName}`
  const p = buildPersonality({ seed, id: rivalName, role: 'rival_founder' }, stream(key, 'personality'))
  const lean = Math.max(-0.6, Math.min(0.8, momentum - 1))
  const entries = RIVAL_ARCHETYPES.map((a) => ({
    value: a,
    weight: affinityScore(RIVAL_ARCHETYPE_AFFINITY[a], p) + RIVAL_ARCHETYPE_MOMENTUM[a] * lean,
  }))
  return weightedPick(entries, stream(key, 'archetype'), 0.1)
}

// ---------- the persistent cast ----------

export interface EnsureCastOptions {
  /**
   * Roles whose members are marked departed when they vanish from `specs`. Nothing is retired by
   * default: a caller that passes only this week's employees must not accidentally bury the board.
   */
  retireMissingRoles?: readonly CharacterRole[]
}

/**
 * Reconcile the persisted cast against who the simulation currently knows about. §5: people are
 * generated ONCE and then remembered — an existing character is never re-rolled, only its mirrors
 * of simulation truth (status, trait, company, an explicitly supplied title) are refreshed, and
 * departures are recorded rather than deleted so other characters can still remember them.
 */
export function ensureCast(
  seed: number,
  existing: Record<CharacterId, Character> | undefined,
  specs: readonly CharacterSpec[],
  week: number,
  opts: EnsureCastOptions = {},
): Record<CharacterId, Character> {
  const out: Record<CharacterId, Character> = { ...(existing ?? {}) }
  const taken = new Set<string>()
  for (const id of Object.keys(out).sort()) if (out[id].status !== 'departed') taken.add(out[id].firstName)

  // Sorted so the name de-duplication below cannot depend on the caller's array order.
  const ordered = [...specs].sort((a, b) => a.id.localeCompare(b.id))
  const present = new Set(ordered.map((s) => s.id))

  for (const spec of ordered) {
    const prior = out[spec.id]
    if (prior) {
      out[spec.id] = refreshCharacter(prior, spec, week)
      if (out[spec.id].status !== 'departed') taken.add(out[spec.id].firstName)
      continue
    }
    let made = generateCharacter({ seed, ...spec, createdWeek: spec.createdWeek ?? week })
    if (taken.has(made.firstName) && !spec.name) made = renameAround(made, taken, characterIdentityKey({ seed, ...spec }))
    taken.add(made.firstName)
    out[spec.id] = made
  }

  const retire = opts.retireMissingRoles
  if (retire && retire.length > 0) {
    for (const id of Object.keys(out).sort()) {
      const c = out[id]
      if (present.has(id) || c.status === 'departed' || !retire.includes(c.role)) continue
      out[id] = { ...c, status: 'departed', departedWeek: week }
    }
  }
  return out
}

function refreshCharacter(prior: Character, spec: CharacterSpec, week: number): Character {
  const status = spec.status ?? prior.status
  const trait = spec.trait !== undefined ? spec.trait : prior.trait
  const title = spec.title ?? prior.title
  const companyId = spec.companyId ?? prior.companyId
  const departing = status === 'departed' && prior.status !== 'departed'
  const returning = status !== 'departed' && prior.status === 'departed'
  if (status === prior.status && trait === prior.trait && title === prior.title && companyId === prior.companyId) return prior
  const next: Character = { ...prior, status, trait, title, companyId }
  if (departing) next.departedWeek = week
  if (returning) delete next.departedWeek
  return next
}

/** Walk the name pool from a seeded offset until a free first name turns up. Deterministic. */
function renameAround(c: Character, taken: Set<string>, key: string): Character {
  const start = Math.floor(stream(key, 'rename')() * FIRST_NAMES.length)
  for (let i = 0; i < FIRST_NAMES.length; i++) {
    const candidate = FIRST_NAMES[(start + i) % FIRST_NAMES.length]
    if (!taken.has(candidate)) return { ...c, firstName: candidate }
  }
  return c
}

// ---------- readable output (§7: never show the numbers) ----------

export function personalityBand(v: number): ObservationBand {
  if (v >= 78) return 'very_high'
  if (v >= 62) return 'high'
  if (v <= 22) return 'very_low'
  if (v <= 38) return 'low'
  return 'mid'
}

/**
 * The strongest few traits, phrased. Ordered by distance from neutral so the list leads with what
 * actually distinguishes this person. The phrasing variant comes from the character's own name
 * and score rather than an RNG, so repeated renders are identical without caching.
 */
export function describePersonality(c: Character, max = 4): string[] {
  const ranked = PERSONALITY_DIMENSIONS.map((dim) => ({ dim, v: c.personality[dim] }))
    .filter((d) => personalityBand(d.v) !== 'mid')
    .sort((a, b) => Math.abs(b.v - 50) - Math.abs(a.v - 50) || a.dim.localeCompare(b.dim))

  const out: string[] = [STYLE_OBSERVATION[c.communicationStyle]]
  for (const { dim, v } of ranked) {
    if (out.length >= max) break
    const pool = v > 50 ? OBSERVATIONS[dim].high : OBSERVATIONS[dim].low
    const phrase = pool[hashString(`${c.firstName}${c.lastName}|${dim}|${v}`) % pool.length]
    if (!out.includes(phrase)) out.push(phrase)
  }
  return out
}

export const describeMotivation = (m: CharacterMotivation): string => MOTIVATION_LABEL[m]

/** "Winning, then Money and Recognition" — the §9 ranking, in words. */
export function describeMotivations(m: CharacterMotivations): string {
  const primary = MOTIVATION_LABEL[m.primary]
  if (m.secondary.length === 0) return primary
  const rest = m.secondary.map((s) => MOTIVATION_LABEL[s])
  const tail = rest.length === 1 ? rest[0] : `${rest[0]} and ${rest[1]}`
  return `${primary}, then ${tail}`
}

// ---------- biography (§10) ----------

/** Title → discipline, so a bio composed later still knows what the person actually does. */
const TITLE_JOB_ROLE: Record<string, Role> = (() => {
  const map: Record<string, Role> = {}
  for (const role of Object.keys(EMPLOYEE_TITLES) as Role[])
    for (const stage of Object.keys(EMPLOYEE_TITLES[role]) as CareerStage[])
      for (const title of EMPLOYEE_TITLES[role][stage]) map[title] = role
  return map
})()

const STRENGTH_JOB_ROLE: Partial<Record<BackgroundStrength, Role>> = {
  ships_fast: 'engineer',
  deep_technical: 'engineer',
  first_principles: 'engineer',
  design_taste: 'designer',
  customer_obsessed: 'designer',
  data_driven: 'marketer',
  recruits_well: 'sales',
  closes_enterprise: 'sales',
}

function inferJobRole(c: Character): Role | undefined {
  if (c.title && TITLE_JOB_ROLE[c.title]) return TITLE_JOB_ROLE[c.title]
  return STRENGTH_JOB_ROLE[c.background.notableStrength]
}

const yearsWord = (n: number): string => (n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n))

/**
 * Two or three short sentences: where they came from, what they are known for, and — for people
 * who joined YOU — why. Pure, so the caller can cache it into `background.bio` (§68/§72) and get
 * the same string back on every reload.
 */
export function composeBio(seed: number, c: Character): string {
  const key = `${seed}|bio|${c.firstName}|${c.lastName}|${c.role}|${c.background.notableStrength}`
  const rng = stream(key, 'bio')
  const jobRole = inferJobRole(c)
  const work = pickOne(jobRole ? WORK_PHRASE[jobRole] : GENERIC_WORK_PHRASE, rng)
  const opening = pickOne(BIO_OPENINGS[c.background.previousEnvironment], rng)
    .replace('{first}', c.firstName)
    .replace('{years}', yearsWord(c.background.yearsExperience))
    .replace('{work}', work)

  const strength = pickOne(BIO_STRENGTHS[c.background.notableStrength], rng)
  const weakness = c.background.knownWeakness ? pickOne(BIO_WEAKNESSES[c.background.knownWeakness], rng) : null
  const reputation = `${c.firstName} ${strength}${weakness ? `, but ${weakness}` : ''}.`

  const joined = c.background.reasonForJoining ? ` ${pickOne(BIO_JOIN_REASONS[c.background.reasonForJoining], rng)}` : ''
  return `${opening} ${reputation}${joined}`
}

/** Compose once, then keep it. Returns the same object when the bio is already cached. */
export function ensureBio(seed: number, c: Character): Character {
  if (c.background.bio) return c
  return { ...c, background: { ...c.background, bio: composeBio(seed, c) } }
}

export type { PersonalityDimension, ObservationBand }
