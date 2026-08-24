// Strategic Systems Expansion — Strategic Coherence (master brief §10). Game verb: COMMIT.
//
// Does this company know what it is trying to become? Coherence is FULLY DERIVED from choices
// the player already made — the Big Bet, the target segment, pricing, the live roadmap, the
// marketing mix, who got hired — never declared and never stored (contract D2: declaration IS
// the bet plus career targeting). The number stays hidden (§9.7): the player sees qualitative
// signals and feels modest, capped consequences. Pivot friction is NOT re-implemented here —
// repositioning cost and the bet-abandonment shadow already price strategy changes (§9.6).
//
// Every dimension reads what the company KNOWS (beliefs), not hidden truth — coherence rewards
// acting on your own evidence, not guessing the generator.

import type { GameState } from '../types'
import type { BigBetType } from './types'
import { bigBetDef } from './bigbets'
import { mixAlignment } from './growth'
import { roadmapDef } from './content'

export interface CoherenceSignal {
  tone: 'good' | 'warn'
  text: string
}

export interface Coherence {
  /** −5…+5, HIDDEN — never render this number (§9.7) */
  total: number
  signals: CoherenceSignal[]
}

/** The role a bet's execution most wants on payroll (§9.4 hiringStrategy dimension). */
const BET_ROLE: Partial<Record<BigBetType, string>> = {
  enterprise_readiness: 'sales',
  consumer_viral_engine: 'marketer',
  platform_play: 'engineer',
  ai_transformation: 'engineer',
  geographic_expansion: 'marketer',
}

export function coherence(s: GameState): Coherence {
  const signals: CoherenceSignal[] = []
  let total = 0
  const bet = s.bigBet?.status === 'active' ? s.bigBet : null
  const c = s.career

  // 1. segment ↔ pricing: premium on a segment the board believes won't pay is a contradiction
  //    the customer feels at the checkout; low pricing on believed-rich customers wastes them.
  if (c) {
    const b = c.segmentBeliefs[c.primaryTargetSegmentId]
    if (b && b.willingnessToPay.confidence >= 0.4) {
      if (c.pricing === 'premium' && b.willingnessToPay.estimate < 35) {
        total -= 1
        signals.push({ tone: 'warn', text: 'Premium pricing on customers the board says won’t pay — someone is wrong' })
      } else if (c.pricing === 'low' && b.willingnessToPay.estimate > 70) {
        total -= 1
        signals.push({ tone: 'warn', text: 'Bargain pricing for customers who’d pay real money — value left on the table' })
      } else if ((c.pricing === 'premium') === (b.willingnessToPay.estimate >= 55)) {
        total += 1
      }
    }
  }

  // 2. segment ↔ Big Bet: an enterprise push aimed at a non-enterprise book pulls two ways.
  if (bet && c) {
    const def = bigBetDef(bet.type)
    if (def.segment) {
      if (c.primaryTargetSegmentId.includes(def.segment) || def.segment.includes(c.primaryTargetSegmentId)) {
        total += 1
        signals.push({ tone: 'good', text: `The ${def.name} and your target customers point the same direction` })
      } else {
        total -= 1
        signals.push({ tone: 'warn', text: `The ${def.name} is about customers you aren’t targeting` })
      }
    }
  }

  // 3. roadmap ↔ segment: building things your own target barely values (career reads the
  //    per-segment impact the roadmap items carry).
  if (c && s.roadmap && s.roadmap.active.length > 0) {
    const rel = s.roadmap.active
      .map((a) => {
        const def = roadmapDef(s.sector, a.id)
        if (!def) return 1
        const vals = Object.values(def.segmentImpact)
        const mean = vals.length ? vals.reduce((x: number, y) => x + (y ?? 0), 0) / vals.length : 1
        return def.segmentImpact[c.primaryTargetSegmentId] ?? mean
      })
      .reduce((x, y) => x + y, 0) / s.roadmap.active.length
    if (rel >= 1.1) total += 1
    else if (rel <= 0.6) {
      total -= 1
      signals.push({ tone: 'warn', text: 'The roadmap is building for people you aren’t targeting' })
    }
  }

  // 4. marketing mix ↔ Big Bet (growth.ts already speaks alignment words — reuse, never re-derive).
  if (bet && s.growth) {
    const word = mixAlignment(bet.type, s.growth.performanceShare)
    if (word === 'supports') total += 1
    else if (word === 'competes') {
      total -= 1
      signals.push({ tone: 'warn', text: 'The marketing mix pulls against the Big Bet' })
    }
  }

  // 5. hiring ↔ Big Bet: the bet's own function on payroll (recent-ish team shape).
  if (bet && s.employees.length >= 3) {
    const want = BET_ROLE[bet.type]
    if (want) {
      const share = s.employees.filter((e) => e.role === want).length / s.employees.length
      if (share >= 0.25) total += 1
      else if (share === 0) {
        total -= 1
        signals.push({ tone: 'warn', text: `A ${bigBetDef(bet.type).name} with nobody in ${want === 'sales' ? 'sales' : want === 'marketer' ? 'marketing' : 'engineering'} hired for it` })
      }
    }
  }

  if (total >= 2 && signals.every((x) => x.tone === 'good')) {
    signals.unshift({ tone: 'good', text: 'The company knows what it is trying to become — decisions reinforce each other' })
  }
  return { total, signals: signals.slice(0, 3) }
}

/** Modest, capped consequences (§9.5): alignment compounds a little, contradiction taxes a
 *  little — parts for effects.ts, never applied twice. */
export function coherenceParts(s: GameState): { acq: number; build: number; moraleDrift: number } {
  const { total } = coherence(s)
  if (total >= 2) return { acq: 0.03, build: 0.02, moraleDrift: 0.1 }
  if (total <= -2) return { acq: -0.04, build: -0.03, moraleDrift: -0.2 }
  return { acq: 0, build: 0, moraleDrift: 0 }
}
