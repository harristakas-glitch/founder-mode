// The Procedural Living World — persistence (§68, §69, §72).
//
// Three jobs, in order of how often they run:
//
//   1. SERIALISE — shrink the slice on the way to localStorage and rebuild it on the way back.
//      A character's identity (name, personality, motivations, style, background) is a pure
//      function of (config.seed, character.id), so persisting it stores a second copy of
//      something the generator can always reproduce. We strip it — but only after proving the
//      generator reproduces it byte-for-byte, because a silently divergent regenerator would
//      rewrite people's personalities on reload, which is far worse than a large save.
//      What history wrote (relationships, memories, status, dates, cached prose) is never
//      derivable and is always persisted.
//
//   2. MIGRATE — a save written before this system existed must load, and then be able to grow
//      a world. Company history is re-derived from the metric series the save already has;
//      character memories are NOT invented, because the data does not support them (§69.5).
//
//   3. BOUND — every array has a cap and the whole slice has a byte budget. The state is
//      structuredClone'd on each action and JSON-serialised on each change, so unbounded growth
//      is a frame-rate problem long before it is a quota problem.
//
// Nothing here draws randomness. Migration derives from recorded facts and pruning ranks by
// (importance, week, id), so two runs with the same save always produce the same slice.

import type { GameState, HistoryPoint } from '../types'
import {
  LIVING_WORLD_LIMITS,
  LIVING_WORLD_STATE_VERSION,
  type Character,
  type CharacterBackground,
  type CharacterId,
  type CharacterStatus,
  type CompanyMemory,
  type CompanyMemoryType,
  type LivingWorldState,
  type MemoryItem,
  type NarrativeEntry,
  type NarrativeHistory,
  type NarrativeUsageState,
  type PromiseRecord,
  type PromiseStatus,
  type RelationshipState,
} from './types'

// ---------- empty state ----------

export function emptyNarrativeUsage(): NarrativeUsageState {
  return { recentFragmentIds: [], recentTags: [], recentPatterns: [], lastUsedWeek: {} }
}

export function emptyNarrativeHistory(): NarrativeHistory {
  return { entries: [], usage: emptyNarrativeUsage(), emitted: {} }
}

export function emptyLivingWorld(): LivingWorldState {
  return {
    version: LIVING_WORLD_STATE_VERSION,
    characters: {},
    companyMemory: [],
    promises: [],
    narrative: emptyNarrativeHistory(),
  }
}

// ---------- the on-disk shape ----------

/** The half of a Character that (seed, id) can reproduce. Never persisted when it round-trips. */
export interface CharacterIdentity {
  firstName: Character['firstName']
  lastName: Character['lastName']
  personality: Character['personality']
  motivations: Character['motivations']
  communicationStyle: Character['communicationStyle']
  archetype?: Character['archetype']
  /** Without `bio`: the bio is composed prose, cached rather than derived, so it is persisted. */
  background: Omit<CharacterBackground, 'bio'>
}

/**
 * A character as stored. Everything here was written by the run and cannot be recomputed;
 * `identity` appears only when regeneration could not be proven to reproduce it.
 */
export interface PersistedCharacter {
  id: CharacterId
  role: Character['role']
  companyId?: string
  title?: string
  status: CharacterStatus
  trait?: Character['trait']
  createdWeek: number
  departedWeek?: number
  /** §68: generated prose is persisted, never recomposed. */
  bio?: string
  relationships: RelationshipState[]
  memories: MemoryItem[]
  identity?: CharacterIdentity
}

/** The compact slice. `characters` is an array because a sorted array serialises smaller than a keyed object. */
export interface PersistedWorld {
  version: number
  characters: PersistedCharacter[]
  companyMemory: CompanyMemory[]
  promises: PromiseRecord[]
  narrative: NarrativeHistory
  lastGeneratedWeek?: number
  narrativeLastSeen?: Record<string, number>
}

/**
 * Rebuilds a character's derivable half from its stored record. Injected rather than imported so
 * this module never depends on the generator, and so tests can supply a stub — the same shape
 * career/tick.ts uses for `rng`. Must be pure in (config.seed, record.id).
 */
export type CharacterRebuilder = (record: PersistedCharacter) => CharacterIdentity | undefined

// ---------- serialise ----------

function pickIdentity(c: Character): CharacterIdentity {
  const { bio: _bio, ...background } = c.background
  return prune({
    firstName: c.firstName,
    lastName: c.lastName,
    personality: c.personality,
    motivations: c.motivations,
    communicationStyle: c.communicationStyle,
    archetype: c.archetype,
    background,
  })
}

// Flatten to a fixed field order before comparing. A plain JSON.stringify would also compare key
// order, so a rebuilder that happened to build its object differently would look "divergent" and
// quietly cost us the whole size saving.
function identityKey(i: CharacterIdentity): string {
  const p = i.personality
  const b = i.background
  return JSON.stringify([
    i.firstName,
    i.lastName,
    i.communicationStyle,
    i.archetype ?? '',
    p.directness, p.ambition, p.patience, p.loyalty, p.optimism, p.ego, p.riskTolerance, p.empathy,
    i.motivations.primary,
    i.motivations.secondary, // order is meaningful: it is the ranking
    b.careerStage, b.previousEnvironment, b.yearsExperience, b.notableStrength,
    b.knownWeakness ?? '',
    b.reasonForJoining ?? '',
  ])
}

const sameIdentity = (a: CharacterIdentity, b: CharacterIdentity) => identityKey(a) === identityKey(b)

/**
 * Strip what the generator can reproduce. `rebuild` is verified per character rather than
 * trusted: a record is only stripped when regenerating it produces exactly what we hold, so a
 * generator change (or a missing rebuilder) costs save size, never a rewritten personality.
 */
export function toPersistedWorld(world: LivingWorldState, rebuild?: CharacterRebuilder): PersistedWorld {
  const characters: PersistedCharacter[] = []
  for (const id of Object.keys(world.characters).sort()) {
    const c = world.characters[id]
    if (!c) continue
    const record: PersistedCharacter = prune({
      id: c.id,
      role: c.role,
      companyId: c.companyId,
      title: c.title,
      status: c.status,
      trait: c.trait,
      createdWeek: c.createdWeek,
      departedWeek: c.departedWeek,
      bio: c.background.bio,
      relationships: c.relationships,
      memories: c.memories,
    })
    const identity = pickIdentity(c)
    const regenerated = rebuild?.(record)
    if (!regenerated || !sameIdentity(identity, regenerated)) record.identity = identity
    characters.push(record)
  }
  return prune({
    version: LIVING_WORLD_STATE_VERSION,
    characters,
    companyMemory: world.companyMemory,
    promises: world.promises,
    narrative: world.narrative,
    lastGeneratedWeek: world.lastGeneratedWeek,
    narrativeLastSeen: world.narrativeLastSeen,
  })
}

// ---------- normalise / deserialise ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const optNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const strings = (v: unknown): string[] => asArray(v).filter((x): x is string => typeof x === 'string')

/**
 * Drop keys whose value is undefined. `{ bio: undefined }` and `{}` are the same object to a
 * reader but not to structuredClone, and only one of them survives a JSON round-trip — so a
 * loaded character would stop being deep-equal to a freshly generated one.
 */
function prune<T extends object>(o: T): T {
  for (const k of Object.keys(o)) {
    if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k]
  }
  return o
}

// `satisfies` ties these to the unions in types.ts: rename a member there and this stops compiling.
const CHARACTER_STATUSES = ['prospect', 'active', 'departed'] as const satisfies readonly CharacterStatus[]
const PROMISE_STATUSES = ['open', 'kept', 'broken', 'expired'] as const satisfies readonly PromiseStatus[]

function normalizeMemory(raw: unknown, index: number): MemoryItem | null {
  if (!isObj(raw)) return null
  const summaryKey = str(raw.summaryKey)
  if (!summaryKey) return null // a memory with no key cannot be composed into anything
  return prune({
    id: str(raw.id) || `m-${index}`,
    week: num(raw.week, 0),
    type: (str(raw.type, 'support') as MemoryItem['type']),
    actorId: optStr(raw.actorId),
    targetId: optStr(raw.targetId),
    importance: clamp(num(raw.importance, 20), 0, 100),
    emotionalImpact: clamp(num(raw.emotionalImpact, 0), -100, 100),
    tags: strings(raw.tags),
    summaryKey,
    facts: isObj(raw.facts) ? (raw.facts as MemoryItem['facts']) : undefined,
    resolved: raw.resolved === true ? true : undefined,
    sourceId: optStr(raw.sourceId),
  })
}

function normalizeRelationship(raw: unknown): RelationshipState | null {
  if (!isObj(raw)) return null
  const characterId = str(raw.characterId)
  if (!characterId) return null
  return prune({
    characterId,
    trust: clamp(num(raw.trust, 50), 0, 100),
    respect: clamp(num(raw.respect, 50), 0, 100),
    alignment: clamp(num(raw.alignment, 50), 0, 100),
    dependence: clamp(num(raw.dependence, 50), 0, 100),
    lastMeaningfulInteractionWeek: optNum(raw.lastMeaningfulInteractionWeek),
  })
}

function normalizeIdentity(raw: unknown): CharacterIdentity | undefined {
  if (!isObj(raw)) return undefined
  const p = isObj(raw.personality) ? raw.personality : {}
  const m = isObj(raw.motivations) ? raw.motivations : {}
  const b = isObj(raw.background) ? raw.background : {}
  const dim = (v: unknown) => clamp(num(v, 50), 0, 100)
  return prune({
    firstName: str(raw.firstName, 'Someone'),
    lastName: str(raw.lastName),
    personality: {
      directness: dim(p.directness),
      ambition: dim(p.ambition),
      patience: dim(p.patience),
      loyalty: dim(p.loyalty),
      optimism: dim(p.optimism),
      ego: dim(p.ego),
      riskTolerance: dim(p.riskTolerance),
      empathy: dim(p.empathy),
    },
    motivations: {
      primary: (str(m.primary, 'money') as CharacterIdentity['motivations']['primary']),
      secondary: strings(m.secondary).slice(0, 2) as CharacterIdentity['motivations']['secondary'],
    },
    communicationStyle: (str(raw.communicationStyle, 'direct') as CharacterIdentity['communicationStyle']),
    archetype: optStr(raw.archetype) as CharacterIdentity['archetype'],
    background: prune({
      careerStage: (str(b.careerStage, 'established') as CharacterBackground['careerStage']),
      previousEnvironment: (str(b.previousEnvironment, 'startup') as CharacterBackground['previousEnvironment']),
      yearsExperience: clamp(num(b.yearsExperience, 5), 0, 60),
      notableStrength: (str(b.notableStrength, 'ships_fast') as CharacterBackground['notableStrength']),
      knownWeakness: optStr(b.knownWeakness) as CharacterBackground['knownWeakness'],
      reasonForJoining: optStr(b.reasonForJoining) as CharacterBackground['reasonForJoining'],
    }),
  })
}

function normalizeCharacterRecord(raw: unknown): PersistedCharacter | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  const statusRaw = str(raw.status, 'active') as CharacterStatus
  return prune({
    id,
    role: (str(raw.role, 'employee') as Character['role']),
    companyId: optStr(raw.companyId),
    title: optStr(raw.title),
    status: CHARACTER_STATUSES.includes(statusRaw) ? statusRaw : 'active',
    // null is a value here, not an absence: it mirrors Employee.trait, where null means "no trait".
    trait: raw.trait === null ? null : typeof raw.trait === 'string' ? (raw.trait as Character['trait']) : undefined,
    createdWeek: num(raw.createdWeek, 1),
    departedWeek: optNum(raw.departedWeek),
    bio: optStr(raw.bio) ?? optStr(isObj(raw.background) ? raw.background.bio : undefined),
    relationships: asArray(raw.relationships)
      .map(normalizeRelationship)
      .filter((r): r is RelationshipState => r !== null),
    memories: asArray(raw.memories)
      .map(normalizeMemory)
      .filter((m): m is MemoryItem => m !== null),
    identity: normalizeIdentityIfPresent(raw),
  })
}

// A full LivingWorldState character carries its identity inline; a compact record nests it under
// `identity`. Both loads land here, so accept either.
function normalizeIdentityIfPresent(raw: Record<string, unknown>): CharacterIdentity | undefined {
  if (isObj(raw.identity)) return normalizeIdentity(raw.identity)
  if (typeof raw.firstName === 'string' || isObj(raw.personality)) return normalizeIdentity(raw)
  return undefined
}

function normalizeCompanyMemory(raw: unknown, index: number): CompanyMemory | null {
  if (!isObj(raw)) return null
  const type = str(raw.type)
  if (!type) return null
  return prune({
    id: str(raw.id) || `cm-${index}`,
    week: num(raw.week, 0),
    type: type as CompanyMemoryType,
    importance: clamp(num(raw.importance, 40), 0, 100),
    metadata: isObj(raw.metadata) ? (raw.metadata as CompanyMemory['metadata']) : {},
    characterIds: Array.isArray(raw.characterIds) ? strings(raw.characterIds) : undefined,
  })
}

function normalizePromise(raw: unknown, index: number): PromiseRecord | null {
  if (!isObj(raw)) return null
  const characterId = str(raw.characterId)
  const summaryKey = str(raw.summaryKey)
  if (!characterId || !summaryKey) return null
  const status = str(raw.status, 'open') as PromiseStatus
  return prune({
    id: str(raw.id) || `p-${index}`,
    week: num(raw.week, 0),
    characterId,
    summaryKey,
    facts: isObj(raw.facts) ? (raw.facts as PromiseRecord['facts']) : undefined,
    dueWeek: optNum(raw.dueWeek),
    status: PROMISE_STATUSES.includes(status) ? status : 'open',
    importance: clamp(num(raw.importance, 50), 0, 100),
    resolvedWeek: optNum(raw.resolvedWeek),
  })
}

function normalizeNarrativeEntry(raw: unknown): NarrativeEntry | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  return prune({
    id,
    week: num(raw.week, 0),
    surface: (str(raw.surface, 'inbox') as NarrativeEntry['surface']),
    beatKey: str(raw.beatKey, 'unknown'),
    characterId: optStr(raw.characterId),
    messageId: optStr(raw.messageId),
    fragmentIds: strings(raw.fragmentIds),
  })
}

function normalizeNarrative(raw: unknown): NarrativeHistory {
  if (!isObj(raw)) return emptyNarrativeHistory()
  const usageRaw = isObj(raw.usage) ? raw.usage : {}
  const lastUsedWeek: Record<string, number> = {}
  if (isObj(usageRaw.lastUsedWeek)) {
    for (const k of Object.keys(usageRaw.lastUsedWeek).sort()) {
      const w = optNum(usageRaw.lastUsedWeek[k])
      if (w !== undefined) lastUsedWeek[k] = w
    }
  }
  const emitted: Record<string, number> = {}
  if (isObj(raw.emitted)) {
    for (const k of Object.keys(raw.emitted).sort()) {
      const w = optNum(raw.emitted[k])
      if (w !== undefined) emitted[k] = w
    }
  }
  return {
    entries: asArray(raw.entries)
      .map(normalizeNarrativeEntry)
      .filter((e): e is NarrativeEntry => e !== null),
    usage: {
      recentFragmentIds: strings(usageRaw.recentFragmentIds),
      recentTags: strings(usageRaw.recentTags),
      recentPatterns: strings(usageRaw.recentPatterns),
      lastUsedWeek,
    },
    emitted,
  }
}

/**
 * Load the slice from whatever a save happens to hold: the compact form, the full in-memory form
 * (saves written before compaction shipped), or garbage. Returns undefined only when there is
 * nothing there — a malformed slice normalises to an empty one rather than crashing the load,
 * because the world regenerates and a thrown error costs the player the whole save.
 */
export function fromPersistedWorld(raw: unknown, rebuild?: CharacterRebuilder): LivingWorldState | undefined {
  if (!isObj(raw)) return undefined
  const charactersRaw = Array.isArray(raw.characters)
    ? raw.characters
    : isObj(raw.characters)
      ? Object.keys(raw.characters).sort().map((k) => (raw.characters as Record<string, unknown>)[k])
      : []

  const characters: Record<CharacterId, Character> = {}
  for (const entry of charactersRaw) {
    const record = normalizeCharacterRecord(entry)
    if (!record) continue
    // Regenerate first, fall back to a carried copy. A record with neither is a person we cannot
    // describe, so it is dropped: generation will re-create them from the live game state.
    const identity = rebuild?.(record) ?? record.identity
    if (!identity) continue
    characters[record.id] = prune({
      id: record.id,
      firstName: identity.firstName,
      lastName: identity.lastName,
      role: record.role,
      companyId: record.companyId,
      title: record.title,
      personality: identity.personality,
      motivations: identity.motivations,
      communicationStyle: identity.communicationStyle,
      background: record.bio ? { ...identity.background, bio: record.bio } : { ...identity.background },
      relationships: record.relationships,
      memories: record.memories,
      status: record.status,
      trait: record.trait,
      archetype: identity.archetype,
      createdWeek: record.createdWeek,
      departedWeek: record.departedWeek,
    })
  }

  const world: LivingWorldState = {
    version: LIVING_WORLD_STATE_VERSION,
    characters,
    companyMemory: asArray(raw.companyMemory)
      .map(normalizeCompanyMemory)
      .filter((c): c is CompanyMemory => c !== null),
    promises: asArray(raw.promises)
      .map(normalizePromise)
      .filter((p): p is PromiseRecord => p !== null),
    narrative: normalizeNarrative(raw.narrative),
    lastGeneratedWeek: optNum(raw.lastGeneratedWeek),
    // Novelty must survive a reload: if it reset, the Director would treat every story as
    // first-time again and the same one could lead week after week — the exact repetition this
    // phase exists to remove. Values are coerced because this is user-writable localStorage.
    narrativeLastSeen: (() => {
      const r = (raw as Record<string, unknown>).narrativeLastSeen
      if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
      return out
    })(),
  }
  prune(world)
  enforceLivingWorldLimits(world)
  return world
}

/**
 * In-slice version migration, run on every load. Version 0/absent is the original shape, so
 * normalising is the whole migration today; the switch is here so a future shape change never
 * needs a global persist bump. A slice from a NEWER build is kept rather than discarded —
 * unknown fields fall away in normalisation, and memories are the one thing no regenerator can
 * rebuild.
 */
export function migrateLivingWorldSlice(raw: unknown, rebuild?: CharacterRebuilder): LivingWorldState | undefined {
  const world = fromPersistedWorld(raw, rebuild)
  if (!world) return undefined
  world.version = LIVING_WORLD_STATE_VERSION
  return world
}

// ---------- migration from a save that predates the living world (§69) ----------

interface DerivedMemory {
  week: number
  type: CompanyMemoryType
  importance: number
  metadata: Record<string, string | number>
}

const FUNDING_JUMP_MULT = 1.6
const FUNDING_JUMP_MIN = 100_000

/**
 * Re-derive the company's notable history from the metric series the save already carries.
 * Everything here is a fact the run recorded — the first week revenue was non-zero, the week
 * cash jumped by a round — never an invented event. Character memories get no equivalent
 * treatment (§69.5): the data does not say who was in the room, so nothing is fabricated.
 */
export function companyMemoryFromSave(g: Pick<GameState, 'history' | 'week' | 'stage'>): CompanyMemory[] {
  const h = g.history
  if (!h.length) return []
  const out: DerivedMemory[] = []
  const firstWhere = (pred: (p: HistoryPoint) => boolean) => h.find(pred)

  const firstUsers = firstWhere((p) => p.users > 0)
  if (firstUsers) out.push({ week: firstUsers.week, type: 'first_customer', importance: 60, metadata: { users: firstUsers.users } })

  const firstRevenue = firstWhere((p) => p.revenue > 0)
  if (firstRevenue)
    out.push({ week: firstRevenue.week, type: 'first_revenue', importance: 70, metadata: { amount: Math.round(firstRevenue.revenue) } })

  const firstPayroll = firstWhere((p) => p.payroll > 0)
  if (firstPayroll) out.push({ week: firstPayroll.week, type: 'first_hire', importance: 65, metadata: {} })

  const firstPmf = firstWhere((p) => p.pmf >= 60)
  if (firstPmf) out.push({ week: firstPmf.week, type: 'pmf', importance: 90, metadata: { pmf: Math.round(firstPmf.pmf) } })

  const firstProfit = firstWhere((p) => p.week > 4 && p.revenue >= p.expenses && p.expenses > 0)
  if (firstProfit)
    out.push({ week: firstProfit.week, type: 'profitability', importance: 80, metadata: { revenue: Math.round(firstProfit.revenue) } })

  // Rounds are not recorded anywhere, but a week where the account multiplies is unambiguous.
  for (let i = 1; i < h.length; i++) {
    const prev = h[i - 1]
    const cur = h[i]
    const delta = cur.cash - prev.cash
    if (delta >= FUNDING_JUMP_MIN && cur.cash >= prev.cash * FUNDING_JUMP_MULT)
      out.push({ week: cur.week, type: 'funding_round', importance: 85, metadata: { amount: Math.round(delta) } })
  }

  let bestRevenue = h[0]
  let bestGrowth: { point: HistoryPoint; delta: number } | null = null
  let worstDrop: { point: HistoryPoint; drop: number } | null = null
  let leanest = h[0]
  for (let i = 0; i < h.length; i++) {
    const cur = h[i]
    if (cur.revenue > bestRevenue.revenue) bestRevenue = cur
    if (cur.cash < leanest.cash) leanest = cur
    if (i === 0) continue
    const delta = cur.users - h[i - 1].users
    if (delta > 0 && (!bestGrowth || delta > bestGrowth.delta)) bestGrowth = { point: cur, delta }
    const drop = h[i - 1].users > 0 ? (h[i - 1].users - cur.users) / h[i - 1].users : 0
    if (drop > 0.1 && (!worstDrop || drop > worstDrop.drop)) worstDrop = { point: cur, drop }
  }
  if (bestRevenue.revenue > 0)
    out.push({ week: bestRevenue.week, type: 'record_revenue', importance: 55, metadata: { amount: Math.round(bestRevenue.revenue) } })
  if (bestGrowth)
    out.push({ week: bestGrowth.point.week, type: 'record_growth', importance: 55, metadata: { users: Math.round(bestGrowth.delta) } })
  if (worstDrop)
    out.push({
      week: worstDrop.point.week,
      type: 'major_loss',
      importance: 60,
      metadata: { percent: Math.round(worstDrop.drop * 100) },
    })
  // Near-death only counts as a crisis if the run survived it; the current week is just "now".
  if (leanest.expenses > 0 && leanest.cash < leanest.expenses * 3 && leanest.week < g.week)
    out.push({ week: leanest.week, type: 'crisis', importance: 75, metadata: { cash: Math.round(leanest.cash) } })

  return out
    .sort((a, b) => a.week - b.week || a.type.localeCompare(b.type))
    .map((m) => ({ id: `cm-${m.week}-${m.type}`, week: m.week, type: m.type, importance: m.importance, metadata: m.metadata }))
}

/**
 * Build the slice for a save that predates it. The cast is injected — the generator owns who
 * exists — and everything else starts empty: no promises anyone made, no stories already told.
 * `lastGeneratedWeek` is set to the current week so migrating mid-run does not immediately fire
 * a second pass over a week the old save already resolved (§72).
 */
export function migrateLegacyWorldSave(
  g: Pick<GameState, 'history' | 'week' | 'stage'>,
  opts: { cast?: Character[] } = {},
): LivingWorldState {
  const world = emptyLivingWorld()
  for (const c of opts.cast ?? []) world.characters[c.id] = c
  world.companyMemory = companyMemoryFromSave(g)
  world.lastGeneratedWeek = g.week
  enforceLivingWorldLimits(world)
  return world
}

// ---------- caps (§72) ----------

/** Rank low-to-high so the tail is what gets dropped. Ties break on week then id: no RNG, no draw order. */
const byValue = (a: { importance: number; week: number; id: string }, b: { importance: number; week: number; id: string }) =>
  b.importance - a.importance || b.week - a.week || a.id.localeCompare(b.id)

function keepTop<T extends { importance: number; week: number; id: string }>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items
  const keep = new Set(items.slice().sort(byValue).slice(0, cap).map((i) => i.id))
  return items.filter((i) => keep.has(i.id)) // preserves the original newest-last order
}

const trimTail = (items: string[], cap: number) => (items.length > cap ? items.slice(items.length - cap) : items)

function trimWeekMap(map: Record<string, number>, cap: number): Record<string, number> {
  const keys = Object.keys(map)
  if (keys.length <= cap) return map
  const keep = keys.sort((a, b) => map[b] - map[a] || a.localeCompare(b)).slice(0, cap)
  const out: Record<string, number> = {}
  for (const k of keep.sort()) out[k] = map[k]
  return out
}

/**
 * Bring every array back inside LIVING_WORLD_LIMITS. Mutates, like the engine's other
 * bookkeeping helpers. Safe to call every week — it is O(n log n) on already-small arrays and
 * a no-op when nothing is over.
 */
export function enforceLivingWorldLimits(world: LivingWorldState): void {
  for (const id of Object.keys(world.characters).sort()) {
    const c = world.characters[id]
    if (c && c.memories.length > LIVING_WORLD_LIMITS.memoriesPerCharacter)
      c.memories = keepTop(c.memories, LIVING_WORLD_LIMITS.memoriesPerCharacter)
  }
  world.companyMemory = keepTop(world.companyMemory, LIVING_WORLD_LIMITS.companyMemory)

  // An open promise outlives the cap: callbacks scan it every week and dropping it would quietly
  // absolve the player. Resolved ones go first, and only a runaway (2× the cap) touches open ones.
  if (world.promises.length > LIVING_WORLD_LIMITS.promises) {
    const open = world.promises.filter((p) => p.status === 'open')
    const room = Math.max(0, LIVING_WORLD_LIMITS.promises - open.length)
    const closed = keepTop(world.promises.filter((p) => p.status !== 'open'), room)
    const keep = new Set([...open, ...closed].map((p) => p.id))
    world.promises = world.promises.filter((p) => keep.has(p.id))
    if (world.promises.length > LIVING_WORLD_LIMITS.promises * 2)
      world.promises = keepTop(world.promises, LIVING_WORLD_LIMITS.promises * 2)
  }

  const n = world.narrative
  if (n.entries.length > LIVING_WORLD_LIMITS.narrativeEntries)
    n.entries = n.entries.slice(n.entries.length - LIVING_WORLD_LIMITS.narrativeEntries)
  n.usage.recentFragmentIds = trimTail(n.usage.recentFragmentIds, LIVING_WORLD_LIMITS.recentFragmentIds)
  n.usage.recentTags = trimTail(n.usage.recentTags, LIVING_WORLD_LIMITS.recentTags)
  n.usage.recentPatterns = trimTail(n.usage.recentPatterns, LIVING_WORLD_LIMITS.recentPatterns)
  // Cooldowns only ever ask about fragments seen recently, so a few multiples of the ring is plenty.
  n.usage.lastUsedWeek = trimWeekMap(n.usage.lastUsedWeek, LIVING_WORLD_LIMITS.recentFragmentIds * 4)
  // `emitted` is the reload guard, so it must outlive `entries` — but not forever.
  n.emitted = trimWeekMap(n.emitted, LIVING_WORLD_LIMITS.narrativeEntries * 2)
}

// ---------- size guard (§72) ----------

/**
 * What the slice may cost in localStorage. The whole save shares a ~5MB origin quota with
 * history (300 points), the Career journal and the PMF subsystem, and the state is
 * structuredClone'd on every action — so the world gets a generous but finite corner of it.
 */
export const LIVING_WORLD_BUDGET_BYTES = 512 * 1024

export interface LivingWorldFootprint {
  bytes: number
  characters: number
  memories: number
  companyMemory: number
  promises: number
  narrativeEntries: number
  overBudget: boolean
}

// Per-item averages from the persisted shape; used to skip the stringify on the common small case.
const ROUGH = { character: 240, memory: 130, relationship: 70, companyMemory: 110, promise: 120, narrativeEntry: 140, usageItem: 30 }

function roughBytes(world: LivingWorldState): number {
  let total = 0
  for (const id of Object.keys(world.characters)) {
    const c = world.characters[id]
    if (!c) continue
    total += ROUGH.character + (c.background.bio?.length ?? 0)
    total += c.memories.length * ROUGH.memory + c.relationships.length * ROUGH.relationship
  }
  total += world.companyMemory.length * ROUGH.companyMemory
  total += world.promises.length * ROUGH.promise
  total += world.narrative.entries.length * ROUGH.narrativeEntry
  const u = world.narrative.usage
  total += (u.recentFragmentIds.length + u.recentTags.length + u.recentPatterns.length) * ROUGH.usageItem
  total += (Object.keys(u.lastUsedWeek).length + Object.keys(world.narrative.emitted).length) * ROUGH.usageItem
  return total
}

/** Measured, not estimated — the JSON is what actually reaches localStorage. Do not call per render. */
export function livingWorldFootprint(world: LivingWorldState): LivingWorldFootprint {
  let memories = 0
  const ids = Object.keys(world.characters)
  for (const id of ids) memories += world.characters[id]?.memories.length ?? 0
  const bytes = JSON.stringify(toPersistedWorld(world)).length
  return {
    bytes,
    characters: ids.length,
    memories,
    companyMemory: world.companyMemory.length,
    promises: world.promises.length,
    narrativeEntries: world.narrative.entries.length,
    overBudget: bytes > LIVING_WORLD_BUDGET_BYTES,
  }
}

/**
 * Last-resort shedding when the caps alone are not enough — a very long run with a large cast.
 * Order is cheapest loss first: cached prose (regenerable by definition), then the memories of
 * people who have left, then old narrative bookkeeping. Open promises and the memories of active
 * characters are never touched; they are the parts of the world the player can still feel.
 *
 * Returns true if anything was shed. Call on week resolve, never per render: the measurement
 * itself serialises the slice.
 */
export function compactLivingWorld(world: LivingWorldState, budget = LIVING_WORLD_BUDGET_BYTES): boolean {
  enforceLivingWorldLimits(world)
  if (roughBytes(world) < budget * 0.8) return false // clearly small: skip the stringify entirely
  if (livingWorldFootprint(world).bytes <= budget) return false

  const ids = Object.keys(world.characters).sort()
  for (const id of ids) {
    const c = world.characters[id]
    if (c?.background.bio) delete c.background.bio
  }
  if (livingWorldFootprint(world).bytes <= budget) return true

  const half = Math.max(4, Math.floor(LIVING_WORLD_LIMITS.memoriesPerCharacter / 2))
  for (const id of ids) {
    const c = world.characters[id]
    if (c?.status === 'departed') c.memories = keepTop(c.memories, Math.min(half, 8))
  }
  if (livingWorldFootprint(world).bytes <= budget) return true

  const n = world.narrative
  const entryCap = Math.floor(LIVING_WORLD_LIMITS.narrativeEntries / 2)
  if (n.entries.length > entryCap) n.entries = n.entries.slice(n.entries.length - entryCap)
  n.emitted = trimWeekMap(n.emitted, LIVING_WORLD_LIMITS.narrativeEntries)
  world.companyMemory = keepTop(world.companyMemory, Math.floor(LIVING_WORLD_LIMITS.companyMemory / 2))
  if (livingWorldFootprint(world).bytes <= budget) return true

  for (const id of ids) {
    const c = world.characters[id]
    if (c) c.memories = keepTop(c.memories, half)
  }
  return true
}

// ---------- the once-per-week guard (§72) ----------

/**
 * Narrative is generated when a week resolves, once. A reload replays nothing, but an autosave
 * restored mid-week could otherwise walk the same week again and emit every story twice.
 */
export function shouldGenerateForWeek(world: LivingWorldState | undefined, week: number): boolean {
  if (!world) return false
  return world.lastGeneratedWeek === undefined || week > world.lastGeneratedWeek
}

export function markWeekGenerated(world: LivingWorldState, week: number): void {
  world.lastGeneratedWeek = Math.max(world.lastGeneratedWeek ?? 0, week)
}
