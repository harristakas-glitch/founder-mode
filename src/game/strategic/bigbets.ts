// Strategic Systems Expansion — Big Bets (master brief §7). Game verb: COMMIT / ALIGN.
//
// A Big Bet is the company-level answer to "what are we trying to become for the next
// chapter?" It creates STRATEGIC GRAVITY: roadmap work that reinforces the bet advances it
// and earns a small bounded synergy; contradictory work stays fully legal and simply doesn't.
// Declaring a strategy is not executing it (§7.11) — progress comes only from aligned
// execution. Board integration lands in phase 8; coherence drag in phase 6.

import type { GameState } from '../types'
import { roadmapDef } from './content'
import type { BigBetType, RoadmapImpact, SystemDepth } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface BigBetDef {
  type: BigBetType
  name: string
  blurb: string
  bestWhen: string
  tradeoff: string
  /** target duration by depth (§7.15: quick 4–8, simulation 8–24) */
  weeks: Record<Exclude<SystemDepth, 'off'>, number>
  /** which roadmap impact axes count as aligned execution, with weights 0–2 */
  axisAffinity: Partial<Record<keyof RoadmapImpact, number>>
  /** initiative TYPES that align regardless of axes */
  typeAffinity?: Partial<Record<string, number>>
  /** career: the segment this bet is really about (alignment bonus when targeting it) */
  segment?: string
  /** the standing company effect when COMPLETED — parts fed into effects.ts, still capped */
  completionEffect: Partial<{
    buildVelocity: number
    acquisitionEff: number
    arpu: number
    churnRelief: number
    opex: number
  }>
  milestones: [string, string, string]
}

export const BIG_BETS: BigBetDef[] = [
  {
    type: 'enterprise_readiness',
    name: 'Enterprise Readiness Push',
    blurb: 'Build the product, sales motion and controls it takes to win larger customers.',
    bestWhen: 'Bigger customers keep asking for things you don’t have.',
    tradeoff: 'Higher complexity, slower consumer roadmap, pricier hiring.',
    weeks: { light: 6, deep: 14, competitive: 8 },
    axisAffinity: { monetization: 1.5, reliability: 1.2, retention: 0.8 },
    typeAffinity: { platform: 0.8, internal_system: 0.5 },
    segment: 'enterprise',
    completionEffect: { arpu: 0.05, acquisitionEff: 0.03 },
    milestones: ['Ship an enterprise-grade initiative', 'Ship a second one', 'Hold retention while it lands'],
  },
  {
    type: 'consumer_viral_engine',
    name: 'Consumer Viral Engine',
    blurb: 'Build growth loops that turn your users into your acquisition channel.',
    bestWhen: 'People already share it without being paid to.',
    tradeoff: 'Monetisation lags; growth gets volatile.',
    weeks: { light: 5, deep: 10, competitive: 6 },
    axisAffinity: { acquisition: 1.8, retention: 0.7 },
    typeAffinity: { growth_system: 1.2 },
    completionEffect: { acquisitionEff: 0.07 },
    milestones: ['Ship a growth loop', 'Ship a second loop', 'Sustain the new arrival rate'],
  },
  {
    type: 'platform_play',
    name: 'Platform Play',
    blurb: 'Open the product up — APIs, integrations, an ecosystem others build on.',
    bestWhen: 'Customers keep building around you anyway.',
    tradeoff: 'A big engineering commitment with delayed direct revenue.',
    weeks: { light: 6, deep: 16, competitive: 9 },
    axisAffinity: { developerVelocity: 1.0, retention: 1.0 },
    typeAffinity: { platform: 2.0 },
    completionEffect: { churnRelief: 0.05, buildVelocity: 0.04 },
    milestones: ['Ship the first platform surface', 'Ship a second', 'Keep the platform reliable'],
  },
  {
    type: 'ai_transformation',
    name: 'AI Transformation Program',
    blurb: 'Redesign how the company operates around AI — leverage over headcount.',
    bestWhen: 'Execution capacity is becoming the constraint.',
    tradeoff: 'Implementation effort now, resistance risk, payoff later.',
    weeks: { light: 6, deep: 16, competitive: 8 },
    axisAffinity: { developerVelocity: 1.6, operatingEfficiency: 1.4 },
    typeAffinity: { internal_system: 1.2, infrastructure: 0.8 },
    completionEffect: { buildVelocity: 0.06, opex: 0.04 },
    milestones: ['Ship an efficiency system', 'Ship a second', 'Hold quality while the model changes'],
  },
  {
    type: 'margin_expansion',
    name: 'Margin Expansion Program',
    blurb: 'Make the machine cheaper to run: efficiency, pricing, automation.',
    bestWhen: 'Revenue is real but the burn eats all of it.',
    tradeoff: 'Slower growth and morale risk while the belt tightens.',
    weeks: { light: 5, deep: 12, competitive: 7 },
    axisAffinity: { operatingEfficiency: 1.8, monetization: 1.2 },
    typeAffinity: { internal_system: 1.0, technical_debt: 0.6 },
    completionEffect: { opex: 0.07, arpu: 0.03 },
    milestones: ['Ship a cost system', 'Lift revenue per customer', 'Hold the lower burn'],
  },
  {
    type: 'geographic_expansion',
    name: 'Geographic Expansion',
    blurb: 'Take the working machine to a market that hasn’t seen it yet.',
    bestWhen: 'The home market is answering and the machine repeats.',
    tradeoff: 'Management complexity and cash burn; focus fragments.',
    weeks: { light: 6, deep: 14, competitive: 8 },
    axisAffinity: { acquisition: 1.4, operatingEfficiency: 0.8, reliability: 0.6 },
    completionEffect: { acquisitionEff: 0.05 },
    milestones: ['Ship market-entry capability', 'Ship operational support', 'Sustain growth through entry'],
  },
]

export const bigBetDef = (type: BigBetType): BigBetDef => BIG_BETS.find((b) => b.type === type)!

/**
 * How much a roadmap initiative supports the bet, 0..~1.5. Hidden number; the UI speaks
 * qualitative words (§7.9). Axis affinity × the item's impact points, plus type affinity,
 * normalised by the item's total budget so a big item isn't "aligned" just by being big.
 */
export function initiativeAlignment(betType: BigBetType, sector: string, initiativeId: string): number {
  const bet = bigBetDef(betType)
  const def = roadmapDef(sector, initiativeId)
  if (!def) return 0
  const total = Object.values(def.impact).reduce((a: number, b) => a + (b ?? 0), 0) || 1
  let score = 0
  for (const [axis, w] of Object.entries(bet.axisAffinity)) {
    const pts = def.impact[axis as keyof RoadmapImpact] ?? 0
    score += (pts / total) * (w ?? 0)
  }
  score += bet.typeAffinity?.[def.type] ?? 0
  return clamp(score, 0, 1.6)
}

export type AlignmentWord = 'strongly_supports' | 'supports' | 'neutral' | 'competes'

export function alignmentWord(a: number): AlignmentWord {
  if (a >= 0.9) return 'strongly_supports'
  if (a >= 0.5) return 'supports'
  if (a >= 0.2) return 'neutral'
  return 'competes'
}

/** Choosing is free-form but singular: one active bet, and abandoning leaves a short shadow. */
export function chooseBigBet(s: GameState, type: BigBetType, depth: SystemDepth): boolean {
  if (depth === 'off') return false
  if (s.bigBet && s.bigBet.status === 'active') return false
  const def = BIG_BETS.find((b) => b.type === type)
  if (!def) return false
  const weeks = def.weeks[depth]
  s.bigBet = {
    type,
    startedWeek: s.week,
    targetWeek: s.week + weeks,
    status: 'active',
    progress: 0,
    milestones: def.milestones.map((_, i) => ({ id: `m${i}` })),
  }
  return true
}

export function abandonBigBet(s: GameState): boolean {
  if (!s.bigBet || s.bigBet.status !== 'active') return false
  s.bigBet.status = 'abandoned'
  s.bigBet.abandonedWeek = s.week
  return true
}

export interface BigBetWeek {
  completed: boolean
  failed: boolean
  milestonesHit: number
}

/**
 * One week of the bet. Progress comes ONLY from aligned execution: roadmap points that landed
 * this week on aligned items, weighted by their alignment, plus a milestone jump when an
 * aligned item ships. Time running out with progress short = failed (§7.14) — recoverable,
 * not fatal: the shadow is narrative plus the completion effect never landing.
 */
export function tickBigBet(
  s: GameState,
  alignedPointsThisWeek: number,
  alignedCompletionsThisWeek: number,
  depth: Exclude<SystemDepth, 'off'>,
): BigBetWeek {
  const bet = s.bigBet
  if (!bet || bet.status !== 'active') return { completed: false, failed: false, milestonesHit: 0 }
  const def = bigBetDef(bet.type)
  const weeks = def.weeks[depth]
  // full-pace aligned execution (~one aligned slot running constantly) completes on schedule
  const perWeekAtPace = 100 / weeks
  const pace = clamp(alignedPointsThisWeek / 1.3, 0, 1.6)
  bet.progress = clamp(bet.progress + perWeekAtPace * pace, 0, 100)

  let milestonesHit = 0
  for (let i = 0; i < alignedCompletionsThisWeek; i++) {
    const next = bet.milestones.find((m) => !m.doneWeek)
    if (next) {
      next.doneWeek = s.week
      milestonesHit++
      bet.progress = clamp(bet.progress + 8, 0, 100)
    }
  }
  // the last milestone is endurance, not shipping: it settles when progress crosses 90
  const last = bet.milestones[bet.milestones.length - 1]
  if (!last.doneWeek && bet.progress >= 90) {
    last.doneWeek = s.week
    milestonesHit++
  }

  if (bet.progress >= 100) {
    bet.status = 'completed'
    return { completed: true, failed: false, milestonesHit }
  }
  // twice the target window with under a third of the progress: the company never showed up
  if (s.week > bet.startedWeek + weeks * 2 && bet.progress < 34) {
    bet.status = 'failed'
    return { completed: false, failed: true, milestonesHit }
  }
  return { completed: false, failed: false, milestonesHit }
}

/** The synergy an ACTIVE bet grants aligned roadmap work — one small bounded part (§7.10). */
export const BIG_BET_SYNERGY = 0.1

/** Standing parts for a COMPLETED bet, consumed by strategicModifiers. */
export function completedBetParts(s: GameState): Partial<Record<'build' | 'acq' | 'arpu' | 'churn' | 'opex', number>> {
  const bet = s.bigBet
  if (!bet || bet.status !== 'completed') return {}
  const e = bigBetDef(bet.type).completionEffect
  return {
    ...(e.buildVelocity ? { build: e.buildVelocity } : {}),
    ...(e.acquisitionEff ? { acq: e.acquisitionEff } : {}),
    ...(e.arpu ? { arpu: e.arpu } : {}),
    ...(e.churnRelief ? { churn: e.churnRelief } : {}),
    ...(e.opex ? { opex: e.opex } : {}),
  }
}
