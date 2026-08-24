// Strategic Systems Expansion — the Product Roadmap engine (brief §6). Game verb: PRIORITISE.
//
// The model: initiatives are named work with a cost in build-weeks at REFERENCE velocity.
// Active items draw a capped share of the week's engineering points — that is the tradeoff
// made physical: while the roadmap builds, the allocation sliders' output visibly drops.
// A stronger team beats the base weeks; a weak one takes longer. Everything is pure and
// deterministic; the tick is called from advanceWeekInner at a fixed position.

import type { GameState } from '../types'
import { nextEvergreens, roadmapDef, roadmapPool } from './content'
import { createDefaultRoadmap, type RoadmapInitiativeDef, type SystemDepth } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Effort points per base week. Depth-scaled (brief §3.1 "shorter durations"): light modes
 *  compress execution so a 4-week item is ~4 weeks for a small team, not a quarter — Quick Run
 *  is the strategic call, not the project management. */
export const REFERENCE_VELOCITY: Record<Exclude<SystemDepth, 'off'>, number> = {
  light: 2.5,
  deep: 6,
  competitive: 4,
}

/** each active initiative draws 22% of eng output, capped at 44% total (two slots) */
export const ROADMAP_DRAW_PER_ITEM = 0.22
export const ROADMAP_MAX_DRAW = 0.44

export const roadmapSlots = (depth: SystemDepth): number => (depth === 'off' ? 0 : 2)

/** the pool this run can see: quick = the iconic four, deep/competitive = everything the
 *  stage allows; already-done and in-flight items are excluded */
export function availableInitiatives(s: GameState, depth: SystemDepth): RoadmapInitiativeDef[] {
  const rm = s.roadmap ?? createDefaultRoadmap()
  const busy = new Set([...rm.active.map((a) => a.id), ...rm.queued, ...rm.done.map((d) => d.id)])
  const late = s.stage !== 'Pre-seed' && s.stage !== 'Seed'
  const pool = roadmapPool(s.sector).filter(
    (i) => !busy.has(i.id) && (depth !== 'light' || i.quickPool) && (!i.lateStage || late),
  )
  // the pool ran dry mid-game (owner playtest) — when fewer than three named initiatives
  // remain in deep play, the evergreen programs open: a roadmap never truly finishes
  if (depth === 'deep' && pool.length < 3) pool.push(...nextEvergreens(busy).filter((i) => !busy.has(i.id)))
  return pool
}

export const effortRequired = (def: RoadmapInitiativeDef, depth: Exclude<SystemDepth, 'off'> = 'deep'): number =>
  def.weeks * REFERENCE_VELOCITY[depth]

/** Start (or queue) an initiative. Mutates in place, engine-style. Returns false if unknown. */
export function startInitiative(s: GameState, id: string, depth: SystemDepth): boolean {
  const def = roadmapDef(s.sector, id)
  if (!def || depth === 'off') return false
  const rm = (s.roadmap ??= createDefaultRoadmap())
  if (rm.active.some((a) => a.id === id) || rm.queued.includes(id) || rm.done.some((d) => d.id === id)) return false
  if (rm.active.length < roadmapSlots(depth)) rm.active.push({ id, startedWeek: s.week, progress: 0 })
  else rm.queued.push(id)
  return true
}

/** Cancel an active or queued initiative. Sunk effort stays sunk; a rushed abandonment leaves
 *  a little residue in the codebase (brief §6.10 — consequences, not punishment). */
export function cancelInitiative(s: GameState, id: string): boolean {
  const rm = s.roadmap
  if (!rm) return false
  const qi = rm.queued.indexOf(id)
  if (qi >= 0) {
    rm.queued.splice(qi, 1)
    return true
  }
  const ai = rm.active.findIndex((a) => a.id === id)
  if (ai < 0) return false
  const started = rm.active[ai].progress > 0
  rm.active.splice(ai, 1)
  if (started) rm.debt = clamp(rm.debt + 2, 0, 100)
  return true
}

export interface RoadmapWeekResult {
  /** fraction of eng output the roadmap consumed this week (0–ROADMAP_MAX_DRAW) */
  draw: number
  completed: RoadmapInitiativeDef[]
  /** effort points landed per item id this week (pre-synergy) — the bet tick reads it */
  pointsByItem: Record<string, number>
}

/**
 * One week of roadmap work. `engPoints` is the week's raw engineering output BEFORE the draw;
 * `buildVelocity` the strategic multiplier. Applies completion effects directly to state
 * (quality/bugs are stocks the engine already owns); standing effects derive from `done` via
 * strategicModifiers, so completing an item permanently changes the company.
 */
export function tickRoadmap(
  s: GameState,
  engPoints: number,
  buildVelocity: number,
  depth: Exclude<SystemDepth, 'off'> = 'deep',
  /** per-item synergy from an aligned Big Bet (bounded at the caller, §7.10) */
  boostFor?: (id: string) => number,
): RoadmapWeekResult {
  const rm = s.roadmap
  if (!rm || rm.active.length === 0) return { draw: 0, completed: [], pointsByItem: {} }

  const draw = Math.min(ROADMAP_MAX_DRAW, rm.active.length * ROADMAP_DRAW_PER_ITEM)
  const perItem = (engPoints * draw * buildVelocity) / rm.active.length
  const completed: RoadmapInitiativeDef[] = []
  const pointsByItem: Record<string, number> = {}
  for (const item of rm.active) pointsByItem[item.id] = perItem

  for (const item of rm.active) item.progress += perItem * (1 + (boostFor?.(item.id) ?? 0))
  // completions resolve after all progress lands, in slot order — deterministic
  for (const item of [...rm.active]) {
    const def = roadmapDef(s.sector, item.id)
    if (!def) {
      rm.active = rm.active.filter((a) => a !== item)
      continue
    }
    if (item.progress < effortRequired(def, depth)) continue
    rm.active = rm.active.filter((a) => a !== item)
    rm.done.push({ id: def.id, week: s.week })
    completed.push(def)
    // one-time stock effects — small, clamped, on stocks the engine already balances
    if (def.impact.productQuality) s.quality = clamp(s.quality + def.impact.productQuality * 3, 0, 100)
    if (def.impact.reliability) s.bugs = clamp(s.bugs - def.impact.reliability * 5, 0, 100)
    if (def.impact.acquisition) s.hype = clamp(s.hype + def.impact.acquisition * 2, 0, 100)
    rm.debt = clamp(rm.debt + (def.techDebtCreated ?? 0) - (def.techDebtReduced ?? 0), 0, 100)
    // a free slot pulls the next queued item the same week — priorities keep moving
    const next = rm.queued.shift()
    if (next && !rm.active.some((a) => a.id === next)) rm.active.push({ id: next, startedWeek: s.week, progress: 0 })
  }
  return { draw, completed, pointsByItem }
}

/** Fast feature shipping quietly accrues debt even outside the roadmap: the existing bug
 *  machinery models the SYMPTOM, this stock models the platform. Small and slow on purpose. */
export function accrueAmbientDebt(s: GameState, featureGain: number): void {
  const rm = s.roadmap
  if (!rm) return
  rm.debt = clamp(rm.debt + featureGain * 0.05 - 0.08, 0, 100)
}
