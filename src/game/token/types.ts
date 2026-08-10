// Tokenisation / ICO — the type surface. Slice 0 of docs/ico-implementation-plan.md.
//
// Read docs/ico-architecture.md before adding anything here. This file is a CONTRACT: every
// later slice builds against these names, and the five decisions recorded in that document are
// what make the names mean what they say.
//
// The four properties every type in this file must keep:
//
//   PERSISTED   — TokenState is partialized into localStorage as JSON and structuredClone'd on
//                 every action. Plain objects, arrays, numbers, strings and string-literal unions
//                 only: no Map, no Set, no Date, no class instances, no functions. Every array
//                 has a cap in TOKEN_LIMITS.
//   DETERMINISTIC — everything is generated from (config.seed, week, tick) through the engine's
//                 seeded()/withSeed(). Nothing in this subsystem reaches for Math.random,
//                 Date.now or new Date. Generators take an injected `rng`/`uid`, the way
//                 career/tick.ts and world/* already do.
//   OPTIONAL    — GameState.token is absent on every save written before this existed and on
//                 every run that never tokenised. Absence IS `capitalPath: 'institutional'`
//                 (brief §74). Readers tolerate undefined; nothing back-fills a slice onto a
//                 traditional run.
//   DERIVED-NOT-STORED — anything computable from other fields in the same tick is a function,
//                 not a field. Treasury value, market cap, founder standing and the user split
//                 in Career are all derived. A stored derived value is how §49's double-count
//                 gets in.
//
// NOTHING IN THIS FILE HAS BEHAVIOUR. Slice 0 ships types, capabilities and a written contract.

import type { SegmentId } from '../career/types'

/** Bumped when this slice's shape changes, so in-slice migration never needs a global persist
 *  bump. Same contract as LIVING_WORLD_STATE_VERSION. */
export const TOKEN_STATE_VERSION = 1

// ---------- the fork ----------

/**
 * How the company is financed and, therefore, how it can end. Brief §4: once `community` is
 * chosen it is irreversible for Phase 1.
 *
 * There is deliberately NO `capitalPath` field on GameState. `GameState.token` being absent is
 * what "institutional" means, which is why a save that predates this feature needs no migration
 * write at all — read it through `capitalPath(s)` (Slice 1, src/game/token/state.ts).
 */
export type CapitalPath = 'institutional' | 'community'

// ---------- eligibility (brief §1, §2) ----------

export type TokenisationBlockerId =
  | 'too_early' // company age
  | 'too_few_users'
  | 'weak_pmf'
  | 'weak_retention'
  | 'weak_community' // not enough engaged users to sell a network story to
  | 'low_reputation'
  | 'ipo_in_flight' // an S-1 is filed; finish or pull it first
  | 'already_tokenised'
  | 'capability_off' // this run does not have `tokenisation`

export interface TokenisationBlocker {
  id: TokenisationBlockerId
  /** Player-facing, already resolved to this run's numbers. §1: readable feedback, not a score. */
  label: string
  /** 0–1 how close this specific requirement is. Drives the progress bar, never shown as a number. */
  progress: number
}

export interface TokenisationEligibility {
  eligible: boolean
  blockers: TokenisationBlocker[]
  /**
   * 0–100. Brief §1 warns against exposing this as an exact optimisation target — the UI shows
   * the blockers, not this number. It exists so bots and tests have something monotone to assert on.
   */
  readinessScore: number
}

/** Brief §2. Relative, never a gate: a low-suitability sector can still tokenise and win. */
export type SectorSuitability = 'low' | 'medium' | 'medium_high' | 'high' | 'high_risk'

// ---------- tokenomics setup (brief §20–§24) ----------

/**
 * Fractions of total supply. MUST sum to 1 within TOKEN_BOUNDS.allocationEpsilon — validate at
 * the point of launch, not at read time.
 */
export interface TokenAllocationPlan {
  community: number
  treasury: number
  team: number
  founder: number
  partners: number
}

export type VestingPolicy = 'short' | 'standard' | 'long'

export interface TokenVestingSchedule {
  policy: VestingPolicy
  cliffWeeks: number
  durationWeeks: number
  /** Week the clock started — the launch week. Unlocks are a pure function of (week, this). */
  startWeek: number
}

/** Brief §24. One primary model per company. Sector compatibility is a Slice-4 table. */
export type TokenUtilityModel =
  | 'product_access'
  | 'rewards'
  | 'governance'
  | 'marketplace_currency'
  | 'ecosystem_incentive'

/** The whole tokenomics screen (§66), captured as one plain object so it can be journaled. */
export interface TokenLaunchPlan {
  allocation: TokenAllocationPlan
  vesting: VestingPolicy
  utilityModel: TokenUtilityModel
  /** 0–100 starting point on the centralised → community-governed axis (§66.4). */
  initialDecentralisation: number
  /** Tokens minted. Fixed at launch; nothing in this feature mints or burns afterwards. */
  totalSupply: number
  /** Price the initial sale clears at, in dollars. Sets `TokenMarket.launchPrice`. */
  launchPrice: number
}

// ---------- supply (brief §41) ----------

/**
 * Token counts, never dollars. The invariant is exact and must be asserted every tick:
 *
 *   circulating + treasury + locked === total
 *
 * `locked` is unvested team/founder/partner allocation. Unlocks move tokens locked → circulating
 * and are aggregate supply pressure, never simulated wallets (§41).
 */
export interface TokenSupply {
  total: number
  circulating: number
  treasury: number
  locked: number
}

// ---------- the market (brief §26–§30) ----------

/**
 * Every field here is a LEVEL that a restoring force pulls on. See docs/ico-architecture.md
 * decision 4: no reflexive edge in this subsystem closes inside one tick without crossing
 * `emaPrice` or a one-week lag, and every clamp has a reversion term behind it so the clamp is
 * never the mechanism that holds the value in range.
 */
export interface TokenMarket {
  /** Dollars. Floored at launchPrice × TOKEN_BOUNDS.priceFloorFraction — zero is absorbing. */
  price: number
  /** Set once at launch, the scale for every relative bound in this subsystem. */
  launchPrice: number
  /**
   * Exponential moving average of price. Speculative demand reads MOMENTUM (price/emaPrice − 1),
   * never the price level: a level term is the absorbing-state bug, a difference term decays to
   * zero as the anchor catches up. This field is the single most load-bearing damper here.
   */
  emaPrice: number
  /**
   * What the network is worth on fundamentals — utility, protocol revenue, organic users.
   * Price is pulled toward it superlinearly in log-deviation (TOKEN_BOUNDS.gravityExponent),
   * so large dislocations correct faster than small ones and no bubble can run away.
   */
  fairValue: number
  /** 0–100. Raises the size of weekly price moves; does not bias their direction. */
  volatility: number
  /** 0–100. Mean-reverts toward `utility` — the anchor, not a clamp (§26). */
  speculation: number
  /** 0–100. Emerges from real network activity only; nothing lets a player buy it (§25). */
  utility: number
  /** 0–1 how much size the market absorbs without moving. Sets the founder's exit discount. */
  depth: number
  /** Last week's terms, kept for narration and the postmortem. Inputs, not state. */
  lastDemand: number
  lastSupplyPressure: number
}

// ---------- community (brief §32–§35) ----------

export interface TokenCommunityState {
  /** People in the community. NOT the same population as product users (§54). */
  members: number
  holders: number
  /** 0–100 each. */
  sentiment: number
  trust: number
  engagement: number
  /** How loudly holders are asking for control. Rises when founderInfluence outruns trust. */
  decentralisationDemand: number
  /** 0–100, monotone non-decreasing (§35): control given away is not taken back. */
  decentralisation: number
  /**
   * 0–100. NOT token ownership (§34): formal control, reputation and governance weight together.
   * Reverts toward (100 − decentralisation); it never jumps.
   */
  founderInfluence: number
}

// ---------- incentives (brief §13–§19) ----------

export type TokenIncentiveCategory =
  | 'customer_rewards'
  | 'developer_grants'
  | 'employee_compensation'
  | 'liquidity_incentives'
  | 'partnerships'
  | 'community_treasury'

/**
 * A standing programme, not a one-off spend. `tokensPerWeek` is denominated in TOKENS, never
 * dollars — that is decision 4's first restoring force on the treasury loop: a doubling price
 * does not double what you may spend.
 */
export interface TokenIncentiveProgramme {
  category: TokenIncentiveCategory
  tokensPerWeek: number
  startedWeek: number
  cumulativeTokens: number
  /** 0–1 rolling read on whether this programme is producing anything. Slice 4 defines it. */
  effectiveness: number
}

// ---------- user composition (brief §11, §12, §52) ----------

/**
 * The organic/incentivised split.
 *
 * AUTHORITATIVE ONLY WHEN `detailedPMF` IS OFF. In Career the truth lives on the cohorts
 * (`CustomerCohort.origin`), because the cohort list is already reconciled against `s.users`
 * every tick and a second copy would desync. Career code derives this pair from cohorts and
 * must never read it. Quick Play, which has no cohorts, stores it here.
 *
 * Invariant in both modes: organic + incentivised === s.users.
 */
export interface TokenUserSplit {
  organic: number
  incentivised: number
}

// ---------- governance (brief §36, §37) ----------

export type GovernanceProposalType =
  | 'treasury_allocation'
  | 'ecosystem_initiative'
  | 'protocol_change'
  | 'expansion_subsidy'
  | 'decentralisation'

export interface GovernanceProposal {
  id: string
  week: number
  type: GovernanceProposalType
  /** Key into a content table, never prose. Content stays out of the persisted slice. */
  descriptionKey: string
  /** 0–100, derived from state every tick (§37) — never a random roll. */
  support: number
  founderPosition: 'support' | 'oppose' | 'neutral'
  closesWeek: number
  status: 'active' | 'passed' | 'rejected'
}

export interface TokenGovernanceState {
  proposals: GovernanceProposal[]
  lastProposalWeek: number
}

// ---------- history (brief §72) ----------

export type TokenHistoryType =
  | 'launch'
  | 'price_rally'
  | 'price_crash'
  | 'treasury_sale'
  | 'founder_sale'
  | 'unlock'
  | 'governance_vote'
  | 'utility_milestone'
  | 'community_milestone'
  | 'decentralisation'
  | 'incentive_change'
  | 'crisis'

export interface TokenHistoryEntry {
  week: number
  type: TokenHistoryType
  /** 0–100, the Narrative Director's scoring input (§59). */
  importance: number
  /** Facts only — numbers and ids the postmortem re-narrates. Never a rendered sentence. */
  metadata: Record<string, string | number>
}

/** A per-week series for the dashboard and the postmortem's charts. Capped, like history. */
export interface TokenSeriesPoint {
  week: number
  price: number
  circulating: number
  treasuryTokens: number
  utility: number
  speculation: number
  sentiment: number
  organicUsers: number
  incentivisedUsers: number
}

// ---------- the founder's own position (brief §22, §42, §51) ----------

export interface FounderTokenPosition {
  granted: number
  /** Tokens past the cliff and vested. Pure function of (week, vesting, granted). */
  vested: number
  sold: number
  /**
   * Cash already taken. Founder sales are the token path's SECONDARY: they must add to
   * `GameState.bankedPayout` exactly as sellSecondary does, or the token founder has no way to
   * de-risk at all (canSellSecondary needs Series B, which a tokenised company rarely reaches).
   */
  realisedProceeds: number
}

// ---------- the persisted slice ----------

/**
 * Everything tokenisation persists. Created WHOLE by `createTokenState` at a successful launch
 * (Slice 1) — every sub-object present and zeroed. Optionality lives at exactly one level,
 * `GameState.token`, so no consumer ever writes `s.token?.market?.price ?? 0`.
 *
 * A slice that a later phase owns (governance, incentives) exists but stays empty until its
 * capability is on. `migrateTokenSlice` back-fills anything a save written at an earlier slice
 * lacks; no reader creates a sub-slice it does not own.
 */
export interface TokenState {
  version: number
  capitalPath: CapitalPath
  launchWeek: number
  plan: TokenLaunchPlan
  supply: TokenSupply
  market: TokenMarket
  community: TokenCommunityState
  founder: FounderTokenPosition
  incentives: TokenIncentiveProgramme[]
  governance: TokenGovernanceState
  /** See TokenUserSplit — authoritative only when `detailedPMF` is off. */
  users: TokenUserSplit
  history: TokenHistoryEntry[]
  series: TokenSeriesPoint[]
  /** Guards a second pass over the same week after a reload, as world.lastGeneratedWeek does. */
  lastTickedWeek?: number
}

// ---------- the seam with Career PMF (decision 5) ----------

/**
 * Why a customer arrived. Added to CustomerCohort as an OPTIONAL field: absent means 'organic',
 * which is what every existing cohort and every existing save is.
 *
 * This is the whole of §52's enforcement. `derivePmfForSegment` sees organic cohorts ONLY —
 * exclusion, not a weighting. A weighting means enough incentive spend still buys Strong PMF;
 * exclusion makes the guarantee structural and testable: for any incentive spend, with organic
 * cohorts held fixed, `derivePmfForSegment` is bit-identical.
 */
export type CohortOrigin = 'organic' | 'incentivised'

/** The §12 / §53 read: what retention would be if the rewards stopped. Pure, so it can be shown. */
export interface RetentionSplit {
  segmentId: SegmentId
  organic: number
  incentivised: number
  /** Incentivised retention with incentiveStrength forced to 0. The number that tells the truth. */
  incentivisedWithoutIncentives: number
}

// ---------- endings (decision 1) ----------

/**
 * Which token success state a `network` ending was. Brief §44 lists five; they share ONE
 * GameOver type and are distinguished here, because five ending types would mean five entries in
 * theme.ts ENDINGS, store.ts RunRecord, Career.tsx, sound.ts and the leaderboard's ending
 * whitelist for four cosmetic variants of the same score.
 */
export type TokenEndingKind =
  | 'network_unicorn'
  | 'category_protocol'
  | 'community_network'
  | 'founder_decentralised'
  | 'self_sustaining_protocol'

// ---------- caps ----------

/** Every array in the slice is bounded: the whole state is structuredClone'd on each action and
 *  JSON-serialised on each change, the same reason career.journal caps at 80 and history at 300. */
export const TOKEN_LIMITS = {
  history: 120,
  series: 300,
  proposals: 12,
  incentives: 6,
} as const

// ---------- damping and bounds (decision 4) ----------

/**
 * The restoring forces, named once so no later slice invents its own.
 *
 * The rule these encode: a clamp is an ABSORBING BOUNDARY, not a bound. We shipped exactly that
 * bug in the funding climate — a random walk against a hard clamp stuck runs at frozen for up to
 * 49 consecutive weeks — and the fix was `reversion = -climate * 0.07`, a pull that scales with
 * distance from neutral. Every 0–100 scalar here gets the same treatment.
 *
 * Slice 2 may retune these numbers against bot runs. It may NOT delete a term: each one closes a
 * specific loop, and docs/ico-architecture.md decision 4 says which.
 */
export const TOKEN_BOUNDS = {
  /** Allocation fractions must sum to 1 within this. */
  allocationEpsilon: 0.001,

  // --- loop B: price ↔ speculation ---
  /** Speculation reverts toward `utility`. Matches the climate fix's 0.07, which cured a 49-week
   *  absorbing state. */
  speculationReversion: 0.08,
  /** Sentiment and trust revert toward a baseline set by delivered product and founder conduct. */
  sentimentReversion: 0.06,
  /** Weight of the EMA anchor. Speculative demand reads price/emaPrice − 1, never price. */
  priceEmaAlpha: 0.18,
  /** Price is pulled toward fairValue by −pull × sign(d) × |d|^exponent, d = ln(price/fairValue).
   *  Superlinear: a 10× dislocation corrects far faster than a 1.2× one. This is the guarantee
   *  that no demand term, however large, produces a runaway. */
  gravityPull: 0.12,
  gravityExponent: 1.5,
  /** Hard per-week move cap, applied last. A backstop for arithmetic, not the mechanism. */
  maxWeeklyPriceMove: 0.45,
  /** Price floor as a fraction of launchPrice. Zero is absorbing: 0 × anything is 0 forever, the
   *  treasury never recovers and §43's "a spiral need not end the company" becomes a lie. */
  priceFloorFraction: 0.01,

  // --- loop A: treasury reflexivity ---
  /** Max share of TREASURY TOKENS committable to incentives per week. Denominated in tokens, so a
   *  doubling price does not double what you may spend — the loop's gain stays linear. */
  treasurySpendCapPerWeek: 0.02,
  /** Tokens released into the float push the price down. Selling 1% of circulating supply must
   *  cost at least the demand that 1% of float buys, or the loop's gain exceeds 1. Slice 2 asserts
   *  this against measured runs. */
  supplyPressurePerFloatPct: 1.1,
  /** Incentivised users decay this fast with no fresh spend, so sustaining the loop needs
   *  ACCELERATING spend against a SHRINKING token balance. */
  incentiveDecayPerWeek: 0.09,
  /** How much of an incentivised cohort's retention is bought rather than earned. The §12 gap
   *  (81% while paid, 31% when the rewards stop) falls out of this one number. */
  incentiveDependence: 0.62,

  // --- loop D: employee token compensation ---
  /** Max share of a package payable in tokens. */
  tokenCompMaxShare: 0.4,
  /** Max weekly morale swing attributable to the token price. Token comp biases morale; the
   *  existing drivers still dominate it. */
  tokenCompMoraleClamp: 3,

  // --- loop E: decentralisation ---
  /** Trust gained from decentralisation is CONCAVE (× sqrt) while the founder's loss of control is
   *  LINEAR, so there is an interior optimum and no corner solution. */
  decentralisationTrustGain: 28,
  /** founderInfluence reverts toward (100 − decentralisation); it never jumps. */
  founderInfluenceReversion: 0.1,
} as const

// ---------- the economy's shape (Slice 2) ----------

/**
 * The weekly economy's coefficients. TOKEN_BOUNDS above holds the DAMPING TERMS the contract names
 * and Slice 2 must not delete; this block holds the shape of the demand, supply and level updates
 * that those terms damp. They are separated so a later slice can retune the economy's character
 * without ever touching a restoring force by accident.
 *
 * Three of these are load-bearing and are asserted in test/token-economy.test.ts:
 *
 *   • `ecosystemDemandPerFloatPct` (1.0) is STRICTLY BELOW `TOKEN_BOUNDS.supplyPressurePerFloatPct`
 *     (1.1). Releasing 1% of the float must cost more price than the demand that 1% of float buys,
 *     or the treasury loop's per-cycle gain reaches 1 and the economy bootstraps itself.
 *
 *   • `demandCap` (0.30) bounds the whole demand side, and gravity is superlinear, so
 *     `gravityPull × |d|^gravityExponent` overtakes it at a FINITE dislocation:
 *         |d| = (demandCap + maxNoise) / gravityPull) ^ (1/gravityExponent) ≈ 2.3  ⇒  ~10× fair value.
 *     That is the ceiling on any bubble, by algebra rather than by hope.
 *
 *   • `fairValueFloorMultiple` (3) keeps the fundamental anchor STRICTLY ABOVE the price floor. At
 *     the floor, `ln(price/fairValue) ≤ ln(1/3) < 0`, so gravity always points UP out of it. The
 *     floor is therefore a REPELLING boundary. Without this, a network whose fundamentals decayed
 *     to nothing would sit at the floor forever — the absorbing state this slice exists to avoid.
 */
export const TOKEN_ECONOMY = {
  // --- fair value: fundamentals only, so the anchor cannot be bought (decision 4, loop B.3) ---
  /** Share of the company's revenue a token network captures, at zero and at full utility. */
  fairRevenueCaptureBase: 0.3,
  fairRevenueCaptureUtility: 0.7,
  /** Multiple applied to captured annual revenue, at zero and at full utility. */
  fairRevenueMultipleBase: 5,
  fairRevenueMultipleUtility: 10,
  /** Share of the sector's per-user value the NETWORK carries, at zero and at full utility. */
  fairUserShareBase: 0.25,
  fairUserShareUtility: 0.75,
  /** Engagement scales the user term: an inert community is worth less than a live one. */
  fairUserEngagementBase: 0.6,
  fairUserEngagementSpan: 0.8,
  /**
   * Global calibration so a launch does not immediately gap against its own anchor.
   *
   * Set from measurement, not taste. At 1.0 the stress sweep put the median token at 0.62× its
   * launch price after 104 quiet weeks and only 9.8% of runs above 1.2× — a token economy whose
   * median outcome is "you lost 40%" is not a fork anybody would take twice, and it collapses the
   * outcome distribution onto one side. 1.6 centres the quiet-policy median on the launch price and
   * leaves both tails populated. Retune it against the probe, never by eye.
   */
  fairValueScale: 1.6,
  /** fairValue ≥ this × the price floor. Makes the floor repelling rather than absorbing. */
  fairValueFloorMultiple: 3,

  // --- demand (brief §27) ---
  /**
   * Speculative demand is a MOMENTUM term: f(price/emaPrice − 1), never the price level.
   *
   * THE STABILITY CONDITION, which cost a rewrite to find. Linearise (ln price, ln emaPrice) about
   * an equilibrium, with `k` the momentum slope `coef / momentumScale × (base + span × spec)` and
   * `γ` gravity's local slope `gravityPull × gravityExponent × |d|^0.5`:
   *
   *     M = [[1 + k − γ, −k], [priceEmaAlpha, 1 − priceEmaAlpha]]   ⇒   stable iff k < α + γ(1−α)
   *
   * and γ → 0 AT the anchor, because gravity is superlinear. So near fair value the whole thing
   * turns on `k` against `priceEmaAlpha` alone. The first draft used coef 0.22, giving k ≈ 1.4 at
   * high speculation against α = 0.18: every equilibrium was locally unstable and every run pinned
   * itself against the saturation ceiling. Bounded, but only ever one shape.
   *
   * Tuned so `coef / momentumScale = 0.2`, i.e. k runs 0.08 → 0.32 across the speculation range:
   *
   *   • low speculation  (k < 0.18) — the market is LOCALLY STABLE and tracks fundamentals;
   *   • high speculation (k > 0.18) — locally unstable, so it oscillates out until gravity's
   *     superlinear term catches it, at |d| = ((k − α)/(gravityPull × gravityExponent))² ≈ 0.44,
   *     which is ±55% around fair value.
   *
   * SPECULATION IS THEREFORE LITERALLY THE PARAMETER THAT DECIDES WHETHER THE MARKET IS STABLE OR
   * CYCLICAL, which is what brief §26 and §28 describe in prose. Changing either number without
   * re-deriving that inequality will produce either a dead market or a permanent bubble.
   */
  speculativeDemandCoef: 0.05,
  /** Momentum is squashed through tanh(momentum / this), so demand saturates. */
  momentumScale: 0.25,
  /** How much the speculation level scales the momentum term, at 0 and at 100. */
  speculationDemandBase: 0.4,
  speculationDemandSpan: 1.2,
  /** Utility demand is a DIFFERENCE from neutral utility: below it, utility is negative demand. */
  utilityDemandCoef: 0.05,
  utilityNeutral: 0.35,
  /** Community demand, likewise a difference from a neutral blend of sentiment and engagement. */
  communityDemandCoef: 0.04,
  /** Demand bought by tokens released into the float. MUST stay < supplyPressurePerFloatPct. */
  ecosystemDemandPerFloatPct: 1,
  /** Total demand is bounded so superlinear gravity provably overtakes it. */
  demandCap: 0.3,

  // --- the week's noise (brief §28) ---
  priceNoiseScale: 0.1,
  priceNoiseVolBase: 0.3,
  /** Bound on `price/emaPrice − 1`, so one absurd week cannot poison every level that reads it. */
  momentumMin: -0.95,
  momentumMax: 4,
  /** Bound on ln(price/fairValue) before the exponent, purely so |d|^1.5 stays finite. */
  logDeviationCap: 6,

  // --- how the 0–100 levels move ---
  /** Speculation's momentum shock, before the saturating boundary term. */
  speculationMomentumGain: 22,
  volatilityReversion: 0.25,
  /**
   * Utility is EARNED: it moves slowly, and NOTHING a player spends appears in its target.
   *
   * Brief §25 says utility emerges from real network activity and cannot be bought. The first draft
   * of the tick put `engagement` in this target, which looked harmless — until the test that spends
   * the treasury's cap for thirty weeks measured utility drifting up against a zero-spend control.
   * Spend raises engagement, engagement raised utility: §25 violated one hop removed, and with it
   * the guarantee that `fairValue` is an anchor a founder cannot inflate. The term is gone, so the
   * utility ↔ engagement edge is now strictly one-way (utility → engagement) and this target reads
   * only product, protocol revenue and organic users.
   */
  utilityReversion: 0.06,
  utilityProductWeight: 0.35,
  utilityRevenueWeight: 33,
  utilityUserWeight: 26,
  engagementReversion: 0.1,
  /** Ecosystem spend buys ENGAGEMENT, never utility — the loop's lagged, capped positive leg. */
  engagementSpendGain: 400,
  engagementSpendCap: 18,
  membersReversion: 0.08,
  membersPerUserBase: 0.6,
  membersPerUserEngagement: 1.1,
  holderShareBase: 0.35,
  holderShareEngagement: 0.4,
  depthReversion: 0.1,
  sentimentMomentumGain: 25,

  // --- what gets written to history ---
  rallyThreshold: 0.25,
  crashThreshold: -0.2,
  historyCooldownWeeks: 4,
} as const

// ---------- scoring (decision 1) ----------

/**
 * How a tokenised run is scored against a traditional one.
 *
 * `valuation()` keeps meaning COMPANY ENTERPRISE VALUE and gains no token term, ever. Network
 * value is a separate function. They meet in exactly one place — the founder's dollars — through
 * two disjoint legs, which is what makes §49's "avoid double-counting" structural:
 *
 *   founderStanding(s) = valuation(s) × founderEquity      ← reads enterprise value only
 *                      + realisableTokenValue(s)           ← reads network value only
 *                      + bankedPayout
 *
 * With no token slice, `realisableTokenValue` is 0 and this is exactly today's expression, so
 * every existing ending pays out to the byte.
 *
 * The token path has no acquisition premium and no IPO pop. Its exit multiple lives in the
 * LIQUIDITY DISCOUNT instead — a founder who built real utility into a deep market realises far
 * more of their bag than one sitting on a speculative float they cannot exit. The spread below is
 * ~4×, the same order as the traditional path's 1.0× → 2.05× exit spread, and it is EARNED rather
 * than rolled. That is the balance argument in one constant block.
 */
export const TOKEN_SCORING = {
  /** Best achievable liquidity discount: deep market, strong utility, modest founder float share. */
  liquidityDiscountMax: 0.85,
  /** Worst: thin, speculative, founder holds a large share of the float. */
  liquidityDiscountMin: 0.2,
  /** Exit price impact scales with the founder's vested holding as a share of CIRCULATING supply —
   *  a founder holding 30% of the float cannot sell 30% of the market cap. */
  exitImpactExponent: 0.85,
  /** Network Unicorn threshold, the token mirror of the $1B company unicorn. */
  networkUnicornValue: 1_000_000_000,
  /** …but a pure bubble must not ring the bell. The network ending also requires this much real
   *  utility and this share of users being organic, or §53's lesson is undone by its own ending. */
  networkUnicornMinUtility: 55,
  networkUnicornMinOrganicShare: 0.5,
  /** Per-user valuation multiplier applied to INCENTIVISED users inside valuation(). A rented user
   *  is worth less to an acquirer. This is the only token-aware term valuation() ever gets, and it
   *  is a discount — never an addition — so enterprise value stays enterprise value. 1 when no
   *  token economy exists, which is what keeps the golden traces intact. */
  incentivisedUserValuationDiscount: 0.35,
} as const
