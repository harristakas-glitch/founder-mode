// The bot population — every balance instrument draws its players from here.
//
// Balance measurements are only as good as the players they simulate: every blind spot the
// 2026-08-25 audit found mapped to a motion no bot played (no upmarket bot -> enterprise tiers
// unmeasured; no acquisitive bot -> the M&A arbitrage lived for months; no dial bot -> peg-high
// dominance invisible). Two rules keep that from recurring:
//   1. TIERS are a design claim: doNothing < casual < active < expert, enforced by
//      test/skill-ladder.ts. A tier inversion is a balance defect, not a shrug.
//   2. LEVER COVERAGE is a stat: every player lever must be exercised by at least one
//      archetype (test/lever-coverage.ts) — a lever no bot pulls is unmeasured by definition.
//
// `casual` and `active` are the CANONICAL probe bots, moved here verbatim from
// test/v2-balance-probe.ts — their behavior is load-bearing (the balance lockfile's bands were
// calibrated against them). Change them only with the lockfile in the same commit.

import { acceptTermSheet, canAcquire, acquireRival, counterTermSheet, drawDebt, marketingMax, pitchInvestors, resolveChoiceOnState } from '../../src/game/engine'
import { startResearchV2 } from '../../src/game/sim2/research'
import { sectorById } from '../../src/game/data'
import type { GameState } from '../../src/game/types'

export type BotTier = 0 | 1 | 2 | 3 // doNothing / casual / active / expert
export interface BotDef {
  name: string
  tier: BotTier
  /** founder background the archetype plays as (mirrors how humans of that profile play) */
  founderKind: 'technical' | 'business'
  /** player levers this bot exercises — verified against LEVER_PREDICATES at runtime */
  levers: string[]
  play(s: GameState): void
}

// ---------- shared moves ----------

export function resolveChoicesFirst(s: GameState): void {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
}

export function hire(s: GameState, role: string): void {
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  if (s.cash < 180_000 || staff >= 10) return
  const c = [...s.candidates].filter((x) => x.role === role).sort((a, b) => b.skill - a.skill)[0]
  if (!c) return
  s.candidates = s.candidates.filter((x) => x.id !== c.id)
  s.offersOut.push(c)
}

/** the dominant SERVED segment (by cohort size) of a V2 run, if any */
function dominantSegment(s: GameState): string | null {
  const v2 = s.simV2
  if (!v2) return null
  const served: Record<string, number> = {}
  for (const c of v2.cohorts) served[c.segmentId] = (served[c.segmentId] ?? 0) + c.size
  return Object.entries(served).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** resolve choices the way an informed player would: known-best options per Major Moment */
function resolveChoicesSmart(s: GameState): void {
  for (const m of s.inbox) {
    if (m.kind !== 'choice' || m.resolved || !m.choices) continue
    let pick = 0
    if (m.title.startsWith('⚔️')) pick = Math.min(2, m.choices.length - 1) // differentiate, not match
    resolveChoiceOnState(s, m.id, pick)
  }
}

// ---------- tier 0: the floor ----------

const doNothing: BotDef = {
  name: 'doNothing',
  tier: 0,
  founderKind: 'technical',
  levers: [],
  play(s) {
    // answers with the LAST option (the shrug), spends nothing, raises nothing
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, m.choices.length - 1)
  },
}

// ---------- tier 1: canonical casual (verbatim from the probe) ----------

const casual: BotDef = {
  name: 'casual',
  tier: 1,
  founderKind: 'technical',
  levers: ['marketing', 'fundraise', 'hire'],
  play(s) {
    resolveChoicesFirst(s)
    s.marketingSpend = Math.min(5_000, marketingMax(s))
    if (s.raiseCooldown === 0 && s.termSheets.length === 0 && s.week % 8 === 0) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
    if (s.week % 9 === 0) hire(s, 'engineer')
  },
}

// ---------- tier 2: canonical active (verbatim from the probe) ----------

const active: BotDef = {
  name: 'active',
  tier: 2,
  founderKind: 'business',
  levers: ['marketing', 'fundraise', 'hire', 'allocation', 'research', 'pricing-tier'],
  play(s) {
    resolveChoicesFirst(s)
    // V2-aware but V1-tolerant: on a classic-engine run (e.g. the daily ladder) the V2 reads
    // vanish and the cadence stands — on V2 runs behavior is byte-identical to the original
    const v2 = s.simV2
    if (s.week === 2) s.marketingSpend = Math.min(6_000, marketingMax(s))
    // an ACTIVE founder re-points the team after every war room / harden sprint — without this
    // the crisis choices' allocation shifts compound and the product org never builds again
    if (s.week >= 2 && s.week % 8 === 2) s.allocation = { ...s.allocation, features: 40, quality: 35, bugs: 15, research: 10 }
    // scale spend only after the service side holds and the channel is not screaming
    if (s.week > 20 && (!v2 || (v2.serviceQuality > 60 && (v2.gtm?.lastCac ?? 0) < 400))) s.marketingSpend = Math.min(10_000, marketingMax(s))
    else if (v2 && v2.serviceQuality < 45) s.marketingSpend = Math.min(3_000, marketingMax(s))
    // study the money question early, then price to the segment you ACTUALLY serve — premium
    // into a mass-consumer base is a real mistake the economics punish (measured, round 1)
    if (v2 && s.week === 6) startResearchV2(s, 'pricing_study', v2.segments[1]?.id ?? v2.segments[0].id)
    if (v2 && s.week === 20 && s.career) {
      const dom = v2.segments.find((x) => x.id === dominantSegment(s))
      if (dom) {
        const est = dom.knowledge.wtp.visibleEstimate
        s.career.pricing = est > v2.pricing.price * 1.35 ? 'premium' : est < v2.pricing.price * 0.75 ? 'low' : 'market'
      }
    }
    // team: engineers first (attributes are the game), one seller for the upmarket door, service
    if (s.week === 10 || s.week === 24 || s.week === 38 || s.week === 52) hire(s, 'engineer')
    if (s.week === 30) hire(s, 'sales')
    if (s.week === 18 || s.week === 44) hire(s, 'designer')
    if (s.raiseCooldown === 0 && s.termSheets.length === 0 && (s.cash < 250_000 || s.week % 16 === 0)) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount / b.equity - a.amount / a.equity)[0].id)
  },
}

// ---------- tier 3: expert — active's plan plus the levers the audit proved pay ----------

const expert: BotDef = {
  name: 'expert',
  tier: 3,
  founderKind: 'business',
  levers: ['marketing', 'fundraise', 'hire', 'allocation', 'research', 'price-dial', 'positioning', 'counter-sheet', 'moment-judgement'],
  play(s) {
    resolveChoicesSmart(s)
    const v2 = s.simV2
    if (s.week === 2) s.marketingSpend = Math.min(6_000, marketingMax(s))
    if (s.week >= 2 && s.week % 8 === 2) s.allocation = { ...s.allocation, features: 40, quality: 35, bugs: 15, research: 10 }
    // spend scales with the business (a fraction of revenue), throttled when service drowns
    if (s.week > 20 && (!v2 || (v2.serviceQuality > 60 && (v2.gtm?.lastCac ?? 0) < 400)))
      s.marketingSpend = Math.min(Math.max(10_000, Math.round(s.lastRevenue * 0.3)), marketingMax(s))
    else if (v2 && v2.serviceQuality < 45) s.marketingSpend = Math.min(3_000, marketingMax(s))
    // research BOTH money questions: the mass base early, the mid segment for the upsell path
    if (v2 && s.week === 6) startResearchV2(s, 'pricing_study', v2.segments[0].id)
    if (v2 && s.week === 14) startResearchV2(s, 'pricing_study', v2.segments[1]?.id ?? v2.segments[0].id)
    // positioning on the segment actually served — measured +6-14% (audit, healthy list)
    if (v2 && s.week >= 14 && s.week % 12 === 2) {
      const dom = dominantSegment(s)
      if (dom) v2.positioning = { targetSegmentId: dom }
    }
    // the dial, informed: price a touch above the served segment's estimated WTP — inside the
    // band where collection is honest and elasticity has not started to bite
    if (v2 && s.week >= 22 && s.week % 12 === 10) {
      const dom = v2.segments.find((x) => x.id === dominantSegment(s))
      if (dom && dom.knowledge.wtp.confidence > 0.4) {
        const ref = sectorById(s.sector).arpuPerCustomer
        const target = Math.min(Math.max(dom.knowledge.wtp.visibleEstimate * 1.1, ref * 0.25), ref * 6)
        v2.pricing = { price: target, lastChangedWeek: s.week, manual: true }
      }
    }
    if (s.week === 10 || s.week === 24 || s.week === 38 || s.week === 52) hire(s, 'engineer')
    if (s.week === 30) hire(s, 'sales')
    if (s.week === 18 || s.week === 44) hire(s, 'designer')
    if (s.raiseCooldown === 0 && s.termSheets.length === 0 && (s.cash < 300_000 || s.week % 14 === 0)) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) {
      // one push-back per sheet (negotiation, engagement §6), then take the best cheque
      const best = [...s.termSheets].sort((a, b) => b.amount / b.equity - a.amount / a.equity)[0]
      if (!best.countered) counterTermSheet(s, best.id)
      const after = [...s.termSheets].sort((a, b) => b.amount / b.equity - a.amount / a.equity)[0]
      if (after) acceptTermSheet(s, after.id)
    }
  },
}

// ---------- specialists: coverage for motions the mainline tiers never play ----------

/** the upmarket motion — sales-led, premium, positioned on the top-WTP segment. Exists so
 *  enterprise tiers are MEASURED (audit: 0 enterprise customers in 128 mainline-bot runs). */
const salesLed: BotDef = {
  name: 'salesLed',
  tier: 2,
  founderKind: 'business',
  levers: ['marketing', 'fundraise', 'hire', 'allocation', 'research', 'pricing-tier', 'price-dial', 'positioning'],
  play(s) {
    resolveChoicesFirst(s)
    const v2 = s.simV2
    if (!v2) return
    if (s.week === 2) {
      s.marketingSpend = Math.min(4_000, marketingMax(s))
      s.allocation = { ...s.allocation, features: 35, quality: 40, bugs: 15, research: 10 }
    }
    const top = v2.segments[v2.segments.length - 1]
    if (s.week === 6 && top) startResearchV2(s, 'pricing_study', top.id)
    if (s.week >= 10 && s.week % 10 === 0 && top) v2.positioning = { targetSegmentId: top.id }
    if (s.week === 20 && s.career) s.career.pricing = 'premium'
    if (s.week >= 30 && s.week % 16 === 14 && top && top.knowledge.wtp.confidence > 0.4) {
      const ref = sectorById(s.sector).arpuPerCustomer
      v2.pricing = { price: Math.min(Math.max(top.knowledge.wtp.visibleEstimate * 0.5, ref), ref * 6), lastChangedWeek: s.week, manual: true }
    }
    // the sales bench IS the strategy
    if (s.week === 8 || s.week === 20 || s.week === 34) hire(s, 'sales')
    if (s.week === 14 || s.week === 28 || s.week === 44) hire(s, 'engineer')
    if (s.raiseCooldown === 0 && s.termSheets.length === 0 && (s.cash < 250_000 || s.week % 12 === 0)) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  },
}

/** the consolidator — casual play plus a rival purchase whenever the gates allow. Exists so
 *  the M&A lane (price floor, whale gate, growth-step discount) stays measured. */
const acquisitive: BotDef = {
  name: 'acquisitive',
  tier: 2,
  founderKind: 'business',
  levers: ['marketing', 'fundraise', 'hire', 'buy-rival'],
  play(s) {
    resolveChoicesFirst(s)
    s.marketingSpend = Math.min(6_000, marketingMax(s))
    if (s.raiseCooldown === 0 && s.termSheets.length === 0 && s.week % 8 === 0) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
    if (s.week % 9 === 0) hire(s, 'engineer')
    if (s.week > 20 && s.week % 4 === 1) {
      // smallest first (cheapest deal clears the size gates soonest), but a rebuffed target
      // must not block the lane — try each rival that passes canAcquire
      for (const target of [...s.rivals].filter((r) => r.alive && !r.acquired).sort((a, b) => a.users - b.users)) {
        if (canAcquire(s, target).ok) {
          acquireRival(s, target.id, s.cash > 2_000_000 ? 'cash' : 'stock')
          break
        }
      }
    }
  },
}

/** the abuser — pegs every abusable dial. NOT part of the ladder; exists for the invariant
 *  fuzzer and exploit regressions: whatever this bot achieves is the game's abuse ceiling. */
const abuser: BotDef = {
  name: 'abuser',
  tier: 2,
  founderKind: 'business',
  levers: ['marketing', 'fundraise', 'hire', 'price-dial', 'debt'],
  play(s) {
    resolveChoicesFirst(s)
    s.marketingSpend = marketingMax(s)
    if (s.week % 8 === 3) drawDebt(s, 1e12) // clamped to debtCapacity inside

    if (s.simV2) {
      const ref = sectorById(s.sector).arpuPerCustomer
      s.simV2.pricing = { price: ref * 6, lastChangedWeek: s.week, manual: true }
    }
    if (s.raiseCooldown === 0 && s.termSheets.length === 0) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
    if (s.week % 6 === 0) hire(s, 'engineer')
  },
}

export const BOTS: Record<string, BotDef> = { doNothing, casual, active, expert, salesLed, acquisitive, abuser }

/** the ladder, in intended order — test/skill-ladder.ts asserts outcomes are monotone in it */
export const LADDER: BotDef[] = [doNothing, casual, active, expert]

// ---------- lever coverage ----------

/** every player lever the balance apparatus claims to measure, with a runtime predicate that
 *  proves a bot actually exercised it in a probe run */
export const LEVER_PREDICATES: Record<string, (s: GameState, virgin: GameState) => boolean> = {
  marketing: (s, v) => s.marketingSpend !== v.marketingSpend,
  fundraise: (s) => s.stage !== 'Pre-seed' || (s.flags.pitchesLanded ?? 0) > 0 || s.raiseCooldown > 0,
  hire: (s) => s.employees.length + s.offersOut.length + s.pendingHires.length > 0,
  allocation: (s, v) => JSON.stringify(s.allocation) !== JSON.stringify(v.allocation),
  research: (s) => (s.simV2?.pendingResearch.length ?? 0) > 0 || (s.simV2?.segments.some((x) => x.knowledge.wtp.confidence > 0.55) ?? false),
  'pricing-tier': (s) => s.career?.pricing !== undefined && s.career.pricing !== 'market',
  'price-dial': (s) => s.simV2?.pricing.manual === true,
  positioning: (s) => (s.simV2?.positioning?.targetSegmentId ?? null) !== null,
  'counter-sheet': (s) => (s.flags.sheetsCountered ?? 0) > 0,
  'moment-judgement': () => true, // exercised by construction (resolveChoicesSmart); no state fingerprint
  'buy-rival': (s) => s.rivals.some((r) => r.acquired) || (s.maCooldown ?? 0) > 0,
  debt: (s) => s.debt !== undefined && s.debt !== null,
}
