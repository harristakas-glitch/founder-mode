// The Procedural Living World — the shared type surface.
//
// One rule governs every type in this file: SIMULATION IS AUTHORITATIVE. Nothing here decides
// an outcome. Characters, memories and fragments only interpret facts the simulation already
// produced, which is why none of these types carry effects, deltas or modifiers.
//
//   SIMULATION → CHARACTERS → MEMORY/RELATIONSHIPS → DIRECTOR → COMPOSER → SURFACES
//
// Constraints these shapes are built around:
//   PERSISTED   — LivingWorldState is partialized into localStorage as JSON and structuredClone'd
//                 on every action. Plain objects and arrays only: no Map, no Set, no Date, no
//                 class instances, no functions. Every array has a cap in LIVING_WORLD_LIMITS.
//   DETERMINISTIC — everything is generated from (config.seed, a stable id). Generators take an
//                 injected `rng`/`uid` the way career/tick.ts does; nothing in this subsystem
//                 reaches for Math.random or the global RNG hook.
//   OPTIONAL    — the slice is absent on every save written before it existed and on any run
//                 whose livingWorldDepth is 'off'. Readers must tolerate undefined.

import type { TraitId } from '../types'
import type { CapabilityKey } from '../modes'

/**
 * How much of the living world a run gets. Lives on GameRules next to pmfDepth/employeeDepth.
 * Depth sets the *shape* of the experience; individual capabilities still gate each system, so
 * a system can be switched off in a deep run without inventing a new depth.
 */
export type LivingWorldDepth = 'off' | 'light' | 'deep' | 'competitive'

/**
 * Deliberately the SAME string as the Employee/Candidate/Rival id it shadows. `hire` reuses the
 * candidate's id for the employee it creates, so a character keyed this way survives the
 * candidate → offer → employee transition for free and needs no re-linking.
 */
export type CharacterId = string

/** The player. Relationships point at the founder like any other party, so this id must be shared. */
export const FOUNDER_ID: CharacterId = 'founder'

/** Undefined companyId means the player's company. Rivals and customers carry their own. */
export type CompanyId = string

// ---------- who exists ----------

export type CharacterRole =
  | 'employee'
  | 'executive'
  | 'investor'
  | 'board_member'
  | 'customer'
  | 'rival_founder'
  | 'recruiter'
  | 'journalist'
  | 'advisor'
  | 'founder'

/**
 * 'prospect' is someone known but not engaged (a candidate, a target account). 'departed' people
 * are kept rather than deleted: other characters remember them, and they can come back.
 */
export type CharacterStatus = 'prospect' | 'active' | 'departed'

/** 0–100 on every dimension. Never rendered as a number — converted to observations by the composer. */
export interface CharacterPersonality {
  directness: number
  ambition: number
  patience: number
  loyalty: number
  optimism: number
  ego: number
  riskTolerance: number
  empathy: number
}

export type PersonalityDimension = keyof CharacterPersonality

/** Drives openings, sentence shape, vocabulary and closings so players learn to recognise voices. */
export type CommunicationStyle = 'direct' | 'warm' | 'formal' | 'analytical' | 'enthusiastic' | 'blunt' | 'cautious'

export type CharacterMotivation =
  | 'money'
  | 'career_progression'
  | 'status'
  | 'autonomy'
  | 'mission'
  | 'learning'
  | 'stability'
  | 'power'
  | 'winning'
  | 'recognition'
  | 'work_life_balance'

/**
 * Primary and secondary are separate fields rather than one ordered array: the ranking is what
 * makes two characters react differently to the same event, and array order is too easy to lose
 * through a sort or a JSON round-trip.
 */
export interface CharacterMotivations {
  primary: CharacterMotivation
  /** At most two. */
  secondary: CharacterMotivation[]
}

// ---------- background ----------

export type CareerStage = 'rising' | 'established' | 'veteran'

export type PreviousEnvironment = 'startup' | 'scaleup' | 'corporate' | 'consulting' | 'agency' | 'university'

export type BackgroundStrength =
  | 'ships_fast'
  | 'deep_technical'
  | 'closes_enterprise'
  | 'operational_rigour'
  | 'design_taste'
  | 'data_driven'
  | 'recruits_well'
  | 'calm_in_crisis'
  | 'first_principles'
  | 'customer_obsessed'

export type BackgroundWeakness =
  | 'avoids_conflict'
  | 'over_promises'
  | 'poor_delegation'
  | 'perfectionist'
  | 'impatient'
  | 'process_heavy'
  | 'unproven_at_scale'
  | 'burns_out'
  | 'territorial'
  | 'weak_written_comms'

/** Split into two unions so a generator cannot hand someone 'burns_out' as their notable strength. */
export type BackgroundTrait = BackgroundStrength | BackgroundWeakness

export type JoinMotivation =
  | 'equity'
  | 'mission'
  | 'the_problem'
  | 'the_founder'
  | 'escaping_bigco'
  | 'title'
  | 'money'
  | 'learning'
  | 'reputation'

export interface CharacterBackground {
  careerStage: CareerStage
  previousEnvironment: PreviousEnvironment
  yearsExperience: number
  notableStrength: BackgroundStrength
  knownWeakness?: BackgroundWeakness
  reasonForJoining?: JoinMotivation
  /**
   * The composed one-or-two-sentence bio, cached on first render. Prose is generated once and
   * persisted rather than recomputed — §68/§72. Absent until someone asks for it.
   */
  bio?: string
}

// ---------- relationships ----------

/** 0–100. Never shown as numbers; surfaced as "Trust: Strong", "Alignment: Mixed". */
export interface RelationshipScores {
  trust: number
  respect: number
  alignment: number
  dependence: number
}

export type RelationshipDimension = keyof RelationshipScores

/**
 * Stored on the character who HOLDS the opinion and points at the other party, so A's view of B
 * and B's view of A can legitimately differ. Most rows point at FOUNDER_ID.
 */
export interface RelationshipState extends RelationshipScores {
  characterId: CharacterId
  /** Drives decay and "we haven't spoken since week 12" callbacks. */
  lastMeaningfulInteractionWeek?: number
}

// ---------- memory ----------

/**
 * Free-form slugs ('leadership', 'engineering', 'promotion') rather than a closed union: tag
 * overlap is how the memory matcher scores relevance, and a union would make every new fragment
 * pool a change to this file.
 */
export type MemoryTag = string

export type MemoryType =
  | 'promise'
  | 'promotion'
  | 'rejection'
  | 'conflict'
  | 'support'
  | 'success'
  | 'failure'
  | 'betrayal'
  | 'recognition'
  | 'layoff'
  | 'crisis'
  | 'hire'
  | 'strategy_change'

/**
 * One remembered fact. Semantic, not prose: `summaryKey` + `facts` + `tags` are what the matcher
 * reads, and the sentence is composed at display time from the character's own voice. Storing the
 * finished sentence instead would freeze one character's phrasing into everyone else's memory.
 */
export interface MemoryItem {
  id: string
  week: number
  type: MemoryType
  /** Who did it. Usually FOUNDER_ID. */
  actorId?: CharacterId
  /** Who it happened to. */
  targetId?: CharacterId
  /** 0–100: how much this matters to the rememberer. Decays into irrelevance, never to zero. */
  importance: number
  /** -100..100. Signed, because betrayal and recognition are the same magnitude of memory with opposite valence. */
  emotionalImpact: number
  tags: MemoryTag[]
  /** Stable key into the fragment library, e.g. 'promised_engineering_leadership'. */
  summaryKey: string
  /** Semantic slots the composer fills into text: { role: 'Engineering', amount: 15000 }. */
  facts?: Record<string, string | number>
  /** Open memories outscore closed ones. A kept promise is resolved; a broken one is resolved and sour. */
  resolved?: boolean
  /** Narrative id (§67) or Message.id that produced this, so the postmortem can link back. */
  sourceId?: string
}

/** §12 calls this CharacterMemory. It is one remembered fact, hence the interface name. */
export type CharacterMemory = MemoryItem

// ---------- rivals ----------

/** Gives a rival a consistent posture to narrate. Purely interpretive — momentum still drives the sim. */
export type RivalArchetype =
  | 'blitzscaler'
  | 'copycat'
  | 'incumbent'
  | 'niche_specialist'
  | 'discount_challenger'
  | 'research_lab'
  | 'roll_up'

// ---------- the character ----------

export interface Character {
  id: CharacterId
  firstName: string
  lastName: string
  role: CharacterRole
  /** Absent = the player's company. */
  companyId?: CompanyId
  /** Human-readable job title ('VP Sales'). Employee.role is a four-value union and too coarse to speak with. */
  title?: string
  personality: CharacterPersonality
  motivations: CharacterMotivations
  communicationStyle: CommunicationStyle
  background: CharacterBackground
  /** This character's view of others. Capped implicitly by cast size, not by LIVING_WORLD_LIMITS. */
  relationships: RelationshipState[]
  /** Newest last. Capped at LIVING_WORLD_LIMITS.memoriesPerCharacter, dropping lowest-importance first. */
  memories: MemoryItem[]
  status: CharacterStatus
  /** Mirrors the existing Employee.trait so the living world and the Team screen never describe the same person differently. */
  trait?: TraitId | null
  archetype?: RivalArchetype
  /** Entry week. Recency scoring and "since the Series A" phrasing both need it. */
  createdWeek: number
  departedWeek?: number
}

// ---------- company memory ----------

export type CompanyMemoryType =
  | 'first_customer'
  | 'first_revenue'
  | 'first_hire'
  | 'funding_round'
  | 'pivot'
  | 'major_customer'
  | 'major_loss'
  | 'layoff'
  | 'outage'
  | 'acquisition'
  | 'profitability'
  | 'pmf'
  | 'record_growth'
  | 'record_revenue'
  | 'crisis'

/**
 * The company's own history, distinct from the raw metric series in GameState.history: this is
 * what the world considers notable, so comparisons like "strongest month since the Series A" can
 * be made without re-deriving them from numbers.
 */
export interface CompanyMemory {
  id: string
  week: number
  type: CompanyMemoryType
  importance: number
  /** Whatever the comparison needs: { amount: 4_000_000, stage: 'Series A' }. */
  metadata: Record<string, string | number>
  /** Who was involved, for callbacks that need the right person rather than the right week. */
  characterIds?: CharacterId[]
}

// ---------- promises ----------

export type PromiseStatus = 'open' | 'kept' | 'broken' | 'expired'

/**
 * Indexed separately from MemoryItem even though a promise also lands in memory: callbacks scan
 * open promises every week, and an unresolved promise must never be dropped by the memory cap.
 */
export interface PromiseRecord {
  id: string
  week: number
  /** Who it was made to. */
  characterId: CharacterId
  summaryKey: string
  facts?: Record<string, string | number>
  /** When the character starts expecting it. Absent = no deadline, judged on events instead. */
  dueWeek?: number
  status: PromiseStatus
  importance: number
  resolvedWeek?: number
}

// ---------- advisors (§28-§33, §76) ----------

/**
 * A perspective on the company, not a person: the person who HOLDS the seat is resolved each week
 * from the actual cast (the strongest salesperson speaks for growth), so who argues with you is
 * itself a fact of the run.
 */
export type AdvisorSeat = 'finance' | 'growth' | 'product' | 'investor'

/** What the seat wants done about what it sees. The verb of the opinion; the topic is the noun. */
export type AdvisorStance = 'cut' | 'push' | 'fix' | 'hold' | 'warn' | 'celebrate'

/**
 * §30. Derived from the character (stage, years, personality, sim skill) rather than stored —
 * a second copy would drift from the person. 0–100 each.
 */
export interface AdvisorSkill {
  functionalExpertise: number
  judgement: number
  forecasting: number
}

/**
 * One advisor's read of the week. Composed prose is persisted (§68) — the panel must not reword
 * itself on reload. Everything here is interpretation; no field is read by the simulation.
 */
export interface AdvisorOpinion {
  /** Narrative id (§67): 'w12_advisor_finance'. */
  id: string
  seat: AdvisorSeat
  characterId: CharacterId
  /** Display name, denormalised so the panel renders even if the character is later pruned. */
  speaker: string
  title?: string
  /** What the seat chose to talk about ('runway', 'retention', …). */
  topic: string
  stance: AdvisorStance
  /** The verdict line ("Slow spending."). */
  headline: string
  /** The grounded reason ("We are at 9 weeks of runway."). */
  detail: string
  /** -1 bad news, +1 good news. The UI tones on the sign; never shown as a number. */
  direction: -1 | 1
  /** For week-over-week repetition control, self-contained — never folded into narrative usage. */
  fragmentIds: string[]
}

/** The current week's panel, replaced whole each week. A quiet week is an empty `opinions`. */
export interface AdvisorPanelState {
  week: number
  opinions: AdvisorOpinion[]
}

// ---------- narrative history ----------

export type NarrativeSurface = 'inbox' | 'media' | 'board' | 'interview' | 'conversation' | 'postmortem' | 'recap' | 'advice'

/**
 * One story already told. Separate from the Decision Journal (what the player chose), Character
 * Memory (how people remember it) and simulation history (the raw numbers) — §16.
 */
export interface NarrativeEntry {
  /** Stable narrative id, §67: 'w48_employee-anna_external-cto'. Same inputs must produce the same id. */
  id: string
  week: number
  surface: NarrativeSurface
  /** Which story this was an instance of, for cooldowns on the beat rather than the wording. */
  beatKey: string
  characterId?: CharacterId
  /** Links to Message.id when the story was delivered to the inbox. */
  messageId?: string
  /** What it was built from, so repetition control can avoid the same phrasing next time. */
  fragmentIds: string[]
}

/** §20. Ring-buffer style: newest pushed, oldest trimmed at the LIVING_WORLD_LIMITS caps. */
export interface NarrativeUsageState {
  recentFragmentIds: string[]
  recentTags: MemoryTag[]
  /** Structural shapes ('opening+memory+request'), so two different fragments can still read the same. */
  recentPatterns: string[]
  /** fragmentId → week last used. Cooldowns need per-fragment recency, which membership alone cannot give. */
  lastUsedWeek: Record<string, number>
}

export interface NarrativeHistory {
  /** Capped at LIVING_WORLD_LIMITS.narrativeEntries. */
  entries: NarrativeEntry[]
  usage: NarrativeUsageState
  /**
   * Narrative id → week emitted. The reload guard: `entries` is capped and cannot be trusted for
   * dedupe once it truncates, and this stays O(1). Pruned on the same schedule as entries.
   */
  emitted: Record<string, number>
}

// ---------- fragments ----------

export type FragmentType = 'opening' | 'context' | 'memory' | 'reaction' | 'request' | 'closing' | 'headline' | 'quote'

/**
 * Eligibility gates, all optional. Nested Partials rather than the flat minDirectness/maxTrust
 * shape so adding a personality dimension does not mean adding two more fields per dimension here.
 * All bounds are inclusive; an absent dimension is no constraint.
 */
export interface FragmentConditions {
  personalityMin?: Partial<CharacterPersonality>
  personalityMax?: Partial<CharacterPersonality>
  relationshipMin?: Partial<RelationshipScores>
  relationshipMax?: Partial<RelationshipScores>
  styles?: CommunicationStyle[]
  roles?: CharacterRole[]
  motivations?: CharacterMotivation[]
  /** Every tag must be present on the triggering context. */
  requiresTags?: MemoryTag[]
  /** Any tag present disqualifies the fragment. */
  forbidsTags?: MemoryTag[]
  minWeek?: number
  /** Mirrors EventDef's gate: content that describes a system the run does not have must not appear. */
  requiresCapabilities?: CapabilityKey[]
  depths?: LivingWorldDepth[]
}

/** Values substituted into a fragment's `{slot}` placeholders at compose time. */
export type FragmentSlots = Record<string, string | number>

/**
 * A sentence-sized piece of a message. Content, not state — fragments live in module scope and
 * are never persisted; only their ids go into NarrativeHistory.
 */
export interface Fragment {
  id: string
  type: FragmentType
  /** Placeholders are `{slot}`, filled from FragmentSlots. Plain text: the inbox renders no markup. */
  text: string
  conditions?: FragmentConditions
  tags: MemoryTag[]
  /** Relative weight in seeded weighted selection among eligible fragments. */
  weight: number
}

/** §12 / §17 name. */
export type NarrativeFragment = Fragment

/** Convention: '<audience>.<topic>', e.g. 'employee.promotion_frustration', 'media.funding'. */
export type FragmentPoolId = string

/**
 * Static content keyed by pool. Deliberately NOT part of LivingWorldState — §63 keeps content out
 * of the simulation, and persisting prose would put the whole library into localStorage.
 */
export type FragmentLibrary = Record<FragmentPoolId, readonly Fragment[]>

// ---------- the persisted slice ----------

/**
 * Hard caps. Every array in the slice is bounded because the whole state is structuredClone'd on
 * each action and JSON-serialised into localStorage on each change — the same reason career.journal
 * is capped at 80 and history at 300.
 */
export const LIVING_WORLD_LIMITS = {
  memoriesPerCharacter: 40,
  companyMemory: 120,
  narrativeEntries: 200,
  recentFragmentIds: 60,
  recentTags: 40,
  recentPatterns: 30,
  promises: 40,
  advisorOpinions: 6,
} as const

/** Bumped when the slice's shape changes, so in-slice migration never needs a global persist bump. */
export const LIVING_WORLD_STATE_VERSION = 1

/**
 * Everything the living world persists. Absent on saves that predate it and on runs whose
 * livingWorldDepth is 'off' — every reader must handle undefined.
 *
 * Depth is intentionally NOT stored: GameRules is never persisted, and a copy here would drift
 * from config. Re-derive it with resolveGameRules(state.config).livingWorldDepth.
 */
export interface LivingWorldState {
  version: number
  /**
   * Keyed by CharacterId. Iterate through a sorted key list, never raw Object.keys order — draw
   * order must not be able to change the world.
   */
  characters: Record<CharacterId, Character>
  companyMemory: CompanyMemory[]
  promises: PromiseRecord[]
  narrative: NarrativeHistory
  /**
   * §76's "What the team thinks", current week only — replaced whole on each resolve, so it is
   * bounded by construction. Absent until the advisorOpinions capability first runs.
   */
  advisorPanel?: AdvisorPanelState
  /** Guards against a second pass over the same week after a reload — §72. */
  lastGeneratedWeek?: number
  /**
   * Candidate type → the week it last led. The Director's novelty term (§27) reads this, which is
   * what stops the same kind of story leading week after week. Persisted, because novelty that
   * resets on reload would let the repetition straight back in.
   */
  narrativeLastSeen?: Record<string, number>
}
