// Strategic Systems Expansion — Founder Attention & Delegation (master brief §9). Game verb:
// ALLOCATE.
//
// The founder has limited attention. Early, direct involvement is leverage; later, direct
// involvement everywhere becomes the bottleneck — that arc IS the mechanic. Depths:
//   light (quick)       — ONE Founder Focus: a single bounded boost, no budget, no maluses.
//   deep (simulation)   — an 8-point weekly budget with real tradeoffs: soft area NEEDS that
//                         emerge from company state, crisis forcing (a quality fire demands
//                         Operations), founder DEPENDENCY that grows with sustained direct
//                         involvement, and senior-hire delegation that covers needs for you.
//   off (arena)         — arena's limited actions per turn already price attention; the brief
//                         forbids a second attention currency there (§ "Attention — Off").
//
// INERT UNTIL ENGAGED: the default state (focus null, no allocation) produces exactly zero
// parts, zero state drift and zero forced events — golden traces stay byte-identical until the
// player touches the system. Effect sizes live HERE; caps live in effects.ts, the one composer.

import type { GameState } from '../types'
import type { AttentionState, BigBetType, FounderAttentionArea, SystemDepth } from './types'
import { bigBetDef } from './bigbets'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const ATTENTION_AREAS: FounderAttentionArea[] = [
  'product',
  'customers',
  'recruiting',
  'fundraising',
  'leadership',
  'operations',
]

export const ATTENTION_META: Record<FounderAttentionArea, { label: string; icon: string; moves: string }> = {
  product: { label: 'Product', icon: '🛠', moves: 'Roadmap and build speed' },
  customers: { label: 'Customers', icon: '💬', moves: 'Learning, retention, market signal' },
  recruiting: { label: 'Recruiting', icon: '🤝', moves: 'Candidate quality' },
  fundraising: { label: 'Fundraising', icon: '💰', moves: 'Investor relationships and pricing' },
  leadership: { label: 'Leadership', icon: '🧭', moves: 'Team morale and direction' },
  operations: { label: 'Operations', icon: '⚙️', moves: 'Stability and quality pressure' },
}

/** Weekly budget in deep mode (brief §8.3 — "8 points, tune during balancing"). */
export const ATTENTION_BUDGET = 8
/** No area absorbs more than this — the seventh point on Product is a meeting nobody needed. */
export const ATTENTION_AREA_MAX = 6

export const createDefaultAttention = (): AttentionState => ({ focus: null, dependency: {} })

/** How the player is currently engaging the system. 'none' MUST mean zero effect anywhere. */
export function attentionEngagement(s: GameState): 'none' | 'focus' | 'alloc' {
  const a = s.attention
  if (!a) return 'none'
  if (a.allocated) return 'alloc'
  return a.focus ? 'focus' : 'none'
}

// ---------- effect scaling ------------------------------------------------------------------
// One Focus (light) = the reference effect. Deep points scale the same effect sub-linearly:
// 3 points ≈ one Focus, 1 point ≈ 58% of it, the capped 6 points ≈ 141% — spreading thin is
// weak, piling on saturates (brief §8.10: "no linear attention = bonus only").
const ptScale = (pts: number) => Math.sqrt(clamp(pts, 0, ATTENTION_AREA_MAX) / 3)

/** Effective deep allocation AFTER crisis forcing squeezes the discretionary budget. Derived,
 *  never stored — the player's chosen allocation survives the crisis week untouched. */
export function effectiveAllocation(s: GameState): Partial<Record<FounderAttentionArea, number>> {
  const a = s.attention
  if (!a?.allocated) return {}
  const forced = a.forcedWeek === s.week ? (a.forced ?? {}) : {}
  const forcedSum = Object.values(forced).reduce((x: number, y) => x + (y ?? 0), 0)
  const discretionary = Math.max(0, ATTENTION_BUDGET - forcedSum)
  const chosenSum = Object.values(a.allocated).reduce((x: number, y) => x + (y ?? 0), 0)
  const squeeze = chosenSum > discretionary ? discretionary / chosenSum : 1
  const out: Partial<Record<FounderAttentionArea, number>> = {}
  for (const area of ATTENTION_AREAS) {
    // forced points count at HALF weight — firefighting is attention, not craft
    const v = (a.allocated[area] ?? 0) * squeeze + (forced[area] ?? 0) * 0.5
    if (v > 0) out[area] = v
  }
  return out
}

/** Scale of each area's reference effect this week: 0 = untouched, 1 = one-Focus-sized. */
export function areaScale(s: GameState): Partial<Record<FounderAttentionArea, number>> {
  const eng = attentionEngagement(s)
  if (eng === 'none') return {}
  if (eng === 'focus') return { [s.attention!.focus!]: 1 }
  const eff = effectiveAllocation(s)
  const out: Partial<Record<FounderAttentionArea, number>> = {}
  for (const area of ATTENTION_AREAS) if (eff[area]) out[area] = ptScale(eff[area]!)
  return out
}

// ---------- needs & delegation (deep only) --------------------------------------------------

/** Soft weekly needs derived from company state — under-attending them is what costs (§8.5).
 *  Only consulted once the player has engaged the allocator; a player who never opens the
 *  system is never punished by it. */
export function attentionNeeds(s: GameState): Partial<Record<FounderAttentionArea, number>> {
  const runwayTight =
    s.lastExpenses > s.lastRevenue && s.cash / Math.max(1, s.lastExpenses - s.lastRevenue) < 26
  return {
    product: 2,
    customers: s.users > 100 ? 1 : 0,
    recruiting: s.offersOut.length + s.pendingHires.length > 0 ? 1 : 0,
    fundraising: runwayTight ? 1 : 0,
    leadership: Math.min(3, Math.floor(s.employees.length / 6)),
    operations: s.bugs > 60 ? 2 : s.bugs > 35 ? 1 : 0,
  }
}

/** Delegation (§8.8): a senior hire (skill ≥ 8) covers one point of need in their domain and
 *  lets founder dependency unwind. Operations has no covering role yet — executives arrive
 *  with the management-capacity phase and will slot in here. */
export function delegationCover(s: GameState): Partial<Record<FounderAttentionArea, number>> {
  const senior = (role: string) => (s.employees.some((e) => e.role === role && e.skill >= 8) ? 1 : 0)
  return {
    product: senior('engineer'),
    customers: senior('marketer'),
    fundraising: senior('sales'),
    recruiting: senior('sales'),
  }
}

/** need − attention − cover, per area, floor 0. The number the maluses read. */
export function attentionShortfalls(s: GameState): Partial<Record<FounderAttentionArea, number>> {
  if (attentionEngagement(s) !== 'alloc') return {}
  const needs = attentionNeeds(s)
  const eff = effectiveAllocation(s)
  const cover = delegationCover(s)
  const out: Partial<Record<FounderAttentionArea, number>> = {}
  for (const area of ATTENTION_AREAS) {
    const short = (needs[area] ?? 0) - (eff[area] ?? 0) - (cover[area] ?? 0)
    if (short > 0) out[area] = short
  }
  return out
}

// ---------- parts for the composer (effects.ts consumes these) ------------------------------

export interface AttentionParts {
  build: number[]
  acq: number[]
  churn: number[] // relief parts (positive = churn goes DOWN)
  bugs: number[] // negative = fewer bugs
  /** multiplies research point gain (customers attention — you're in the calls) */
  researchMult: number
  /** flat weekly morale drift for every employee (leadership attention / neglect) */
  moraleDrift: number
}

/** Reference sizes: what ONE Focus is worth. Deep scales these by ptScale per area. */
const REF = {
  productBuild: 0.06,
  customersChurn: 0.04,
  customersResearch: 0.15,
  leadershipMorale: 1.0,
  operationsBugs: 0.08,
} as const

export function attentionParts(s: GameState): AttentionParts {
  const out: AttentionParts = { build: [], acq: [], churn: [], bugs: [], researchMult: 1, moraleDrift: 0 }
  const scale = areaScale(s)
  if (scale.product) out.build.push(REF.productBuild * scale.product)
  if (scale.customers) {
    out.churn.push(REF.customersChurn * scale.customers)
    out.researchMult = 1 + REF.customersResearch * Math.min(1.41, scale.customers)
  }
  if (scale.leadership) out.moraleDrift += REF.leadershipMorale * Math.min(1.8, scale.leadership)
  if (scale.operations) out.bugs.push(-REF.operationsBugs * scale.operations)

  // Neglect (deep, engaged only): each shortfall point bites the axis it starved. Founder
  // dependency ≥ 60 DOUBLES the bite — the org never learned to run without you (§8.7).
  const shorts = attentionShortfalls(s)
  const dep = s.attention?.dependency ?? {}
  const w = (area: FounderAttentionArea) => ((dep[area] ?? 0) >= 60 ? 2 : 1)
  if (shorts.product) out.build.push(-0.03 * shorts.product * w('product'))
  if (shorts.operations) out.bugs.push(0.06 * shorts.operations * w('operations'))
  if (shorts.leadership) out.moraleDrift -= 0.6 * shorts.leadership * w('leadership')
  if (shorts.customers) out.acq.push(-0.02 * shorts.customers * w('customers'))
  return out
}

// ---------- direct engine hooks (multipliers only — they change no RNG draw, no order) -------

/** Recruiting attention → better candidates walk in. Added inside makeCandidate's skill round. */
export function attentionRecruitingBonus(s: GameState): number {
  const sc = areaScale(s).recruiting ?? 0
  return Math.min(2, 1.2 * sc)
}

/** Fundraising attention → warmer processes price slightly better. Multiplies offeredVal. */
export function attentionFundraisingMult(s: GameState): number {
  const sc = areaScale(s).fundraising ?? 0
  return Math.min(1.08, 1 + 0.05 * sc)
}

// ---------- Big-Bet integration (§13.3) -----------------------------------------------------

/** Founder attention on the bet's affinity areas adds a small aligned-execution trickle. Sized
 *  so attention ALONE can never complete a bet — it accelerates real work, it isn't the work. */
export function attentionBetPoints(s: GameState, betType: BigBetType): number {
  const affinity = bigBetDef(betType).attentionAffinity
  if (!affinity?.length) return 0
  const eng = attentionEngagement(s)
  if (eng === 'focus') return affinity.includes(s.attention!.focus!) ? 0.15 : 0
  if (eng === 'alloc') {
    const eff = effectiveAllocation(s)
    const pts = affinity.reduce((a, area) => a + (eff[area] ?? 0), 0)
    return Math.min(0.3, 0.06 * pts)
  }
  return 0
}

// ---------- weekly tick (dependency drift + crisis forcing) ---------------------------------

/**
 * Called once per week at the START of the tick (right after `s.week += 1`), so a crisis
 * forces THIS week's budget before the modifiers are derived. Deterministic — no RNG — and a
 * strict no-op unless the deep allocator is engaged, so light modes and untouched saves see
 * zero state drift. `crisis` is non-null only the week a fire IGNITES (for the one inbox line).
 */
export function tickAttention(s: GameState, depth: SystemDepth): { crisis: FounderAttentionArea | null } {
  if (depth !== 'deep' || attentionEngagement(s) !== 'alloc') return { crisis: null }
  const a = s.attention!

  // Dependency (§8.7): sustained direct involvement without delegation makes the org lean on
  // you; senior cover halves the growth and doubles the unwind.
  const cover = delegationCover(s)
  for (const area of ATTENTION_AREAS) {
    const pts = a.allocated?.[area] ?? 0
    const covered = (cover[area] ?? 0) > 0
    const cur = a.dependency[area] ?? 0
    let next = cur
    if (pts >= 3) next = cur + (covered ? 1.5 : 3)
    else if (pts >= 1) next = cur + (covered ? 0.5 : 1)
    else next = cur - (covered ? 2 : 1)
    next = clamp(next, 0, 100)
    if (next > 0) a.dependency[area] = next
    else delete a.dependency[area]
  }

  // Crisis forcing (§8.6): a real quality fire demands Operations THIS week, shrinking the
  // discretionary budget. Threshold-driven and deterministic — no new dice.
  if (s.bugs > 60) {
    const alreadyBurning = !!a.forced && a.forcedWeek === s.week - 1
    a.forced = { operations: 3 }
    a.forcedWeek = s.week
    return { crisis: alreadyBurning ? null : 'operations' }
  }
  delete a.forced
  delete a.forcedWeek
  return { crisis: null }
}

// ---------- words for the UI (qualitative, never formulas — §8.9) ---------------------------

export const dependencyWord = (v: number): string | null =>
  v >= 80 ? 'cannot run without you' : v >= 60 ? 'leans on you heavily' : v >= 35 ? 'starting to lean on you' : null

export function attentionSignals(s: GameState): string[] {
  const lines: string[] = []
  if (attentionEngagement(s) !== 'alloc') return lines
  const shorts = attentionShortfalls(s)
  const names: Partial<Record<FounderAttentionArea, string>> = {
    product: 'Product is drifting without you',
    customers: 'You are losing touch with customers',
    leadership: 'The team feels unled',
    operations: 'Operational fires are burning unattended',
  }
  for (const area of ATTENTION_AREAS) if (shorts[area] && names[area]) lines.push(names[area]!)
  const dep = s.attention?.dependency ?? {}
  for (const area of ATTENTION_AREAS) {
    const word = dependencyWord(dep[area] ?? 0)
    if (word) lines.push(`${ATTENTION_META[area].label} ${word}`)
  }
  return lines.slice(0, 3)
}
