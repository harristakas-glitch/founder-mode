// Tokenisation — organic versus incentivised users. Slice 3, the one the feature exists for.
//
// Brief §11, §12, §52, §53, §54. docs/ico-architecture.md §5 (the seam with Career PMF).
//
// ---------------------------------------------------------------------------------------------
// THE ONE SENTENCE
//
// Incentivised users are REAL users — they sit in `s.users`, they pay, they cost servers, they
// inflate every growth chart — and they are NOT EVIDENCE. Everything in this file exists to keep
// those two facts from being confused.
//
// ---------------------------------------------------------------------------------------------
// EXCLUSION, NOT WEIGHTING (§52)
//
// `derivePmfForSegment` sees organic customers and organic retention only. Not a discount, not a
// weight. `pmf.ts:496` already states the rule this subsystem was built on — "PMF is an OUTPUT,
// never an input… Research alone can never manufacture it" — and a user who stays because they are
// paid to stay is not evidence of fit AT ANY WEIGHT. Any weighting scheme means that ENOUGH spend
// still buys Strong PMF, and §52 forbids that in absolute terms.
//
// Exclusion also makes the guarantee testable as an INVARIANT rather than as a threshold: for any
// incentive spend, with the organic cohorts held fixed, `derivePmfForSegment` returns a bit-
// identical result. A threshold test ("PMF stayed under 66") would pass for the wrong reasons.
//
// ---------------------------------------------------------------------------------------------
// DETERMINISM: NOTHING IN THIS FILE DRAWS
//
// `resolveIncentivisedAcquisition` is deliberately PURE and noiseless, unlike its organic sibling
// `resolveSegmentAcquisition`, which rolls `rand(0.85, 1.15)`. Two reasons, and the first is not
// negotiable:
//
//   • `tickCareerPMF` is NOT inside the `tokenActive(s)` gate — it runs for every Career week. A
//     draw here, however carefully conditioned, would put a capability-dependent branch in the
//     middle of the RNG stream that daily challenges, Arena replays and the golden traces all
//     depend on. A pure term makes a Career run's draw COUNT identical whether the token
//     capability is on or off, by construction rather than by inspection.
//   • It is also the honest model. Rented growth is exactly as much as you paid for; that is what
//     makes it rented.
//
// ---------------------------------------------------------------------------------------------
// THE `s.users` UNIT HAZARD
//
// `s.users` means different things in Career and Quick Play — Career counts named ACCOUNTS in the
// hundreds, Quick Play counts raw users in the tens of thousands (Slice 1 found this the hard way,
// reading 330 Career accounts as 20 community members). So:
//
//   • nothing here converts dollars to users with a rate of its own. Incentivised acquisition is
//     built from the SAME `sqrt(spend/6) × reach × acqScale` shape the organic marketing term
//     already uses, so it inherits Career's calibration instead of inventing a second one;
//   • incentive STRENGTH is denominated as a share of the sector's revenue per user, so it means
//     the same thing at $1.80/wk (Social) and $24/wk (B2B SaaS);
//   • the counts below always reconcile against `s.users` itself, so
//     `organicUsers + incentivisedUsers === round(s.users)` holds by construction — which is the
//     §4.6 invariant, not a coincidence.

import { incentivisedCustomers, totalCustomers } from '../career/pmf'
import { sectorById } from '../data'
import { hasCapability } from '../modes'
import type { CareerPMFState, SegmentId, SegmentTruth } from '../career/types'
import type { GameState } from '../types'
import { treasuryCommitment } from './market'
import { TOKEN_BOUNDS, TOKEN_USERS, type RetentionSplit, type TokenState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/** Is the organic/incentivised split live for this run? Both halves are required: the capability
 *  AND a token slice, so a Career run that never tokenised behaves exactly as it did. */
export function userCompositionActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenUserComposition')
}

// ---------- the counts (brief §11) ----------

/**
 * Users a token incentive is paying for.
 *
 * Career reads the COHORTS, which are the truth: the cohort list is already reconciled against
 * `s.users` every week, so a second copy would desync (docs/ico-architecture.md §7.2). Quick Play
 * has no cohorts and reads `TokenState.users`, which is authoritative only there.
 *
 * Bounded by `s.users` in both modes, so the invariant cannot be broken by a stale mirror.
 */
export function incentivisedUsers(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  const users = Math.max(0, Math.round(s!.users))
  const raw = s!.career ? incentivisedCustomers(s!.career) : Math.max(0, Math.round(t.users.incentivised))
  return Math.min(users, Math.max(0, Math.round(raw)))
}

/**
 * Users who are here because the product is worth using.
 *
 * With no token slice this is `Math.max(0, s.users)` exactly — the expression `organicUserCount`
 * carried through Slice 2 — so `fairValue` and everything else that reads it are untouched for a
 * traditional run.
 */
export function organicUsers(s: GameState | null | undefined): number {
  if (!s) return 0
  if (!s.token) return Math.max(0, s.users)
  return Math.max(0, Math.round(s.users)) - incentivisedUsers(s)
}

/** 0–1. The network-unicorn gate reads this (docs/ico-architecture.md §1.4), and so does §53. */
export function organicShare(s: GameState | null | undefined): number {
  if (!s) return 1
  const users = Math.max(0, Math.round(s.users))
  if (users <= 0) return 1
  return clamp01(organicUsers(s) / users)
}

// ---------- what the treasury is actually paying users this week ----------

/** The week's incentive read, as one object so acquisition and retention cannot disagree. */
export interface IncentiveContext {
  /** Capability on, token slice present. */
  active: boolean
  /** Tokens released to customer rewards this week. */
  tokens: number
  /** Those tokens at last week's close. The price is a LAG — this tick does not read a price it
   *  wrote (docs/ico-architecture.md §4, the lag rule). */
  dollars: number
  /** 0–1. Spend per incentivised user, against that sector's revenue per user. */
  strength: number
  /** The head count `strength` was divided by. Exposed so a test can pin the denominator. */
  heads: number
}

const IDLE_INCENTIVES: IncentiveContext = { active: false, tokens: 0, dollars: 0, strength: 0, heads: 0 }

/**
 * Tokens the treasury releases to CUSTOMER REWARDS this week.
 *
 * SLICE SEAM. `treasuryCommitment` (Slice 2) owns the token-denominated weekly cap — the first
 * restoring force on loop A — and it caps the TOTAL across programmes. This function takes the
 * customer-rewards share of that capped total, pro rata, so the cap keeps meaning what it means and
 * this file never re-derives it.
 *
 * Slice 4 owns the player controls that CREATE programmes and the other five categories. Until it
 * lands `t.incentives` is empty in game, so this returns 0 and nothing in a played run changes; the
 * mechanism is exercised by test/token-users-probe.ts, which writes a programme directly the way
 * Slice 2's probe does. Reading a sub-slice a later phase owns is fine — §2 forbids CREATING one,
 * and nothing here creates one.
 *
 * Only `customer_rewards` reaches users. Developer grants, liquidity incentives and partnerships
 * are real spend that buys something else; treating them as a customer subsidy would make every
 * Slice-4 allocation identical, which is precisely what that slice has to disprove.
 */
export function userIncentiveTokens(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  const commitment = treasuryCommitment(s)
  if (!(commitment.tokens > 0) || !(commitment.requested > 0)) return 0
  let rewards = 0
  for (const p of t.incentives)
    if (p.category === 'customer_rewards' && Number.isFinite(p.tokensPerWeek) && p.tokensPerWeek > 0)
      rewards += p.tokensPerWeek
  if (rewards <= 0) return 0
  return commitment.tokens * clamp01(rewards / commitment.requested)
}

/** Weekly revenue per user in the units this mode counts users in. See the header's unit hazard. */
export function revenuePerUser(s: GameState): number {
  const sector = sectorById(s.sector)
  return Math.max(0.01, s.career ? sector.careerArpu : sector.arpuWeekly)
}

/**
 * 0–1, and the whole of §12's second act.
 *
 * While it is high, incentivised retention EXCEEDS organic retention and growth genuinely looks
 * better. The moment spend stops it is 0, and the keep rate collapses. It is a pure read of THIS
 * WEEK'S spend — nothing is remembered, nothing decays — which is exactly why the counterfactual
 * below can be computed rather than simulated.
 *
 * `heads` is the incentivised population the spend is spread across, so the same budget buys each
 * user less as the rented base grows. Sustaining a large incentivised base therefore needs
 * ACCELERATING spend against a treasury that is being drained — decision 4's loop A, item 3, in the
 * place a player can actually feel it.
 */
export function incentiveStrength(s: GameState, dollars: number, heads: number): number {
  if (!(dollars > 0)) return 0
  const perUser = dollars / Math.max(1, heads)
  return clamp01(perUser / (revenuePerUser(s) * TOKEN_USERS.fullStrengthArpuShare))
}

/**
 * The week's incentive position. `heads` defaults to the current incentivised population; the
 * caller passes it explicitly from inside `tickCareerPMF`, where the count has just moved.
 */
export function incentiveContext(s: GameState, heads?: number): IncentiveContext {
  if (!userCompositionActive(s)) return IDLE_INCENTIVES
  const t = s.token!
  const tokens = userIncentiveTokens(s)
  const dollars = tokens * t.market.price
  const h = heads ?? incentivisedUsers(s)
  return { active: true, tokens, dollars, strength: incentiveStrength(s, dollars, h), heads: h }
}

// ---------- acquisition (docs/ico-architecture.md §5.1) ----------

/**
 * New INCENTIVISED customers this week — a separate additive term, never a coefficient on the
 * organic one. Two functions, two populations, no shared coefficients.
 *
 * `resolveSegmentAcquisition` keeps its exact signature and behaviour; the only thing that changes
 * at its call site is that `currentCustomers` becomes `organicCustomers(...)`, because its referral
 * term SCALES WITH `currentCustomers`. If incentivised customers fed it, bought growth would
 * compound into growth that looks organic, and the §52 violation would arrive through a term nobody
 * was watching.
 *
 * `room` here reads the TOTAL customer count: the market is full either way.
 *
 * Pure and noiseless — see the header.
 */
export function resolveIncentivisedAcquisition(args: {
  truth: SegmentTruth
  productFit: number
  /** Dollars of token reward pointed at customers this week. */
  incentiveDollars: number
  /** TOTAL customers in the segment. The market does not care who paid. */
  currentCustomers: number
  ceiling: number
  marketingPenalty: number
  /** sector.acqBase / 5, exactly as the organic term takes it. */
  acqScale: number
}): number {
  const { truth, productFit, incentiveDollars, currentCustomers, ceiling, marketingPenalty, acqScale } = args
  if (!(incentiveDollars > 0)) return 0
  const room = Math.pow(Math.max(0, 1 - currentCustomers / Math.max(1, ceiling)), 1.3)
  const reach = 0.25 + (truth.acquisitionAccessibility / 100) * 1.5
  // Same shape as the organic spend term, so this inherits Career's user-count calibration rather
  // than inventing a second dollars-to-users rate. See the header's unit hazard.
  const spendEffect = Math.sqrt(incentiveDollars / 6) * reach * acqScale * TOKEN_USERS.acquisitionEfficiency
  // PRODUCT FIT ONLY. A customer moved by a reward is not weighing your price — which is the same
  // fact that disqualifies them as evidence of fit.
  const conversion = clamp01(TOKEN_USERS.conversionBase + (productFit / 100) * TOKEN_USERS.conversionProductSpan)
  const competition = clamp01(1 - truth.competitiveIntensity / 190)
  return Math.max(0, Math.round(spendEffect * conversion * competition * room * marketingPenalty))
}

// ---------- retention (brief §12, docs/ico-architecture.md §5.3) ----------

/** A weekly keep rate as a four-week survival, and back. Retention is measured over four weeks
 *  everywhere in Career (`retentionAt4wk`), and the blend below only means what §12 says it means
 *  in that space. */
export const toFourWeek = (weekly: number) => clamp01(weekly) ** 4
export const toWeekly = (fourWeek: number) => clamp01(fourWeek) ** 0.25

/**
 * §12's four-week number for an incentivised cohort, given the organic four-week number and how
 * hard the rewards are running.
 *
 *     incentivised4 = organic4 × (1 − dependence) + strength × dependence
 *
 * `incentiveDependence` is 0.62, from TOKEN_BOUNDS, and it is how much of an incentivised cohort's
 * retention is BOUGHT rather than earned. Worked, at the game's typical organic four-week rate of
 * 63%:
 *
 *     strength 1.0 →  0.63 × 0.38 + 0.62  =  86%   — better than organic. Growth looks great.
 *     strength 0.5 →  0.24 + 0.31         =  55%   — already worse than the organic base.
 *     strength 0.0 →  0.24                =  24%   — §12's "expected retention if incentives stop".
 *
 * The brief's illustration is 81% / 63% / 31%; this lands at 86 / 63 / 24 on the same organic base,
 * which is the same story with a slightly sharper cliff. That is the shape §53 has to be able to
 * warn about.
 */
export function incentivisedRetention4wk(organic4wk: number, strength: number): number {
  return clamp01(
    clamp01(organic4wk) * (1 - TOKEN_BOUNDS.incentiveDependence) + clamp01(strength) * TOKEN_BOUNDS.incentiveDependence,
  )
}

/**
 * The WEEKLY keep rate for an incentivised cohort. `resolveCohortRetention` gains no argument: it
 * computes the organic keep rate for the cohort's segment exactly as it always did, and this
 * function bends it.
 *
 * The conversion through four-week space is load-bearing, not cosmetic — see TOKEN_USERS. Applying
 * the blend directly to a 0.90 weekly rate gives 0.342/wk with the rewards off, a four-week
 * survival of 1.4%, and an incentivised base that vanishes inside a month.
 */
export function incentivisedKeepRate(keepOrganicWeekly: number, strength: number): number {
  return toWeekly(incentivisedRetention4wk(toFourWeek(keepOrganicWeekly), strength))
}

/**
 * THE NUMBER THAT TELLS THE TRUTH (brief §12, docs/ico-architecture.md §5.3).
 *
 *     Expected Incentivised Retention (if incentives were removed)
 *
 * No simulation and no lookahead: `incentiveStrength` is a pure read of this week's spend, so
 * forcing it to zero is an algebraic substitution. That is what makes §53's warning an honest
 * forecast rather than a mood, and it is the primary educational insight of the whole feature.
 *
 * Measured against the ORGANIC four-week retention of the segment, because that is the floor an
 * incentivised cohort would fall back toward — the product is the only thing left holding them.
 *
 * `token` is required by the contract's signature and it earns its place: with no token there are
 * no incentives, so the counterfactual and the actual are the same number.
 */
export function expectedRetentionWithoutIncentives(
  career: CareerPMFState | null | undefined,
  token: TokenState | null | undefined,
  segmentId: SegmentId,
): number {
  const organic = clamp01(career?.retentionBySegment[segmentId] ?? 0)
  if (!token) return organic
  return incentivisedRetention4wk(organic, 0)
}

/** All three §12 numbers for one segment. Measured where there is data, forecast where there is
 *  not, and the counterfactual always computed. */
export function retentionSplit(
  s: GameState,
  segmentId: SegmentId,
  strength = incentiveContext(s).strength,
): RetentionSplit {
  const career = s.career
  const organic = clamp01(career?.retentionBySegment[segmentId] ?? 0)
  const measured = career?.retentionBySegmentIncentivised?.[segmentId]
  return {
    segmentId,
    organic,
    // A measured four-week number wherever an incentivised cohort has produced one; the model's
    // forecast at this week's strength until then.
    incentivised: measured !== undefined && measured > 0 ? clamp01(measured) : incentivisedRetention4wk(organic, strength),
    incentivisedWithoutIncentives: expectedRetentionWithoutIncentives(career, s.token, segmentId),
  }
}

// ---------- the §53 warning ----------

/**
 * Brief §53, verbatim in intent:
 *
 *     TOKEN-DRIVEN GROWTH
 *     User growth is strong.
 *     However, organic retention remains weak.
 *     Most recent growth appears incentive-driven.
 *
 * Three conditions, all of which must hold, because any two of them alone describe a company that
 * is fine:
 *
 *   1. growth IS strong over the window — otherwise there is nothing being masked;
 *   2. a meaningful share of the target segment is rented;
 *   3. ORGANIC four-week retention is weak, and MEASURED (a segment with no four-week data yet is
 *      not weak, it is unknown — warning on it would train players to ignore the warning).
 *
 * Pure. The tick decides when to say it; this decides whether it is true.
 */
export interface MercenaryGrowthWarning {
  segmentId: SegmentId
  /** Customer growth over the window, as a fraction. */
  growth: number
  organicRetention: number
  incentivisedRetention: number
  expectedWithoutIncentives: number
  incentivisedShare: number
  incentivisedUsers: number
}

export function mercenaryGrowthWarning(s: GameState): MercenaryGrowthWarning | null {
  if (!userCompositionActive(s)) return null
  const career = s.career
  if (!career) return null
  const target = career.primaryTargetSegmentId

  const incentivised = incentivisedCustomers(career, target)
  const total = totalCustomers(career, target)
  if (total <= 0) return null
  const share = incentivised / total
  if (share < TOKEN_USERS.warnIncentivisedShare) return null

  const organic = clamp01(career.retentionBySegment[target] ?? 0)
  if (!(organic > 0) || organic >= TOKEN_USERS.warnOrganicRetention) return null

  // Growth off the shared history, which both modes write, rather than off a second counter.
  const h = s.history
  const window = TOKEN_USERS.warnWindowWeeks
  if (h.length <= window) return null
  const then = h[h.length - 1 - window].users
  const now = h[h.length - 1].users
  if (!(then > 0)) return null
  const growth = (now - then) / then
  if (growth < TOKEN_USERS.warnGrowthPct) return null

  const split = retentionSplit(s, target)
  return {
    segmentId: target,
    growth,
    organicRetention: split.organic,
    incentivisedRetention: split.incentivised,
    expectedWithoutIncentives: split.incentivisedWithoutIncentives,
    incentivisedShare: share,
    incentivisedUsers: incentivised,
  }
}
