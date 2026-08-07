// The procedural narrative composer — §17-20.
//
// Given facts the simulation already produced, a character and what that character remembers,
// build a message out of sentence-sized fragments. Nothing in this file decides an outcome: it
// interprets. If it cannot say something specific and in-character it returns null and the
// surface says nothing, which is always better than a generic line.
//
// Three rules hold the whole thing up:
//
//   DETERMINISM  Every draw comes from a stream keyed by (run seed, narrative id) — not from the
//                global RNG hook. Composing message B must not change what message A would have
//                said, so the director can compose in any order, retry, or compose lazily on a
//                surface open without the text ever changing. Math.random and Date.now are never
//                reachable from here.
//   ELIGIBILITY  A fragment is only spoken when its conditions hold AND every {slot} it mentions
//                was supplied. A message with a visible {role} in it is worse than no message.
//   REPETITION   §20. A fragment that was used recently is *removed* from the draw, not merely
//                down-weighted, while any untired alternative exists. Down-weighting alone still
//                repeats — with six fragments a week and a 20-deep pool, the same opening comes
//                back inside a month and the world stops feeling written.

import { hasCapability, type CapabilityKey, type GameCapabilities } from '../modes'
import type {
  Character,
  CharacterId,
  Fragment,
  FragmentLibrary,
  FragmentSlots,
  FragmentType,
  LivingWorldDepth,
  MemoryItem,
  MemoryTag,
  NarrativeEntry,
  NarrativeHistory,
  NarrativeSurface,
  NarrativeUsageState,
  RelationshipScores,
} from './types'
import { LIVING_WORLD_LIMITS } from './types'
import { EMPLOYEE_FRAGMENTS } from './content/composer-employee'
import { MEDIA_FRAGMENTS } from './content/composer-media'
import { shapesFor, type MessageShape } from './content/composer-shapes'
export type { MessageShape } from './content/composer-shapes'

/** Everything shipped today. Callers may pass their own library; this is the default. */
export const DEFAULT_FRAGMENT_LIBRARY: FragmentLibrary = { ...EMPLOYEE_FRAGMENTS, ...MEDIA_FRAGMENTS }

// Sized against the caps in LIVING_WORLD_LIMITS: recentFragmentIds holds 60 ids and a message
// spends 4-6 of them, so ~12 weeks of one-message-a-week history is what the buffer can actually
// remember. A longer cooldown than the buffer can back would silently degrade to no cooldown.
export const FRAGMENT_COOLDOWN_WEEKS = 12
export const PATTERN_COOLDOWN_WEEKS = 4

const TAG_REPEAT_PENALTY = 0.6
const TAG_PENALTY_FLOOR = 0.15
const PATTERN_REPEAT_PENALTY = 0.2
const PATTERN_JUST_USED_PENALTY = 0.04
/** Only reached when every eligible fragment is on cooldown: prefer the one used longest ago. */
const EXHAUSTED_POOL_BASE = 0.05

// ---------- deterministic stream ----------

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

/** FNV-1a. The narrative id is the only thing that varies per message, so it must mix well. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * The composer's own stream, keyed by the run seed and the narrative id rather than by the
 * engine's (seed, week, tick) hook. Deliberate: a tick-based stream makes a message's wording
 * depend on how many other things were composed first, which breaks replay the moment the
 * director's ordering changes or a surface composes lazily.
 */
export function makeNarrativeRng(seed: number, id: string): () => number {
  return mulberry32((hashString(id) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0)
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** §67: 'w48_employee-anna_external-cto'. Same inputs, same id — that is the reload guard. */
export function narrativeId(week: number, ...parts: (string | number | undefined | null)[]): string {
  const tail = parts
    .filter((p): p is string | number => p !== undefined && p !== null && p !== '')
    .map((p) => slugify(String(p)))
    .filter((p) => p.length > 0)
  return [`w${week}`, ...tail].join('_')
}

// ---------- slots ----------

const SLOT_RE = /\{([a-zA-Z0-9_]+)\}/g

// Fragment text is module-scope content and never changes, so the slot names in it are worth
// extracting once.
const slotNameCache = new Map<string, readonly string[]>()

export function fragmentSlotNames(text: string): readonly string[] {
  const hit = slotNameCache.get(text)
  if (hit) return hit
  const names: string[] = []
  for (const m of text.matchAll(SLOT_RE)) if (!names.includes(m[1])) names.push(m[1])
  slotNameCache.set(text, names)
  return names
}

// Grouping only above 10k: week numbers, percentages and counts read wrong as "1,200". Grouped by
// hand rather than through toLocaleString, which depends on the host's ICU build and would make
// the same save render differently on two machines.
function formatSlotValue(v: string | number): string {
  if (typeof v === 'string') return v
  if (!Number.isFinite(v)) return ''
  if (!Number.isInteger(v)) return String(Math.round(v * 10) / 10)
  if (Math.abs(v) < 10_000) return String(v)
  const sign = v < 0 ? '-' : ''
  const digits = String(Math.abs(v))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return sign + out
}

export function fillSlots(text: string, slots: FragmentSlots): string {
  return text.replace(SLOT_RE, (whole, name: string) => {
    const v = slots[name]
    return v === undefined ? whole : formatSlotValue(v)
  })
}

// ---------- eligibility ----------

export interface FragmentContext {
  week: number
  tags: readonly MemoryTag[]
  slots: FragmentSlots
  character?: Character
  /** The speaker's view of the other party — normally their row pointing at the founder. */
  relationship?: RelationshipScores
  capabilities?: Partial<GameCapabilities>
  depth?: LivingWorldDepth
}

function withinMin(actual: Record<string, number>, min: Partial<Record<string, number>> | undefined): boolean {
  if (!min) return true
  for (const k of Object.keys(min)) {
    const bound = min[k]
    if (bound !== undefined && (actual[k] ?? 0) < bound) return false
  }
  return true
}

function withinMax(actual: Record<string, number>, max: Partial<Record<string, number>> | undefined): boolean {
  if (!max) return true
  for (const k of Object.keys(max)) {
    const bound = max[k]
    if (bound !== undefined && (actual[k] ?? 0) > bound) return false
  }
  return true
}

/**
 * Character gates fail CLOSED. A line written for someone blunt and mistrustful must not be
 * spoken by a nameless narrator just because no character was passed in.
 */
export function isFragmentEligible(f: Fragment, ctx: FragmentContext): boolean {
  for (const name of fragmentSlotNames(f.text)) if (ctx.slots[name] === undefined) return false
  const c = f.conditions
  if (!c) return true
  if (c.minWeek !== undefined && ctx.week < c.minWeek) return false
  if (c.depths && (ctx.depth === undefined || !c.depths.includes(ctx.depth))) return false
  if (c.requiresCapabilities) {
    for (const k of c.requiresCapabilities as CapabilityKey[]) {
      if (!hasCapability({ capabilities: ctx.capabilities }, k)) return false
    }
  }
  if (c.requiresTags) for (const t of c.requiresTags) if (!ctx.tags.includes(t)) return false
  if (c.forbidsTags) for (const t of c.forbidsTags) if (ctx.tags.includes(t)) return false

  if (c.styles || c.roles || c.motivations || c.personalityMin || c.personalityMax) {
    const ch = ctx.character
    if (!ch) return false
    if (c.styles && !c.styles.includes(ch.communicationStyle)) return false
    if (c.roles && !c.roles.includes(ch.role)) return false
    if (c.motivations) {
      const mine = [ch.motivations.primary, ...ch.motivations.secondary]
      if (!c.motivations.some((m) => mine.includes(m))) return false
    }
    const p = ch.personality as unknown as Record<string, number>
    if (!withinMin(p, c.personalityMin as Record<string, number>)) return false
    if (!withinMax(p, c.personalityMax as Record<string, number>)) return false
  }

  if (c.relationshipMin || c.relationshipMax) {
    const r = ctx.relationship
    if (!r) return false
    const rr = r as unknown as Record<string, number>
    if (!withinMin(rr, c.relationshipMin as Record<string, number>)) return false
    if (!withinMax(rr, c.relationshipMax as Record<string, number>)) return false
  }
  return true
}

export function eligibleFragments(pool: readonly Fragment[], ctx: FragmentContext): Fragment[] {
  return pool.filter((f) => isFragmentEligible(f, ctx))
}

// ---------- seeded weighted selection ----------

export function weightedPick<T>(items: readonly T[], weightOf: (item: T) => number, rng: () => number): T | undefined {
  if (items.length === 0) return undefined
  let total = 0
  for (const it of items) total += Math.max(0, weightOf(it))
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
  let roll = rng() * total
  for (const it of items) {
    roll -= Math.max(0, weightOf(it))
    if (roll <= 0) return it
  }
  return items[items.length - 1]
}

export function createNarrativeUsage(): NarrativeUsageState {
  return { recentFragmentIds: [], recentTags: [], recentPatterns: [], lastUsedWeek: {} }
}

export function createNarrativeHistory(): NarrativeHistory {
  return { entries: [], usage: createNarrativeUsage(), emitted: {} }
}

const EMPTY_USAGE = createNarrativeUsage()

function onCooldown(f: Fragment, usage: NarrativeUsageState, week: number): boolean {
  if (usage.recentFragmentIds.includes(f.id)) return true
  const last = usage.lastUsedWeek[f.id]
  return last !== undefined && week - last < FRAGMENT_COOLDOWN_WEEKS
}

// Tag fatigue is what stops six different fragments from all being about compensation. Each
// recent occurrence of one of the fragment's tags multiplies its weight down, with a floor so a
// tag-heavy fragment stays reachable.
function tagFatigue(f: Fragment, usage: NarrativeUsageState): number {
  let hits = 0
  for (const t of f.tags) for (const r of usage.recentTags) if (r === t) hits++
  if (hits === 0) return 1
  return Math.max(TAG_PENALTY_FLOOR, TAG_REPEAT_PENALTY ** hits)
}

export interface SelectionState {
  week: number
  usage?: NarrativeUsageState
  /** Fragment ids already spent on THIS message — never repeat a line inside one message. */
  used?: readonly string[]
}

/**
 * Two-tier draw. Tier one is everything eligible and off cooldown; only when that is empty does
 * the pool fall back to tired fragments, ordered so the least recently used wins. This is the
 * difference between "prefers not to repeat" and "does not repeat".
 */
export function selectFragment(
  pool: readonly Fragment[],
  ctx: FragmentContext,
  rng: () => number,
  sel: SelectionState,
): Fragment | undefined {
  const usage = sel.usage ?? EMPTY_USAGE
  const eligible = pool.filter((f) => !sel.used?.includes(f.id) && isFragmentEligible(f, ctx))
  if (eligible.length === 0) return undefined
  const fresh = eligible.filter((f) => !onCooldown(f, usage, sel.week))
  if (fresh.length > 0) return weightedPick(fresh, (f) => Math.max(0.01, f.weight) * tagFatigue(f, usage), rng)
  return weightedPick(
    eligible,
    (f) => {
      const last = usage.lastUsedWeek[f.id]
      const age = last === undefined ? FRAGMENT_COOLDOWN_WEEKS : Math.max(0, sel.week - last)
      return Math.max(0.01, f.weight) * (EXHAUSTED_POOL_BASE + age) * tagFatigue(f, usage)
    },
    rng,
  )
}

// ---------- memory callback ----------

export interface MemoryContext {
  week: number
  tags: readonly MemoryTag[]
}

/**
 * §14. Importance, recency, tag overlap, emotional strength and unresolved status. Deliberately
 * NOT the memory module's authoritative scorer — this one answers a narrower question: is this
 * memory worth *bringing up right now*, in this message.
 */
export function scoreMemoryForCallback(m: MemoryItem, ctx: MemoryContext): number {
  const age = Math.max(0, ctx.week - m.week)
  const recency = 1 / (1 + age / 26)
  let overlap = 0
  for (const t of m.tags) if (ctx.tags.includes(t)) overlap++
  let score = m.importance * (0.35 + 0.65 * recency)
  score += overlap * 18
  score += Math.abs(m.emotionalImpact) * 0.25
  if (m.resolved !== true) score += 15
  return score
}

const CALLBACK_FLOOR = 45

/**
 * Old events surface only when they are relevant: a memory with no tag overlap has to be near
 * career-defining (importance >= 75) to earn a callback at all.
 */
export function selectMemoryCallback(memories: readonly MemoryItem[] | undefined, ctx: MemoryContext): MemoryItem | undefined {
  if (!memories || memories.length === 0) return undefined
  const scored = memories
    .filter((m) => m.week <= ctx.week)
    .filter((m) => m.importance >= 75 || m.tags.some((t) => ctx.tags.includes(t)))
    .map((m) => ({ m, score: scoreMemoryForCallback(m, ctx) }))
    .filter((x) => x.score >= CALLBACK_FLOOR)
  if (scored.length === 0) return undefined
  // Sort is fully ordered (score, then week, then id) so two equal memories never swap on replay.
  scored.sort((a, b) => b.score - a.score || b.m.week - a.m.week || (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0))
  return scored[0].m
}

// ---------- composition ----------

export interface ComposeInput {
  /** The run seed (config.seed). With the narrative id it fixes every draw in this message. */
  seed: number
  week: number
  surface: NarrativeSurface
  /** Which story this is an instance of, for cooldowns on the beat rather than the wording. */
  beatKey: string
  /** Pool namespace: 'employee' resolves 'employee.opening', 'employee.reaction', … */
  audience: string
  /** Supply for a stable id (§67). Derived from week/audience/character/beat when absent. */
  id?: string
  character?: Character
  relationship?: RelationshipScores
  /** What the simulation says just happened. Drives requiresTags/forbidsTags. */
  tags?: readonly MemoryTag[]
  slots?: FragmentSlots
  /** Callback candidates. Defaults to the character's own memories. */
  memories?: readonly MemoryItem[]
  /** Force a specific callback (the director already picked one) or `null` to suppress it. */
  memory?: MemoryItem | null
  capabilities?: Partial<GameCapabilities>
  depth?: LivingWorldDepth
  usage?: NarrativeUsageState
  library?: FragmentLibrary
  shapes?: readonly MessageShape[]
  /** Escape hatch for callers that already own a seeded stream. Normally omitted. */
  rng?: () => number
}

export interface ComposedNarrative {
  id: string
  week: number
  surface: NarrativeSurface
  beatKey: string
  characterId?: CharacterId
  /** Inbox title / headline. */
  subject: string
  /** Paragraphs, already joined with blank lines. */
  body: string
  /** subject + body, for surfaces that render one blob. */
  text: string
  fragmentIds: string[]
  /** Structure identity, recorded for §20 pattern cooldowns. */
  shapeKey: string
  /** The realised skeleton, e.g. 'opening|memory+reaction+request'. Diagnostics and tests. */
  pattern: string
  tags: MemoryTag[]
  memoryIds: string[]
  slots: FragmentSlots
}

const ROLE_LABEL: Record<string, string> = {
  employee: 'the team',
  executive: 'the leadership team',
  investor: 'an investor',
  board_member: 'the board',
  customer: 'a customer',
  rival_founder: 'a rival founder',
  recruiter: 'a recruiter',
  journalist: 'a reporter',
  advisor: 'an advisor',
  founder: 'the founder',
}

function characterSlots(ch: Character | undefined): FragmentSlots {
  if (!ch) return {}
  return {
    firstName: ch.firstName,
    lastName: ch.lastName,
    fullName: `${ch.firstName} ${ch.lastName}`.trim(),
    title: ch.title ?? ROLE_LABEL[ch.role] ?? ch.role,
    speakerRole: ch.title ?? ROLE_LABEL[ch.role] ?? ch.role,
  }
}

function memorySlots(m: MemoryItem, week: number): FragmentSlots {
  const out: FragmentSlots = { mem_week: m.week, mem_weeksAgo: Math.max(0, week - m.week), mem_key: m.summaryKey }
  if (m.facts) for (const [k, v] of Object.entries(m.facts)) out[`mem_${k}`] = v
  return out
}

const ENDS_SENTENCE = /[.!?"”')\]]$/

function joinLine(parts: readonly string[], punctuate: boolean): string {
  const line = parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!line) return ''
  return punctuate && !ENDS_SENTENCE.test(line) ? `${line}.` : line
}

function poolFor(library: FragmentLibrary, audience: string, type: FragmentType): readonly Fragment[] {
  return library[`${audience}.${type}`] ?? []
}

/**
 * Build one message. Returns null when the content library cannot say anything specific enough —
 * the caller must then stay silent rather than fall back to a generic line.
 */
export function composeNarrative(input: ComposeInput): ComposedNarrative | null {
  const library = input.library ?? DEFAULT_FRAGMENT_LIBRARY
  const shapes = input.shapes ?? shapesFor(input.audience)
  if (shapes.length === 0) return null

  const id =
    input.id ?? narrativeId(input.week, input.audience, input.character ? input.character.id : undefined, input.beatKey)
  const rng = input.rng ?? makeNarrativeRng(input.seed, id)
  const usage = input.usage ?? EMPTY_USAGE
  const situationTags = input.tags ?? []

  const memory =
    input.memory === null
      ? undefined
      : (input.memory ?? selectMemoryCallback(input.memories ?? input.character?.memories, { week: input.week, tags: situationTags }))

  const slots: FragmentSlots = {
    week: input.week,
    ...characterSlots(input.character),
    ...(memory ? memorySlots(memory, input.week) : {}),
    ...(input.slots ?? {}),
  }

  const base: FragmentContext = {
    week: input.week,
    tags: situationTags,
    slots,
    character: input.character,
    relationship: input.relationship,
    capabilities: input.capabilities,
    depth: input.depth,
  }
  // The memory's own tags open up memory fragments without bleeding into every other slot: a
  // callback about a broken promise must not make the whole message read as if a promise was
  // just made this week.
  const memoryCtx: FragmentContext = memory
    ? { ...base, tags: [...situationTags, ...memory.tags.filter((t) => !situationTags.includes(t))] }
    : base
  const ctxFor = (type: FragmentType): FragmentContext => (type === 'memory' ? memoryCtx : base)

  const usableShapes = shapes.filter((shape) =>
    (shape.required ?? []).every((type) => {
      if (type === 'memory' && !memory) return false
      return poolFor(library, input.audience, type).some((f) => isFragmentEligible(f, ctxFor(type)))
    }),
  )
  if (usableShapes.length === 0) return null

  const recentPatterns = usage.recentPatterns
  const shape = weightedPick(
    usableShapes,
    (s) => {
      const idx = recentPatterns.lastIndexOf(s.key)
      if (idx < 0) return Math.max(0.01, s.weight ?? 1)
      const sinceUses = recentPatterns.length - 1 - idx
      const penalty = sinceUses < PATTERN_COOLDOWN_WEEKS ? PATTERN_JUST_USED_PENALTY : PATTERN_REPEAT_PENALTY
      return Math.max(0.01, s.weight ?? 1) * penalty
    },
    rng,
  )
  if (!shape) return null

  const used: string[] = []
  const chosen: Fragment[] = []
  const take = (type: FragmentType): string | undefined => {
    if (type === 'memory' && !memory) return undefined
    const f = selectFragment(poolFor(library, input.audience, type), ctxFor(type), rng, {
      week: input.week,
      usage,
      used,
    })
    if (!f) return undefined
    used.push(f.id)
    chosen.push(f)
    return fillSlots(f.text, slots)
  }

  const subjectParts: string[] = []
  const subjectTypes: FragmentType[] = []
  for (const type of shape.subject) {
    const text = take(type)
    if (text) {
      subjectParts.push(text)
      subjectTypes.push(type)
    }
  }
  const bodyParts: string[] = []
  const bodyTypes: FragmentType[] = []
  for (const type of shape.body) {
    const text = take(type)
    if (text) {
      bodyParts.push(joinLine([text], true))
      bodyTypes.push(type)
    }
  }

  const subject = joinLine(subjectParts, shape.punctuateSubject !== false)
  if (!subject && bodyParts.length === 0) return null

  // Required types that lost their draw (all eligible fragments already spent on this message)
  // invalidate the shape — half a message is worse than none.
  for (const type of shape.required ?? []) {
    if (!subjectTypes.includes(type) && !bodyTypes.includes(type)) return null
  }

  const body = bodyParts.join('\n\n')
  const tags: MemoryTag[] = []
  for (const f of chosen) for (const t of f.tags) if (!tags.includes(t)) tags.push(t)

  return {
    id,
    week: input.week,
    surface: input.surface,
    beatKey: input.beatKey,
    characterId: input.character?.id,
    subject,
    body,
    text: body ? `${subject}\n\n${body}` : subject,
    fragmentIds: used,
    shapeKey: shape.key,
    pattern: `${subjectTypes.join('+')}|${bodyTypes.join('+')}`,
    tags,
    memoryIds: memory ? [memory.id] : [],
    slots,
  }
}

/** §48 media, with the media pools and headline shapes already selected. */
export function composeHeadline(input: Omit<ComposeInput, 'surface' | 'audience'> & { audience?: string }): ComposedNarrative | null {
  return composeNarrative({ ...input, surface: 'media', audience: input.audience ?? 'media' })
}

// ---------- repetition control state (§20) ----------

const tail = <T>(arr: readonly T[], n: number): T[] => (arr.length <= n ? arr.slice() : arr.slice(arr.length - n))

/**
 * Fold a composed message into the usage buffers. Pure: returns a new state, mutates nothing, so
 * a caller can compose speculatively and only record what it actually shows.
 */
export function recordNarrativeUsage(usage: NarrativeUsageState, composed: ComposedNarrative): NarrativeUsageState {
  const lastUsedWeek = { ...usage.lastUsedWeek }
  for (const fid of composed.fragmentIds) lastUsedWeek[fid] = composed.week
  const recentFragmentIds = tail([...usage.recentFragmentIds, ...composed.fragmentIds], LIVING_WORLD_LIMITS.recentFragmentIds)
  // lastUsedWeek is the long memory, but it must not grow without bound: an id that has fallen
  // out of the buffer AND out of its cooldown window can no longer change any decision.
  const keep = new Set(recentFragmentIds)
  for (const fid of Object.keys(lastUsedWeek)) {
    if (!keep.has(fid) && composed.week - lastUsedWeek[fid] >= FRAGMENT_COOLDOWN_WEEKS) delete lastUsedWeek[fid]
  }
  return {
    recentFragmentIds,
    recentTags: tail([...usage.recentTags, ...composed.tags], LIVING_WORLD_LIMITS.recentTags),
    recentPatterns: tail([...usage.recentPatterns, composed.shapeKey], LIVING_WORLD_LIMITS.recentPatterns),
    lastUsedWeek,
  }
}

/** The reload guard from §67 — `entries` is capped, so dedupe reads `emitted`, which is not. */
export function hasEmittedNarrative(history: NarrativeHistory | undefined, id: string): boolean {
  return history?.emitted[id] !== undefined
}

/** Keeps roughly four caps' worth of ids: long enough that a pruned id can never be re-emitted. */
const EMITTED_KEEP = LIVING_WORLD_LIMITS.narrativeEntries * 4

/**
 * Append a told story and update the usage buffers in one step. Pure — returns a new history.
 * Re-recording the same narrative id is a no-op, which is what makes a double pass over the same
 * week after a reload harmless.
 */
export function recordNarrative(history: NarrativeHistory, composed: ComposedNarrative, messageId?: string): NarrativeHistory {
  if (history.emitted[composed.id] !== undefined) return history
  const entry: NarrativeEntry = {
    id: composed.id,
    week: composed.week,
    surface: composed.surface,
    beatKey: composed.beatKey,
    fragmentIds: composed.fragmentIds,
  }
  if (composed.characterId) entry.characterId = composed.characterId
  if (messageId) entry.messageId = messageId

  const emitted: Record<string, number> = { ...history.emitted, [composed.id]: composed.week }
  const ids = Object.keys(emitted)
  if (ids.length > EMITTED_KEEP) {
    // Oldest first, id as the tiebreak so pruning is identical on every machine.
    ids.sort((a, b) => emitted[a] - emitted[b] || (a < b ? -1 : a > b ? 1 : 0))
    for (const dead of ids.slice(0, ids.length - EMITTED_KEEP)) delete emitted[dead]
  }
  return {
    entries: tail([...history.entries, entry], LIVING_WORLD_LIMITS.narrativeEntries),
    usage: recordNarrativeUsage(history.usage, composed),
    emitted,
  }
}

/** Has this beat been told recently, regardless of how it was worded? Cooldowns on the story. */
export function weeksSinceBeat(history: NarrativeHistory | undefined, beatKey: string, characterId?: CharacterId): number | undefined {
  if (!history) return undefined
  let last: number | undefined
  for (const e of history.entries) {
    if (e.beatKey !== beatKey) continue
    if (characterId !== undefined && e.characterId !== characterId) continue
    if (last === undefined || e.week > last) last = e.week
  }
  return last
}

// ---------- authoring guard ----------

/**
 * Content lint, for tests rather than runtime: duplicate ids silently break cooldowns (two lines
 * sharing an id retire each other), and a fragment in the wrong pool never gets drawn.
 */
export function validateFragmentLibrary(library: FragmentLibrary = DEFAULT_FRAGMENT_LIBRARY): string[] {
  const problems: string[] = []
  const seen = new Map<string, string>()
  for (const poolId of Object.keys(library).sort()) {
    const expected = poolId.split('.')[1]
    for (const f of library[poolId]) {
      const prev = seen.get(f.id)
      if (prev) problems.push(`duplicate fragment id '${f.id}' in ${poolId} and ${prev}`)
      else seen.set(f.id, poolId)
      if (f.type !== expected) problems.push(`fragment '${f.id}' is a ${f.type} but sits in ${poolId}`)
      if (!(f.weight > 0)) problems.push(`fragment '${f.id}' has a non-positive weight`)
      if (f.text.trim().length === 0) problems.push(`fragment '${f.id}' has no text`)
    }
  }
  return problems
}
