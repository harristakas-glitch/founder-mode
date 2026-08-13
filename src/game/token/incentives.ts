// Tokenisation — the six incentive categories. Slice 4, and the slice that makes Slice 3 reachable.
//
// Brief §13–§19. docs/ico-architecture.md §4 (loops A and D) and the denomination rule recorded on
// `TOKEN_INCENTIVES` in ./types.ts.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
//
// Slice 3 proved that bought growth cannot manufacture product-market fit, and every number in that
// proof came from a probe that wrote a `customer_rewards` programme directly into the state.
// `t.incentives` was empty in a played game: there was no control anywhere in the product that
// could create one. Until this file shipped, the entire user-composition mechanic was unreachable
// by a player. That is the point of the slice, not a footnote to it.
//
// ---------------------------------------------------------------------------------------------
// ONE DIAL PER CATEGORY, AND THE DIAL IS A SHARE
//
// Brief §13: "Do not create micro-management. Use broad allocations." So the player sets six
// numbers, each 0–100% of the treasury's WEEKLY TOKEN BUDGET, summing to at most 100%. Nothing is
// denominated in absolute tokens, for a reason that matters mechanically rather than cosmetically:
// the budget is `TOKEN_BOUNDS.treasurySpendCapPerWeek × supply.treasury`, which SHRINKS every week
// the treasury spends. An absolute standing order would go stale and silently start hitting the cap;
// a share tracks the drain, so "I am spending 60% of my weekly budget on rewards" stays true, and
// the treasury depleting is something the player watches happen rather than something that quietly
// rewrites their orders.
//
// ---------------------------------------------------------------------------------------------
// EVERY EFFECT IS A STOCK, AND THE STOCK IS WHY THIS IS A POLICY AND NOT A PURCHASE
//
// A category's spend does not act on the world. It moves that programme's `effectiveness` — a 0–1
// stock — toward this week's intensity at the category's own build rate, and the stock decays at
// `TOKEN_INCENTIVES.stockDecayPerWeek` (0.09, the number that used to be the fictional
// `incentiveDecayPerWeek`; see the note in types.ts). Effects read the stock. Three consequences,
// all deliberate:
//
//   • LAGGED. Nothing you commit this week lands this week. A one-week blitz buys almost nothing.
//   • CAPPED. The stock cannot exceed 1, so no amount of spend produces an unbounded effect, and
//     every downstream term is a bounded addition to a TARGET that already reverts.
//   • REVERSIBLE, EXCEPT WHERE IT MUST NOT BE. Stop paying and the stock decays and the effect goes
//     with it — apart from `decentralisation`, which is monotone non-decreasing by §35. Control
//     given away is not taken back, and that asymmetry is the cost of the community-treasury
//     category.
//
// ---------------------------------------------------------------------------------------------
// DETERMINISM
//
// Nothing here draws. `advanceIncentiveStocks` and every effect below are pure functions of state,
// which is what lets `employeeTokenComp` be read from inside `advanceWeek`'s expense block — miles
// away from the `tokenActive(s)` gate — without touching the RNG stream that every daily challenge,
// Arena replay and golden trace depends on.

import { weeklyPayroll } from '../engine'
import { hasCapability } from '../modes'
import type { GameState } from '../types'
import { governanceShareFloors } from './governance'
import { treasuryCommitment } from './market'
import {
  TOKEN_BOUNDS,
  TOKEN_INCENTIVES,
  TOKEN_LIMITS,
  type TokenIncentiveCategory,
  type TokenIncentiveProgramme,
  type TokenState,
} from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/** Fixed order. The UI renders it, the probe reports it, and a stable order keeps both readable. */
export const INCENTIVE_CATEGORIES: TokenIncentiveCategory[] = [
  'customer_rewards',
  'developer_grants',
  'employee_compensation',
  'liquidity_incentives',
  'partnerships',
  'community_treasury',
]

export type IncentiveShares = Record<TokenIncentiveCategory, number>

export const NO_SHARES: IncentiveShares = {
  customer_rewards: 0,
  developer_grants: 0,
  employee_compensation: 0,
  liquidity_incentives: 0,
  partnerships: 0,
  community_treasury: 0,
}

/** Player-facing labels and the one-line promise each category makes. */
export const INCENTIVE_LABELS: Record<TokenIncentiveCategory, { name: string; effect: string; risk: string }> = {
  customer_rewards: {
    name: 'Customer rewards',
    effect: 'Buys customers and keeps them while the rewards run.',
    risk: 'None of them count toward product-market fit, and they leave when you stop paying.',
  },
  developer_grants: {
    name: 'Developer grants',
    effect: 'Funds people who build on you. Real utility, slowly.',
    risk: 'Slow to arrive, slow to leave, and worth far less outside a platform sector.',
  },
  employee_compensation: {
    name: 'Employee compensation',
    effect: 'Pays part of payroll in tokens. Saves cash every week.',
    risk: "Ties the team's morale to the chart.",
  },
  liquidity_incentives: {
    name: 'Liquidity incentives',
    effect: 'Deepens the market, so your own position is worth more when you sell it.',
    risk: 'Attracts speculators. A deep market and an unstable one are the same purchase.',
  },
  partnerships: {
    name: 'Partnerships',
    effect: 'Buys distribution. The users it brings are organic — they count.',
    risk: 'Slower than paying people directly, and it fades when the deals lapse.',
  },
  community_treasury: {
    name: 'Community treasury',
    effect: 'Hands tokens to the community. Trust, and a network that is genuinely theirs.',
    risk: 'Decentralisation does not come back. You are giving away control permanently.',
  },
}

// ---------- is any of this live? ----------

/** Both halves required: the capability AND a token slice. A run that never tokenised is untouched. */
export function incentivesActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenIncentives')
}

// ---------- the standing orders ----------

/**
 * What one programme asks for this week, in tokens.
 *
 * `share` is the authority and `tokensPerWeek` is its shadow, re-derived from the CURRENT weekly cap
 * every time this is called — so a standing order tracks a draining treasury instead of going stale.
 * The `tokensPerWeek` fallback is not dead code: `test/token-economy-probe.ts` and
 * `test/token-users-probe.ts` write absolute programmes directly to exercise the cap, and a v1 save
 * has no `share` at all until `migrateTokenSlice` derives one.
 */
export function programmeRequest(p: TokenIncentiveProgramme, cap: number): number {
  const share = Number.isFinite(p.share) ? clamp01(p.share) : 0
  if (share > 0) return share * Math.max(0, cap)
  return Number.isFinite(p.tokensPerWeek) && p.tokensPerWeek > 0 ? p.tokensPerWeek : 0
}

/** The player's current policy, as six numbers. Absent programmes read 0. */
export function incentiveShares(s: GameState | null | undefined): IncentiveShares {
  const out: IncentiveShares = { ...NO_SHARES }
  const t = s?.token
  if (!t) return out
  for (const p of t.incentives) if (p.category in out) out[p.category] = clamp01(Number.isFinite(p.share) ? p.share : 0)
  return out
}

/**
 * Set the policy. THE ONE WRITE THE PLAYER MAKES, and the only place programmes are created.
 *
 * Shares are clamped to 0–1 each and scaled down proportionally if they sum past 1, so the treasury
 * cap remains the budget by construction rather than by a validation the UI has to get right. A
 * category set to zero has its programme REMOVED, which keeps `TOKEN_LIMITS.incentives` (6) honest
 * and stops a dormant programme carrying a stale stock forever.
 *
 * SLICE 6: a live governance mandate holds a FLOOR under its category. The floor is applied here —
 * at the one write — so a passed vote binds by construction: the slider physically cannot go below
 * it, and when the request over-commits, only the headroom ABOVE the floors is scaled down. With no
 * mandate running the floors are all zero and this is the Slice-4 arithmetic character for
 * character. Defying the mandate (token/governance.ts) is the priced way out, not this function.
 *
 * Returns the shares actually stored, which is what the caller should show — never the request.
 */
export function setIncentiveShares(s: GameState, next: Partial<IncentiveShares>): IncentiveShares {
  const t = s.token
  if (!t || !incentivesActive(s)) return incentiveShares(s)

  const asked: IncentiveShares = { ...incentiveShares(s) }
  for (const c of INCENTIVE_CATEGORIES) {
    const v = next[c]
    if (v !== undefined) asked[c] = Number.isFinite(v) ? clamp01(v) : 0
  }
  // Function-body import both ways round (governance.ts calls setIncentiveShares to materialise a
  // fresh mandate) — the same cycle shape market ↔ users already carries, for the same reason:
  // re-deriving the floors here from raw mandate rows would be the desync §7.3 warns about.
  const floors = governanceShareFloors(s)
  const minFor = (c: TokenIncentiveCategory) => clamp01(floors[c] ?? 0)
  for (const c of INCENTIVE_CATEGORIES) asked[c] = Math.max(asked[c], minFor(c))
  const fixed = INCENTIVE_CATEGORIES.reduce((a, c) => a + minFor(c), 0)
  const flexible = INCENTIVE_CATEGORIES.reduce((a, c) => a + (asked[c] - minFor(c)), 0)
  const flexScale = fixed + flexible > 1 && flexible > 0 ? Math.max(0, 1 - fixed) / flexible : 1

  const before = incentiveShares(s)
  const kept: TokenIncentiveProgramme[] = []
  for (const c of INCENTIVE_CATEGORIES) {
    const share = Math.round((minFor(c) + (asked[c] - minFor(c)) * flexScale) * 1000) / 1000
    if (share <= 0) continue
    const existing = t.incentives.find((p) => p.category === c)
    kept.push({
      category: c,
      share,
      tokensPerWeek: existing?.tokensPerWeek ?? 0,
      startedWeek: existing?.startedWeek ?? s.week,
      cumulativeTokens: existing?.cumulativeTokens ?? 0,
      // A programme that comes back keeps the stock it had — the ecosystem you funded last quarter
      // has not forgotten you. It has been decaying at 9%/wk while you were away.
      effectiveness: existing?.effectiveness ?? 0,
    })
  }
  t.incentives = kept.slice(0, TOKEN_LIMITS.incentives)

  const after = incentiveShares(s)
  const moved = INCENTIVE_CATEGORIES.some((c) => Math.abs(after[c] - before[c]) > 0.0005)
  if (moved)
    t.history.push({
      week: s.week,
      type: 'incentive_change',
      importance: 30,
      metadata: {
        total: Math.round(INCENTIVE_CATEGORIES.reduce((a, c) => a + after[c], 0) * 100),
        ...Object.fromEntries(INCENTIVE_CATEGORIES.filter((c) => after[c] > 0).map((c) => [c, Math.round(after[c] * 100)])),
      },
    })
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)
  return after
}

// ---------- the week's spend, split six ways ----------

export interface CategorySpend {
  category: TokenIncentiveCategory
  share: number
  /** Tokens this category gets after the treasury's weekly cap has bitten. */
  tokens: number
  /** Those tokens at last week's close. A LAG — nothing here reads a price this tick wrote. */
  dollars: number
  /** Tokens as a share of circulating supply. The scale-free intensity every effect is built on. */
  floatFraction: number
  /** 0–1 stock as it stands BEFORE this week's spend is folded in. Effects read this. */
  stock: number
}

export interface WeeklyIncentiveSpend {
  active: boolean
  tokens: number
  dollars: number
  capped: boolean
  byCategory: Record<TokenIncentiveCategory, CategorySpend>
}

function emptySpend(active = false): WeeklyIncentiveSpend {
  const byCategory = {} as Record<TokenIncentiveCategory, CategorySpend>
  for (const c of INCENTIVE_CATEGORIES)
    byCategory[c] = { category: c, share: 0, tokens: 0, dollars: 0, floatFraction: 0, stock: 0 }
  return { active, tokens: 0, dollars: 0, capped: false, byCategory }
}

/** A week in which nothing was committed. Built from the category list alone, so it is safe to
 *  evaluate at module load in a file that participates in the market ↔ users ↔ incentives cycle. */
export const NO_SPEND: WeeklyIncentiveSpend = emptySpend(false)

/**
 * How the week's capped release is divided.
 *
 * PRO RATA OF THE CAPPED TOTAL, never of the request — `treasuryCommitment` (Slice 2) owns the
 * token-denominated weekly cap, which is decision 4's first restoring force on loop A, and this
 * file must not re-derive it. When the cap bites, every category is cut in the same proportion.
 */
export function weeklyIncentiveSpend(s: GameState | null | undefined): WeeklyIncentiveSpend {
  const t = s?.token
  if (!t || !incentivesActive(s)) return emptySpend(false)
  const commitment = treasuryCommitment(s)
  const out = emptySpend(true)
  out.capped = commitment.capped
  if (!(commitment.tokens > 0) || !(commitment.requested > 0)) return out

  const cap = commitment.cap
  const circulating = Math.max(1, t.supply.circulating)
  let assigned = 0
  for (const p of t.incentives) {
    const slot = out.byCategory[p.category]
    if (!slot) continue
    const request = programmeRequest(p, cap)
    if (!(request > 0)) continue
    const tokens = commitment.tokens * clamp01(request / commitment.requested)
    slot.share = clamp01(Number.isFinite(p.share) ? p.share : 0)
    slot.tokens += tokens
    slot.dollars += tokens * t.market.price
    slot.floatFraction += tokens / circulating
    slot.stock = clamp01(p.effectiveness)
    assigned += tokens
  }
  out.tokens = assigned
  out.dollars = assigned * t.market.price
  return out
}

/** Tokens pointed at one category this week. */
export function categoryTokens(s: GameState | null | undefined, category: TokenIncentiveCategory): number {
  return weeklyIncentiveSpend(s).byCategory[category]?.tokens ?? 0
}

/**
 * 0–1. A category's spend as a share of the float, against the float share that saturates it.
 *
 * THE PRICE IS NOT IN THIS EXPRESSION, and that is the whole of the denomination rule in
 * TOKEN_INCENTIVES: three of the six categories reach `fairValue`, and a dollar-denominated
 * intensity would make the fundamental anchor rise with the price it is supposed to anchor.
 */
export function spendIntensity(spend: CategorySpend): number {
  return clamp01(spend.floatFraction / TOKEN_INCENTIVES.fullIntensityFloatPct)
}

// ---------- what the stocks buy ----------

export interface IncentiveEffects {
  /** Points added to the UTILITY target (developer grants). The only lever that moves the anchor. */
  utility: number
  /** Added to the DEPTH target (liquidity incentives). Depth is the founder's exit discount. */
  depth: number
  /** Points added to the SPECULATION target (liquidity incentives). The dangerous half. */
  speculation: number
  /** Points of `decentralisation` this week (community treasury). MONOTONE — never negative. */
  decentralisation: number
  /** Absolute target for `trust`, or null when this run has no incentives. */
  trustTarget: number | null
  /** Points of `s.hype` (partnerships), applied with headroom by the caller. */
  hype: number
}

export const NO_EFFECTS: IncentiveEffects = {
  utility: 0,
  depth: 0,
  speculation: 0,
  decentralisation: 0,
  trustTarget: null,
  hype: 0,
}

/**
 * Every category's effect, from the stocks as they stand BEFORE this week's spend.
 *
 * Pure, and deliberately readable as a table: six categories, six distinct downstream variables,
 * no shared coefficients. If two of these rows ever collapse onto the same variable, the two
 * categories are the same lever wearing different names and should be merged.
 *
 *   customer_rewards       → s.users (rented)      via token/users.ts, ARPU-denominated
 *   developer_grants       → market.utility        the anchor, and nothing else touches it
 *   employee_compensation  → payroll, morale       via engine.ts, dollar-denominated
 *   liquidity_incentives   → market.depth + speculation
 *   partnerships           → s.hype → ORGANIC users
 *   community_treasury     → decentralisation → trust
 */
export function incentiveEffects(s: GameState | null | undefined): IncentiveEffects {
  const t = s?.token
  if (!t || !incentivesActive(s)) return NO_EFFECTS
  const stock = (c: TokenIncentiveCategory) => clamp01(t.incentives.find((p) => p.category === c)?.effectiveness ?? 0)

  const sectorMult = TOKEN_INCENTIVES.grantSectorMultiplier[s!.sector] ?? 1
  const grants = stock('developer_grants')
  const liquidity = stock('liquidity_incentives')
  const community = stock('community_treasury')
  const partners = stock('partnerships')

  // §19 + §35 + decision 4's loop E. The benefit is CONCAVE in decentralisation while the cost —
  // control, permanently — is linear, which is what guarantees an interior optimum rather than
  // "always give everything away".
  const d = clamp01(t.community.decentralisation / 100)
  const trustTarget = clamp(
    TOKEN_INCENTIVES.trustBase +
      TOKEN_BOUNDS.decentralisationTrustGain * Math.sqrt(d) +
      TOKEN_INCENTIVES.trustSentimentWeight * t.community.sentiment +
      TOKEN_INCENTIVES.communityTrustGain * community,
    0,
    100,
  )

  return {
    utility: TOKEN_INCENTIVES.grantUtilityGain * TOKEN_INCENTIVES.grantSuccessRate * sectorMult * grants,
    depth: TOKEN_INCENTIVES.liquidityDepthGain * liquidity,
    speculation: TOKEN_INCENTIVES.liquiditySpeculationGain * liquidity,
    decentralisation: TOKEN_INCENTIVES.communityDecentralisationGain * community,
    trustTarget,
    hype: TOKEN_INCENTIVES.partnershipHypeGain * partners,
  }
}

const BUILD_RATE: Record<TokenIncentiveCategory, number> = {
  // Customer rewards and employee comp act THIS WEEK through their own mechanisms (rented
  // acquisition, payroll), so their stock is a readout rather than a transmission. It still builds
  // and decays at the same rate as the others so the screen reads consistently.
  customer_rewards: 0.25,
  developer_grants: TOKEN_INCENTIVES.grantBuildRate,
  employee_compensation: 0.25,
  liquidity_incentives: TOKEN_INCENTIVES.liquidityBuildRate,
  partnerships: TOKEN_INCENTIVES.partnershipBuildRate,
  community_treasury: TOKEN_INCENTIVES.communityBuildRate,
}

/**
 * Fold this week's spend into every stock, and record what was actually spent.
 *
 * Called LAST in the tick, after every effect has been read, so no effect can see the stock this
 * week's spend produced — the lag rule from docs/ico-architecture.md §4, applied to the one
 * subsystem that would otherwise close a same-tick loop through the treasury.
 *
 * The build and the decay are the SAME `approach`: a stock under constant intensity `i` settles at
 * `i`. That is why holding a programme at 30% of the budget forever is a materially different thing
 * from spending the same total in one week — and why nothing here ratchets.
 */
export function advanceIncentiveStocks(s: GameState, spend: WeeklyIncentiveSpend): void {
  const t = s.token
  if (!t) return
  for (const p of t.incentives) {
    const slot = spend.byCategory[p.category]
    const intensity = slot ? spendIntensity(slot) : 0
    const rate = intensity > clamp01(p.effectiveness) ? (BUILD_RATE[p.category] ?? 0.1) : TOKEN_INCENTIVES.stockDecayPerWeek
    p.effectiveness = clamp01(p.effectiveness + (intensity - clamp01(p.effectiveness)) * rate)
    const tokens = slot?.tokens ?? 0
    p.tokensPerWeek = tokens
    p.cumulativeTokens += tokens
  }
}

// ---------- employee token compensation (brief §16, decision 4 loop D) ----------

export interface EmployeeTokenComp {
  active: boolean
  tokens: number
  dollars: number
  payroll: number
  /** Dollars of payroll the tokens actually cover, after the 40% cap. */
  offset: number
  /** 0–`tokenCompMaxShare`. How much of the package is paid in tokens. */
  coverage: number
  /** Dollars committed beyond what the cap allows — spent, and buying nothing. */
  wasted: number
}

/**
 * §16: "Allow token compensation to substitute for some cash/equity compensation… Do not rebuild
 * the employee compensation system. Integrate into existing employee economics."
 *
 * So this returns a number the engine SUBTRACTS FROM PAYROLL, and that is the whole integration.
 * No second salary model, no token-denominated packages, no vesting per employee.
 *
 * Read from `advanceWeek`'s expense block, which runs BEFORE `tickToken`. That ordering is not an
 * accident: `supply.treasury` and `market.price` do not move between the two points, so the dollars
 * counted here are exactly the dollars the tick then releases. One release, one saving.
 *
 * Capped at `TOKEN_BOUNDS.tokenCompMaxShare` (0.4) of payroll. Tokens past the cap are `wasted`:
 * they still leave the treasury and still hit the float, because you cannot un-print an
 * over-generous package. Over-allocating this category is a real, legible mistake.
 */
export function employeeTokenComp(s: GameState | null | undefined): EmployeeTokenComp {
  const idle: EmployeeTokenComp = { active: false, tokens: 0, dollars: 0, payroll: 0, offset: 0, coverage: 0, wasted: 0 }
  if (!s || !incentivesActive(s)) return idle
  const spend = weeklyIncentiveSpend(s).byCategory.employee_compensation
  const payroll = weeklyPayroll(s)
  if (!(spend.dollars > 0) || !(payroll > 0)) return { ...idle, active: true, payroll }
  const ceiling = payroll * TOKEN_BOUNDS.tokenCompMaxShare
  const offset = Math.min(spend.dollars, ceiling)
  return {
    active: true,
    tokens: spend.tokens,
    dollars: spend.dollars,
    payroll,
    offset,
    coverage: clamp01(offset / payroll),
    wasted: Math.max(0, spend.dollars - ceiling),
  }
}

/**
 * Loop D, and the reason §16 lists "token price falls → morale decreases" as a risk.
 *
 * Reads the token's MOMENTUM — `price / emaPrice − 1`, the same difference term the whole price
 * model is built on — never the price level. A level term would mean a company whose token is
 * merely cheap has a permanently miserable team; a momentum term means a team that watches the
 * chart is happy while it climbs and unhappy while it falls, which is the actual phenomenon.
 *
 * Scaled by coverage (a team paid 5% in tokens barely notices) and clamped to
 * `TOKEN_BOUNDS.tokenCompMoraleClamp` (±3/wk), so it can bias morale and never dominate the
 * existing drivers — runway, bugs, shipping, culture — which move it by far more.
 */
export function tokenCompMoraleDelta(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t || !incentivesActive(s)) return 0
  const comp = employeeTokenComp(s)
  if (!(comp.coverage > 0)) return 0
  const ema = Math.max(t.market.launchPrice * TOKEN_BOUNDS.priceFloorFraction, t.market.emaPrice)
  const momentum = clamp(t.market.price / ema - 1, -0.95, 4)
  const raw =
    TOKEN_INCENTIVES.tokenCompMomentumGain *
    Math.tanh(momentum / 0.25) *
    (comp.coverage / TOKEN_BOUNDS.tokenCompMaxShare)
  return clamp(raw, -TOKEN_BOUNDS.tokenCompMoraleClamp, TOKEN_BOUNDS.tokenCompMoraleClamp)
}

// ---------- readouts ----------

/** Weeks of spending left at the current policy, or Infinity when nothing is committed. Shown so
 *  "the treasury is finite" is a number on the screen rather than a discovery in week 60. */
export function treasuryWeeksLeft(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return Infinity
  const spend = weeklyIncentiveSpend(s)
  if (!(spend.tokens > 0)) return Infinity
  // The cap is a fraction of a shrinking balance, so spending is exponential decay, not a straight
  // line: t = ln(remaining/floor) / −ln(1 − rate). Reported against a 10% floor, the point at which
  // a programme can no longer do anything meaningful.
  const rate = clamp01((spend.tokens / Math.max(1, t.supply.treasury)))
  if (!(rate > 0)) return Infinity
  return Math.round(Math.log(10) / -Math.log(1 - Math.min(0.99, rate)))
}

/** The state a UI needs, in one call. */
export interface IncentivePanel {
  active: boolean
  shares: IncentiveShares
  spend: WeeklyIncentiveSpend
  effects: IncentiveEffects
  comp: EmployeeTokenComp
  weeklyCapTokens: number
  treasuryTokens: number
  weeksLeft: number
}

export function incentivePanel(s: GameState): IncentivePanel {
  const t = s.token
  return {
    active: incentivesActive(s),
    shares: incentiveShares(s),
    spend: weeklyIncentiveSpend(s),
    effects: incentiveEffects(s),
    comp: employeeTokenComp(s),
    weeklyCapTokens: t ? t.supply.treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek : 0,
    treasuryTokens: t ? t.supply.treasury : 0,
    weeksLeft: treasuryWeeksLeft(s),
  }
}

/** Shape guard for a migrated programme; the migration owns the clamping. */
export function isIncentiveCategory(v: unknown): v is TokenIncentiveCategory {
  return typeof v === 'string' && (INCENTIVE_CATEGORIES as string[]).includes(v)
}

/** Used by the migration to re-derive a v1 programme's share from its absolute standing order. */
export function shareFromTokens(t: Pick<TokenState, 'supply'>, tokensPerWeek: number): number {
  const cap = Math.max(1, t.supply.treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek)
  return clamp01(tokensPerWeek / cap)
}
