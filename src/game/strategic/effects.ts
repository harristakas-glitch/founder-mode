// Strategic Systems Expansion — THE effect choke point (brief §21–§22).
//
// Every strategic multiplier in the game flows through this module. The composition rule,
// stated once and enforced here: parts are small additive bonuses (±0.02–0.20), they stack
// with diminishing returns, and every output is HARD-CAPPED. Nothing in this codebase may
// multiply strategic effects together (1.4 × 1.4 × 1.4 is how balance dies).
//
// Documented caps (the balance contract — change only with a probe run recorded in
// docs/balance-strategic.md):
//   buildVelocity     ±35%   (AI eng, roadmap dev-velocity items, tech debt drag, coherence)
//   acquisitionEff    ±20%   (roadmap acquisition items, coherence, big-bet synergy)
//   opexMult          −20%…0 (roadmap operating-efficiency items, AI ops — a discount, never a tax)
//   arpuMult          0…+12% (roadmap monetization items)
//   churnRelief       0…15%  (roadmap retention items — multiplies churn DOWN, never up)
//   bugPressure       ±25%   (tech debt raises it, reliability items lower it)
//   conversionLift    0…+18% (CRO items, PMF-CEILINGED — optimisation cannot outrun weak fit)
//   brand → acquisitionEff (≤+12% at stock 100) and arpu (≤+3%); its CAC relief lives in
//   estimatedCac via brandCacRelief so paid economics improve at ONE choke point

import type { GameState } from '../types'
import { roadmapDef } from './content'
import { completedBetParts } from './bigbets'
import { attentionParts } from './attention'
import { capacityParts } from './capacity'
import { aiParts } from './ai'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Additive parts with diminishing stacking: each extra part beyond the first contributes a
 *  little less, and the sum is clamped. Pure; the ONLY composition rule in the expansion. */
export function composeBonus(parts: number[], cap: number): number {
  const live = parts.filter((p) => p !== 0)
  const dim = 1 - 0.06 * Math.max(0, live.length - 1)
  return 1 + clamp(live.reduce((a, b) => a + b, 0) * Math.max(0.7, dim), -cap, cap)
}

export interface StrategicModifiers {
  /** multiplies eng/design output flowing into product + roadmap */
  buildVelocity: number
  /** multiplies marketing/user acquisition effectiveness */
  acquisitionEff: number
  /** multiplies weekly non-payroll operating costs (≤1) */
  opexMult: number
  /** multiplies revenue per customer */
  arpuMult: number
  /** multiplies churn (≤1 — completed retention work makes leaving harder) */
  churnRelief: number
  /** multiplies bug generation (tech debt pushes up, reliability work pushes down) */
  bugPressure: number
  /** multiplies the revenue conversion term — CRO work, ceilinged by PMF (growth brief §9) */
  conversionLift: number
  /** multiplies weekly research point gain (customers attention — the founder is in the calls) */
  researchMult: number
  /** flat weekly morale drift for every employee (leadership attention lifts, neglect drains) */
  moraleDrift: number
}

/** Impact points → bonus size. One point of impact ≈ 2% on its axis, before diminishing. */
const PT = 0.02

/**
 * Derived, never stored: recomputed from the roadmap's DONE list and debt each time. Adding a
 * slice to state that this could compute is how saves and truth drift apart.
 * Segment relevance: in career the target segment's multiplier applies to customer-facing
 * axes (an enterprise SSO shipped while targeting freelancers earns its 0.2×); quick play uses
 * the item's mean multiplier.
 */
export function strategicModifiers(s: GameState): StrategicModifiers {
  const rm = s.roadmap
  const acq: number[] = []
  const build: number[] = []
  const opex: number[] = []
  const arpu: number[] = []
  const churn: number[] = []
  const bugs: number[] = []
  const cro: number[] = []

  if (rm) {
    const target = s.career?.primaryTargetSegmentId
    for (const doneItem of rm.done) {
      const def = roadmapDef(s.sector, doneItem.id)
      if (!def) continue
      const segVals = Object.values(def.segmentImpact)
      const mean = segVals.length ? segVals.reduce((a: number, b) => a + (b ?? 0), 0) / segVals.length : 1
      const rel = target ? (def.segmentImpact[target] ?? mean) : mean
      const i = def.impact
      // customer-facing axes wear the segment relevance; internal axes do not
      if (i.acquisition) acq.push(i.acquisition * PT * rel)
      if (i.monetization) arpu.push(i.monetization * PT * 0.75 * rel)
      if (i.retention) churn.push(i.retention * PT * 0.9 * rel)
      if (i.developerVelocity) build.push(i.developerVelocity * PT)
      // CRO items lift conversion, CEILINGED BY FIT: the same shipped work is worth less than
      // half as much at PMF 20 as at PMF 80 — conversion tricks cannot manufacture fit.
      if (def.type === 'cro') {
        const ceiling = 0.4 + 0.6 * (s.pmf / 100)
        cro.push(3 * PT * rel * ceiling)
      }
      if (i.operatingEfficiency) opex.push(i.operatingEfficiency * PT * 0.75)
      if (i.reliability) bugs.push(-i.reliability * PT * 1.5)
    }
    // tech debt: a 0–100 stock that drags velocity (up to −15%) and feeds bugs (up to +25%)
    if (rm.debt > 0) {
      build.push(-0.15 * (rm.debt / 100))
      bugs.push(0.25 * (rm.debt / 100))
    }
  }

  // BRAND (growth engine): the compounding stock pulls organic demand and buys a little trust.
  // Its third effect — cheaper paid acquisition — is applied inside estimatedCac, not here.
  const brandStock = s.growth?.brand.stock ?? 0
  if (brandStock > 0) {
    acq.push((brandStock / 100) * 0.12)
    arpu.push((brandStock / 100) * 0.03)
  }

  // FOUNDER ATTENTION (phase 4): where the founder personally spends the week. Boosts and
  // neglect maluses arrive as parts sized in attention.ts; the caps here still bind them.
  const attn = attentionParts(s)
  build.push(...attn.build)
  acq.push(...attn.acq)
  churn.push(...attn.churn)
  bugs.push(...attn.bugs)

  // AI ADOPTION (phase 5): maturity × implementation quality per area, through the same caps as
  // everything else — and a botched engineering transformation pays in bugs, not speed. No PMF
  // hook by design (§5.10): AI moves execution channels, never fit itself.
  const aip = aiParts(s)
  build.push(...aip.build)
  acq.push(...aip.acq)
  arpu.push(...aip.arpu)
  churn.push(...aip.churn)
  opex.push(...aip.opex)
  bugs.push(...aip.bugs)

  // MANAGEMENT CAPACITY (phase 4): an org past Stretched leaks quality and morale — the delayed
  // consequences the brief demands (§10.5). Its speed cost lives in mgmtDrag at the employee
  // seam, not here, so it is never double-counted. Zero outside deep career by construction.
  const cap = capacityParts(s)
  if (cap.bugs) bugs.push(cap.bugs)

  // a COMPLETED Big Bet leaves its archetype's standing effect (bigbets.ts, still capped here)
  const bet = completedBetParts(s)
  if (bet.build) build.push(bet.build)
  if (bet.acq) acq.push(bet.acq)
  if (bet.arpu) arpu.push(bet.arpu)
  if (bet.churn) churn.push(bet.churn)
  if (bet.opex) opex.push(bet.opex)
  // an ABANDONED bet leaves three weeks of strategic confusion (§7.14) — brief, then it fades
  if (s.bigBet?.status === 'abandoned' && s.bigBet.abandonedWeek !== undefined && s.week < s.bigBet.abandonedWeek + 3) {
    build.push(-0.05)
  }

  return {
    buildVelocity: composeBonus(build, 0.35),
    acquisitionEff: composeBonus(acq, 0.2),
    opexMult: Math.min(1, composeBonus(opex.map((p) => -p), 0.2)),
    arpuMult: clamp(composeBonus(arpu, 0.12), 1, 1.12),
    churnRelief: clamp(composeBonus(churn.map((p) => -p), 0.15), 0.85, 1),
    bugPressure: composeBonus(bugs, 0.25),
    conversionLift: clamp(composeBonus(cro, 0.18), 1, 1.18),
    researchMult: attn.researchMult,
    // attention lifts or starves morale; AI leverage adds a little; a Breaking org drains it —
    // one clamped channel for all three
    moraleDrift: clamp(attn.moraleDrift + cap.moraleDrift + aip.moraleDrift, -2.5, 1.8),
  }
}
