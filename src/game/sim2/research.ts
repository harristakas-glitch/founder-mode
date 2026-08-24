// V2 phase 4 — Market Research & the Information Economy (spec §14, §0A.13).
//
// The one law: TRUTH EXISTS IN THE SIMULATION; THE PLAYER SEES ESTIMATES; RESEARCH IMPROVES
// ESTIMATES. A study never moves the market — it narrows the player's uncertainty band toward
// the truth and raises confidence, after a real delay, for real money. Question → Spend →
// Wait → Learn → Decide (spec §14.4). Deterministic: the narrowing is a fixed contraction
// toward truth, no dice.

import type { GameState } from '../types'
import type { BusinessSimulationV2State, EstimatedValue, SimulationEvent } from './types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export type ResearchKind = 'interviews' | 'market_survey' | 'pricing_study' | 'cohort_analysis' | 'competitor_intel'

export interface ResearchDef {
  kind: ResearchKind
  name: string
  /** plain language: what will we learn (spec §14.6) */
  what: string
  cost: number
  weeks: number
  /** which knowledge estimate it improves */
  improves: 'wtp' | 'size' | 'retention'
  /** how hard it narrows (0..1 contraction toward truth per completed study) */
  strength: number
}

export const RESEARCH_CATALOG: ResearchDef[] = [
  {
    kind: 'interviews',
    name: 'Customer interviews',
    what: 'What these people actually need, and roughly what staying power they have.',
    cost: 4_000,
    weeks: 1,
    improves: 'retention',
    strength: 0.45,
  },
  {
    kind: 'market_survey',
    name: 'Market survey',
    what: 'How many of them are really out there.',
    cost: 9_000,
    weeks: 2,
    improves: 'size',
    strength: 0.55,
  },
  {
    kind: 'pricing_study',
    name: 'Pricing study',
    what: 'What they are willing to pay — before you find out the expensive way.',
    cost: 12_000,
    weeks: 2,
    improves: 'wtp',
    strength: 0.6,
  },
  {
    kind: 'competitor_intel',
    name: 'Competitive intelligence',
    what: 'A rival’s real price and who they are actually courting.',
    cost: 8_000,
    weeks: 2,
    improves: 'size', // unused for intel — the reveal writes the intel map instead
    strength: 0,
  },
  {
    kind: 'cohort_analysis',
    name: 'Cohort analysis',
    what: 'How your own customers actually behave once the honeymoon ends.',
    cost: 6_000,
    weeks: 1,
    improves: 'retention',
    strength: 0.65,
  },
]

export const researchDef = (kind: string): ResearchDef | undefined => RESEARCH_CATALOG.find((r) => r.kind === kind)

/** Start a study. Bills cash now, completes later; one study per (kind, segment) at a time. */
export function startResearchV2(s: GameState, kind: string, segmentId: string): boolean {
  const v2 = s.simV2
  const def = researchDef(kind)
  if (!v2 || !def) return false
  // competitor_intel targets a COMPETITOR key; everything else targets a segment
  if (kind === 'competitor_intel') {
    if (!v2.competitors.some((c) => c.id === segmentId)) return false
  } else if (!v2.segments.some((seg) => seg.id === segmentId)) return false
  if (v2.pendingResearch.some((p) => p.kind === kind && p.targetId === segmentId)) return false
  if (s.cash < def.cost) return false
  s.cash -= def.cost
  v2.pendingResearch.push({
    id: `${kind}_${segmentId}_${s.week}`,
    kind,
    startedWeek: s.week,
    completesWeek: s.week + def.weeks,
    targetId: segmentId,
  })
  return true
}

/** The deterministic narrowing: estimate moves toward truth, band contracts, confidence rises.
 *  TRUTH IS READ, NEVER WRITTEN. */
function narrow(e: EstimatedValue, strength: number, week: number): EstimatedValue {
  const visibleEstimate = e.visibleEstimate + (e.truth - e.visibleEstimate) * strength
  const half = Math.abs(e.uncertaintyRange[1] - e.uncertaintyRange[0]) / 2
  const newHalf = Math.max(Math.abs(e.truth) * 0.04, half * (1 - strength * 0.8))
  return {
    truth: e.truth,
    visibleEstimate,
    confidence: clamp01(e.confidence + strength * 0.45),
    uncertaintyRange: [visibleEstimate - newHalf, visibleEstimate + newHalf],
    lastUpdatedWeek: week,
  }
}

/** Resolver step 27: due studies land. Each completion is an explicit event (spec §0A.13) with
 *  before/after confidence in the facts — the reveal belongs to the engagement layer. */
export function tickResearch(v2: BusinessSimulationV2State, week: number, analyticsMult = 1): SimulationEvent[] {
  const events: SimulationEvent[] = []
  const due = v2.pendingResearch.filter((p) => week >= p.completesWeek)
  if (due.length === 0) return events
  v2.pendingResearch = v2.pendingResearch.filter((p) => week < p.completesWeek)
  for (const p of due) {
    const def = researchDef(p.kind)
    if (!def) continue
    // intel: the rival's offer becomes KNOWN — price and focus, as of this week
    if (p.kind === 'competitor_intel') {
      const comp = v2.competitors.find((c) => c.id === p.targetId)
      if (!comp) continue
      const focusSegment = Object.entries(comp.segmentFocus).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      ;(v2.intel ??= {})[comp.id] = { price: Math.round(comp.price), focusSegment, revealedWeek: week }
      events.push({
        id: `v2_${week}_research_${p.id}`,
        week,
        category: 'research',
        type: 'competitor_intel_completed',
        magnitude: 0.55,
        urgency: 0.4,
        strategicRelevance: 0.7,
        entityIds: [comp.id],
        facts: { study: 'Competitive intelligence', competitor: comp.name, price: Math.round(comp.price) },
        visibility: 'known',
      })
      continue
    }
    const seg = v2.segments.find((x) => x.id === p.targetId)
    if (!seg) continue
    const before = seg.knowledge[def.improves]
    // analytics capability (spec §14.5): AI-assisted analysis makes the same study sharper
    const after = narrow(before, Math.min(0.85, def.strength * analyticsMult), week)
    seg.knowledge[def.improves] = after
    events.push({
      id: `v2_${week}_research_${p.id}`,
      week,
      category: 'research',
      type: `${p.kind}_completed`,
      magnitude: 0.45 + 0.4 * (after.confidence - before.confidence),
      urgency: 0.4,
      strategicRelevance: 0.65,
      entityIds: [seg.id],
      facts: {
        study: def.name,
        segment: seg.name,
        metric: def.improves,
        confidenceBefore: Math.round(before.confidence * 100),
        confidenceAfter: Math.round(after.confidence * 100),
      },
      visibility: 'known',
    })
  }
  return events
}

export const confidenceLabel = (c: number): string => (c >= 0.75 ? 'High' : c >= 0.45 ? 'Medium' : 'Low')

/** The player-facing read of an estimate — everything EXCEPT the truth. */
export function describeEstimate(e: EstimatedValue, fmt: (n: number) => string): { text: string; confidence: string } {
  return {
    text: `${fmt(e.uncertaintyRange[0])} – ${fmt(e.uncertaintyRange[1])}`,
    confidence: confidenceLabel(e.confidence),
  }
}
