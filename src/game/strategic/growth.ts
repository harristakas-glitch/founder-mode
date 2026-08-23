// Strategic Systems Expansion — the Growth Engine (owner brief "CRO + Marketing Mix").
// Game verbs: ALLOCATE / OPTIMISE.
//
// Two different growth activities, deliberately different shapes:
//   PERFORMANCE captures demand that exists — immediate, measurable, saturating (the existing
//   paid curve already charges rising marginal CAC; this module only routes spend into it).
//   BRAND creates demand that doesn't exist yet — a lagged, compounding, decaying stock that
//   pays out as organic pull, cheaper paid acquisition and a little pricing trust.
// CRO lives in the ROADMAP (a 'cro' initiative type), competes with feature work for the same
// slots, and is ceilinged by PMF — conversion tricks cannot manufacture fit (brief §9).
//
// The default state is exactly today's behaviour (performanceShare 1, brand 0) — the golden
// rule of this expansion: inert until the player engages it.

import type { GameState } from '../types'
import type { BigBetType, GrowthState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const createDefaultGrowth = (): GrowthState => ({
  performanceShare: 1,
  lastMixWeek: 0,
  brand: { stock: 0, pending: [] },
})

/** Brand investment matures this many weeks after it is spent (§24 — spend now, demand later). */
export const BRAND_LAG_WEEKS = 8

/**
 * One week of brand dynamics: mature what was invested BRAND_LAG_WEEKS ago, decay the stock
 * (young brands fade faster — §25), invest this week's brand spend for the future. Pure state
 * mutation, zero RNG.
 */
export function tickBrand(s: GameState, brandSpend: number): void {
  const g = (s.growth ??= createDefaultGrowth())
  const b = g.brand
  // 1. mature
  const due = b.pending.filter((p) => p.week <= s.week)
  b.pending = b.pending.filter((p) => p.week > s.week)
  for (const p of due) b.stock = clamp(b.stock + p.gain, 0, 100)
  // 2. decay — a young brand is a rumour, an old one is a memory
  const decay = b.stock < 25 ? 0.025 : 0.015
  b.stock = clamp(b.stock * (1 - decay), 0, 100)
  // 3. invest: ~$3k/wk builds a point at zero stock; the same dollars build less as the brand
  //    grows (awareness saturates) — sustained 5k/wk plateaus around "Known" (~45)
  if (brandSpend > 0) {
    const gain = brandSpend / (3000 * (1 + b.stock / 50))
    b.pending.push({ week: s.week + BRAND_LAG_WEEKS, gain })
    // pending list stays tiny: one entry per week, capped defensively
    if (b.pending.length > 30) b.pending.shift()
  }
}

export type BrandWord = 'Unknown' | 'Emerging' | 'Known' | 'Strong' | 'Category leader'

export function brandWord(stock: number): BrandWord {
  if (stock >= 75) return 'Category leader'
  if (stock >= 50) return 'Strong'
  if (stock >= 25) return 'Known'
  if (stock >= 8) return 'Emerging'
  return 'Unknown'
}

/** How much the brand discounts CAC (applied inside estimatedCac — brand makes performance
 *  work better, §27). Bounded at 12%. */
export const brandCacRelief = (s: GameState): number => clamp(((s.growth?.brand.stock ?? 0) / 100) * 0.12, 0, 0.12)

/**
 * The mix's alignment with the active Big Bet (§35–§36): qualitative, never a hard block.
 * Brand-hungry bets want ≥30% brand; the viral engine wants performance seeding activation.
 */
export function mixAlignment(bet: BigBetType, performanceShare: number): 'supports' | 'neutral' | 'competes' {
  const brandShare = 1 - performanceShare
  switch (bet) {
    case 'enterprise_readiness':
    case 'platform_play':
      return brandShare >= 0.3 ? 'supports' : brandShare >= 0.15 ? 'neutral' : 'competes'
    case 'margin_expansion':
      return brandShare >= 0.25 && brandShare <= 0.6 ? 'supports' : 'neutral'
    case 'consumer_viral_engine':
      return performanceShare >= 0.6 ? 'supports' : performanceShare >= 0.4 ? 'neutral' : 'competes'
    case 'geographic_expansion':
      return performanceShare >= 0.5 ? 'supports' : 'neutral'
    case 'ai_transformation':
      return 'neutral'
  }
}

export interface GrowthSignals {
  /** the one constraint the Growth screen leads with (§51) */
  constraint: string
  saturation: 'Open' | 'Warming' | 'Crowded'
  brand: BrandWord
  /** weeks until the next brand investment matures, if any */
  brandMaturesIn: number | null
}

/** Derived, deterministic, no RNG — the qualitative reads the UI speaks (§56). */
export function growthSignals(s: GameState): GrowthSignals {
  const g = s.growth
  const spend = Math.max(0, s.marketingSpend) * (g?.performanceShare ?? 1)
  const sat = spend / (spend + 150_000)
  const stock = g?.brand.stock ?? 0
  const nextMature = g?.brand.pending.length ? Math.min(...g.brand.pending.map((p) => p.week)) - s.week : null
  const constraint =
    s.pmf < 40
      ? 'Fit limits conversion — optimisation cannot outrun a product the market hasn’t said yes to.'
      : s.bugs > 35
        ? 'Quality is leaking users — bugs undo what acquisition buys.'
        : sat > 0.25
          ? 'Paid channels are getting crowded — the next dollar buys less than the last.'
          : 'Distribution — demand exists; reach and conversion decide who gets it.'
  return {
    constraint,
    saturation: sat > 0.25 ? 'Crowded' : sat > 0.12 ? 'Warming' : 'Open',
    brand: brandWord(stock),
    brandMaturesIn: nextMature !== null && nextMature > 0 ? nextMature : null,
  }
}
