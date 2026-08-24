// Strategic Systems Expansion — Management Capacity (master brief §11). Game verb: SCALE.
//
// A 5-person startup runs informally; a 40-person company cannot. Capacity is fully DERIVED —
// demand from what the company is trying to do, supply from who can actually lead it — and it
// is recomputed from state every read (contract §2: adding a stored slice here is how saves and
// truth drift apart). Outside deep career the whole system collapses to the classic
// coordinationDrag, BYTE-EXACTLY: quick and arena keep the engine they always had (owner
// simplification 2026-08-23), and the golden traces prove the equivalence every run.
//
// Deep career replaces the flat 1.5%/head tax with the real question: is the organisation LED?
// A big org with senior people, internal systems and a clear strategy claws the tax back; an
// unled one sinks below it and starts leaking morale and quality (parts fed through effects.ts,
// the one capped composer). No arbitrary headcount cap — leadership is the cap (brief §10.9).

import type { GameState } from '../types'
import { STAGES } from '../data'
import { systemDepth } from '../modes'
import { effectiveAllocation } from './attention'
import { roadmapDef } from './content'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Headcount past this many people starts costing the org 1.5%/head in effectiveness. Moved here
// from engine.ts verbatim (engine re-exports both, so every importer is untouched).
export const COORDINATION_FREE_HEADS = 8

export function coordinationDrag(s: GameState): number {
  return clamp(1 - Math.max(0, s.employees.length - COORDINATION_FREE_HEADS) * 0.015, 0.6, 1)
}

export type CapacityWord = 'Healthy' | 'Stretched' | 'Overloaded' | 'Breaking'

export interface ManagementCapacity {
  demand: number
  supply: number
  word: CapacityWord
  /** the load-bearing why-lines for the UI — read off the same terms the numbers use */
  why: string[]
}

/** What running THIS company takes per week (brief §10.3). Every term is a real commitment. */
export function capacityDemand(s: GameState): number {
  const heads = s.employees.length
  // informality runs out around the fourth person
  const headcount = Math.max(0, heads - 3) * 1.6
  const functions = new Set(s.employees.map((e) => e.role)).size * 1.5
  const stage = STAGES.indexOf(s.stage) * 2.5
  const roadmap = (s.roadmap?.active.length ?? 0) * 2 + (s.bigBet?.status === 'active' ? 3 : 0)
  const crisis = s.bugs > 60 ? 4 : 0
  const change = s.career?.repositioning ? 3 : 0
  return headcount + functions + Math.max(0, stage) + roadmap + crisis + change
}

/** Who can actually lead it (brief §10.4). Founder + senior people + systems + focus. */
export function capacitySupply(s: GameState): number {
  // the founder's own leadership, thinned when they are running on fumes
  const founder = 10 * (0.5 + clamp(s.energy, 0, 100) / 200)
  // seniors lead by existing; the truly senior (skill 8+) lead like executives (§10.7 — their
  // leverage is the function they cover, not a generic +20)
  const managers = s.employees.filter((e) => e.skill >= 7).length * 3
  const executives = s.employees.filter((e) => e.skill >= 8).length * 3
  // shipped internal systems ARE organisational capacity (§10.6)
  const systems =
    s.roadmap?.done.filter((d) => {
      const def = roadmapDef(s.sector, d.id)
      return def?.type === 'internal_system' || def?.type === 'infrastructure'
    }).length ?? 0
  // AI in operations runs the machine so people don't have to (phase 5 feeds this)
  const ops = s.aiAdoption?.areas.operations
  const ai = ops ? ops.maturity * (0.5 + ops.quality / 200) * 1.5 : 0
  // founder attention on leadership is direct supply; a clear strategy is cheap coordination
  const attn = (effectiveAllocation(s).leadership ?? 0) * 1.2
  const strategy = s.bigBet?.status === 'active' ? 2 : 0
  return founder + managers + executives + systems * 2.5 + ai + attn + strategy
}

const wordFor = (demand: number, supply: number): CapacityWord => {
  const r = demand > 0 ? supply / demand : 2
  return r >= 1 ? 'Healthy' : r >= 0.8 ? 'Stretched' : r >= 0.6 ? 'Overloaded' : 'Breaking'
}

export function managementCapacity(s: GameState): ManagementCapacity {
  const demand = capacityDemand(s)
  const supply = capacitySupply(s)
  const why: string[] = []
  const heads = s.employees.length
  const seniors = s.employees.filter((e) => e.skill >= 7).length
  if (heads > 6 && seniors === 0) why.push('Nobody senior enough to lead — everything routes through you')
  if (s.bugs > 60) why.push('The quality crisis is eating leadership hours')
  if (s.career?.repositioning) why.push('The repositioning has everyone asking what the plan is')
  if ((s.roadmap?.active.length ?? 0) >= 2 && seniors === 0) why.push('Two initiatives in flight with no one to run them')
  if (s.energy < 40) why.push('You are too drained to lead at full strength')
  if (why.length === 0 && supply < demand) why.push('The company is simply bigger than its leadership')
  return { demand: Math.round(demand), supply: Math.round(supply), word: wordFor(demand, supply), why: why.slice(0, 3) }
}

/**
 * THE replacement for coordinationDrag at the engine's employee-output seam (contract §4.2).
 * Light/competitive/off: the classic formula, byte-exactly — quick and arena cannot move.
 * Deep: the classic formula is the ANCHOR, and leadership bends it — up to +12% recovered by a
 * genuinely led org (never above 1.0), down to the 0.55 floor when demand swamps supply.
 */
export function mgmtDrag(s: GameState): number {
  const base = coordinationDrag(s)
  if (systemDepth(s, 'managementCapacity') !== 'deep') return base
  const demand = capacityDemand(s)
  const supply = capacitySupply(s)
  const adj = clamp((supply - demand) * 0.006, -0.25, 0.12)
  return clamp(base + adj, 0.55, 1)
}

/** Overload consequences beyond speed (§10.5), as parts for effects.ts — deep only, and zero
 *  the moment the org is merely Stretched (early warning costs nothing but worry). */
export function capacityParts(s: GameState): { bugs: number; moraleDrift: number } {
  if (systemDepth(s, 'managementCapacity') !== 'deep') return { bugs: 0, moraleDrift: 0 }
  const word = wordFor(capacityDemand(s), capacitySupply(s))
  if (word === 'Breaking') return { bugs: 0.1, moraleDrift: -0.9 }
  if (word === 'Overloaded') return { bugs: 0.05, moraleDrift: -0.4 }
  return { bugs: 0, moraleDrift: 0 }
}
