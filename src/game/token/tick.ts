// Tokenisation — the weekly step. Slice 2, and the FIRST token tick in the game.
//
// docs/ico-architecture.md §3.2, §4 and §4.6. Brief §26–§31.
//
// ---------------------------------------------------------------------------------------------
// THE DETERMINISM RULE, WHICH IS NOT A STYLE PREFERENCE
//
// This function consumes RNG draws. `seeded()` in engine.ts bumps `s.flags.rngTick` and reseeds
// from (config.seed, week, tick), so a SINGLE unguarded call shifts the stream for every daily
// challenge, every Arena match, every replay and all three golden traces. The call site is
// therefore, exactly as `livingWorldActive` gates `tickLivingWorld`:
//
//     if (tokenActive(s)) seeded(s, () => tickToken(s))
//
// `tokenActive(s)` is false when there is no token slice or when no token capability is on, so a
// run that never tokenised draws zero times and is byte-identical to the game before this slice.
//
// ---------------------------------------------------------------------------------------------
// THE LAG RULE (§4.6: "no state variable is both input and output of the same tick")
//
// Every level this function writes is computed from a SNAPSHOT taken at the top, and NOTHING here
// reads a value this tick produced. Utility feeds the engagement target; sentiment feeds it too and
// is itself written this week; members feeds holders feeds depth. Without the snapshot those are
// same-tick reflexive edges — the exact shape that produces algebraic blow-up — and with it every
// one of them is a one-week lag, which is a bounded oscillator.
//
// The snapshot IS the mechanism, so the rule is absolute even where a particular chain happens to be
// one-directional and could not blow up on its own: do not read `t.market.*` or `t.community.*`
// after the writes begin. A test catches the specific case that matters — `trust` reaches the
// sentiment target and must NOT reach engagement — because a broken snapshot is invisible to every
// value-based assertion.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS SLICE DOES NOT DO
//
// No founder token sales (§42 — still unbuilt, so `bankedPayout` remains unreachable on the token
// path), no proposals (Slice 6), no narrative (Slice 7).
//
// SLICE 4 ADDED, and each is marked at its line: the six incentive categories' effects, vesting
// unlocks as pure supply pressure, and the one write into `trust` that the community-treasury
// category needs.
//
// SLICE 5 ADDED the community as a counterparty (token/community.ts), behind `tokenCommunity`:
// the full trust model (conduct ledger + crash shocks, resilience-scaled), decentralisation
// demand that actually rises, founderInfluence's contractual reversion, and the exodus. With the
// capability off, every branch below reduces to the exact Slice-4 arithmetic — measured, not
// assumed: the acceptance test diffs `npm run bots` byte-for-byte.
//
// Supply moves in exactly two places, treasury → circulating and locked → circulating, each one
// subtraction and one addition of the same integer, so the §4.6 identity cannot break here.
// (Exodus sell pressure is priced pressure, not moved supply: departing holders sell to other
// holders — the float does not change, the price does.)

import { RNG } from '../data'
import { hasCapability } from '../modes'
import type { GameState } from '../types'
import {
  communityModifiers,
  tickCommunity,
  COMMUNITY_IDLE,
  NEUTRAL_MODIFIERS,
  type CommunityModifiers,
  type CommunityTickReport,
} from './community'
import {
  advanceIncentiveStocks,
  incentiveEffects,
  weeklyIncentiveSpend,
  NO_EFFECTS,
  NO_SPEND,
  type IncentiveEffects,
  type WeeklyIncentiveSpend,
} from './incentives'
import { pendingUnlock, utilityModelMultiplier } from './state'
import {
  fairValue,
  momentum,
  organicUserCount,
  priceStep,
  spendEffectiveness,
  treasuryCommitment,
  type PriceStep,
  type TreasuryCommitment,
} from './market'
import { incentivisedUsers } from './users'
import { TOKEN_BOUNDS, TOKEN_ECONOMY, TOKEN_LIMITS, type TokenState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/** Move `current` a fraction of the way to `target`. The target is always in range, so the result
 *  is too: this is the reversion the contract asks for, not a clamp pretending to be one. */
const approach = (current: number, target: number, rate: number) => current + (target - current) * clamp01(rate)

/**
 * Add `delta`, with the step shrinking to zero as the value nears the boundary it is heading for.
 *
 * This is how a shock term stays inside 0–100 WITHOUT the clamp doing the work. At 100 a positive
 * shock contributes nothing while a negative one contributes in full, so the boundary is repelling
 * rather than absorbing — the same property the price floor gets from `fairValueFloorMultiple`.
 * A plain `clamp(v + delta)` would let a large sustained shock pin the value at the boundary, which
 * is the funding-climate bug in miniature.
 */
function saturatingAdd(current: number, delta: number, lo = 0, hi = 100): number {
  const span = hi - lo
  if (span <= 0) return current
  const headroom = delta > 0 ? (hi - current) / span : (current - lo) / span
  return current + delta * clamp01(headroom)
}

/** Everything the tick decided, returned for tests and the stress probe. Nothing reads it in-game. */
export interface TokenTickReport {
  ran: boolean
  commitment: TreasuryCommitment
  fair: number
  step: PriceStep
  /** Consecutive weeks including this one in which the floor was the binding constraint. */
  flooredThisWeek: boolean
  /** Slice 4: tokens released from `locked` by the vesting schedule this week (brief §41). */
  unlocked: number
  /** Slice 4: the six categories' spend, and what the stocks bought. */
  spend: WeeklyIncentiveSpend
  effects: IncentiveEffects
  /** Slice 5: what the community's mood did to the week, and what the community step decided. */
  mods: CommunityModifiers
  community: CommunityTickReport
}

const IDLE: TokenTickReport = {
  ran: false,
  commitment: { requested: 0, tokens: 0, cap: 0, capped: false, floatFraction: 0 },
  fair: 0,
  step: {
    momentum: 0, speculativeDemand: 0, utilityDemand: 0, communityDemand: 0, ecosystemDemand: 0,
    demand: 0, supplyPressure: 0, logDeviation: 0, gravity: 0, noise: 0, logMove: 0, factor: 1,
    price: 0, floored: false,
  },
  flooredThisWeek: false,
  unlocked: 0,
  spend: NO_SPEND,
  effects: NO_EFFECTS,
  mods: NEUTRAL_MODIFIERS,
  community: COMMUNITY_IDLE,
}

/** The product the network ships. Local copy for the same reason market.ts keeps one. */
function productQuality(s: GameState): number {
  const bugPenalty = s.sector === 'fintech' ? 1.0 : 0.6
  return clamp(s.features * 0.5 + s.quality * 0.5 - s.bugs * bugPenalty, 0, 100)
}

/**
 * The week. Mutates `s.token` in place, like every other subsystem tick.
 *
 * Runs inside `seeded()`. Draws exactly ONE number, unconditionally, whenever the economy runs —
 * a fixed draw count is what makes a token run replayable, and a conditional draw is how draw-order
 * bugs are born.
 */
export function tickToken(s: GameState): TokenTickReport {
  const t = s.token
  if (!t) return IDLE
  if (!hasCapability(s, 'tokenEconomy')) return IDLE
  // A reload can re-enter the same week; the world slice guards this with `lastGeneratedWeek` and
  // the economy needs it more, because a second pass would double a price move.
  if (t.lastTickedWeek !== undefined && t.lastTickedWeek >= s.week) return IDLE

  // ---- the snapshot. Every target below reads THIS, never a value written by this tick. ----
  const prev = {
    price: t.market.price,
    utility: t.market.utility,
    speculation: t.market.speculation,
    volatility: t.market.volatility,
    sentiment: t.community.sentiment,
    engagement: t.community.engagement,
    trust: t.community.trust,
    members: t.community.members,
    holders: t.community.holders,
    depth: t.market.depth,
    momentum: momentum(t),
    // Slice 5. The community step's inputs, snapshotted under the same rule as everything else.
    decentralisation: t.community.decentralisation,
    decentralisationDemand: t.community.decentralisationDemand,
    founderInfluence: t.community.founderInfluence,
  }

  // Slice 5: what the community's mood does to the week — member growth, market depth, and (below
  // the trust floor) the exodus and its sell pressure. Computed from the snapshot BEFORE any
  // write, neutral (scales 1, pressures 0) when `tokenCommunity` is off.
  const mods = communityModifiers(s, prev)

  // ---- 1. the treasury releases tokens into the float (loop A) ----
  // Slice 4: the six categories' split of the week's release, read BEFORE anything moves, and the
  // effect stocks as they stood at the start of the week. Every effect below reads these — never a
  // stock this tick produced. `advanceIncentiveStocks` at the bottom is what closes the lag.
  const spend = weeklyIncentiveSpend(s)
  const effects = incentiveEffects(s)
  const commitment = treasuryCommitment(s)
  const released = Math.min(t.supply.treasury, Math.round(commitment.tokens))
  if (released > 0) {
    // One subtraction, one addition, same integer: the §4.6 identity cannot break here.
    t.supply.treasury -= released
    t.supply.circulating += released
  }

  // ---- 1b. vesting unlocks (brief §41) ----
  // Team, founder and partner tokens leave `locked` on the schedule chosen at launch. Same exact
  // integer move, so the identity holds; and this is PURE SUPPLY PRESSURE — see `priceStep`'s
  // `unlockFraction`. It is also the cost of `short` vesting, which the tokenomics screen sells as
  // flexibility: the whole team allocation reaches the float inside 26 weeks.
  const unlocked = Math.min(t.supply.locked, pendingUnlock(t, s.week))
  if (unlocked > 0) {
    t.supply.locked -= unlocked
    t.supply.circulating += unlocked
  }

  const circulatingNow = Math.max(1, t.supply.circulating)
  const floatFraction = released / circulatingNow
  const unlockFraction = unlocked / circulatingNow

  // ---- 2. the fundamental anchor, after dilution ----
  const fair = fairValue(s)

  // ---- 3. the price. One draw, always. ----
  const noise = RNG.next() * 2 - 1
  // Slice 5: departing holders sell on the way out. Same supply-pressure coefficient as every
  // other release; 0 whenever the community capability is off or trust is above the floor.
  const step = priceStep(t, fair, floatFraction, spendEffectiveness(t), noise, unlockFraction, mods.sellPressure)
  t.market.price = step.price
  t.market.fairValue = fair
  t.market.lastDemand = step.demand
  t.market.lastSupplyPressure = step.supplyPressure
  // The EMA is updated AFTER the move, from the new price. That is what makes next week's momentum
  // a difference against a moving anchor rather than against a constant.
  t.market.emaPrice = t.market.emaPrice + (t.market.price - t.market.emaPrice) * TOKEN_BOUNDS.priceEmaAlpha

  // ---- 4. the 0–100 levels, all from `prev` ----

  // Speculation mean-reverts to the UTILITY anchor and is shocked by momentum. The shock saturates
  // at the boundaries, so 0 and 100 are never where speculation is held.
  //
  // Slice 4: a liquidity-incentive programme raises the ANCHOR speculation reverts to, which is why
  // §17 calls the category dangerous. TOKEN_ECONOMY's stability derivation says the market tracks
  // fundamentals below speculation ~50 and oscillates above it, so this term is literally the dial
  // between the two regimes — bought, and not cheaply.
  const specShock = TOKEN_ECONOMY.speculationMomentumGain * Math.tanh(prev.momentum / TOKEN_ECONOMY.momentumScale)
  t.market.speculation = clamp(
    saturatingAdd(
      approach(prev.speculation, clamp(prev.utility + effects.speculation, 0, 100), TOKEN_BOUNDS.speculationReversion),
      specShock,
    ),
    0,
    100,
  )

  // Utility is EARNED (§25): NOTHING a player spends appears in this target, not even one hop
  // removed. Product, protocol revenue and organic users — that is the whole list. Engagement is
  // deliberately absent: it used to be here, and because treasury spend raises engagement, thirty
  // weeks of capped spend measurably bought utility. Slow reversion, so utility is the anchor the
  // fast variables are pulled toward rather than another fast variable.
  const revenueSignal = clamp01(Math.log10(1 + Math.max(0, s.lastRevenue) * 52 / 1e5) / 2)
  const userSignal = clamp01(Math.log10(1 + organicUserCount(s)) / 4)
  //
  // Slice 4 adds exactly ONE bought term to this target — developer grants — and it is the single
  // most carefully bounded number in the slice, because `fairValue` reads utility and decision 4's
  // loop B.3 requires that the anchor cannot be inflated by the price it anchors. The reflexive edge
  // is severed by DENOMINATION rather than by size: grant intensity is `tokens / circulating`, so a
  // doubling price buys exactly as much ecosystem as before. See TOKEN_INCENTIVES' header. The term
  // is also lagged twice (a 5%/wk stock feeding a 6%/wk reversion), capped at ~14 points, and
  // haircut by `grantSuccessRate` — §15's "some projects may fail", deterministically.
  //
  // The EARNED part is multiplied by how well the chosen utility model fits this sector (§24) —
  // permanently, not just at launch. A multiplier on an earned quantity, fixed at launch and
  // unbuyable, so the anchor stays an anchor.
  const utilityTarget = clamp(
    (productQuality(s) * TOKEN_ECONOMY.utilityProductWeight +
      revenueSignal * TOKEN_ECONOMY.utilityRevenueWeight +
      userSignal * TOKEN_ECONOMY.utilityUserWeight) *
      utilityModelMultiplier(s.sector, t.plan.utilityModel) +
      effects.utility,
    0,
    100,
  )
  t.market.utility = clamp(approach(prev.utility, utilityTarget, TOKEN_ECONOMY.utilityReversion), 0, 100)

  // Sentiment reverts toward a baseline set by TRUST and delivered product, biased by how the price
  // behaved (decision 4, loop C.4). Trust is Slice 5's; read here, never written.
  const sentimentTarget = clamp(
    18 +
      prev.trust * 0.35 +
      productQuality(s) * 0.2 +
      TOKEN_ECONOMY.sentimentMomentumGain * Math.tanh(prev.momentum / TOKEN_ECONOMY.momentumScale) +
      12 * (clamp01(prev.utility / 100) - TOKEN_ECONOMY.utilityNeutral),
    0,
    100,
  )
  t.community.sentiment = clamp(approach(prev.sentiment, sentimentTarget, TOKEN_BOUNDS.sentimentReversion), 0, 100)

  // Ecosystem spend buys ENGAGEMENT, never utility — brief §25 is explicit that utility cannot be
  // bought. This is the lagged positive leg of loop A, and it is capped so the leg is finite.
  const spendEngagement = Math.min(
    TOKEN_ECONOMY.engagementSpendCap,
    TOKEN_ECONOMY.engagementSpendGain * floatFraction,
  )
  const engagementTarget = clamp(prev.sentiment * 0.45 + prev.utility * 0.3 + spendEngagement, 0, 100)
  // Slice 5: an exodus is disengagement in motion. A saturating shock from the snapshot — the same
  // composition the speculation shock uses — and zero whenever the community capability is off.
  t.community.engagement = clamp(
    saturatingAdd(approach(prev.engagement, engagementTarget, TOKEN_ECONOMY.engagementReversion), -mods.engagementShock),
    0,
    100,
  )

  // Volatility is a level with a bounded target (brief §28): speculation raises it, utility and
  // community damp it, and a violent week raises it temporarily.
  const volatilityTarget = clamp(
    18 + 0.55 * prev.speculation - 0.22 * prev.utility - 0.15 * prev.engagement + 30 * Math.abs(prev.momentum),
    0,
    100,
  )
  t.market.volatility = clamp(approach(prev.volatility, volatilityTarget, TOKEN_ECONOMY.volatilityReversion), 0, 100)

  // Community size tracks the organic user base, scaled by how engaged and how happy it is. Bounded
  // by construction: the target is a multiple of a population the token economy does not control.
  // Slice 5 scales the TARGET by trust (a betrayed community stops arriving) and cuts the RESULT
  // by the week's exodus (the ones already here leave). Both factors are 1/0 with the capability
  // off, and both are computed from the snapshot.
  const membersTarget = Math.max(
    0,
    organicUserCount(s) *
      (TOKEN_ECONOMY.membersPerUserBase + TOKEN_ECONOMY.membersPerUserEngagement * clamp01(prev.engagement / 100)) *
      (0.6 + 0.8 * clamp01(prev.sentiment / 100)) *
      mods.membersScale,
  )
  t.community.members = Math.max(
    0,
    Math.round(approach(prev.members, membersTarget, TOKEN_ECONOMY.membersReversion) * (1 - mods.exodusFraction)),
  )
  // `prev.engagement`, not the engagement written four lines above. Nothing in this block reads a
  // value this tick produced — the chain members → holders → depth is one-directional and could not
  // blow up, but keeping the rule absolute is what stops the next person adding the edge that can.
  t.community.holders = Math.round(
    t.community.members * (TOKEN_ECONOMY.holderShareBase + TOKEN_ECONOMY.holderShareEngagement * clamp01(prev.engagement / 100)),
  )

  // Depth is what the founder's exit discount reads (scoring.ts). It is earned the same way.
  // Slice 4: liquidity incentives are the useful half of §17, and the only category that pays the
  // founder directly — depth is 45% of `liquidityDiscount`'s market-quality term.
  // Slice 5 scales this target by trust too: market makers price counterparty risk, and depth is
  // the term that carries the community's mood into `liquidityDiscount` — the founder's own exit.
  const depthTarget = clamp01(
    (0.08 +
      0.5 * clamp01(prev.engagement / 100) +
      0.25 * clamp01(prev.utility / 100) +
      0.15 * clamp01(prev.holders / 5000) +
      effects.depth) *
      mods.depthScale,
  )
  t.market.depth = clamp01(approach(prev.depth, depthTarget, TOKEN_ECONOMY.depthReversion))

  // ---- 4b. the community (§19 Slice 4; §32–§35, §38 Slice 5) ----
  // Decentralisation is MONOTONE NON-DECREASING (§35): unlike every other effect in this slice it
  // does not reverse when the stock decays, and that asymmetry is the category's whole cost.
  if (effects.decentralisation > 0) {
    t.community.decentralisation = clamp(saturatingAdd(t.community.decentralisation, effects.decentralisation), 0, 100)
  }
  // Slice 5 owns trust, decentralisation demand and founder influence from here — the seam Slice 4
  // left it ("conduct, delivery, revolt"). With the capability off, the ORIGINAL Slice-4 writes run
  // below, character for character, so a save that never turns it on computes what it always did.
  let community: CommunityTickReport = COMMUNITY_IDLE
  if (mods.active) {
    const communityStock = clamp01(t.incentives.find((p) => p.category === 'community_treasury')?.effectiveness ?? 0)
    community = tickCommunity(s, prev, effects, mods, communityStock)
  } else {
    if (effects.decentralisation > 0) {
      // Handing over control is what the loudest holders were asking for, so the demand subsides.
      t.community.decentralisationDemand = clamp(
        saturatingAdd(t.community.decentralisationDemand, -effects.decentralisation * 1.5),
        0,
        100,
      )
    }
    // Trust, through the ONE channel Slice 4 owned: decision 4 loop E's concave
    // `decentralisationTrustGain × sqrt(d)`. Written as an approach to a target rather than as an
    // accumulation, so nothing ratchets — which is exactly what let Slice 5 extend the target.
    if (effects.trustTarget !== null)
      t.community.trust = clamp(approach(prev.trust, effects.trustTarget, TOKEN_BOUNDS.sentimentReversion), 0, 100)
  }

  // Partnerships buy DISTRIBUTION, and distribution is the engine's own `hype` — which feeds the
  // ORGANIC acquisition terms in both modes. This is the one category whose users are evidence:
  // they still have to choose the product at its price, so they reach `derivePmfForSegment` and
  // count toward PMF, where a customer-rewards user never can. Applied with headroom, and hype
  // already decays 8%/wk in `advanceWeek`, so it settles instead of accumulating.
  if (effects.hype > 0) s.hype = clamp(saturatingAdd(s.hype, effects.hype), 0, 100)

  // ---- 5. the user mirror, so §4.6's `organic + incentivised === s.users` holds ----
  // Authoritative only when detailedPMF is off; kept honest in both, because the invariant is.
  //
  // Slice 3: in Career the COHORTS are the truth, so the mirror is written FROM them rather than
  // left to drift. `incentivisedUsers(s)` reads the cohort list in Career and this same field in
  // Quick Play, which is why writing it back here is a fixed point rather than a feedback loop.
  const users = Math.max(0, Math.round(s.users))
  t.users.incentivised = Math.min(users, incentivisedUsers(s))
  t.users.organic = users - t.users.incentivised

  // ---- 6. the record ----
  t.series.push({
    week: s.week,
    price: t.market.price,
    circulating: t.supply.circulating,
    treasuryTokens: t.supply.treasury,
    utility: t.market.utility,
    speculation: t.market.speculation,
    sentiment: t.community.sentiment,
    organicUsers: t.users.organic,
    incentivisedUsers: t.users.incentivised,
  })
  if (t.series.length > TOKEN_LIMITS.series) t.series.splice(0, t.series.length - TOKEN_LIMITS.series)

  recordMarketHistory(t, s.week, step, released, unlocked)
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)

  // ---- 7. the stocks, LAST ----
  // Every effect above read the stocks as they were at the top of the week. Folding this week's
  // spend in here is what makes that a one-week lag rather than a same-tick reflexive edge, and it
  // is the same discipline as the `prev` snapshot: the rule is absolute even where a particular
  // chain could not blow up on its own.
  advanceIncentiveStocks(s, spend)

  t.lastTickedWeek = s.week

  return { ran: true, commitment, fair, step, flooredThisWeek: step.floored, unlocked, spend, effects, mods, community }
}

/** Facts only, and rate-limited: history is a 120-entry budget the postmortem quotes from. */
function recordMarketHistory(t: TokenState, week: number, step: PriceStep, released: number, unlocked = 0): void {
  const move = step.factor - 1
  const last = t.history[t.history.length - 1]
  const quiet = !last || week - last.week >= TOKEN_ECONOMY.historyCooldownWeeks
  // An unlock that meaningfully moves the float is the kind of week the postmortem should be able
  // to point at — §41's supply pressure, arriving on a schedule the founder chose at launch.
  if (unlocked > 0 && unlocked / Math.max(1, t.supply.circulating) >= 0.01 && quiet) {
    t.history.push({
      week,
      type: 'unlock',
      importance: 40,
      metadata: { tokens: unlocked, lockedLeft: t.supply.locked, price: t.market.price },
    })
  } else if (move >= TOKEN_ECONOMY.rallyThreshold && quiet) {
    t.history.push({ week, type: 'price_rally', importance: Math.min(100, Math.round(40 + move * 100)), metadata: { move: Math.round(move * 1000) / 1000, price: t.market.price } })
  } else if (move <= TOKEN_ECONOMY.crashThreshold && quiet) {
    t.history.push({ week, type: 'price_crash', importance: Math.min(100, Math.round(45 - move * 120)), metadata: { move: Math.round(move * 1000) / 1000, price: t.market.price } })
  } else if (released > 0 && quiet) {
    t.history.push({ week, type: 'treasury_sale', importance: 35, metadata: { tokens: released, treasuryLeft: t.supply.treasury } })
  }
}
