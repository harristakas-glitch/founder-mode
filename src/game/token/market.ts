// Tokenisation — the price model. Slice 2.
//
// docs/ico-architecture.md §4 (the restoring force for every reflexive loop) and brief §26–§31.
//
// EVERYTHING IN THIS FILE IS PURE. No RNG, no clock, no mutation. `tickToken` in ./tick.ts draws
// the week's noise and hands it in, which is what lets the whole price model be tested — and
// mutation-verified — without a simulation around it, and what lets the stress probe replay a week
// twice from the same state to measure a loop's gain.
//
// ---------------------------------------------------------------------------------------------
// THE THREE THINGS THAT MAKE THIS ECONOMY NON-ABSORBING. Read these before changing a number.
//
// 1. SPECULATIVE DEMAND READS MOMENTUM, NEVER THE PRICE LEVEL.
//    `momentum(t) = price / emaPrice − 1`. A level term (`demand ∝ price`) is the funding-climate
//    bug rewritten: that was a random walk against a hard clamp and it stuck runs frozen for 49 of
//    104 weeks because nothing pulled them back. A difference term against a MOVING anchor decays
//    to zero as the anchor catches up — a price that keeps rising raises its own baseline and stops
//    being news. This is the single most load-bearing damper in the subsystem.
//
// 2. GRAVITY IS SUPERLINEAR IN LOG-DEVIATION.
//    `d = ln(price/fairValue)`, `gravity = −gravityPull × sign(d) × |d|^1.5`. Because the exponent
//    exceeds 1 and the demand side is bounded by `TOKEN_ECONOMY.demandCap`, the restoring force
//    OVERTAKES any demand configuration at a finite dislocation:
//
//        |d|* = ((demandCap + maxNoise) / gravityPull) ^ (1/gravityExponent) ≈ 2.3   ⇒ ~10× fair
//
//    which is an algebraic ceiling on a bubble, not an empirical hope. It is symmetric, so an
//    undervaluation corrects exactly as fast as an overvaluation — decision 4's loop C, item 3.
//
// 3. THE PRICE FLOOR REPELS.
//    Price is floored at 1% of the launch price because zero is absorbing: `0 × anything = 0`, the
//    treasury is dead forever, and brief §43's "a death spiral need not end the company" becomes
//    a lie. But a floor is only a bound if something pushes off it — otherwise the floor IS the
//    absorbing state, one level down. So `fairValue` is itself floored at
//    `fairValueFloorMultiple × priceFloor`: at the price floor, `d ≤ ln(1/3) < 0` ALWAYS, and
//    gravity therefore always points up out of it. The floor is a boundary the economy bounces off.
//
// ---------------------------------------------------------------------------------------------
// AND THE ONE THAT MAKES THE TREASURY LOOP CONTRACT RATHER THAN COMPOUND.
//
//    price ↑ → treasuryValue ↑ → spend ↑ → demand ↑ → price ↑            (decision 4, loop A)
//
// `treasuryCommitment` caps the week's spend at `treasurySpendCapPerWeek × supply.treasury` —
// denominated in TOKENS. A doubling price does not double what may be spent; it doubles what a
// fixed token budget buys. That converts the loop's gain from compounding to linear, and it is why
// `treasuryValue` below is a READ-OUT rather than a budget.
//
// Then spending is its own negative feedback, twice over:
//   • `supplyPressurePerFloatPct` (1.1) > `ecosystemDemandPerFloatPct` (1.0), so releasing 1% of
//     the float costs strictly more price than the demand 1% of float buys;
//   • the released tokens raise `circulating`, and `fairValue` is a PER-TOKEN price, so the
//     fundamental anchor itself falls. Dilution is not a metaphor here, it is division.
//
// test/token-economy-probe.ts measures the resulting per-cycle gain rather than assuming it.

import { sectorById } from '../data'
import type { GameState } from '../types'
// Slice 3. This is a genuine cycle — users.ts imports `treasuryCommitment` from here — and it is
// safe for the same reason engine.ts ↔ token/scoring.ts already is: both directions are referenced
// only from inside function bodies, never at module top level, so the live bindings are resolved at
// call time. The alternative was to re-derive the treasury's weekly cap in a second place, which is
// the desync the contract spends §7.3 warning about.
import { programmeRequest } from './incentives'
import { incentivisedUsers, organicUsers } from './users'
import { TOKEN_BOUNDS, TOKEN_ECONOMY, TOKEN_LIMITS, type TokenState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

// ---------- read-outs ----------

/**
 * Brief §29. DERIVED, NEVER STORED — docs/ico-architecture.md §7.3: the brief puts `treasuryValue`
 * on the state next to `treasuryTokens` and `tokenPrice`, which is the same number in two places
 * with two update timings, and is exactly how §49's double-count gets in.
 *
 * It is a display figure and a narrative figure. It is NOT a budget: what may be spent is capped in
 * tokens by `treasuryCommitment`, which never reads this.
 */
export function treasuryValue(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  return t.supply.treasury * t.market.price
}

/** The lowest price this token may ever print. Zero is absorbing; 1% of launch is a catastrophe. */
export function priceFloor(t: TokenState): number {
  return t.plan.launchPrice * TOKEN_BOUNDS.priceFloorFraction
}

/**
 * Organic users — the ones the fair-value anchor is allowed to see.
 *
 * SLICE 3 MADE THIS REAL. It now delegates to `organicUsers(s)`, which reads the Career COHORTS
 * (where the truth lives) and falls back to `TokenState.users` only in Quick Play, which has no
 * cohorts. Before the split existed `t.users.incentivised` was always 0 and this was exactly
 * `s.users`, so nothing Slice 2 measured moves.
 *
 * Why it matters here specifically: `fairValue` is the anchor gravity pulls the price toward, and
 * decision 4 loop B.3 requires that the anchor CANNOT BE BOUGHT. A treasury that could spend its
 * way into more "organic" users would be inflating the very thing its price is supposed to be
 * pulled back to.
 */
export function organicUserCount(s: GameState): number {
  return organicUsers(s)
}

// ---------- fair value ----------

/**
 * What the whole network is worth on FUNDAMENTALS, in dollars.
 *
 * Three ingredients and no fourth: utility, protocol revenue, and ORGANIC users. Deliberately no
 * hype, no reputation and no incentivised users — decision 4 loop B.3 requires that the anchor
 * cannot be bought, and hype is the cheapest thing in this game to buy. It is also NOT
 * `valuation()`: enterprise value counts incentivised users (at a discount, from Slice 3) and the
 * "vibe" term, and an anchor that moved with either would let a founder inflate the thing their
 * price is supposed to be pulled back toward.
 */
export function fairNetworkValue(s: GameState): number {
  const t = s.token
  if (!t) return 0
  const u = clamp01(t.market.utility / 100)
  const eng = clamp01(t.community.engagement / 100)
  const sector = sectorById(s.sector)

  const annualRevenue = Math.max(0, s.lastRevenue) * 52
  const capture = TOKEN_ECONOMY.fairRevenueCaptureBase + TOKEN_ECONOMY.fairRevenueCaptureUtility * u
  const multiple = TOKEN_ECONOMY.fairRevenueMultipleBase + TOKEN_ECONOMY.fairRevenueMultipleUtility * u
  const revenueTerm = annualRevenue * capture * multiple

  const userShare = TOKEN_ECONOMY.fairUserShareBase + TOKEN_ECONOMY.fairUserShareUtility * u
  const engagementScale = TOKEN_ECONOMY.fairUserEngagementBase + TOKEN_ECONOMY.fairUserEngagementSpan * eng
  const userTerm = organicUserCount(s) * sector.perUserVal * userShare * engagementScale

  return Math.max(0, (revenueTerm + userTerm) * TOKEN_ECONOMY.fairValueScale)
}

/**
 * The fundamental anchor as a PER-TOKEN price, which is what gravity needs: `d = ln(price/fairValue)`
 * only type-checks as a dislocation if both sides are prices.
 *
 * Note what dividing by `circulating` buys: every token the treasury releases into the float lowers
 * the anchor. Dilution becomes a first-class force in the model rather than a footnote, and it is
 * the second of the two brakes on the treasury loop.
 *
 * The floor is the load-bearing part. See the header, point 3.
 */
export function fairValue(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  const circulating = Math.max(1, t.supply.circulating)
  const raw = fairNetworkValue(s!) / circulating
  return Math.max(priceFloor(t) * TOKEN_ECONOMY.fairValueFloorMultiple, raw)
}

// ---------- the treasury's weekly commitment ----------

export interface TreasuryCommitment {
  /** Tokens the standing programmes asked for this week. */
  requested: number
  /** Tokens actually released, after the cap. */
  tokens: number
  /** `treasurySpendCapPerWeek × supply.treasury`, in tokens. */
  cap: number
  /** Whether the cap bit — the fact that makes the loop linear rather than compounding. */
  capped: boolean
  /** Tokens released as a fraction of circulating supply. Both price terms scale with this. */
  floatFraction: number
}

/**
 * What the treasury may release into the float this week.
 *
 * SLICE SEAM. Slice 2 owns the CAP and the two price consequences; Slice 4 owns the player controls
 * that create programmes and what those programmes buy in users. `t.incentives` is empty until then,
 * so in this slice the in-game commitment is zero and the mechanism is exercised by
 * test/token-economy-probe.ts, which writes programmes directly. Reading a sub-slice a later phase
 * owns is fine; docs/ico-architecture.md §2 forbids CREATING one, and nothing here creates one.
 *
 * The cap is in TOKENS. That single choice is decision 4's first restoring force on loop A.
 */
export function treasuryCommitment(s: GameState | null | undefined): TreasuryCommitment {
  const empty: TreasuryCommitment = { requested: 0, tokens: 0, cap: 0, capped: false, floatFraction: 0 }
  const t = s?.token
  if (!t) return empty
  const treasury = Math.max(0, t.supply.treasury)
  const cap = treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek
  // Slice 4. A programme's standing order is a SHARE of this cap, re-derived here every week so it
  // tracks a draining treasury; `programmeRequest` falls back to the absolute `tokensPerWeek` for a
  // v1 save and for the probes that write programmes directly. Function-body import, like the
  // users.ts cycle above.
  let requested = 0
  for (const p of t.incentives) requested += programmeRequest(p, cap)
  const tokens = Math.min(requested, cap, treasury)
  const circulating = Math.max(1, t.supply.circulating)
  return { requested, tokens, cap, capped: tokens < requested - 1e-9, floatFraction: tokens / circulating }
}

/**
 * 0–1. How much demand a released token actually buys, before the coefficient. A spend into a
 * network nobody uses buys nothing; a spend into a live one buys close to the full coefficient —
 * and the full coefficient is still below the supply pressure the same spend creates.
 */
export function spendEffectiveness(t: TokenState): number {
  return clamp01(0.25 + 0.45 * clamp01(t.market.utility / 100) + 0.3 * clamp01(t.community.engagement / 100))
}

// ---------- the week's price move ----------

/** Every term of the week's move, kept separately so a test can assert on one of them. */
export interface PriceStep {
  momentum: number
  speculativeDemand: number
  utilityDemand: number
  communityDemand: number
  ecosystemDemand: number
  demand: number
  supplyPressure: number
  logDeviation: number
  gravity: number
  noise: number
  logMove: number
  factor: number
  price: number
  /** True when the floor was the binding constraint — the probe counts consecutive weeks of this. */
  floored: boolean
}

/** `price / emaPrice − 1`, bounded. THE difference term. Never replace this with a level. */
export function momentum(t: TokenState): number {
  const ema = Math.max(priceFloor(t), t.market.emaPrice)
  return clamp(t.market.price / ema - 1, TOKEN_ECONOMY.momentumMin, TOKEN_ECONOMY.momentumMax)
}

/**
 * One week of price, as a pure function.
 *
 * `noise` is injected in [−1, 1] rather than drawn here: the model is then testable without an RNG,
 * and the stress probe can replay the identical week with one input perturbed, which is how the
 * per-cycle loop gains are measured instead of assumed.
 */
export function priceStep(
  t: TokenState,
  fair: number,
  floatFraction: number,
  effectiveness: number,
  noise: number,
  /**
   * Slice 4, brief §41. Tokens that came out of `locked` this week, as a share of circulating
   * supply — vesting unlocks for the team, the founder and the partners.
   *
   * SEPARATE FROM `floatFraction` AND IT MUST STAY SEPARATE. Treasury spend creates supply pressure
   * AND ecosystem demand, because someone was paid to do something with those tokens. An unlock
   * creates supply pressure and NOTHING ELSE: nobody bought anything, a cliff simply passed. Folding
   * the two together would make every vesting schedule mildly bullish, which is exactly backwards
   * and would delete the cost of choosing `short`.
   */
  unlockFraction = 0,
): PriceStep {
  const m = momentum(t)
  const spec = clamp01(t.market.speculation / 100)
  const u = clamp01(t.market.utility / 100)
  const sentiment = clamp01(t.community.sentiment / 100)
  const engagement = clamp01(t.community.engagement / 100)

  // MOMENTUM, not level. The whole subsystem turns on this line.
  const speculativeDemand =
    TOKEN_ECONOMY.speculativeDemandCoef *
    Math.tanh(m / TOKEN_ECONOMY.momentumScale) *
    (TOKEN_ECONOMY.speculationDemandBase + TOKEN_ECONOMY.speculationDemandSpan * spec)

  // Differences from neutral, so weak utility and a sour community are negative demand rather than
  // merely a smaller positive — which is what gives loop C a real downward leg.
  const utilityDemand = TOKEN_ECONOMY.utilityDemandCoef * (u - TOKEN_ECONOMY.utilityNeutral)
  const communityDemand = TOKEN_ECONOMY.communityDemandCoef * (0.5 * sentiment + 0.5 * engagement - 0.5)
  const ecosystemDemand = TOKEN_ECONOMY.ecosystemDemandPerFloatPct * floatFraction * clamp01(effectiveness)

  const demand = clamp(
    speculativeDemand + utilityDemand + communityDemand + ecosystemDemand,
    -TOKEN_ECONOMY.demandCap,
    TOKEN_ECONOMY.demandCap,
  )

  // Strictly larger coefficient than ecosystemDemand's, by construction — and the unlock leg gets
  // the same coefficient with no demand term at all behind it.
  const supplyPressure = TOKEN_BOUNDS.supplyPressurePerFloatPct * (floatFraction + Math.max(0, unlockFraction))

  const safeFair = Math.max(priceFloor(t) * TOKEN_ECONOMY.fairValueFloorMultiple, fair)
  const d = clamp(Math.log(t.market.price / safeFair), -TOKEN_ECONOMY.logDeviationCap, TOKEN_ECONOMY.logDeviationCap)
  const gravity = -TOKEN_BOUNDS.gravityPull * Math.sign(d) * Math.pow(Math.abs(d), TOKEN_BOUNDS.gravityExponent)

  const noiseTerm =
    clamp(noise, -1, 1) *
    TOKEN_ECONOMY.priceNoiseScale *
    (TOKEN_ECONOMY.priceNoiseVolBase + clamp01(t.market.volatility / 100))

  const logMove = demand - supplyPressure + gravity + noiseTerm
  // The ±45% cap is an ARITHMETIC BACKSTOP applied last, never the mechanism: everything above is
  // already bounded, and a run in which this clamp binds every week is a bug in the terms above.
  const factor = clamp(Math.exp(logMove), 1 - TOKEN_BOUNDS.maxWeeklyPriceMove, 1 + TOKEN_BOUNDS.maxWeeklyPriceMove)
  const floor = priceFloor(t)
  const raw = t.market.price * factor
  const price = Math.max(floor, raw)

  return {
    momentum: m,
    speculativeDemand,
    utilityDemand,
    communityDemand,
    ecosystemDemand,
    demand,
    supplyPressure,
    logDeviation: d,
    gravity,
    noise: noiseTerm,
    logMove,
    factor,
    price,
    floored: raw < floor,
  }
}

// ---------- invariants (docs/ico-architecture.md §4.6) ----------

/**
 * The assertable list from §4.6, as data rather than as prose. Returns the violations, empty when
 * the state is sound. Tests and the stress probe call it every simulated week; it is deliberately
 * NOT called from the tick, because a check that runs in the hot path is a check nobody dares make
 * strict.
 */
export function tokenInvariants(s: GameState): string[] {
  const t = s.token
  if (!t) return []
  const out: string[] = []
  const sup = t.supply
  if (sup.circulating + sup.treasury + sup.locked !== sup.total)
    out.push(`supply identity broken: ${sup.circulating}+${sup.treasury}+${sup.locked} !== ${sup.total}`)
  if (!Number.isInteger(sup.circulating) || !Number.isInteger(sup.treasury) || !Number.isInteger(sup.locked))
    out.push('supply counts are not integers')
  if (sup.circulating < 0 || sup.treasury < 0 || sup.locked < 0) out.push('a supply bucket went negative')
  if (t.users.organic + t.users.incentivised !== Math.max(0, Math.round(s.users)))
    out.push(`user split broken (mirror): ${t.users.organic}+${t.users.incentivised} !== ${Math.round(s.users)}`)
  // §4.6's `organicUsers + incentivisedUsers === s.users`, on the AUTHORITATIVE counts rather than
  // on the mirror — in Career those come from the cohorts, and a mirror that agreed with itself
  // while disagreeing with the cohort list is exactly the desync this invariant exists to catch.
  if (organicUsers(s) + incentivisedUsers(s) !== Math.max(0, Math.round(s.users)))
    out.push(`user split broken (cohorts): ${organicUsers(s)}+${incentivisedUsers(s)} !== ${Math.round(s.users)}`)
  const floor = priceFloor(t)
  if (!(t.market.price >= floor)) out.push(`price ${t.market.price} below the floor ${floor}`)
  if (!(floor > 0)) out.push('price floor is not positive — zero is absorbing')
  if (!Number.isFinite(t.market.price) || !Number.isFinite(t.market.emaPrice) || !Number.isFinite(t.market.fairValue))
    out.push('a market field is not finite')
  const scalars: [string, number][] = [
    ['volatility', t.market.volatility],
    ['speculation', t.market.speculation],
    ['utility', t.market.utility],
    ['sentiment', t.community.sentiment],
    ['trust', t.community.trust],
    ['engagement', t.community.engagement],
    ['decentralisation', t.community.decentralisation],
    ['founderInfluence', t.community.founderInfluence],
  ]
  for (const [name, v] of scalars) if (!(v >= 0 && v <= 100)) out.push(`${name} out of 0–100: ${v}`)
  if (!(t.market.depth >= 0 && t.market.depth <= 1)) out.push(`depth out of 0–1: ${t.market.depth}`)
  const a = t.plan.allocation
  const sum = a.community + a.treasury + a.team + a.founder + a.partners
  if (Math.abs(sum - 1) > TOKEN_BOUNDS.allocationEpsilon) out.push(`allocation sums to ${sum}`)
  if (t.history.length > TOKEN_LIMITS.history) out.push('history over its cap')
  if (t.series.length > TOKEN_LIMITS.series) out.push('series over its cap')
  return out
}
