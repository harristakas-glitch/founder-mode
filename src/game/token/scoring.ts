// Tokenisation — what scores a run. Slice 1.
//
// docs/ico-architecture.md §1, the one decision the owner had to approve before any code.
//
// The game is denominated in FOUNDER DOLLARS: `gameOver.payout` is the score, everywhere.
// `valuation()` is not the score — it is the company's enterprise value, and it is consumed in
// fourteen places that would all break if it absorbed token market cap (term-sheet sizing, M&A
// ratios, stock-funded dilution, "am I the bigger company"). So:
//
//   valuation(s)      → COMPANY ENTERPRISE VALUE. Gains no token term. Ever.
//   networkValue(s)   → price × circulating supply. An ecosystem metric. Never realised value.
//
// They meet in exactly ONE place, the founder's own dollars, through two DISJOINT legs:
//
//   founderStanding(s) = valuation(s) × founderEquity     ← reads enterprise value only
//                      + realisableTokenValue(s)          ← reads network value only
//                      + bankedPayout                     ← already realised
//
// Disjoint legs is what makes "no double-counting" structural instead of careful. There is no
// expression in which a dollar of token demand and a dollar of enterprise value are the same
// dollar.
//
// With no token slice, `realisableTokenValue` is 0 and `founderStanding` is character-for-character
// today's payout expression, so every existing run pays out to the byte.

import { valuation } from '../engine'
import type { GameState } from '../types'
import { VESTING_TERMS } from './state'
import { TOKEN_SCORING, type TokenState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t)

// ---------- the network (brief §50) ----------

/**
 * Brief §50. What the whole token network is notionally worth. An ecosystem metric for the
 * dashboard, the network ending's gate and the postmortem — it is NOT company value and it is NOT
 * the founder's money. `TokenState` deliberately has no `tokenMarketCap` field: a stored derived
 * value is how the §49 double-count gets in through the side door.
 */
export function networkValue(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  return t.market.price * t.supply.circulating
}

// ---------- vesting (brief §23) ----------

/**
 * Tokens the founder can actually touch this week. A pure function of (week, launchWeek, policy,
 * granted) — nothing stores it, so it cannot desync from the clock.
 *
 * The vesting clock starts at the LAUNCH WEEK, which is the single largest reason an early launch
 * is not dominated by a late one: tokenise at week 20 on a standard schedule and you are fully
 * vested by week 72; tokenise at week 80 and you finish the run holding paper you cannot sell.
 */
export function founderVestedTokens(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  const terms = VESTING_TERMS[t.plan.vesting] ?? VESTING_TERMS.standard
  const elapsed = s!.week - t.launchWeek
  if (elapsed < terms.cliffWeeks) return 0
  const fraction = clamp01(elapsed / terms.durationWeeks)
  return Math.max(0, (t.founder.granted - t.founder.sold) * fraction)
}

// ---------- the liquidity discount: the token path's exit multiple ----------

/**
 * 0–1. Brief §51 taken seriously: TOKEN HOLDINGS ARE NOT CASH-EQUIVALENT. A founder holding 30% of
 * the float cannot sell 30% of the market cap.
 *
 *   discount = lerp(MIN, MAX, marketQuality) × (1 − exitImpact)
 *   marketQuality ← depth, utility, community      the things a real business produces
 *   exitImpact    ← (vested / circulating) ^ exitImpactExponent
 *
 * This is where the token path's exit multiple lives. Tokenising closes the IPO (0.95–1.80×) and
 * makes acquisition rarer and cheaper (2.05× median); if nothing replaced them the path would be
 * strictly dominated. The discount's spread — 0.20 → 0.85, a factor of 4.25 — is the same order as
 * the traditional exit spread, with one difference that is the entire design argument: the
 * traditional premium is partly ROLLED, this one is entirely EARNED. Build real utility into a
 * deep market and you realise your position; sit on a speculative float and you do not.
 */
export function liquidityDiscount(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  const marketQuality = clamp01(t.market.depth * 0.45 + (t.market.utility / 100) * 0.35 + (t.community.engagement / 100) * 0.2)
  const base = lerp(TOKEN_SCORING.liquidityDiscountMin, TOKEN_SCORING.liquidityDiscountMax, marketQuality)
  const circulating = Math.max(1, t.supply.circulating)
  const share = clamp01(founderVestedTokens(s) / circulating)
  const exitImpact = clamp01(Math.pow(share, TOKEN_SCORING.exitImpactExponent))
  return clamp(base * (1 - exitImpact), 0, TOKEN_SCORING.liquidityDiscountMax)
}

/**
 * The TOKEN LEG of the founder's standing, in dollars. Reads network value only — never
 * `valuation()`, never revenue, never equity.
 *
 * Zero when there is no token slice, which is what makes `founderStanding` byte-identical to
 * today's payout expression for every traditional run.
 */
export function realisableTokenValue(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  return founderVestedTokens(s) * t.market.price * liquidityDiscount(s)
}

// ---------- founder standing ----------

export interface FounderStandingOpts {
  /**
   * What the founder's EQUITY is marked against. Defaults to `valuation(s)` — enterprise value.
   * An acquisition passes the offer; a priced IPO passes `valuation × mult`. Passing the base
   * rather than a multiplier keeps the arithmetic in the same order as the expression it replaces,
   * which is why every existing payout is unchanged to the last bit.
   */
  exitValue?: number
  /** Applied to the EQUITY LEG ONLY. `fired` halves it — being removed does not halve your tokens. */
  equityMultiplier?: number
}

/**
 * docs/ico-architecture.md §1.2. The founder's dollars, and the only place the two value systems
 * meet.
 *
 * With `opts` empty and no token slice this is, character for character:
 *
 *     valuation(s) * s.founderEquity + s.bankedPayout
 *
 * which is what all five payout sites in `engine.ts` compute today.
 */
export function founderStanding(s: GameState, opts: FounderStandingOpts = {}): number {
  const base = opts.exitValue ?? valuation(s)
  const equityLeg = base * s.founderEquity * (opts.equityMultiplier ?? 1)
  return equityLeg + realisableTokenValue(s) + s.bankedPayout
}

// ---------- readouts for the UI and the postmortem ----------

export interface TokenStandingBreakdown {
  equityLeg: number
  tokenLeg: number
  banked: number
  total: number
  networkValue: number
  vestedTokens: number
  liquidityDiscount: number
}

/** The two legs, separately, so a screen can show that they are separate. */
export function standingBreakdown(s: GameState): TokenStandingBreakdown {
  const equityLeg = valuation(s) * s.founderEquity
  const tokenLeg = realisableTokenValue(s)
  return {
    equityLeg,
    tokenLeg,
    banked: s.bankedPayout,
    total: equityLeg + tokenLeg + s.bankedPayout,
    networkValue: networkValue(s),
    vestedTokens: founderVestedTokens(s),
    liquidityDiscount: liquidityDiscount(s),
  }
}

/** Used by the migration to keep a loaded slice's mirror field honest. */
export function syncFounderVested(s: GameState, t: TokenState): void {
  const terms = VESTING_TERMS[t.plan.vesting] ?? VESTING_TERMS.standard
  const elapsed = s.week - t.launchWeek
  t.founder.vested = elapsed < terms.cliffWeeks ? 0 : Math.max(0, (t.founder.granted - t.founder.sold) * clamp01(elapsed / terms.durationWeeks))
}
