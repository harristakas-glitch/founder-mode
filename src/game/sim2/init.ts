// V2 state initialization — a market template becomes one run's TRUTH via the seeded rng
// (deterministic per run, different between runs), and the player's initial KNOWLEDGE of it
// starts wide and low-confidence (fog of war, spec §14). Called from newGame only when the V2
// gate is on; V1 runs never allocate any of this.

import type { BusinessSimulationV2State, EstimatedValue, MarketSegmentV2 } from './types'
import { marketTemplate, type Band } from './config/markets'

const draw = (rng: () => number, b: Band): number => b.lo + (b.hi - b.lo) * rng()

/** Initial estimate of a hidden truth: centred NEAR the truth with seeded error, range wide,
 *  confidence low — research (phase 4) narrows it; it never moves the truth. */
function estimate(rng: () => number, truth: number, week: number, spread = 0.5): EstimatedValue {
  const err = 1 + (rng() * 2 - 1) * spread * 0.5
  const visibleEstimate = truth * err
  return {
    truth,
    visibleEstimate,
    confidence: 0.2 + rng() * 0.15,
    uncertaintyRange: [visibleEstimate * (1 - spread), visibleEstimate * (1 + spread)],
    lastUpdatedWeek: week,
  }
}

export function createSimV2(sector: string, price: number, rng: () => number): BusinessSimulationV2State {
  const tpl = marketTemplate(sector)
  const segments: MarketSegmentV2[] = tpl.segments.map((b) => {
    const potentialCustomers = Math.round(draw(rng, b.size))
    const baseWtp = draw(rng, b.wtp)
    const retentionBaseline = draw(rng, b.retention)
    return {
      id: b.id,
      name: b.name,
      potentialCustomers,
      activeDemandRate: draw(rng, b.activeRate),
      growthRateAnnual: draw(rng, b.growthAnnual),
      adoptionMaturity: draw(rng, b.adoptionMaturity),
      baseWtp,
      priceSensitivity: draw(rng, b.priceSensitivity),
      switchingFriction: draw(rng, b.switchingFriction),
      retentionBaseline,
      attributePreferences: b.prefs,
      brandImportance: b.brandImportance,
      knowledge: {
        size: estimate(rng, potentialCustomers, 0, 0.6),
        wtp: estimate(rng, baseWtp, 0, 0.55),
        retention: estimate(rng, retentionBaseline, 0, 0.03),
      },
    }
  })

  return {
    version: 2,
    segments,
    attributes: tpl.attributes.map((a) => ({
      id: a.id,
      label: a.label,
      value: draw(rng, a.start),
      technicalCeiling: a.ceiling,
      decayRate: a.decayRate,
    })),
    pricing: { price, lastChangedWeek: 0 },
    competitors: [],
    cohorts: [],
    finance: { revenue: 0, cogs: 0, opex: 0, netIncome: 0 },
    planning: { commitments: [] },
    boardConfidence: { value: 60, driverHistory: [] },
    investorConfidence: { value: 55, driverHistory: [] },
    pendingResearch: [],
    events: [],
    explanations: [],
    weeklyHistory: [],
    lastSeen: {},
    firedMilestones: [],
    chapter: 'searching_for_fit',
  }
}
