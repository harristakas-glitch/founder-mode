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
 *  bump. Same contract as LIVING_WORLD_STATE_VERSION.
 *
 *  2 — Slice 4 added `TokenIncentiveProgramme.share`, the standing order the player actually sets,
 *      and `TokenState.treasurySales`. A v1 save has programmes with no `share`; the migration
 *      re-derives one from `tokensPerWeek` against the treasury's weekly cap, so a mid-run save
 *      keeps spending what it was spending, and back-fills a zeroed sales record. */
export const TOKEN_STATE_VERSION = 2

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
  /**
   * SLICE 4, AND THE THING THE PLAYER ACTUALLY SETS. 0–1 of the treasury's weekly token cap
   * (`TOKEN_BOUNDS.treasurySpendCapPerWeek × supply.treasury`). Shares across programmes sum to at
   * most 1, so the cap is the budget by construction and "how much of my treasury do I burn each
   * week" is one dial rather than six absolute numbers that go stale as the treasury drains.
   */
  share: number
  /** Derived from `share` every tick: `share × cap`. Kept because it is what the price model and
   *  `treasuryCommitment` read, and because a v1 save has only this. */
  tokensPerWeek: number
  startedWeek: number
  cumulativeTokens: number
  /**
   * 0–1, AND IT IS A STOCK, not a rating (Slice 4).
   *
   * Each week it moves toward this week's spend intensity at the category's own build rate and
   * decays toward zero at `TOKEN_INCENTIVES.stockDecayPerWeek` — which is where the old
   * `TOKEN_BOUNDS.incentiveDecayPerWeek` went, see the note there. Effects read the STOCK, never
   * the week's spend, so every category is lagged (nothing a player commits lands the same week),
   * capped (the stock cannot exceed 1) and reversible (stop paying and it decays away). A one-week
   * blitz therefore buys almost nothing and a sustained programme compounds slowly, which is the
   * difference between a purchase and a policy.
   */
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
  /**
   * Slice 6, brief §43's Community Revolt at its terminus — architecture §7.9: a revolt that
   * removes the founder routes to the existing `fired` ending. Rare by construction (see
   * TOKEN_GOVERNANCE's removal* constants) and telegraphed twice before it is even tabled.
   */
  | 'founder_removal'

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
  /**
   * Slice 6. True once the founder has taken a public position on this proposal. A position is
   * taken ONCE — you said it in public — and shifts the weekly tally from the NEXT tick; it never
   * re-rolls a resolved vote.
   */
  campaigned?: boolean
  /** Slice 6. The week the vote closed. The engine's ouster check reads it; the postmortem quotes it. */
  resolvedWeek?: number
}

/**
 * Slice 6. What a PASSED proposal binds, while it binds it. A mandate is the outcome made real:
 * a share floor holds part of the weekly incentive budget where the vote pointed it, a sale factor
 * of 0 freezes treasury sales. Enforced at the write sites (`setIncentiveShares`,
 * `maxTreasurySale`) and re-asserted weekly by the governance tick, so complying is the default
 * and defying is a priced decision, never an oversight.
 */
export interface GovernanceMandate {
  proposalId: string
  type: GovernanceProposalType
  /** Which incentive category the vote directed budget to (the three floor types). */
  category?: TokenIncentiveCategory
  /** 0–1 minimum share of the weekly incentive budget, while the mandate runs. */
  shareFloor?: number
  /** 0–1 multiplier on `maxTreasurySale`. 0 is a freeze (protocol_change). */
  saleFactor?: number
  untilWeek: number
}

export interface TokenGovernanceState {
  proposals: GovernanceProposal[]
  lastProposalWeek: number
  /** Slice 6. Active bindings from passed proposals. Expired entries are pruned by the tick. */
  mandates: GovernanceMandate[]
  /** Slice 6. Mandates the founder tore up. Feeds the legitimacy term of every later vote. */
  defiances: number
  /** Slice 6. 0–TOKEN_GOVERNANCE.removalHeatMax. Consecutive-week pressure toward a no-confidence
   *  vote; rises only while ALL removal preconditions hold and decays faster than it builds. */
  revoltHeat: number
  /** Slice 6. Rate-limits the brewing-revolt warning, like every other inbox warning. */
  lastWarnWeek: number
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
  /**
   * Slice 4. What the treasury has raised by selling its own tokens (brief §6, §30) — the token
   * path's replacement for the rounds tokenising closed.
   *
   * Stored rather than derived because `lastSaleWeek` is the memory the CONFIDENCE cost is built
   * from: a second raise inside a quarter costs far more belief than the first, and there is no way
   * to recover "when did they last sell" from any other field.
   */
  treasurySales: { tokensSold: number; proceeds: number; lastSaleWeek: number }
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
  //
  // `incentiveDecayPerWeek: 0.09` USED TO LIVE HERE AND IT WAS A LIE. It claimed incentivised users
  // leave at ~9%/wk absent fresh spend — decision 4's loop A, item 3 — but Slice 3 built that
  // restoring force out of `incentiveDependence` instead, and built it STRONGER: with the rewards
  // off, an incentivised cohort's four-week survival collapses to `organic4 × 0.38` (24% against
  // 63%), which is ~12%/wk of decay against an organic base that is itself churning. Two decay
  // terms on the same population would have double-counted the collapse, so nothing ever read this
  // constant and it sat in the contract asserting a mechanism that did not exist.
  //
  // Slice 4 did not delete the NUMBER, only the claim. 0.09 is now
  // `TOKEN_INCENTIVES.stockDecayPerWeek`, where it governs the decay of the incentive STOCKS the
  // five non-customer categories build — ecosystem, liquidity, distribution, community standing.
  // Those genuinely had no restoring force before this slice, and without one every category would
  // ratchet: buy the effect once, keep it forever. See TOKEN_INCENTIVES.
  //
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

// ---------- user composition (Slice 3) ----------

/**
 * Organic versus incentivised users. Brief §11, §12, §52, §53; docs/ico-architecture.md §5.
 *
 * TOKEN_BOUNDS above owns `incentiveDependence` (0.62), the one number §12's whole story falls out
 * of. This block owns the shape of the demand and the thresholds the warning fires on, separated
 * for the same reason TOKEN_ECONOMY is separated from TOKEN_BOUNDS: a later slice can retune the
 * character without touching a damping term by accident.
 *
 * TWO THINGS HERE ARE LOAD-BEARING AND ARE ASSERTED IN test/token-users.test.ts:
 *
 *   • `RETENTION IS BLENDED IN FOUR-WEEK SPACE.` docs/ico-architecture.md §5.3 writes
 *     `keepIncentivised = keepOrganic × (1 − dependence) + strength × dependence` and then reads the
 *     result off as §12's 81% / 31%. But `resolveCohortRetention` returns a WEEKLY keep rate of
 *     roughly 0.90, so applied literally the unpaid case is 0.90 × 0.38 = 0.342 PER WEEK — a
 *     four-week survival of 1.4%, not 31%. An incentivised cohort would evaporate in three weeks
 *     and the mechanic would be a cliff rather than a decision. The blend is therefore done on the
 *     four-week figure (0.90⁴ = 63%, which IS §12's organic number) and converted back to a weekly
 *     rate. See `incentivisedKeepRate`.
 *
 *   • `INCENTIVE STRENGTH IS DENOMINATED IN ARPU, NOT DOLLARS.` A Career account in Social earns
 *     $1.80/wk and one in B2B SaaS earns $24/wk. A flat dollars-per-user constant would make
 *     incentives free in one sector and unaffordable in another. Strength is spend per incentivised
 *     user as a share of that sector's weekly revenue per user.
 */
export const TOKEN_USERS = {
  /**
   * How efficiently a dollar of token reward buys a customer, against a dollar of marketing.
   * Deliberately ≥ 1: paying people to show up works, and if it did not there would be no
   * temptation and therefore no lesson. Everything that makes it a bad idea is downstream.
   */
  acquisitionEfficiency: 1.25,
  /**
   * Conversion for a bought customer. Higher and flatter than the organic term, and it reads
   * PRODUCT FIT ONLY — never price fit. A customer moved by a reward is by definition not weighing
   * your price, which is the same fact that disqualifies them as evidence.
   */
  conversionBase: 0.5,
  conversionProductSpan: 0.3,
  /**
   * Spend per incentivised user, as a share of that user's weekly revenue, at which
   * `incentiveStrength` reaches 1. Paying half of what a customer pays you, back to them, every
   * week, is what "fully rented" costs.
   */
  fullStrengthArpuShare: 0.5,

  // --- the §53 warning ---
  /** Incentivised share of the target segment at or above which growth is mostly rented. */
  warnIncentivisedShare: 0.35,
  /** Organic four-week retention below which the base underneath that growth is leaking. Matches
   *  `pmfBlocker`'s existing 62% line, so the game tells one story in two places. */
  warnOrganicRetention: 0.62,
  /** Customer growth over the window that counts as "growth is strong". */
  warnGrowthPct: 0.08,
  warnWindowWeeks: 8,
  /** The warning is a lesson, not a nag. */
  warnCooldownWeeks: 12,
} as const

// ---------- incentives (Slice 4) ----------

/**
 * The six allocation categories, and what a dollar — or a token — of each actually buys.
 * Brief §13–§19; the tokenomics screen is §20–§24.
 *
 * THE RULE THIS BLOCK IS ORGANISED AROUND, WHICH THE CONTRACT DOES NOT STATE AND SHOULD:
 *
 *     ANYTHING THAT FEEDS `fairValue` IS TOKEN-DENOMINATED. ANYTHING THAT DOES NOT MAY BE
 *     DOLLAR-DENOMINATED.
 *
 * docs/ico-architecture.md §4 loop B.3 requires that the fundamental anchor cannot be bought, and
 * Slice 2 already had to delete a term (engagement → utility) that violated it one hop removed. A
 * dollar-denominated effect on a fairValue input would reopen exactly that hole through a new door:
 * spend is capped in TOKENS, so a rising price cannot raise the token budget — but it CAN raise
 * what those tokens are worth to whoever receives them, and if that bought more utility then
 * `price ↑ → grant dollars ↑ → utility ↑ → fairValue ↑ → price ↑` would be a live reflexive loop
 * with the loop-A cap doing nothing about it.
 *
 * So the three categories whose effects reach the anchor — developer grants (utility), partnerships
 * (hype, hence ORGANIC users) and community treasury (trust → sentiment → engagement) — measure
 * intensity as a share of the FLOAT, `tokens / circulating`, and the price is not in their
 * arithmetic at all. Liquidity incentives are nominally dollar-denominated against market cap, but
 * `dollars / (price × circulating) === tokens / circulating`: the price cancels, so they use the
 * same expression. Only two categories are genuinely priced in dollars, and both are dollars by
 * nature rather than by choice:
 *
 *   • customer rewards — a reward is worth what it is worth to the customer, denominated in that
 *     sector's ARPU (Slice 3's `incentiveStrength`). It reaches `s.users`, which fairValue does not
 *     read: fairValue counts ORGANIC users only, which is the same exclusion §52 turns on.
 *   • employee compensation — a salary is a dollar amount. It reaches payroll and morale, neither
 *     of which is in fairValue. This is decision 4's loop D, which already has its own clamp.
 */
export const TOKEN_INCENTIVES = {
  /**
   * 0.09, AND IT IS THE NUMBER THAT USED TO BE `TOKEN_BOUNDS.incentiveDecayPerWeek`.
   *
   * There it claimed incentivised USERS decay at 9%/wk absent spend, which Slice 3 superseded with a
   * stronger, better-founded force on the same population (see the note where it used to live). Here
   * it decays the incentive STOCKS, which had no restoring force at all before this slice and
   * needed one badly: without it every category would be a RATCHET — pay once, keep the ecosystem,
   * the liquidity and the distribution forever — and the treasury's weekly cap would stop being a
   * budget and start being a queue.
   *
   * A stock at rest under a constant intensity `i` settles at `i` itself: the build term and this
   * decay term are the same `approach`, which is why an effect is a POLICY rather than a purchase.
   */
  stockDecayPerWeek: 0.09,
  /**
   * Float share per week at which a category's spend intensity reaches 1. Calibrated against the
   * treasury cap: 2% of a treasury holding ~25% of supply, against a float of ~40%, is ~1.25% of
   * the float per week for the WHOLE budget. So one category taking the entire budget saturates,
   * half the budget runs at ~0.8, and a sixth runs at ~0.26 — focus beats spread, but not by so
   * much that spreading is never right.
   */
  fullIntensityFloatPct: 0.008,

  // --- developer grants (§15): the only thing that moves the ANCHOR ---
  grantBuildRate: 0.05, // §15's "slow payoff", as a rate rather than as a sentence
  /** Points added to the UTILITY TARGET at full stock, before the sector multiplier. Utility still
   *  reverts at `utilityReversion` (0.06/wk), so this takes ~20 weeks to land and ~20 to leave. */
  grantUtilityGain: 14,
  /** §15: "especially strong for Developer Tools, protocol-like companies, platform businesses".
   *  A grants programme in a consumer social app funds people nobody asked for. */
  grantSectorMultiplier: { devtools: 1.35, aiml: 1.25, saas: 1.15, fintech: 1, ecommerce: 0.85, social: 0.7 } as Record<string, number>,
  /** §15's "some projects may fail", as a deterministic haircut rather than a roll. The tick draws
   *  exactly one number a week and a conditional draw is how draw-order bugs are born. */
  grantSuccessRate: 0.72,

  // --- liquidity incentives (§17): useful and dangerous, in that order ---
  liquidityBuildRate: 0.18, // liquidity shows up when you pay for it and leaves the week you stop
  /** Added to the DEPTH target at full stock. Depth is what the founder's liquidity discount reads,
   *  so this is the one category that pays the founder directly. */
  liquidityDepthGain: 0.22,
  /** Points added to the SPECULATION target at full stock. This is the danger, and it is not
   *  decorative: TOKEN_ECONOMY's stability condition says the market is locally stable below
   *  speculation ~50 and cyclical above it, so a large liquidity programme literally moves the
   *  economy from tracking fundamentals to oscillating around them. */
  liquiditySpeculationGain: 18,

  // --- partnerships (§18): distribution, and the users it brings are EVIDENCE ---
  partnershipBuildRate: 0.09,
  /** Points of `s.hype` per week at full stock, added with headroom so 100 is repelling. Hype
   *  already decays 8%/wk in the engine, so this settles rather than accumulating — and it buys
   *  ORGANIC customers through the acquisition machinery that already exists, which is the whole
   *  point of the category: it is the one way a token can buy growth that counts toward PMF,
   *  because the people it reaches still have to choose the product at its price. */
  partnershipHypeGain: 2,

  // --- community treasury (§19): the only category that buys nothing ---
  communityBuildRate: 0.08,
  /** Points of `decentralisation` per week at full stock. MONOTONE NON-DECREASING (§35): control
   *  given away is not taken back, so unlike every other category this one does not reverse when
   *  the stock decays. That asymmetry IS the cost. */
  communityDecentralisationGain: 1.6,
  /** Trust's floor and its sentiment coupling. The decentralisation term itself is
   *  `TOKEN_BOUNDS.decentralisationTrustGain × sqrt(d/100)` — the contract's own concave-benefit
   *  formula from loop E, used here because community treasury is the only Slice-4 lever that
   *  touches it. Slice 5 owns the rest of the trust model (conduct, delivery, revolt). */
  trustBase: 24,
  trustSentimentWeight: 0.25,
  /** Points of trust bought directly by a running community-treasury programme, on top of what the
   *  decentralisation it causes is worth. Handing tokens to a community fund is itself the signal;
   *  the concave decentralisation term is the slower, permanent half. Measured: without this the
   *  category moved trust by 0.4 points over thirty weeks — decentralisation is concave and trust
   *  reverts at 6%/wk, so the sqrt term alone is real but nearly invisible inside a run. */
  communityTrustGain: 12,

  // --- employee compensation (§16): the one whose primary effect is cash, not a stock ---
  /** Morale moves with the token's MOMENTUM, scaled by how much of the package is in tokens and
   *  clamped by `TOKEN_BOUNDS.tokenCompMoraleClamp`. Loop D, and the clamp is the contract's. */
  tokenCompMomentumGain: 6,

  // --- the tokenomics screen (§20–§23) ---
  /** How far above or below the community's expected founder share the player may go. The band is
   *  centred on `defaultAllocation`, which is itself set by how late the launch is. */
  founderShareBand: 0.12,
  /** Floors, so no bucket can be zeroed into meaninglessness. */
  minCommunityShare: 0.2,
  minTreasuryShare: 0.05,
  minFounderShare: 0.02,
  /** Points of launch-day trust per point of supply taken above (or left below) the expected
   *  founder share. §22: higher founder allocation, community trust ↓, sell-pressure fears ↑. */
  founderExcessTrust: -90,
  founderExcessSentiment: -45,
  founderExcessSpeculation: 55,
  founderExcessReputation: -18,
  /** §23. Short vesting reads as a founder planning an exit; long vesting buys credibility. */
  vestingTrust: { short: -7, standard: 0, long: 7 } as Record<string, number>,
  vestingSpeculation: { short: 6, standard: 0, long: -5 } as Record<string, number>,
  /** §24. How well the chosen utility model suits the sector — it seeds launch-day utility, and it
   *  is a nudge, never a gate: any model may be chosen in any sector. */
  utilityModelFit: {
    devtools: { ecosystem_incentive: 1, product_access: 0.85, governance: 0.7, marketplace_currency: 0.55, rewards: 0.5 },
    saas: { product_access: 1, governance: 0.8, ecosystem_incentive: 0.7, rewards: 0.6, marketplace_currency: 0.5 },
    fintech: { marketplace_currency: 1, product_access: 0.8, governance: 0.7, rewards: 0.6, ecosystem_incentive: 0.55 },
    ecommerce: { rewards: 1, marketplace_currency: 0.9, product_access: 0.7, ecosystem_incentive: 0.55, governance: 0.5 },
    social: { rewards: 1, governance: 0.8, ecosystem_incentive: 0.65, product_access: 0.6, marketplace_currency: 0.55 },
    // Compute credits ARE the product: a token that meters inference is the one crypto pattern
    // this sector invented for itself. Ecosystem grants fit the developer surface; rewards fit
    // nothing — nobody farms points from a GPU bill.
    aiml: { product_access: 1, ecosystem_incentive: 0.85, marketplace_currency: 0.7, governance: 0.6, rewards: 0.5 },
  } as Record<string, Record<string, number>>,
  /** Launch-day utility multiplier across the fit range. The best-matched model for a sector scores
   *  1 and is the DEFAULT, so it multiplies by 1 and changes nothing; every other choice starts the
   *  network with less real utility and — because launch speculation is `78 − 0.8 × utility` — more
   *  speculation. A mismatched model launches a story rather than a product. */
  utilityFitMin: 0.7,
  utilityFitMax: 1,
} as const

// ---------- community & decentralisation (Slice 5) ----------

/**
 * The community as a COUNTERPARTY. Brief §32–§35, §38; docs/ico-architecture.md §4 loop E.
 *
 * Slice 5 is the COST side of the token path, and this block is organised around one measured
 * failure: before it, `trust` reached exactly one term (engagement at weight 0.35 → the liquidity
 * discount at weight 0.2) and a maximum treasury sale cost about ONE POINT of market quality, while
 * `founderInfluence` was written at launch and never read again. The community noticed everything
 * and could do nothing about any of it.
 *
 * THE RULE THIS BLOCK ADDS, stated once:
 *
 *     TRUST IS PARTIALLY BUYABLE (the community-treasury category pays for it), SO TRUST MUST
 *     NEVER REACH `fairValue`, `utility`, OR ANY OTHER ANCHOR INPUT. Its consequences run through
 *     the community's own BODY — members, holders, engagement, depth — and through the price's
 *     supply side (an exodus sells), never through the fundamental anchor.
 *
 * Every reaction here has a restoring force, per the standing contract:
 *   • the trust TARGET carries the conduct drags; trust itself reverts toward it, so stopping the
 *     conduct is what recovers the trust — nothing ratchets and nothing is absorbing;
 *   • decentralisation demand reverts toward a target set by the influence−trust gap;
 *   • founderInfluence reverts toward (100 − decentralisation) and never jumps (§34);
 *   • an exodus removes the people who would have left, so each week's exodus shrinks the base the
 *     next one is drawn from, and trust recovering re-grows members through the ordinary target.
 */
export const TOKEN_COMMUNITY = {
  // --- the conduct ledger: what drags the trust TARGET down (§33's list, priced) ---
  /** Weeks the community remembers a treasury sale when setting its expectation of you. The same
   *  window the sale's own confidence cost uses, so the story is one story. */
  saleMemoryWeeks: 16,
  /** Points off the trust target at full, fresh memory of a treasury sale. This is what makes the
   *  sale's one-off trust hit STAY DOWN instead of reverting away within a quarter. */
  saleMemoryDrag: 12,
  /** Points off the trust target when the whole user base is rented. The community can read the
   *  §53 warning too: growth that is mostly bought reads as a founder buying a chart. */
  mercenaryTrustDrag: 14,
  /** Incentivised share of users below which nobody minds the rewards programme. Matches the §53
   *  warning's own floor so the game tells one story in two places. */
  mercenaryShareFloor: 0.25,
  /** Founder vested-unsold tokens as a share of the FLOAT above which sell-pressure fear sets in.
   *  Vested, not granted: tokens behind the cliff cannot hit the market, and the forums count the
   *  weeks to your cliff (launch.ts already says so). */
  overhangFloatFloor: 0.12,
  /** Points off the trust target when the founder's sellable position IS the float. */
  overhangTrustDrag: 10,
  /** Points off the trust target at full decentralisation demand under a founder at full
   *  influence. THE `founderInfluence` READ: the same unmet demand under a founder who already
   *  handed over control costs nothing, because there is nothing left to demand. */
  centralisationTrustDrag: 14,

  // --- crash shocks, and the resilience trade (§35: decentralisation buys network resilience) ---
  /** Points of trust shock per unit of negative momentum, before the resilience factor. */
  crashTrustGain: 10,
  /** The resilience factor at founderInfluence 0 and 100. A centralised network AMPLIFIES a trust
   *  shock (everyone watches the founder, and the founder was the story); a decentralised one
   *  absorbs it. Reads INFLUENCE, not decentralisation — influence lags the handover by design
   *  (§34), so giving control away protects you only once the community believes it. */
  resilienceAmpMin: 0.5,
  resilienceAmpMax: 1.5,

  // --- decentralisation demand (§33: "excessive centralisation"; §38: community pressure) ---
  /** Demand target floor — some holders always want more say. */
  demandBase: 12,
  /** Points of demand target per point `founderInfluence` exceeds `trust`. The type's own comment
   *  ("rises when founderInfluence outruns trust"), finally implemented. */
  demandGapGain: 0.9,
  demandReversion: 0.08,

  // --- what the mood is worth: the founder-feel channels ---
  /** Trust level at which the community neither grows nor shrinks the targets below — the pivot,
   *  so a healthy community is a mild tailwind and a betrayed one is a real cost. */
  trustNeutral: 0.55,
  /** Members target scale = 1 + span × (trust/100 − trustNeutral). Community growth is organic
   *  growth in the population that holders, engagement and depth are all built from. */
  membersTrustSpan: 0.8,
  /** Depth target scale, same shape. Depth is 45% of the liquidity discount's market quality —
   *  this is the channel that makes trust reach the founder's own arithmetic. */
  depthTrustSpan: 0.5,

  // --- exodus (§43's community revolt, as a PROCESS rather than an event roll) ---
  /** Trust below this and holders start leaving. Strictly above 0 so the floor is never where the
   *  process starts; strictly below launch-day trust so no launch begins inside one. */
  exodusTrustFloor: 30,
  /** Share of holders leaving per week at trust 0. Severity scales linearly up from the floor. */
  exodusRateMax: 0.12,
  /** Float-fraction of sell pressure at full severity — the departing holders sell on the way
   *  out, through the SAME supply-pressure coefficient every other release pays. */
  exodusSellFloatPct: 0.012,
  /** Points of engagement shock at full severity, saturating like every other shock. */
  exodusEngagementShock: 6,
  exodusInboxCooldownWeeks: 8,

  // --- who was seen selling (treasury.ts, gated on `tokenCommunity`) ---
  /** Confidence-cost multiplier on a treasury sale at founderInfluence 0 and 100. A sale by a
   *  treasury the community effectively governs reads as their decision; a founder-controlled
   *  treasury dumping into its own float reads as the boss cashing out. */
  saleInfluenceCostMin: 0.6,
  saleInfluenceCostMax: 1.4,

  // --- community pressure (§38) ---
  pressureDemand: 70,
  pressureInfluence: 60,
  pressureCooldownWeeks: 12,
} as const

// ---------- governance (Slice 6) ----------

/**
 * Proposals and votes. Brief §36–§38, §43, §69; docs/ico-architecture.md §7.9.
 *
 * THE GATE THIS BLOCK EXISTS TO HONOUR, from the slice plan: votes resolve FROM STATE, never
 * randomly. Nothing in governance.ts draws — a proposal is tabled when the state's own need for it
 * crosses a threshold, its support is a pure function of the community state §37 lists (sentiment,
 * proposal utility, founder influence, holder composition, recent token performance, trust,
 * decentralisation), and the vote at the close is that function's value that week. Two founders in
 * identical states get identical votes; the way to change a vote is to change the state.
 *
 * THE SECOND RULE: OUTCOMES BIND. A passed vote is not a mood — it holds a floor under part of the
 * weekly incentive budget, freezes treasury sales, or hands over control (monotone, §35). The
 * founder's surface is comply (the default — mandates enforce themselves), campaign (a public
 * position, priced in energy and reputation, that shifts the tally from the next week), or defy a
 * standing mandate (priced in trust, reputation and legitimacy — every later vote remembers).
 */
export const TOKEN_GOVERNANCE = {
  // --- cadence (§36: "keep frequency low, only major issues") ---
  /** Weeks a tabled proposal stays open before the vote closes (§69's countdown). */
  votingWeeks: 4,
  /** No new proposal inside this many weeks of the last one being tabled. */
  proposalCooldownWeeks: 10,
  /** The same argument is not re-tabled inside this window, whichever way it went. */
  typeCooldownWeeks: 24,
  /** 0–1 need below which nothing is worth the community's meeting. */
  tablingNeedFloor: 0.5,
  /** Support at the close required to pass. Above 50 so a shrug never binds anyone. */
  passBar: 55,
  /** The no-confidence bar is higher: removing a founder takes a majority with conviction. */
  removalPassBar: 62,

  // --- the support function (§37's list, weighted) ---
  /** Support starts at needBase + needGain × need: the proposal's utility is the dominant term. */
  needBase: 30,
  needGain: 40,
  /** Points of support per unit of sentiment deviation (±1), signed by the proposal's stance:
   *  a happy crowd funds ambition and keeps its founder; a sour one reaches for restraint. */
  moodGain: 12,
  hostileMoodGain: 16,
  /** Recent token performance (momentum, tanh-squashed ±1). A falling chart radicalises. */
  perfGain: 8,
  hostilePerfGain: 10,
  /** Holder composition: holder-heavy communities protect the float (restraint ↑, spending ↓);
   *  member-heavy ones vote for programmes. Signed by stance, centred at half holders. */
  holderGain: 8,
  /** Points of support, on EVERY proposal, at maxDefiances torn-up mandates. A founder who
   *  ignores votes makes every next vote angrier — §43's "governance legitimacy weak". */
  legitimacyGain: 10,
  maxDefiances: 3,
  /** The founder's word, at full influence and full trust. Influence is the megaphone and trust is
   *  whether anyone believes it — a distrusted founder campaigning against a proposal moves
   *  almost nothing. Endorsement is worth swaySupportRatio of opposition. */
  swayMax: 18,
  swaySupportRatio: 0.6,
  swayTrustFloor: 0.3,
  /** Turnout scales how far the tally deviates from 50: a disengaged community cannot organise a
   *  majority either way, and a decentralised one's votes are decisive (§37's decentralisation
   *  level, as legitimacy rather than as a direction). */
  turnoutEngagementBase: 0.55,
  turnoutEngagementSpan: 0.55,
  turnoutDecentralisationBase: 0.75,
  turnoutDecentralisationSpan: 0.5,
  turnoutMin: 0.35,
  turnoutMax: 1.3,

  // --- what the needs read ---
  /** Treasury share of total supply at which "there is something to give" saturates. */
  treasuryRichFloor: 0.08,

  // --- what a passed vote binds ---
  /** ecosystem_initiative → developer_grants floor (§38: "demanding more ecosystem grants"). */
  grantFloorShare: 0.25,
  /** treasury_allocation → community_treasury floor: funds the community actually controls. */
  communityFloorShare: 0.2,
  /** expansion_subsidy → partnerships floor (§36's "international expansion subsidy"). */
  expansionFloorShare: 0.15,
  mandateWeeks: 16,
  expansionMandateWeeks: 12,
  /** protocol_change: treasury sales freeze outright — saleFactor 0 — for this long. */
  saleFreezeWeeks: 16,
  /** decentralisation: points of control handed over on a pass. Monotone, §35 — this is the one
   *  outcome that cannot be defied, because control given away is not taken back. */
  decentralisationStep: 12,
  decentralisationRelief: 25,

  // --- the founder's surface, priced ---
  campaignEnergyCost: 4,
  endorseEnergyCost: 2,
  campaignReputationCost: 2,
  defyEnergyCost: 8,
  defyReputationCost: 5,
  /** Tearing up a passed vote is the loudest possible statement about whose network this is. */
  defyTrustCost: 12,
  defyDemandSpike: 15,

  // --- the ouster (§43's revolt terminus; architecture §7.9). Rare, and telegraphed twice. ---
  /** ALL preconditions must hold for heat to build: trust below this… */
  removalTrustCeiling: 25,
  /** …influence at or above this (there is a founder to remove)… */
  removalInfluenceFloor: 60,
  /** …and legitimacy already broken: at least one defiance, or an exodus inside this window. */
  removalExodusWindowWeeks: 12,
  /** Heat builds 1/wk while all preconditions hold and decays 2/wk when any lapses, so recovery
   *  is always faster than the descent. Warning at 4, tabled at 8, vote 4 weeks later: a founder
   *  gets ~12 weeks of explicit warnings on top of the exodus and pressure messages already firing
   *  in this territory. */
  removalHeatMax: 10,
  removalHeatBuild: 1,
  removalHeatDecay: 2,
  removalWarnAt: 4,
  removalHeatTabling: 8,
  warnCooldownWeeks: 6,
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
