// The Living World — Structured Interactions (brief §38-§39, §41-§45, §46-§47; tests §85). Phase 8.
//
// Phases 1-7 built a world that TALKS to the founder: people with memories, advisors with
// opinions, promises the world holds you to. What it could not do was let the founder talk BACK
// anywhere except the inbox. This phase builds the three rooms the brief asks for — the customer
// interview (§41), the employee conversation (§38) and the board meeting (§46) — as one engine,
// because they are one object: a scene composed from facts, a bounded set of things the founder
// may say, and an outcome that is felt through the systems that already exist.
//
// THE LIFECYCLE, and where each half lives:
//
//   OPENED   — inside tickLivingWorld's once-per-week guard, from facts the simulation already
//              resolved: an interview study that completed (Career's own evidence log says so),
//              an employee whose relationship is genuinely strained, a board that has not sat
//              down in a quarter. Never on a timer alone, and never for a reason the game
//              cannot point at.
//   ANSWERED — by the player, through `chooseInteractionOption`, routed via the replay registry
//              like every other player action. An interview spends a question and the room
//              answers; a conversation or a board meeting takes one reply and closes.
//   FELT     — through Phase 4's relationship facts, Phase 2's memory and Phase 7's promise
//              ledger. A founder's answer moves trust and can create a real commitment with a
//              real deadline; it moves no simulation field whatsoever.
//   SURFACED — three panels (Discovery, Team, Dashboard) plus the Dashboard attention strip, and
//              the run biography, which reads the settled rooms back as story beats.
//
// WHY NOTHING HERE TOUCHES THE INBOX. The simulation READS inbox windows upstream of seeded
// draws — maybeOneOnOne filters on the first 12 messages, the weekly event picker dedupes against
// the first 8 titles — so one extra message shifts an RNG draw count and `npm run bots` stops
// being byte-identical. Phase 7 found this the hard way and this phase inherits the rule: the
// rooms live on surfaces the simulation never reads.
//
// DETERMINISM. Every draw comes from the composer's (seed, narrative id) stream, never from the
// engine's RNG hook — so composing a room, or answering one, can never shift a simulation
// outcome. Interview customers are GENERATED rather than persisted (pure in seed + interaction id
// + index) and deliberately never join `world.characters`: they are three people who took a call,
// not cast members, and adding them would grow the relationship tick and the save for nothing.

import type { Employee, GameState } from '../types'
import { hasCapability } from '../modes'
import { BOARD_SPEC, readWeekFacts, type WeekFact } from './advisors'
import { composeNarrative, makeNarrativeRng, narrativeId } from './composer'
import { generateCharacter, fullName, stableCastId, type CharacterSpec } from './characters'
import { noteCharacterEvent, notePromise, sortedCharacterIds } from './memory'
import {
  applyRelationshipFacts,
  relationshipStrain,
  relationshipWith,
  upsertRelationship,
  type RelationshipFact,
} from './relationships'
import { ADVISOR_FRAGMENTS, ADVISOR_SHAPES } from './content/advisors'
import {
  BOARD_CHAIR_STANCES,
  BOARD_CHAIR_WEIGHTS,
  BOARD_DECISIONS,
  BOARD_MEETING_INTERVAL_WEEKS,
  BOARD_MEETING_MAX_TOPICS,
  BOARD_MEETING_MIN_TOPICS,
  BOARD_TOPIC_LABEL,
  CONVERSATION_GAP_WEEKS,
  CONVERSATION_STRAIN_FLOOR,
  CUSTOMER_FRAGMENTS,
  CUSTOMER_SHAPES,
  INTERVIEW_ALTERNATIVES,
  INTERVIEW_FREQUENCY_WORDS,
  INTERVIEW_PANEL_SIZE,
  INTERVIEW_PRICE_PHRASE,
  INTERVIEW_QUESTIONS,
  INTERVIEW_QUESTION_BUDGET,
  boardDecision,
  conversationTopic,
  interviewQuestion,
  type ConversationAnswer,
  type InterviewQuestion,
} from './content/interactions'
import { FOUNDER_ID, LIVING_WORLD_LIMITS } from './types'
import type {
  Character,
  CharacterId,
  InteractionEvidence,
  InteractionKind,
  InteractionLine,
  InteractionOption,
  LivingWorldState,
  MemoryTag,
  StructuredInteraction,
} from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Settled rooms stay readable for this long before the cap is allowed to shed them. */
export const INTERACTION_RECENT_WEEKS = 12

/**
 * How long a room waits for the founder before the moment passes.
 *
 * Without this, open rooms accumulate: an interview opens every time a study lands, an employee
 * raises something every quarter, and a player who ignores all of them ends a 104-week run with
 * thirty unanswered questions and a §77-style panel that is pure backlog. A stale room closes
 * unattended — no relationship movement, no memory, no promise, because the founder did not
 * actually say anything. The cost of ignoring people is the thing you did not get, not a
 * punishment the system invents on your behalf.
 */
export const INTERACTION_STALE_WEEKS = 8

/** What the panels tell the player about the clock, in one sentence they can act on. */
export const INTERVIEW_STALE_HINT = `The calls run for about ${INTERACTION_STALE_WEEKS} weeks. After that the study is written up without you.`

// ---------- shared plumbing ----------

/** Which capability owns which room. One switch each, per the brief's own capability list. */
const KIND_CAPABILITY = {
  interview: 'structuredInterviews',
  conversation: 'structuredEmployeeConversations',
  board_meeting: 'proceduralBoardMeetings',
} as const

export function interactionsEnabled(s: GameState): boolean {
  return (
    hasCapability(s, 'structuredInterviews') ||
    hasCapability(s, 'structuredEmployeeConversations') ||
    hasCapability(s, 'proceduralBoardMeetings')
  )
}

const list = (world: LivingWorldState): StructuredInteraction[] => world.interactions ?? []

/** Rooms still waiting on the founder, newest first. The one read every surface starts from. */
export function openInteractions(world: LivingWorldState | undefined, kind?: InteractionKind): StructuredInteraction[] {
  if (!world) return []
  return list(world)
    .filter((i) => i.status === 'open' && (kind === undefined || i.kind === kind))
    .sort((a, b) => b.week - a.week || (a.id < b.id ? -1 : 1))
}

/** Open rooms first, then recently settled ones. The panel read; pure, so it is §68-safe. */
export function recentInteractions(s: GameState, kind: InteractionKind, limit = 3): StructuredInteraction[] {
  const world = s.world
  if (!world || !hasCapability(s, KIND_CAPABILITY[kind])) return []
  const open = openInteractions(world, kind)
  const settled = list(world)
    .filter((i) => i.status === 'resolved' && i.kind === kind && s.week - (i.resolvedWeek ?? i.week) <= INTERACTION_RECENT_WEEKS)
    .sort((a, b) => (b.resolvedWeek ?? b.week) - (a.resolvedWeek ?? a.week) || (a.id < b.id ? -1 : 1))
  return [...open, ...settled].slice(0, Math.max(0, limit))
}

function push(world: LivingWorldState, room: StructuredInteraction): StructuredInteraction {
  if (!Array.isArray(world.interactions)) world.interactions = []
  world.interactions.push(room)
  return room
}

/** Already opened this room? The reload guard: ids are (§67) stable, so this is exact. */
const alreadyOpened = (world: LivingWorldState, id: string) => list(world).some((i) => i.id === id)

/**
 * Apply a set of relationship facts as one movement — one call, not one per fact, so the weekly
 * cap and the headroom scaling see the whole answer rather than each half of it. Silent when the
 * run has no relationship simulation; the memory and the promise still land.
 */
function feelFacts(
  s: GameState,
  characterId: CharacterId,
  facts: readonly { kind: RelationshipFact['kind']; magnitude: number }[],
  sourceId: string,
): void {
  const world = s.world
  if (!world || !hasCapability(s, 'relationships') || facts.length === 0) return
  const character = world.characters[characterId]
  if (!character || character.status === 'departed') return
  const change = applyRelationshipFacts(
    relationshipWith(character, s.week),
    character,
    facts.map((f) => ({ kind: f.kind, week: s.week, magnitude: f.magnitude, sourceId })),
    s.week,
  )
  world.characters[characterId] = upsertRelationship(character, change.after)
}

// ---------------------------------------------------------------------------------------
// 1. Customer interviews (§41-§45)
// ---------------------------------------------------------------------------------------

/**
 * §42, derived rather than stored. Every field is a function of the segment's hidden truth and the
 * generated person's own temperament, so the same seed always produces the same three people with
 * the same biases — and none of it is ever shown as a number (§42's "do not expose hidden values").
 */
export interface InterviewCustomer {
  character: Character
  segmentId: string
  role: string
  problemFrequency: number
  painIntensity: number
  budgetAuthority: boolean
  priceSensitivity: number
  innovationAffinity: number
  politenessBias: number
  statusQuoBias: number
  featureRequestBias: number
  currentAlternative: string
}

/** The hidden half of a segment, as the interview needs it. Passed in; never re-derived here. */
export interface InterviewSegmentTruth {
  needIntensity: number
  willingnessToPay: number
  productRequirement: number
  acquisitionAccessibility: number
  marketSize: number
}

/**
 * Build one interview customer. Pure in (seed, interactionId, index, truth): the person, their
 * biases and what they are using instead of you are all fixed the moment the session opens, which
 * is what makes "same profile, same question, same seed → same answer" (§85) true by construction.
 */
export function buildInterviewCustomer(
  seed: number,
  interactionId: string,
  index: number,
  segmentId: string,
  truth: InterviewSegmentTruth,
  week: number,
  sector?: string,
): InterviewCustomer {
  const character = generateCharacter({
    seed,
    id: `${interactionId}:c${index}`,
    role: 'customer',
    index: 800 + index,
    identityKey: `${interactionId}|c${index}`,
    createdWeek: week,
    sector: sector as never,
  })
  const p = character.personality
  const rng = makeNarrativeRng(seed, `${interactionId}_profile_${index}`)
  // Spread around the segment's truth: three people from one segment are not three copies of it.
  const jitter = (base: number, spread: number) => clamp(base + (rng() * 2 - 1) * spread, 0, 100)

  const problemFrequency = jitter(truth.needIntensity, 22)
  const painIntensity = jitter(truth.needIntensity * 0.85 + (100 - p.patience) * 0.15, 18)
  // Reachability is how easy this segment is to sell to at all, so it is also how likely the
  // person who answered the phone is the person who can say yes.
  const budgetAuthority = rng() < clamp01(0.15 + truth.acquisitionAccessibility / 190)
  // Mostly the segment's own willingness to pay, tilted by temperament: a pessimist reads the same
  // invoice as more expensive than an optimist does.
  const priceSensitivity = clamp(100 - truth.willingnessToPay + (50 - p.optimism) * 0.25, 0, 100)
  const innovationAffinity = clamp(20 + p.riskTolerance * 0.55 + p.optimism * 0.35, 0, 100)
  // Agreeable people give you the answer you want. The single most expensive bias in the game, and
  // deliberately the common case (§43) — but it has to SPREAD, or "polite" stops being a property
  // of a person and becomes a property of customers, and the lesson stops being learnable.
  const politenessBias = clamp(50 + (60 - p.directness) * 0.8 + (p.empathy - 50) * 0.4, 0, 100)
  const statusQuoBias = clamp(40 + (55 - p.riskTolerance) * 0.7 + (60 - truth.needIntensity) * 0.4, 0, 100)
  const featureRequestBias = clamp(truth.productRequirement * 0.6 + p.ego * 0.25, 0, 100)

  return {
    character,
    segmentId,
    role: character.title ?? 'Head of Operations',
    problemFrequency: Math.round(problemFrequency),
    painIntensity: Math.round(painIntensity),
    budgetAuthority,
    priceSensitivity: Math.round(priceSensitivity),
    innovationAffinity: Math.round(innovationAffinity),
    politenessBias: Math.round(politenessBias),
    statusQuoBias: Math.round(statusQuoBias),
    featureRequestBias: Math.round(featureRequestBias),
    currentAlternative: INTERVIEW_ALTERNATIVES[Math.floor(rng() * INTERVIEW_ALTERNATIVES.length) % INTERVIEW_ALTERNATIVES.length],
  }
}

/**
 * The customer's profile, expressed as fragment tags. This is the whole of §43: the answer pool is
 * gated on these, so a polite low-pain customer and a blunt high-pain one give visibly different
 * answers to the identical question.
 */
export function customerTags(c: InterviewCustomer): MemoryTag[] {
  const tags: MemoryTag[] = []
  tags.push(c.problemFrequency >= 60 ? 'freq_high' : c.problemFrequency < 35 ? 'freq_low' : 'freq_mid')
  if (c.painIntensity >= 60) tags.push('pain_high')
  if (c.painIntensity < 35) tags.push('pain_low')
  tags.push(c.budgetAuthority ? 'authority' : 'no_authority')
  tags.push(c.priceSensitivity >= 58 ? 'price_tight' : 'price_ok')
  if (c.statusQuoBias >= 60) tags.push('statusquo')
  if (c.innovationAffinity >= 62) tags.push('keen')
  tags.push(c.politenessBias >= 58 ? 'polite' : 'blunt_customer')
  if (c.featureRequestBias >= 62) tags.push('featurey')
  return tags
}

const frequencyWord = (v: number): string =>
  INTERVIEW_FREQUENCY_WORDS[clamp(Math.floor(v / 20.0001), 0, INTERVIEW_FREQUENCY_WORDS.length - 1)]

/**
 * §45. The evidence one answer is worth, produced from the hidden profile and the instrument —
 * never read back out of the sentence. `signal` is what the answer SUGGESTS the metric is, which
 * is deliberately not the truth: a polite customer's "I'd definitely consider it" carries a high
 * signal on willingness to pay and a reliability near the floor, and the gap between those two
 * numbers is the lesson the whole interview exists to teach.
 */
export function answerEvidence(q: InterviewQuestion, c: InterviewCustomer, truth: InterviewSegmentTruth): InteractionEvidence {
  let signal: number
  switch (q.metric) {
    case 'needIntensity':
      signal = q.id === 'last' ? c.problemFrequency : c.painIntensity
      break
    case 'willingnessToPay':
      signal = 100 - c.priceSensitivity
      break
    case 'productRequirement':
      signal = truth.productRequirement * 0.6 + c.featureRequestBias * 0.4
      break
    case 'acquisitionAccessibility':
      signal = c.budgetAuthority ? 62 + truth.acquisitionAccessibility * 0.3 : truth.acquisitionAccessibility * 0.45
      break
    default:
      signal = truth.marketSize
  }
  // Stated preference inflates, and it inflates most where it costs most (§43).
  const stated = q.id === 'pay' || q.id === 'cost' || q.id === 'frustrates'
  if (stated) signal += (c.politenessBias - 50) * 0.35 + (c.innovationAffinity - 50) * 0.15
  if (q.id === 'switch' || q.id === 'why') signal -= (c.statusQuoBias - 50) * 0.3

  // Reliability is the instrument times the person: an answer from somebody who cannot sign is
  // worth less about buying, and an agreeable answer is worth less about everything.
  let reliability = q.baseReliability
  reliability *= 1 - clamp01((c.politenessBias - 50) / 140)
  if (!c.budgetAuthority && (q.metric === 'willingnessToPay' || q.metric === 'acquisitionAccessibility')) reliability *= 0.55
  if (q.id === 'last' || q.id === 'who_buys') reliability *= 1.1 // recalled facts, not opinions

  return { metric: q.metric, signal: Math.round(clamp(signal, 0, 100)), reliability: round3(clamp01(reliability)) }
}

/** Reliability, as words. §42 forbids showing the number; the band is what a founder can act on. */
export function reliabilityBand(r: number): 'anecdote' | 'weak' | 'mixed' | 'solid' {
  if (r < 0.2) return 'anecdote'
  if (r < 0.35) return 'weak'
  if (r < 0.55) return 'mixed'
  return 'solid'
}

/**
 * Compose one customer's answer to one question. Deterministic per (seed, room, question, person),
 * which is exactly §85's "same profile, same question, same seed gives the same answer".
 *
 * No `capabilities` and no `usage` are passed, deliberately: the customer pool declares no
 * capability gates and a stranger on a phone call is not part of the company's narrative
 * repetition budget — folding these answers into `world.narrative.usage` would put a customer's
 * turn of phrase on cooldown for the founder's own team.
 */
function composeAnswer(
  seed: number,
  room: StructuredInteraction,
  q: InterviewQuestion,
  c: InterviewCustomer,
  index: number,
  slots: Record<string, string | number>,
  exclude: readonly string[],
): { text: string; fragmentIds: string[] } | null {
  const composed = composeNarrative({
    seed,
    week: room.week,
    surface: 'interview',
    beatKey: `interview_${q.id}`,
    audience: 'customer',
    id: narrativeId(room.week, 'interview', room.topic, q.id, `c${index}`),
    character: c.character,
    tags: [q.tag, ...customerTags(c)],
    slots: { ...slots, alternative: c.currentAlternative, frequency: frequencyWord(c.problemFrequency) },
    memory: null, // a stranger on a call has no history with you to call back to
    library: CUSTOMER_FRAGMENTS,
    shapes: CUSTOMER_SHAPES,
    exclude,
  })
  if (!composed) return null
  const text = [composed.subject, composed.body].filter((part) => part && part.length > 0).join(' ')
  return text ? { text, fragmentIds: composed.fragmentIds } : null
}

/**
 * Open an interview session. The three people are generated, not persisted; the questions are
 * §41's list; the budget is what makes choosing between them a decision.
 */
export function openInterview(
  s: GameState,
  world: LivingWorldState,
  seed: number,
  input: { segmentId: string; segmentName: string; truth: InterviewSegmentTruth; price: string },
): StructuredInteraction | null {
  const id = narrativeId(s.week, 'interview', input.segmentId)
  if (alreadyOpened(world, id)) return null

  const room: StructuredInteraction = {
    id,
    kind: 'interview',
    mode: 'ask',
    week: s.week,
    topic: `seg:${input.segmentId}`,
    title: `Customer interviews — ${input.segmentName}`,
    characterIds: [],
    lines: [],
    options: INTERVIEW_QUESTIONS.map((q): InteractionOption => ({ id: q.id, label: q.text })),
    chosen: [],
    movesLeft: INTERVIEW_QUESTION_BUDGET,
    status: 'open',
    facts: {
      segmentId: input.segmentId,
      segment: input.segmentName,
      price: input.price,
      // The hidden truth the answers are drawn against, stored so a reload regenerates the same
      // people. These are the segment's own numbers, already in the save under career.segmentTruth
      // — this is a pointer, not a second source of truth.
      needIntensity: Math.round(input.truth.needIntensity),
      willingnessToPay: Math.round(input.truth.willingnessToPay),
      productRequirement: Math.round(input.truth.productRequirement),
      acquisitionAccessibility: Math.round(input.truth.acquisitionAccessibility),
      marketSize: Math.round(input.truth.marketSize),
    },
    evidence: [],
  }

  // The roster lives in `facts`, not in `lines`: a line is something somebody SAID, and nobody has
  // said anything yet. It is stored rather than regenerated only so the panel can name the room
  // without re-running generation on every render.
  for (let i = 0; i < INTERVIEW_PANEL_SIZE; i++) {
    const c = buildInterviewCustomer(seed, id, i, input.segmentId, input.truth, s.week, s.config?.sector)
    room.facts![`who${i}`] = `${fullName(c.character)}|${c.role}`
  }
  return push(world, room)
}

/** The three people in the room, as (name, role) pairs, read back off the record. */
export function interviewRoster(room: StructuredInteraction): { name: string; role: string }[] {
  const out: { name: string; role: string }[] = []
  for (let i = 0; i < INTERVIEW_PANEL_SIZE; i++) {
    const raw = room.facts?.[`who${i}`]
    if (typeof raw !== 'string') continue
    const [name, role] = raw.split('|')
    if (name) out.push({ name, role: role ?? '' })
  }
  return out
}

/** Rebuild the session's three people from the record. Pure — the record IS the seed. */
export function interviewPanel(seed: number, room: StructuredInteraction, sector?: string): InterviewCustomer[] {
  const truth = interviewTruth(room)
  const segmentId = typeof room.facts?.segmentId === 'string' ? room.facts.segmentId : ''
  const out: InterviewCustomer[] = []
  for (let i = 0; i < INTERVIEW_PANEL_SIZE; i++) out.push(buildInterviewCustomer(seed, room.id, i, segmentId, truth, room.week, sector))
  return out
}

function interviewTruth(room: StructuredInteraction): InterviewSegmentTruth {
  const n = (k: string) => (typeof room.facts?.[k] === 'number' ? (room.facts[k] as number) : 50)
  return {
    needIntensity: n('needIntensity'),
    willingnessToPay: n('willingnessToPay'),
    productRequirement: n('productRequirement'),
    acquisitionAccessibility: n('acquisitionAccessibility'),
    marketSize: n('marketSize'),
  }
}

/** What four questions to three people actually bought, said in the founder's own terms. */
function interviewVerdict(room: StructuredInteraction, panel: readonly InterviewCustomer[]): string {
  const ev = room.evidence ?? []
  const avg = ev.length ? ev.reduce((a, e) => a + e.reliability, 0) / ev.length : 0
  const band = reliabilityBand(avg)
  const noAuthority = panel.filter((c) => !c.budgetAuthority).length
  const statusQuo = panel.filter((c) => c.statusQuoBias >= 60).length
  const polite = panel.filter((c) => c.politenessBias >= 58).length

  const worth =
    band === 'solid'
      ? 'Most of what you collected was recalled behaviour, which is the good kind.'
      : band === 'mixed'
        ? 'Half of it was behaviour and half of it was opinion.'
        : band === 'weak'
          ? 'Most of it was stated preference. Stated preference is cheap.'
          : 'Almost all of it was opinion offered for free, and priced accordingly.'
  const tail: string[] = []
  if (noAuthority > 0) tail.push(`${noAuthority} of ${panel.length} cannot sign a purchase order`)
  if (statusQuo > 0) tail.push(`${statusQuo} told you their workaround is good enough`)
  if (polite >= 2) tail.push('and they were being kind to you')
  return `${room.chosen.length} question${room.chosen.length === 1 ? '' : 's'}, ${panel.length} people. ${worth}${tail.length ? ` ${tail.join('; ')}.` : ''} None of it moves PMF — only customers who stay and pay do that.`
}

/** Spend one question. Everybody in the room answers it, which is where the disagreement lives. */
function askQuestion(s: GameState, room: StructuredInteraction, seed: number, questionId: string): boolean {
  const q = interviewQuestion(questionId)
  if (!q || room.chosen.includes(questionId)) return false
  const panel = interviewPanel(seed, room, s.config?.sector)
  const truth = interviewTruth(room)
  const price = typeof room.facts?.price === 'string' ? room.facts.price : 'that'

  // Two hard exclusions, because both kinds of repetition are visible and both read as a bug:
  // three people in one room must not give the SAME sentence to the same question, and one person
  // must not trail every one of their four answers with the identical qualifier. Everything
  // already said by anybody in this room to this question, plus everything this person has said
  // at all, is off the table — a bias would not have been enough at these pool sizes.
  const saidByPerson: string[][] = panel.map((_, i) =>
    room.lines.filter((l) => l.speaker === fullName(panel[i].character)).flatMap((l) => l.fragmentIds ?? []),
  )
  const saidToThisQuestion: string[] = []

  let answered = 0
  panel.forEach((c, i) => {
    const answer = composeAnswer(seed, room, q, c, i, { price, segment: String(room.facts?.segment ?? '') }, [
      ...saidByPerson[i],
      ...saidToThisQuestion,
    ])
    if (!answer) return
    answered++
    saidToThisQuestion.push(...answer.fragmentIds)
    room.lines.push({
      speaker: fullName(c.character),
      role: c.role,
      text: answer.text,
      optionId: questionId,
      fragmentIds: answer.fragmentIds,
    })
    ;(room.evidence ??= []).push(answerEvidence(q, c, truth))
  })
  if (answered === 0) return false

  room.chosen.push(questionId)
  room.movesLeft = Math.max(0, room.movesLeft - 1)
  if (room.movesLeft === 0) {
    room.status = 'resolved'
    room.resolvedWeek = s.week
    room.outcome = interviewVerdict(room, panel)
  }
  return true
}

// ---------------------------------------------------------------------------------------
// 2. Employee conversations (§38-§39)
// ---------------------------------------------------------------------------------------

/**
 * Which of §38's subjects this person would actually raise, scored from facts the simulation
 * already produced. Returns an empty list when nothing about this run gives them a reason —
 * a conversation with no cause is a conversation this system is not allowed to invent.
 */
export function conversationTopicScores(s: GameState, character: Character, employee: Employee): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = []
  const tenure = Math.max(0, s.week - character.createdWeek)
  const rel = relationshipWith(character, s.week)
  const memoryTagged = (tag: string, within: number) =>
    character.memories.some((m) => m.tags.includes(tag) && s.week - m.week <= within)

  // Promotion — ambition plus time served. The two facts that make somebody ask.
  if (character.personality.ambition >= 52 && tenure >= 16)
    out.push({ id: 'promotion', score: (character.personality.ambition - 50) / 50 + Math.min(1, tenure / 40) })

  // Compensation — a demoralised long-server, or somebody who has already been told no once.
  if (employee.morale < 62 || memoryTagged('compensation', 30))
    out.push({ id: 'compensation', score: (62 - Math.min(62, employee.morale)) / 40 + (memoryTagged('compensation', 30) ? 0.6 : 0) })

  // Workload — a small team carrying a big product, or a bug list nobody is getting to.
  const load = s.employees.length > 0 ? s.users / Math.max(1, s.employees.length) : 0
  if (s.bugs > 45 || load > 400)
    out.push({ id: 'workload', score: clamp01((s.bugs - 45) / 45) + clamp01((load - 400) / 1200) })

  // Strategy — the company has actually changed its mind, recently and provably.
  const turned = (s.pivots > 0 ? 0.5 : 0) + (s.career?.repositioning ? 0.9 : 0) + (memoryTagged('strategy', 20) ? 0.5 : 0)
  if (turned > 0) out.push({ id: 'strategy', score: turned })

  // Departure risk — the relationship itself is the fact, and it is the loudest one there is.
  if (rel.trust < 42 || relationshipStrain(rel) > 0.62)
    out.push({ id: 'departure', score: 0.8 + (42 - Math.min(42, rel.trust)) / 40 })

  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
}

/** The strained person with something specific to say. Deterministic: sorted cast, full tiebreak. */
function conversationCandidate(
  s: GameState,
  world: LivingWorldState,
): { character: Character; employee: Employee; topicId: string } | null {
  const lastSpokeTo = list(world)
    .filter((i) => i.kind === 'conversation')
    .sort((a, b) => b.week - a.week)[0]
  if (lastSpokeTo && s.week - lastSpokeTo.week < CONVERSATION_GAP_WEEKS) return null

  let best: { character: Character; employee: Employee; topicId: string; score: number } | null = null
  for (const id of sortedCharacterIds(world)) {
    const character = world.characters[id]
    if (!character || character.status !== 'active' || character.role !== 'employee') continue
    if (lastSpokeTo?.characterIds.includes(id)) continue // not the same person twice running
    const employee = s.employees.find((e) => stableCastId('emp', e.name, e.role) === id)
    if (!employee) continue
    const strain = relationshipStrain(relationshipWith(character, s.week))
    if (strain < CONVERSATION_STRAIN_FLOOR) continue
    const topic = conversationTopicScores(s, character, employee)[0]
    if (!topic) continue
    const score = strain + topic.score * 0.35
    if (!best || score > best.score || (score === best.score && id < best.character.id))
      best = { character, employee, topicId: topic.id, score }
  }
  return best ? { character: best.character, employee: best.employee, topicId: best.topicId } : null
}

/** Open one conversation. Composed through the EXISTING employee voice, so it is the same person. */
export function openConversation(s: GameState, world: LivingWorldState, seed: number): StructuredInteraction | null {
  const found = conversationCandidate(s, world)
  if (!found) return null
  const def = conversationTopic(found.topicId)
  if (!def) return null

  const id = narrativeId(s.week, 'conversation', found.character.id, def.id)
  if (alreadyOpened(world, id)) return null

  // The employee pool is SHARED with the weekly inbox check-in, so the conversation READS the
  // narrative usage buffer (a fragment the inbox used last month is biased down) but deliberately
  // never WRITES to it. Writing would change which fragment a later inbox beat draws, and an
  // inbox beat's subject becomes a message TITLE — which the engine's event picker scans, upstream
  // of a seeded draw. That is the exact path by which a narrative capability stops `npm run bots`
  // being byte-identical, so the buffer stays read-only and conversation-to-conversation
  // repetition is handled by a hard exclusion instead.
  const previous = list(world)
    .filter((i) => i.kind === 'conversation')
    .sort((a, b) => b.week - a.week)[0]
  const composed = composeNarrative({
    seed,
    week: s.week,
    surface: 'conversation',
    beatKey: `conversation_${def.id}`,
    audience: 'employee',
    id,
    character: found.character,
    relationship: hasCapability(s, 'relationships') ? relationshipWith(found.character, s.week) : undefined,
    exclude: previous?.lines.flatMap((l) => l.fragmentIds ?? []) ?? [],
    tags: ['concern', ...def.tags],
    slots: {
      company: s.companyName,
      role: found.employee.role,
      weeks: Math.max(1, s.week - found.character.createdWeek),
      // Prettified from the slug rather than looked up: the world layer does not import the
      // Career subsystem, and a fragment that mentions the target segment is worth more than the
      // three characters of polish a real lookup would buy.
      ...(s.career ? { segment: s.career.primaryTargetSegmentId.replace(/_/g, ' ') } : {}),
    },
    usage: world.narrative.usage,
    capabilities: s.capabilities,
  })
  if (!composed) return null

  const room: StructuredInteraction = {
    id,
    kind: 'conversation',
    mode: 'answer',
    week: s.week,
    topic: def.id,
    title: `${fullName(found.character)} ${def.title}`,
    characterIds: [found.character.id],
    lines: [
      {
        characterId: found.character.id,
        speaker: fullName(found.character),
        role: found.character.title ?? found.employee.role,
        text: [composed.subject, composed.body].filter(Boolean).join('\n\n'),
        fragmentIds: composed.fragmentIds,
      },
    ],
    options: (['explain', 'commit', 'hold'] as ConversationAnswer[]).map(
      (a): InteractionOption => ({ id: a, label: def.answers[a].label, detail: def.answers[a].detail }),
    ),
    chosen: [],
    movesLeft: 1,
    status: 'open',
  }
  return push(world, room)
}

/** The founder answers. Trust moves now; the promise, if there is one, is judged later. */
function answerConversation(s: GameState, room: StructuredInteraction, answerId: string): boolean {
  const def = conversationTopic(room.topic)
  const answer = def?.answers[answerId as ConversationAnswer]
  if (!def || !answer) return false
  const characterId = room.characterIds[0]
  const world = s.world
  if (!world || !characterId) return false
  const character = world.characters[characterId]
  const firstName = character?.firstName ?? 'They'

  // A commitment with a window is a real promise, on the same ledger the board's is (Phase 7).
  // Delivered-on-the-spot answers have no `promise` def and simply land as memory and trust.
  let promiseId: string | undefined
  if (answerId === 'commit' && def.promise) {
    const record = notePromise(s, characterId, {
      summaryKey: def.promise.summaryKey,
      dueWeek: s.week + def.promise.window,
      importance: def.promise.importance,
      emotionalImpact: answer.outcome.memory.emotionalImpact,
      tags: ['promise', ...def.tags],
      facts: conversationPromiseFacts(s, characterId),
    })
    promiseId = record?.id
  }

  feelFacts(s, characterId, answer.outcome.facts, promiseId ?? room.id)
  // `commit` already writes its memory through the promise ledger — recording a second one would
  // double the thing the character remembers and let the cap evict the one that matters.
  if (!promiseId)
    noteCharacterEvent(s, characterId, {
      type: answer.outcome.memory.type,
      summaryKey: answer.outcome.memory.summaryKey,
      importance: answer.outcome.memory.importance,
      emotionalImpact: answer.outcome.memory.emotionalImpact,
      tags: answer.outcome.memory.tags,
      actorId: FOUNDER_ID,
      targetId: characterId,
      sourceId: room.id,
    })

  room.chosen.push(answerId)
  room.movesLeft = 0
  room.status = 'resolved'
  room.resolvedWeek = s.week
  room.outcome = answer.outcome.text.replace(/\{firstName\}/g, firstName)
  if (promiseId) room.facts = { ...(room.facts ?? {}), promiseId }
  return true
}

/**
 * The facts a conversation promise will be JUDGED on, snapshotted at the moment of the saying.
 * Every one of them is something the simulation computes, which is the whole point: "I'll get you
 * two more people" is settled by headcount, not by how sincerely it was said.
 *
 * The person is found through `stableCastId`, NOT through a stored `Employee.id`. Employee ids
 * come from `uid()`, which mixes Date.now and Math.random — storing one in the world slice makes
 * two runs of the same seed produce different bytes, which is exactly what the §79 determinism
 * test caught the first time this function tried it.
 */
function conversationPromiseFacts(s: GameState, characterId: CharacterId): Record<string, string | number> {
  const employee = s.employees.find((e) => stableCastId('emp', e.name, e.role) === characterId)
  return {
    salary: employee?.salary ?? 0,
    headcount: s.employees.length,
    equity: Math.round((s.founderEquity ?? 0) * 10_000) / 10_000,
    pivots: s.pivots,
    focus: s.career?.focus ?? '-',
    pricing: s.career?.pricing ?? '-',
    segment: s.career?.primaryTargetSegmentId ?? '-',
  }
}

// ---------------------------------------------------------------------------------------
// 3. Board meetings (§46-§47)
// ---------------------------------------------------------------------------------------

/** The second chair (§47's "Independent Director"). Persisted like any other seat. */
export const BOARD_INDEPENDENT_SPEC = (s: GameState): CharacterSpec => ({
  id: 'adv:board_ind',
  role: 'board_member',
  title: 'Independent director',
  index: 92,
  sector: s.config?.sector,
})

/** The cast this phase needs beyond what advisors and promises already install. */
export function interactionCastSpecs(s: GameState): CharacterSpec[] {
  const specs: CharacterSpec[] = []
  if (hasCapability(s, 'proceduralBoardMeetings') && s.board) {
    specs.push(BOARD_SPEC(s), BOARD_INDEPENDENT_SPEC(s))
  }
  return specs
}

/**
 * §46: 2–4 topics, read off the same week the advisors read.
 *
 * Loudest-first alone was not enough: §47's format is TWO chairs disagreeing, and a top-four by
 * raw severity routinely contained nothing the independent director weighs at all, so half the
 * room sat silent. Each chair's own loudest topic is therefore guaranteed a seat on the agenda
 * before the rest is filled by severity — which is what an agenda IS.
 */
export function boardMeetingTopics(facts: readonly WeekFact[]): WeekFact[] {
  const ranked = [...facts].sort((a, b) => b.severity - a.severity || a.topic.localeCompare(b.topic))
  const strong = ranked.filter((f) => f.severity >= 0.2)
  const pool = strong.length >= BOARD_MEETING_MIN_TOPICS ? strong : ranked
  if (pool.length === 0) return []

  const agenda: WeekFact[] = [pool[0]]
  for (const chair of ['lead', 'independent'] as const) {
    if (agenda.length >= BOARD_MEETING_MAX_TOPICS) break
    const weights = BOARD_CHAIR_WEIGHTS[chair]
    const best = pool
      .filter((f) => !agenda.includes(f))
      .map((fact) => ({ fact, score: fact.severity * (weights[fact.topic] ?? 0) }))
      .filter((r) => r.score > 0.02)
      .sort((a, b) => b.score - a.score || a.fact.topic.localeCompare(b.fact.topic))[0]
    if (best) agenda.push(best.fact)
  }
  for (const f of pool) {
    if (agenda.length >= BOARD_MEETING_MAX_TOPICS) break
    if (!agenda.includes(f)) agenda.push(f)
  }
  // Back into severity order: the agenda is what gets discussed, not the order it was assembled in.
  return agenda.sort((a, b) => b.severity - a.severity || a.topic.localeCompare(b.topic))
}

/** Which of the week's topics this chair would actually raise, and with what verb. */
function chairPick(chair: 'lead' | 'independent', topics: readonly WeekFact[]): { fact: WeekFact; stance: string } | undefined {
  const weights = BOARD_CHAIR_WEIGHTS[chair]
  const ranked = topics
    .map((fact) => ({ fact, score: fact.severity * (weights[fact.topic] ?? 0) }))
    .filter((r) => r.score > 0.02)
    .sort((a, b) => b.score - a.score || a.fact.topic.localeCompare(b.fact.topic))
  const top = ranked[0]
  if (!top) return undefined
  const stanceDef = BOARD_CHAIR_STANCES[chair][top.fact.topic]
  const stance = stanceDef ? (top.fact.direction < 0 ? stanceDef.bad : stanceDef.good) : top.fact.direction < 0 ? 'warn' : 'hold'
  return { fact: top.fact, stance }
}

/**
 * Seat the board (§46-§47). Two chairs read the SAME week through different weights, which is
 * where the disagreement in §47's example comes from — neither of them is wrong. They speak
 * through the advisor fragment pool because they are doing the advisor's job; `exclude` keeps the
 * meeting from repeating a sentence this week's Dashboard panel already used.
 */
export function openBoardMeeting(
  s: GameState,
  world: LivingWorldState,
  seed: number,
  extraFacts: readonly WeekFact[],
): StructuredInteraction | null {
  if (!s.board) return null
  const anchor = world.lastBoardMeetingWeek ?? world.characters['adv:board']?.createdWeek ?? s.week
  if (s.week - anchor < BOARD_MEETING_INTERVAL_WEEKS) return null
  if (openInteractions(world, 'board_meeting').length > 0) return null

  const id = narrativeId(s.week, 'board', 'meeting')
  if (alreadyOpened(world, id)) return null

  const topics = boardMeetingTopics([...readWeekFacts(s), ...extraFacts])
  if (topics.length < BOARD_MEETING_MIN_TOPICS) return null

  // Nothing this week's Dashboard panel already said, and nothing the LAST board meeting said —
  // the same chairs sitting down every quarter is exactly the case where a repeated sentence
  // reads as a bug rather than as a person having a consistent view.
  const previous = list(world)
    .filter((i) => i.kind === 'board_meeting')
    .sort((a, b) => b.week - a.week)[0]
  const spoken: string[] = [
    ...(world.advisorPanel?.week === s.week ? world.advisorPanel.opinions.flatMap((o) => o.fragmentIds) : []),
    ...(previous?.lines.flatMap((l) => l.fragmentIds ?? []) ?? []),
  ]
  const lines: InteractionLine[] = []
  const characterIds: CharacterId[] = []

  for (const chair of ['lead', 'independent'] as const) {
    const spec = chair === 'lead' ? BOARD_SPEC(s) : BOARD_INDEPENDENT_SPEC(s)
    const character =
      world.characters[spec.id] ?? generateCharacter({ seed, ...spec, createdWeek: spec.createdWeek ?? s.week })
    if (character.status === 'departed') continue
    const pick = chairPick(chair, topics)
    if (!pick) continue
    const composed = composeNarrative({
      seed,
      week: s.week,
      surface: 'board',
      beatKey: `board_${chair}`,
      audience: 'advisor',
      id: narrativeId(s.week, 'board', chair),
      character,
      relationship: hasCapability(s, 'relationships') ? relationshipWith(character, s.week) : undefined,
      tags: [pick.fact.topic, pick.stance, pick.fact.direction < 0 ? 'bad' : 'good', ...(pick.fact.tags ?? [])],
      slots: { company: s.companyName, ...pick.fact.slots },
      memory: null,
      library: ADVISOR_FRAGMENTS,
      shapes: ADVISOR_SHAPES,
      exclude: spoken,
      capabilities: s.capabilities,
    })
    if (!composed || !composed.subject) continue
    spoken.push(...composed.fragmentIds)
    lines.push({
      characterId: character.id,
      speaker: fullName(character),
      role: character.title ?? 'Board member',
      text: composed.body ? `${composed.subject} ${composed.body}` : composed.subject,
      fragmentIds: composed.fragmentIds,
    })
    characterIds.push(character.id)
  }
  if (lines.length === 0) return null

  const burn = Math.max(0, Math.round((s.lastExpenses || 0) - (s.lastRevenue || 0)))
  const room: StructuredInteraction = {
    id,
    kind: 'board_meeting',
    mode: 'answer',
    week: s.week,
    topic: topics[0].topic,
    title: `Board meeting — ${topics.map((t) => BOARD_TOPIC_LABEL[t.topic] ?? t.topic).join(' · ')}`,
    characterIds,
    lines,
    options: BOARD_DECISIONS.map((d): InteractionOption => ({ id: d.id, label: d.label, detail: d.detail })),
    chosen: [],
    movesLeft: 1,
    status: 'open',
    facts: {
      target: Math.round(s.board.targetGrowth * 10_000) / 10_000,
      burn,
      strikes: s.board.strikes,
      review: s.board.nextReview,
      topics: topics.map((t) => t.topic).join(','),
    },
  }
  world.lastBoardMeetingWeek = s.week
  return push(world, room)
}

/** The founder decides (§47). Accelerate and Slow down are commitments; Maintain is not. */
function answerBoardMeeting(s: GameState, room: StructuredInteraction, decisionId: string): boolean {
  const def = boardDecision(decisionId)
  if (!def) return false
  const world = s.world
  if (!world) return false
  const target = typeof room.facts?.target === 'number' ? room.facts.target : 0
  const burn = typeof room.facts?.burn === 'number' ? room.facts.burn : 0

  let promiseId: string | undefined
  if (def.promise && s.board) {
    // Judged at the next review, and never sooner than a quarter — a commitment the board can
    // call in three weeks from now is not a commitment, it is a trap.
    const dueWeek = Math.max(s.board.nextReview, s.week + 6)
    const record = notePromise(s, 'adv:board', {
      summaryKey: def.promise.summaryKey,
      dueWeek,
      importance: def.promise.importance,
      emotionalImpact: def.memory.emotionalImpact,
      tags: ['promise', 'board'],
      facts: def.promise.summaryKey.includes('burn') ? { burn } : { target },
    })
    promiseId = record?.id
  }

  for (const characterId of room.characterIds) {
    feelFacts(s, characterId, def.facts, promiseId ?? room.id)
    if (!promiseId || characterId !== 'adv:board')
      noteCharacterEvent(s, characterId, {
        type: promiseId ? 'strategy_change' : def.memory.type,
        summaryKey: promiseId ? `board_meeting_${def.id}` : def.memory.summaryKey,
        importance: def.memory.importance,
        emotionalImpact: def.memory.emotionalImpact,
        tags: def.memory.tags,
        actorId: FOUNDER_ID,
        targetId: characterId,
        sourceId: room.id,
      })
  }

  room.chosen.push(decisionId)
  room.movesLeft = 0
  room.status = 'resolved'
  room.resolvedWeek = s.week
  room.outcome = def.text
  if (promiseId) room.facts = { ...(room.facts ?? {}), promiseId }
  return true
}

// ---------------------------------------------------------------------------------------
// 4. The player's move
// ---------------------------------------------------------------------------------------

/**
 * THE entry point for answering a room. Capability-gated per kind, idempotent (an option already
 * spent, or a room already closed, is a no-op), and incapable of touching a simulation field —
 * everything it writes lands in `s.world`.
 *
 * Routed through the replay registry by the store, like every other player action: the rooms a
 * founder answered, and how, are part of what a run did, and a replay that skipped them would
 * rebuild a different biography from the same decisions.
 */
export function chooseInteractionOption(s: GameState, interactionId: string, optionId: string): StructuredInteraction | null {
  const world = s.world
  const seed = s.config?.seed
  if (!world || seed === undefined) return null
  const room = list(world).find((i) => i.id === interactionId)
  if (!room || room.status !== 'open' || room.movesLeft <= 0) return null
  if (!hasCapability(s, KIND_CAPABILITY[room.kind])) return null
  if (!room.options.some((o) => o.id === optionId)) return null

  const ok =
    room.kind === 'interview'
      ? askQuestion(s, room, seed, optionId)
      : room.kind === 'conversation'
        ? answerConversation(s, room, optionId)
        : answerBoardMeeting(s, room, optionId)
  return ok ? room : null
}

// ---------------------------------------------------------------------------------------
// 5. The weekly step
// ---------------------------------------------------------------------------------------

/**
 * Which segment, if any, finished a round of interviews this week. Read off Career's OWN evidence
 * log rather than off `activeExperiments` — a completed experiment is filtered out of that array
 * in the same tick, and inventing a second bookkeeping copy of "an interview finished" is how two
 * subsystems start disagreeing about what happened.
 */
function segmentInterviewedThisWeek(s: GameState): string | null {
  const evidence = s.career?.evidence
  if (!Array.isArray(evidence)) return null
  const hits = evidence.filter((e) => e.week === s.week && e.source === 'interview').map((e) => e.segmentId)
  if (hits.length === 0) return null
  return [...hits].sort()[0]
}

/**
 * Open whatever rooms this week's facts call for. Runs inside tickLivingWorld's
 * shouldGenerateForWeek guard, after the advisor panel so a board meeting can exclude the
 * sentences the panel already spoke. Draws no randomness outside the composer's own streams.
 */
export function generateInteractions(
  s: GameState,
  world: LivingWorldState,
  seed: number,
  extraFacts: readonly WeekFact[] = [],
  segmentLookup?: (segmentId: string) => { name: string; truth: InterviewSegmentTruth } | null,
): void {
  sweepStaleInteractions(world, s.week)

  // One interview room at a time. A founder cannot sit in two rooms at once, and the STUDY's
  // evidence has already landed in Career's belief system either way — the room is the human face
  // of that evidence, not a second copy of it, so skipping one costs the conversation and nothing
  // else. Without this guard a standing study opens a room every other week and the panel becomes
  // a queue.
  if (hasCapability(s, 'structuredInterviews') && segmentLookup && openInteractions(world, 'interview').length === 0) {
    const segmentId = segmentInterviewedThisWeek(s)
    const seg = segmentId ? segmentLookup(segmentId) : null
    if (segmentId && seg)
      openInterview(s, world, seed, {
        segmentId,
        segmentName: seg.name,
        truth: seg.truth,
        price: INTERVIEW_PRICE_PHRASE[s.career?.pricing ?? 'market'] ?? INTERVIEW_PRICE_PHRASE.market,
      })
  }

  if (hasCapability(s, 'structuredEmployeeConversations') && openInteractions(world, 'conversation').length === 0)
    openConversation(s, world, seed)

  if (hasCapability(s, 'proceduralBoardMeetings')) openBoardMeeting(s, world, seed, extraFacts)

  enforceInteractionLimit(world)
}

/**
 * Close the rooms the founder never came to. Idempotent and fact-only: it writes a status and a
 * sentence, never a relationship fact or a memory, because nothing was said. An interview that ran
 * its budget partway keeps whatever was collected — those answers really were heard.
 */
export function sweepStaleInteractions(world: LivingWorldState, week: number): StructuredInteraction[] {
  const closed: StructuredInteraction[] = []
  for (const room of list(world)) {
    if (room.status !== 'open' || week - room.week < INTERACTION_STALE_WEEKS) continue
    room.status = 'resolved'
    room.resolvedWeek = week
    room.movesLeft = 0
    room.outcome =
      room.kind === 'interview'
        ? room.chosen.length > 0
          ? 'The rest of the calls happened without you. What you did hear is above.'
          : 'The calls happened. You were not on them, and nobody wrote down what was said.'
        : room.kind === 'board_meeting'
          ? 'The meeting closed without a decision from the chair. The room drew its own conclusions.'
          : 'You never got back to them. The moment passed, the way moments do.'
    closed.push(room)
  }
  return closed
}

/**
 * Keep the rooms inside their cap. An OPEN room is never dropped — the player has not answered it
 * yet and silently deleting the question would be the system lying about what it asked — so the
 * settled ones go first, oldest verdict first, exactly the way the promise ledger sheds.
 */
export function enforceInteractionLimit(world: LivingWorldState): void {
  const rooms = world.interactions
  if (!Array.isArray(rooms) || rooms.length <= LIVING_WORLD_LIMITS.interactions) return
  const open = rooms.filter((i) => i.status === 'open')
  const room = Math.max(0, LIVING_WORLD_LIMITS.interactions - open.length)
  const keptSettled = new Set(
    rooms
      .filter((i) => i.status !== 'open')
      .sort((a, b) => (b.resolvedWeek ?? b.week) - (a.resolvedWeek ?? a.week) || (a.id < b.id ? -1 : 1))
      .slice(0, room)
      .map((i) => i.id),
  )
  world.interactions = rooms.filter((i) => i.status === 'open' || keptSettled.has(i.id))
  // A runaway (a hand-edited save with fifty open rooms) still has to come down to something.
  if (world.interactions.length > LIVING_WORLD_LIMITS.interactions * 2)
    world.interactions = [...world.interactions]
      .sort((a, b) => b.week - a.week || (a.id < b.id ? -1 : 1))
      .slice(0, LIVING_WORLD_LIMITS.interactions * 2)
}
