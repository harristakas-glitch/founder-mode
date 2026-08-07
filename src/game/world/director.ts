// The Narrative Director (brief §24-§27).
//
// One job: decide what deserves attention this week. It does NOT compose text and it does NOT
// touch the simulation — it takes candidates the week already produced, scores them, and returns
// the one story that leads plus a couple that also happened.
//
// Everything here is pure. The scoring is the part most likely to need tuning, so it has to be
// testable without booting a game.

import type { LivingWorldDepth } from './types'

/** What a message is doing, socially. Brief §21. */
export type InboxCategory =
  | 'concern'
  | 'opportunity'
  | 'request'
  | 'escalation'
  | 'recognition'
  | 'warning'
  | 'conflict'
  | 'follow_up'
  | 'reminder'
  | 'callback'

/**
 * Something that happened, offered up for narration. Each axis is 0–1: how much this matters
 * along that dimension. A candidate scores well by being strong on the axes the current mode
 * cares about, not by being loud everywhere.
 */
export interface NarrativeCandidate {
  id: string
  type: string
  financialImpact: number
  strategicImpact: number
  relationshipImpact: number
  competitiveImpact: number
  urgency: number
  /** Filled in by the director from history — a candidate should not assert its own novelty. */
  novelty: number
  callbackValue: number
  tags: string[]
  category: InboxCategory
  /** Who is speaking, if anyone. */
  characterId?: string
  /** Passed through to the composer. */
  slots?: Record<string, string>
}

export type NarrativeWeights = Readonly<{
  financialImpact: number
  strategicImpact: number
  relationshipImpact: number
  competitiveImpact: number
  urgency: number
  novelty: number
  callbackValue: number
}>

// Brief §25 — deliberately NOT the same across modes. Quick Play wants spectacle and surprise,
// Career wants consequence and memory, Arena wants the other players.
export const QUICK_WEIGHTS: NarrativeWeights = {
  novelty: 0.3,
  financialImpact: 0.25,
  strategicImpact: 0.2,
  competitiveImpact: 0.15,
  callbackValue: 0.05,
  relationshipImpact: 0.05,
  urgency: 0.15,
}

export const CAREER_WEIGHTS: NarrativeWeights = {
  strategicImpact: 0.25,
  relationshipImpact: 0.25,
  callbackValue: 0.2,
  financialImpact: 0.2,
  novelty: 0.1,
  competitiveImpact: 0.05,
  urgency: 0.15,
}

export const ARENA_WEIGHTS: NarrativeWeights = {
  competitiveImpact: 0.4,
  strategicImpact: 0.25,
  financialImpact: 0.15,
  novelty: 0.2,
  relationshipImpact: 0.02,
  callbackValue: 0.02,
  urgency: 0.15,
}

export function weightsForDepth(depth: LivingWorldDepth): NarrativeWeights {
  return depth === 'deep' ? CAREER_WEIGHTS : depth === 'competitive' ? ARENA_WEIGHTS : QUICK_WEIGHTS
}

/** How many stories a mode is willing to tell in one week. Brief §26. */
export function budgetForDepth(depth: LivingWorldDepth): { major: number; secondary: number } {
  if (depth === 'deep') return { major: 1, secondary: 2 }
  if (depth === 'competitive') return { major: 1, secondary: 1 }
  return { major: 1, secondary: 0 } // light: Quick Play must stay fast
}

/**
 * Brief §27. A thing that has never happened leads the week; the same thing three weeks running is
 * wallpaper. `lastSeen` maps candidate type → the week it last ran.
 *
 * The decay is deliberately slow (a full month) because the failure this replaces was a message
 * repeating every single week, and a short memory would let that back in.
 */
export const NOVELTY_MEMORY_WEEKS = 16

export function noveltyOf(type: string, week: number, lastSeen: Readonly<Record<string, number>>): number {
  const seen = lastSeen[type]
  if (seen === undefined) return 1 // never happened before — this is the story
  const age = Math.max(0, week - seen)
  return Math.min(1, age / NOVELTY_MEMORY_WEEKS)
}

export function scoreCandidate(c: NarrativeCandidate, w: NarrativeWeights): number {
  return (
    c.financialImpact * w.financialImpact +
    c.strategicImpact * w.strategicImpact +
    c.relationshipImpact * w.relationshipImpact +
    c.competitiveImpact * w.competitiveImpact +
    c.urgency * w.urgency +
    c.novelty * w.novelty +
    c.callbackValue * w.callbackValue
  )
}

export interface DirectedWeek {
  major?: NarrativeCandidate
  secondary: NarrativeCandidate[]
  /** Every candidate with its final score, highest first. Diagnostics and tests. */
  ranked: { candidate: NarrativeCandidate; score: number }[]
}

/**
 * Rank the week and pick what to tell. Novelty is computed here rather than trusted from the
 * candidate, so a generator cannot inflate its own importance.
 *
 * Ties break on candidate id so two clients scoring the same week agree — Arena replays the same
 * seed on every machine and a divergent narrative would be a visible desync.
 */
export function directWeek(
  candidates: readonly NarrativeCandidate[],
  opts: { week: number; depth: LivingWorldDepth; lastSeen?: Readonly<Record<string, number>>; minScore?: number },
): DirectedWeek {
  const { week, depth, lastSeen = {}, minScore = 0.12 } = opts
  const w = weightsForDepth(depth)
  const budget = budgetForDepth(depth)

  const ranked = candidates
    .map((c) => {
      const withNovelty = { ...c, novelty: noveltyOf(c.type, week, lastSeen) }
      return { candidate: withNovelty, score: scoreCandidate(withNovelty, w) }
    })
    .sort((a, b) => b.score - a.score || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0))

  // A quiet week should be quiet. Narrating something that scored 0.03 is how a living world turns
  // back into noise, which is the exact complaint this phase exists to answer.
  const worth = ranked.filter((r) => r.score >= minScore)
  const major = worth[0]?.candidate

  // One story per type per week: two different framings of the same fact read as a stutter.
  const seenTypes = new Set(major ? [major.type] : [])
  const secondary: NarrativeCandidate[] = []
  for (const r of worth.slice(1)) {
    if (secondary.length >= budget.secondary) break
    if (seenTypes.has(r.candidate.type)) continue
    seenTypes.add(r.candidate.type)
    secondary.push(r.candidate)
  }

  return { major, secondary, ranked }
}
