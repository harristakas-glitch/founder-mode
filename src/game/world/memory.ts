// The Procedural Living World — memory.
//
// RECORD — append-only. The simulation has already decided what happened; recording it can
// never change an outcome, only what someone can bring up later (§64). Company memory, character
// memory and promises are the three ledgers, each with its own eviction policy below.
//
// (A scored RECALL engine — scoreMemoryRelevance / recallMemories and friends — used to live here
// as well, but the live narrative path selects callbacks through world/composer.ts, so the scoring
// engine was never wired and has been removed. See docs/architecture-audit-2026-08.md.)
//
// Nothing in this file draws randomness. Memory is bookkeeping over facts, so ids are derived
// from (week, key, collision index) rather than from an injected uid — that also survives a
// reload, where a counter-based id would not.
//
// BOUNDED BY CONSTRUCTION. A 104-week Career run records thousands of facts and must not grow
// without limit, so every array is capped and evicts by retention score, not by age:
//   • 40 memories per character   (LIVING_WORLD_LIMITS.memoriesPerCharacter)
//   • 120 company memories        (LIVING_WORLD_LIMITS.companyMemory)
//   • 40 promise records          (LIVING_WORLD_LIMITS.promises)
// Worst case is therefore memoriesPerCharacter × cast size + 160 rows, independent of run length.
// An open promise is protected from eviction on both sides: the PromiseRecord is never dropped
// while it is unresolved, and its memory carries a retention floor no ordinary memory can beat.

import type { GameState } from '../types'
import { hasCapability } from '../modes'
import {
  FOUNDER_ID,
  LIVING_WORLD_LIMITS,
  type Character,
  type CharacterId,
  type CompanyMemory,
  type CompanyMemoryType,
  type LivingWorldState,
  type MemoryItem,
  type MemoryTag,
  type MemoryType,
  type PromiseRecord,
  type PromiseStatus,
} from './types'
import {
  COMPANY_MEMORY_DEFAULTS,
  ERA_COMPANY_MEMORY,
  MEMORY_TYPE_DEFAULTS,
  ONCE_ONLY_COMPANY_MEMORY,
} from './content/memory-cues'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp100 = (v: number) => clamp(v, 0, 100)
const signed100 = (v: number) => clamp(v, -100, 100)

/** Half-lives in weeks. Recency fades faster than importance: what mattered still matters, it just gets quieter. */
const IMPORTANCE_HALF_LIFE = 60
/** Importance decays into irrelevance but never to zero — a betrayal at week 4 is still findable at week 104. */
const IMPORTANCE_FLOOR = 0.25

/** Retention bonus that keeps an unresolved promise above every ordinary memory in the eviction sort. */
const OPEN_PROMISE_RETENTION = 1000

// ---------- ids ----------

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'x'

/**
 * Deterministic and reload-stable: same week + same key + same number of prior collisions gives
 * the same id on a replay. Eviction can free a suffix, which is fine — ids only need to be unique
 * among live rows and the narrative entries pointing at them.
 */
function uniqueId(prefix: string, taken: (id: string) => boolean): string {
  if (!taken(prefix)) return prefix
  for (let n = 1; ; n++) {
    const id = `${prefix}_${n}`
    if (!taken(id)) return id
  }
}

// ---------- character memory ----------

export interface MemoryDraft {
  type: MemoryType
  /** Stable key into the fragment library, e.g. 'promised_engineering_leadership'. */
  summaryKey: string
  /** Merged with the type's default tags rather than replacing them. */
  tags?: MemoryTag[]
  importance?: number
  emotionalImpact?: number
  actorId?: CharacterId
  targetId?: CharacterId
  facts?: Record<string, string | number>
  resolved?: boolean
  sourceId?: string
}

/**
 * How close this character stood to the event. A layoff is a different memory for the person cut,
 * the person who ran it and the person who watched — same fact, three weights.
 */
export type MemoryPerspective = 'subject' | 'participant' | 'witness'

const PERSPECTIVE_SCALE: Record<MemoryPerspective, { importance: number; emotion: number }> = {
  subject: { importance: 1, emotion: 1 },
  participant: { importance: 0.8, emotion: 0.75 },
  witness: { importance: 0.55, emotion: 0.5 },
}

function buildMemory(
  existing: readonly MemoryItem[],
  week: number,
  draft: MemoryDraft,
  perspective: MemoryPerspective,
): MemoryItem {
  const def = MEMORY_TYPE_DEFAULTS[draft.type]
  const scale = PERSPECTIVE_SCALE[perspective]
  const tags = mergeTags(def.tags, draft.tags)
  const taken = new Set(existing.map((m) => m.id))
  const item: MemoryItem = {
    id: uniqueId(`mem_w${week}_${slug(draft.summaryKey)}`, (id) => taken.has(id)),
    week,
    type: draft.type,
    importance: clamp100(Math.round((draft.importance ?? def.importance) * scale.importance)),
    emotionalImpact: signed100(Math.round((draft.emotionalImpact ?? def.emotionalImpact) * scale.emotion)),
    tags,
    summaryKey: draft.summaryKey,
  }
  if (draft.actorId) item.actorId = draft.actorId
  if (draft.targetId) item.targetId = draft.targetId
  if (draft.facts) item.facts = { ...draft.facts }
  if (draft.resolved !== undefined) item.resolved = draft.resolved
  if (draft.sourceId) item.sourceId = draft.sourceId
  return item
}

function mergeTags(base: readonly MemoryTag[], extra: readonly MemoryTag[] | undefined): MemoryTag[] {
  const out: MemoryTag[] = []
  for (const t of base) if (typeof t === 'string' && t && !out.includes(t)) out.push(t)
  for (const t of extra ?? []) if (typeof t === 'string' && t && !out.includes(t)) out.push(t)
  return out
}

/**
 * Append one remembered fact to one character. Returns the stored item, or null if that character
 * does not exist — callers record against ids that may belong to someone who was never generated,
 * and a missing person is not an error worth throwing over mid-week.
 */
export function recordMemory(
  world: LivingWorldState,
  characterId: CharacterId,
  week: number,
  draft: MemoryDraft,
  perspective: MemoryPerspective = 'subject',
): MemoryItem | null {
  const character = world.characters[characterId]
  if (!character) return null
  if (!Array.isArray(character.memories)) character.memories = []
  const item = buildMemory(character.memories, week, draft, perspective)
  character.memories.push(item)
  evictMemories(character, week)
  return item
}

/**
 * One event, several rememberers. `draft.targetId` (falling back to `subjectId`) is the person who
 * takes it full strength; everyone else records the witness weighting.
 */
export function recordSharedMemory(
  world: LivingWorldState,
  characterIds: readonly CharacterId[],
  week: number,
  draft: MemoryDraft,
  opts: { subjectId?: CharacterId; witnessPerspective?: MemoryPerspective } = {},
): MemoryItem[] {
  const subject = opts.subjectId ?? draft.targetId
  const witness = opts.witnessPerspective ?? 'witness'
  const out: MemoryItem[] = []
  // Sorted so the ids assigned do not depend on the caller's array order.
  for (const id of [...new Set(characterIds)].sort()) {
    const item = recordMemory(world, id, week, draft, id === subject ? 'subject' : witness)
    if (item) out.push(item)
  }
  return out
}

/** Mark a previously recorded memory closed, optionally souring it (a promise kept vs broken). */
export function resolveMemory(
  world: LivingWorldState,
  characterId: CharacterId,
  memoryId: string,
  opts: { emotionalImpact?: number; importanceDelta?: number } = {},
): MemoryItem | null {
  const memory = world.characters[characterId]?.memories?.find((m) => m.id === memoryId)
  if (!memory) return null
  memory.resolved = true
  if (opts.emotionalImpact !== undefined) memory.emotionalImpact = signed100(Math.round(opts.emotionalImpact))
  if (opts.importanceDelta) memory.importance = clamp100(Math.round(memory.importance + opts.importanceDelta))
  return memory
}

// ---------- decay & eviction ----------

const halfLife = (age: number, life: number) => Math.pow(0.5, Math.max(0, age) / life)

/** Importance as felt now: faded by age, floored so an old wound stays reachable when cued. */
export function decayedImportance(memory: MemoryItem, currentWeek: number): number {
  const decay = halfLife(currentWeek - memory.week, IMPORTANCE_HALF_LIFE)
  return memory.importance * (IMPORTANCE_FLOOR + (1 - IMPORTANCE_FLOOR) * decay)
}

/**
 * What survives the cap. Not the same as relevance: relevance answers "does this belong in the
 * message I am writing", retention answers "is this worth still knowing at all".
 */
export function memoryRetention(memory: MemoryItem, currentWeek: number): number {
  if (memory.type === 'promise' && !memory.resolved) return OPEN_PROMISE_RETENTION + memory.importance
  const open = memory.resolved ? 0 : 12
  return decayedImportance(memory, currentWeek) + Math.abs(memory.emotionalImpact) * 0.25 + open
}

/** Drop the least worth-keeping memories until the character is back under the per-character cap. */
export function evictMemories(character: Character, currentWeek: number): number {
  const cap = LIVING_WORLD_LIMITS.memoriesPerCharacter
  const list = character.memories
  if (list.length <= cap) return 0
  const ranked = list
    .map((m, i) => ({ m, i, score: memoryRetention(m, currentWeek) }))
    // Ties break on original order, so eviction never depends on sort stability.
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, cap)
    .sort((a, b) => a.i - b.i)
  const dropped = list.length - ranked.length
  character.memories = ranked.map((r) => r.m)
  return dropped
}

/** Sorted so every iteration over the cast is order-stable regardless of insertion history. */
export function sortedCharacterIds(world: LivingWorldState): CharacterId[] {
  return Object.keys(world.characters ?? {}).sort()
}

// ---------- company memory ----------

export interface CompanyMemoryDraft {
  importance?: number
  metadata?: Record<string, string | number>
  characterIds?: CharacterId[]
  /** Also write this into the cast's personal memory — what the company did, as people felt it. */
  remember?: {
    summaryKey: string
    type: MemoryType
    subjectId?: CharacterId
    importance?: number
    emotionalImpact?: number
    tags?: MemoryTag[]
    /** Defaults to every active character. */
    characterIds?: CharacterId[]
  }
}

/**
 * Record something the company itself will remember. Returns null when a once-only type
 * (first_customer, first_revenue, first_hire, pmf, profitability) has already happened — the first
 * one keeps its week forever rather than being overwritten.
 */
export function recordCompanyMemory(
  world: LivingWorldState,
  week: number,
  type: CompanyMemoryType,
  draft: CompanyMemoryDraft = {},
): CompanyMemory | null {
  if (!Array.isArray(world.companyMemory)) world.companyMemory = []
  if (ONCE_ONLY_COMPANY_MEMORY.includes(type) && world.companyMemory.some((m) => m.type === type)) return null

  const def = COMPANY_MEMORY_DEFAULTS[type]
  const taken = new Set(world.companyMemory.map((m) => m.id))
  const entry: CompanyMemory = {
    id: uniqueId(`co_w${week}_${type}`, (id) => taken.has(id)),
    week,
    type,
    importance: clamp100(Math.round(draft.importance ?? def.importance)),
    metadata: { ...(draft.metadata ?? {}) },
  }
  if (draft.characterIds?.length) entry.characterIds = [...new Set(draft.characterIds)].sort()
  world.companyMemory.push(entry)
  evictCompanyMemory(world, week)

  const r = draft.remember
  if (r) {
    const audience = r.characterIds ?? activeCharacterIds(world)
    recordSharedMemory(
      world,
      audience,
      week,
      {
        type: r.type,
        summaryKey: r.summaryKey,
        tags: mergeTags(def.tags, r.tags),
        importance: r.importance,
        emotionalImpact: r.emotionalImpact,
        actorId: FOUNDER_ID,
        targetId: r.subjectId,
        facts: entry.metadata,
        sourceId: entry.id,
      },
      { subjectId: r.subjectId },
    )
  }
  return entry
}

function evictCompanyMemory(world: LivingWorldState, currentWeek: number): number {
  const cap = LIVING_WORLD_LIMITS.companyMemory
  const list = world.companyMemory
  if (list.length <= cap) return 0
  const ranked = list
    .map((m, i) => ({ m, i, score: m.importance * (IMPORTANCE_FLOOR + (1 - IMPORTANCE_FLOOR) * halfLife(currentWeek - m.week, IMPORTANCE_HALF_LIFE)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, cap)
    .sort((a, b) => a.i - b.i)
  const dropped = list.length - ranked.length
  world.companyMemory = ranked.map((r) => r.m)
  return dropped
}

export function hasCompanyMemory(world: LivingWorldState, type: CompanyMemoryType): boolean {
  return (world.companyMemory ?? []).some((m) => m.type === type)
}

/** Most recent entry of any of these types at or before `week`. The "since the Series A" lookup. */
export function lastCompanyMemory(
  world: LivingWorldState,
  types: readonly CompanyMemoryType[],
  beforeWeek?: number,
): CompanyMemory | undefined {
  let best: CompanyMemory | undefined
  for (const m of world.companyMemory ?? []) {
    if (!types.includes(m.type)) continue
    if (beforeWeek !== undefined && m.week > beforeWeek) continue
    if (!best || m.week > best.week || (m.week === best.week && m.id > best.id)) best = m
  }
  return best
}

/**
 * The era the company is currently in — the last funding round, pivot, layoff or similar. What
 * "the strongest month since ..." anchors on. Undefined before anything notable has happened.
 */
export function currentEra(world: LivingWorldState, week: number): CompanyMemory | undefined {
  return lastCompanyMemory(world, ERA_COMPANY_MEMORY, week)
}

/**
 * Is `value` a new high for this metric, and what was the previous best? Lets a caller record a
 * record_revenue only when it actually is one, instead of every week the number ticks up.
 */
export function companyRecord(
  world: LivingWorldState,
  type: CompanyMemoryType,
  metadataKey: string,
): { best: number; memory: CompanyMemory } | undefined {
  let out: { best: number; memory: CompanyMemory } | undefined
  for (const m of world.companyMemory ?? []) {
    if (m.type !== type) continue
    const raw = m.metadata?.[metadataKey]
    const v = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(v)) continue
    if (!out || v > out.best) out = { best: v, memory: m }
  }
  return out
}

// ---------- promises ----------

export interface PromiseDraft {
  summaryKey: string
  facts?: Record<string, string | number>
  dueWeek?: number
  importance?: number
  emotionalImpact?: number
  tags?: MemoryTag[]
  sourceId?: string
}

/**
 * A promise is indexed twice on purpose: as a PromiseRecord the callback scanner can walk cheaply
 * every week, and as a memory the character can bring up in their own words. The record is the
 * one that must never be lost, so it is written first and protected from the cap while open.
 */
export function recordPromise(
  world: LivingWorldState,
  characterId: CharacterId,
  week: number,
  draft: PromiseDraft,
): PromiseRecord | null {
  if (!world.characters[characterId]) return null
  if (!Array.isArray(world.promises)) world.promises = []
  const taken = new Set(world.promises.map((p) => p.id))
  const record: PromiseRecord = {
    id: uniqueId(`prm_w${week}_${slug(draft.summaryKey)}`, (id) => taken.has(id)),
    week,
    characterId,
    summaryKey: draft.summaryKey,
    status: 'open',
    importance: clamp100(Math.round(draft.importance ?? MEMORY_TYPE_DEFAULTS.promise.importance)),
  }
  if (draft.facts) record.facts = { ...draft.facts }
  if (draft.dueWeek !== undefined) record.dueWeek = draft.dueWeek
  world.promises.push(record)
  evictPromises(world)

  recordMemory(world, characterId, week, {
    type: 'promise',
    summaryKey: draft.summaryKey,
    tags: draft.tags,
    importance: record.importance,
    emotionalImpact: draft.emotionalImpact,
    actorId: FOUNDER_ID,
    targetId: characterId,
    facts: draft.facts,
    resolved: false,
    sourceId: draft.sourceId ?? record.id,
  })
  return record
}

/**
 * Close a promise. A kept one settles warm and stops competing for attention; a broken one gets
 * *more* important and flips negative — that is the whole point of tracking it (§93).
 */
export function resolvePromise(
  world: LivingWorldState,
  promiseId: string,
  week: number,
  status: Exclude<PromiseStatus, 'open'>,
): PromiseRecord | null {
  const record = (world.promises ?? []).find((p) => p.id === promiseId)
  if (!record || record.status !== 'open') return null
  record.status = status
  record.resolvedWeek = week
  const memory = world.characters[record.characterId]?.memories?.find(
    (m) => m.type === 'promise' && m.summaryKey === record.summaryKey && !m.resolved,
  )
  if (memory) {
    const kept = status === 'kept'
    memory.resolved = true
    memory.emotionalImpact = signed100(kept ? Math.abs(memory.emotionalImpact) : -Math.max(60, Math.abs(memory.emotionalImpact)))
    memory.importance = clamp100(memory.importance + (kept ? -10 : 10))
    if (!kept) memory.tags = mergeTags(memory.tags, ['trust', 'blame'])
  }
  return record
}

/** Open promises whose due week has passed by more than `grace`. Nobody waits forever quietly. */
export function expireDuePromises(world: LivingWorldState, week: number, grace = 4): PromiseRecord[] {
  const out: PromiseRecord[] = []
  for (const p of [...(world.promises ?? [])]) {
    if (p.status !== 'open' || p.dueWeek === undefined) continue
    if (week <= p.dueWeek + grace) continue
    const resolved = resolvePromise(world, p.id, week, 'expired')
    if (resolved) out.push(resolved)
  }
  return out
}

export function openPromises(world: LivingWorldState, characterId?: CharacterId): PromiseRecord[] {
  return (world.promises ?? [])
    .filter((p) => p.status === 'open' && (characterId === undefined || p.characterId === characterId))
    .sort((a, b) => b.importance - a.importance || a.week - b.week || (a.id < b.id ? -1 : 1))
}

/** Open promises that are now overdue but not yet expired — the ones worth a nudge this week. */
export function promisesComingDue(world: LivingWorldState, week: number): PromiseRecord[] {
  return openPromises(world).filter((p) => p.dueWeek !== undefined && week >= p.dueWeek)
}

function evictPromises(world: LivingWorldState): number {
  const cap = LIVING_WORLD_LIMITS.promises
  const list = world.promises
  if (list.length <= cap) return 0
  const ranked = list
    // Open promises outrank every settled one no matter how old: a forgotten commitment is the
    // one thing this index exists to keep.
    .map((p, i) => ({ p, i, score: (p.status === 'open' ? 1000 : 0) + p.importance + p.week * 0.01 }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, cap)
    .sort((a, b) => a.i - b.i)
  const dropped = list.length - ranked.length
  world.promises = ranked.map((r) => r.p)
  return dropped
}

// ---------- weekly maintenance ----------

/**
 * Once per resolved week: expire what has gone stale and re-apply every cap. Idempotent, so a
 * second pass after a reload changes nothing (§72).
 */
export function pruneMemory(world: LivingWorldState, week: number): void {
  expireDuePromises(world, week)
  for (const id of sortedCharacterIds(world)) {
    const c = world.characters[id]
    if (c && Array.isArray(c.memories)) evictMemories(c, week)
  }
  evictCompanyMemory(world, week)
  evictPromises(world)
}

// ---------- save normalization ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

function normalizeFacts(v: unknown): Record<string, string | number> | undefined {
  if (!isRecord(v)) return undefined
  const out: Record<string, string | number> = {}
  for (const k of Object.keys(v).sort()) {
    const val = v[k]
    if (typeof val === 'string' || (typeof val === 'number' && Number.isFinite(val))) out[k] = val
  }
  return out
}

const asTags = (v: unknown): MemoryTag[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && !!t) : [])

/**
 * Repair the memory-owned parts of a slice loaded from localStorage. A save written by an older
 * build can be missing arrays entirely or carry rows a since-tightened type no longer allows;
 * dropping the malformed row is always right, because memory is interpretation and losing one is
 * survivable in a way that losing a simulation field is not.
 */
export function normalizeMemoryState(world: LivingWorldState, week: number): LivingWorldState {
  if (!isRecord(world.characters)) world.characters = {}
  for (const id of sortedCharacterIds(world)) {
    const c = world.characters[id]
    if (!c) continue
    const raw = Array.isArray(c.memories) ? c.memories : []
    const seen = new Set<string>()
    c.memories = raw.flatMap((m) => {
      if (!isRecord(m) || typeof m.id !== 'string' || typeof m.summaryKey !== 'string') return []
      if (typeof m.type !== 'string' || !(m.type in MEMORY_TYPE_DEFAULTS)) return []
      if (seen.has(m.id)) return []
      seen.add(m.id)
      const item: MemoryItem = {
        id: m.id,
        week: Math.max(0, Math.round(num(m.week, 0))),
        type: m.type as MemoryType,
        importance: clamp100(num(m.importance, MEMORY_TYPE_DEFAULTS[m.type as MemoryType].importance)),
        emotionalImpact: signed100(num(m.emotionalImpact, 0)),
        tags: asTags(m.tags),
        summaryKey: m.summaryKey,
      }
      if (typeof m.actorId === 'string') item.actorId = m.actorId
      if (typeof m.targetId === 'string') item.targetId = m.targetId
      const facts = normalizeFacts(m.facts)
      if (facts) item.facts = facts
      if (typeof m.resolved === 'boolean') item.resolved = m.resolved
      if (typeof m.sourceId === 'string') item.sourceId = m.sourceId
      return [item]
    })
    evictMemories(c, week)
  }

  const rawCompany = Array.isArray(world.companyMemory) ? world.companyMemory : []
  const seenCompany = new Set<string>()
  world.companyMemory = rawCompany.flatMap((m) => {
    if (!isRecord(m) || typeof m.id !== 'string') return []
    if (typeof m.type !== 'string' || !(m.type in COMPANY_MEMORY_DEFAULTS)) return []
    if (seenCompany.has(m.id)) return []
    seenCompany.add(m.id)
    const type = m.type as CompanyMemoryType
    const entry: CompanyMemory = {
      id: m.id,
      week: Math.max(0, Math.round(num(m.week, 0))),
      type,
      importance: clamp100(num(m.importance, COMPANY_MEMORY_DEFAULTS[type].importance)),
      metadata: normalizeFacts(m.metadata) ?? {},
    }
    if (Array.isArray(m.characterIds)) {
      const ids = m.characterIds.filter((v): v is string => typeof v === 'string')
      if (ids.length) entry.characterIds = ids
    }
    return [entry]
  })
  evictCompanyMemory(world, week)

  const rawPromises = Array.isArray(world.promises) ? world.promises : []
  const seenPromises = new Set<string>()
  world.promises = rawPromises.flatMap((p) => {
    if (!isRecord(p) || typeof p.id !== 'string' || typeof p.characterId !== 'string') return []
    if (typeof p.summaryKey !== 'string' || seenPromises.has(p.id)) return []
    seenPromises.add(p.id)
    const status: PromiseStatus =
      p.status === 'kept' || p.status === 'broken' || p.status === 'expired' ? p.status : 'open'
    const record: PromiseRecord = {
      id: p.id,
      week: Math.max(0, Math.round(num(p.week, 0))),
      characterId: p.characterId,
      summaryKey: p.summaryKey,
      status,
      importance: clamp100(num(p.importance, MEMORY_TYPE_DEFAULTS.promise.importance)),
    }
    const facts = normalizeFacts(p.facts)
    if (facts) record.facts = facts
    if (typeof p.dueWeek === 'number' && Number.isFinite(p.dueWeek)) record.dueWeek = Math.round(p.dueWeek)
    if (typeof p.resolvedWeek === 'number' && Number.isFinite(p.resolvedWeek)) record.resolvedWeek = Math.round(p.resolvedWeek)
    return [record]
  })
  evictPromises(world)
  return world
}

// ---------- capability-gated entry points ----------
//
// What a simulation step actually calls. These branch on hasCapability, never on mode — a run
// without the capability records nothing and behaves exactly as it did before this module existed.

function activeCharacterIds(world: LivingWorldState): CharacterId[] {
  return sortedCharacterIds(world).filter((id) => {
    const c = world.characters[id]
    return !!c && c.status === 'active' && c.id !== FOUNDER_ID
  })
}

/** Record a personal memory for one character, if this run remembers anything at all. */
export function noteCharacterEvent(
  s: GameState,
  characterId: CharacterId,
  draft: MemoryDraft,
  perspective: MemoryPerspective = 'subject',
): MemoryItem | null {
  if (!s.world || !hasCapability(s, 'characterMemory')) return null
  return recordMemory(s.world, characterId, s.week, draft, perspective)
}

/** Record the same event across several rememberers, each at their own distance from it. */
export function noteSharedEvent(
  s: GameState,
  characterIds: readonly CharacterId[],
  draft: MemoryDraft,
  opts: { subjectId?: CharacterId; witnessPerspective?: MemoryPerspective } = {},
): MemoryItem[] {
  if (!s.world || !hasCapability(s, 'characterMemory')) return []
  return recordSharedMemory(s.world, characterIds, s.week, draft, opts)
}

/**
 * Record a company-level fact. The personal side of `draft.remember` is dropped when the run has
 * companyMemory but not characterMemory, so each capability buys exactly its own system.
 */
export function noteCompanyEvent(s: GameState, type: CompanyMemoryType, draft: CompanyMemoryDraft = {}): CompanyMemory | null {
  if (!s.world || !hasCapability(s, 'companyMemory')) return null
  const withRemember = hasCapability(s, 'characterMemory') ? draft : { ...draft, remember: undefined }
  return recordCompanyMemory(s.world, s.week, type, withRemember)
}

export function notePromise(s: GameState, characterId: CharacterId, draft: PromiseDraft): PromiseRecord | null {
  if (!s.world || !hasCapability(s, 'promises')) return null
  return recordPromise(s.world, characterId, s.week, draft)
}

export function settlePromise(s: GameState, promiseId: string, status: Exclude<PromiseStatus, 'open'>): PromiseRecord | null {
  if (!s.world || !hasCapability(s, 'promises')) return null
  return resolvePromise(s.world, promiseId, s.week, status)
}

/**
 * The once-per-week call. Cheap enough to run unconditionally when the slice exists: it does no
 * generation, only expiry and capping.
 */
export function tickMemory(s: GameState): void {
  if (!s.world) return
  if (hasCapability(s, 'promises')) expireDuePromises(s.world, s.week)
  pruneMemory(s.world, s.week)
}
