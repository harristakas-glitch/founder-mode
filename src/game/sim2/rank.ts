// V2 event importance — ONE ranker for every surface (spec §0A.7: briefing, resolution,
// inbox, major-moment candidates, postmortem turning points). V2 produces far more state than
// the player should see; this is the dial that keeps depth from becoming noise.

import type { BusinessSimulationV2State, SimulationEvent } from './types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Novelty: an event type unseen for longer scores higher; something that fired last week is
 *  old news. Reads the state's lastSeen memory (written by the resolver after ranking). */
export function noveltyOf(type: string, week: number, lastSeen: Readonly<Record<string, number>>): number {
  const prev = lastSeen[type]
  if (prev === undefined) return 1
  return clamp01((week - prev) / 12)
}

export function importanceOf(e: SimulationEvent, week: number, lastSeen: Readonly<Record<string, number>>): number {
  // multiplicative per the spec — an event must matter on EVERY axis to lead the week
  const novelty = 0.35 + 0.65 * noveltyOf(e.type, week, lastSeen)
  return clamp01(e.magnitude) * clamp01(0.3 + 0.7 * e.strategicRelevance) * clamp01(0.3 + 0.7 * e.urgency) * novelty
}

/** The week's player-visible consequences, best first. Hidden events never surface; signals
 *  rank but read vaguer in the UI (fog of war). */
export function rankEvents(v2: BusinessSimulationV2State, week: number, cap = 6): SimulationEvent[] {
  return v2.events
    .filter((e) => e.visibility !== 'hidden')
    .map((e) => ({ e, imp: importanceOf(e, week, v2.lastSeen) }))
    .sort((a, b) => b.imp - a.imp)
    .slice(0, cap)
    .map((x) => x.e)
}
