// V2 economic primitives (spec §8.4, §9, §10, §13.2) — PURE functions, no state, no RNG.
// Everything the choice model needs: ideal-point product fit with thresholds, sigmoid price
// fit against latent WTP, bounded brand effects, softmax choice with an outside option.
// The monotonicity tests in test/sim2.test.ts pin the shape: better fit never hurts, price far
// above WTP always hurts, brand never reduces demand.

import type { MarketSegmentV2, ProductAttributeV2, SegmentAttributePreference } from './types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Ideal-point fit with minimum thresholds (spec §8.3-8.4). Ideals ≥95 behave monotonically —
 *  "more is always better" — because the distance term stops penalizing overshoot there. */
export function productFit(attributes: Record<string, number>, prefs: SegmentAttributePreference[]): number {
  let num = 0
  let den = 0
  let penalty = 0
  for (const p of prefs) {
    const v = attributes[p.attributeId] ?? 0
    const fit = p.idealValue >= 95 ? clamp01(v / p.idealValue) : clamp01(1 - Math.abs(v - p.idealValue) / 100)
    num += fit * p.importance
    den += p.importance
    if (p.minimumThreshold !== undefined && v < p.minimumThreshold) penalty += p.thresholdPenalty ?? 0.35
  }
  const base = den > 0 ? num / den : 0
  return clamp01(base - penalty)
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** Latent willingness-to-pay, moved by what the product actually is (spec §13.1). Brand buys a
 *  LITTLE pricing power (≤+12% at brand 100 on a brand-led segment) — never rescues bad fit. */
export function effectiveWtp(seg: MarketSegmentV2, fit: number, brand: number): number {
  return seg.baseWtp * (0.7 + 0.5 * fit) * (1 + 0.12 * (brand / 100) * seg.brandImportance)
}

/** Sigmoid price fit (spec §13.2): smooth, punishing far above WTP, diminishing below it.
 *  Sensitivity steepens the curve — price-sensitive segments notice everything. */
export function priceFit(price: number, wtp: number, priceSensitivity: number): number {
  const scale = Math.max(0.1, wtp * (1.15 - 0.7 * priceSensitivity))
  return sigmoid((wtp - price) / scale)
}

export interface OfferInput {
  id: string
  fit: number
  priceFitV: number
  brand: number // 0..100
  /** installed share of this segment's served customers, 0..1 — switching friction protects it */
  installedShare: number
}

/** Utility per offer per segment (spec §9). Weights derive from the segment's own personality
 *  and renormalize, so a price-blind enterprise buyer and a price-first freelancer read the
 *  same product differently. */
export function offerUtility(seg: MarketSegmentV2, o: OfferInput): number {
  const wFit = 0.42
  const wPrice = 0.18 + 0.25 * seg.priceSensitivity
  const wBrand = 0.06 + 0.22 * seg.brandImportance
  const wTotal = wFit + wPrice + wBrand
  const base = (wFit * o.fit + wPrice * o.priceFitV + wBrand * (o.brand / 100)) / wTotal
  const installed = seg.switchingFriction * 0.25 * o.installedShare
  return clamp01(base) + installed
}

/** The outside option (spec §9): "do nothing / keep the current tool". Strong in immature
 *  categories, and never zero — competitors cannot split 100% of a market nobody wants. */
export function outsideUtility(seg: MarketSegmentV2): number {
  return 0.42 + 0.35 * (1 - seg.adoptionMaturity)
}

/** Softmax over offers + outside option (spec §9). Returns shares keyed by offer id, plus
 *  'outside'. Sums to 1 within floating tolerance (tested). */
export function choiceShares(seg: MarketSegmentV2, offers: OfferInput[], temperature: number): Record<string, number> {
  const t = Math.max(0.02, temperature)
  const entries = [...offers.map((o) => ({ id: o.id, u: offerUtility(seg, o) })), { id: 'outside', u: outsideUtility(seg) }]
  const maxU = Math.max(...entries.map((e) => e.u))
  const exps = entries.map((e) => ({ id: e.id, x: Math.exp((e.u - maxU) / t) }))
  const sum = exps.reduce((a, e) => a + e.x, 0)
  const out: Record<string, number> = {}
  for (const e of exps) out[e.id] = e.x / sum
  return out
}

/** Weekly in-market demand for a segment (spec §10) — POTENTIAL buyers this week, before GTM
 *  reach and capacity constrain what is realized. */
export function weeklyDemand(seg: MarketSegmentV2, week: number, macroFactor: number): number {
  const growth = Math.pow(1 + seg.growthRateAnnual, week / 52)
  return (seg.potentialCustomers * seg.activeDemandRate * growth * macroFactor) / 52
}

export const attrRecord = (attributes: ProductAttributeV2[]): Record<string, number> =>
  Object.fromEntries(attributes.map((a) => [a.id, a.value]))
