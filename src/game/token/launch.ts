// Tokenisation — the launch decision and its terms. Slice 1.
//
// Brief §3 (the fork), §4 (irreversible), §6 (community capital), §76 (no universal correct
// timing), and docs/ico-architecture.md §7.7 and §7.12.
//
// ---------------------------------------------------------------------------------------------
// §7.12 — WHY AN EARLY LAUNCH IS NOT DOMINATED BY A LATE ONE
//
// The architect's finding: if the founder allocation is a fixed fraction of a supply fixed at
// launch, a later launch at a higher fair value dominates an earlier one on every axis, "no fixed
// optimal week" is decoration, and the Early Token bot loses by construction. The fix named in the
// contract is that COMMUNITY SIZE AT LAUNCH sets the supply scale.
//
// Building it exposed something the contract does not say, and it matters for Slice 8. A UNIFORM
// supply scale cancels out of the founder's score:
//
//     tokenLeg = founderFraction × totalSupply × price × discount
//     price    = networkValue / totalSupply
//     ⇒ tokenLeg = founderFraction × networkValue × discount        — totalSupply is gone
//
// So supply scale alone cannot carry §76. Three channels that do NOT cancel carry it instead, and
// all three are implemented here:
//
//   1. THE SALE CLEARS AGAINST THE COMMUNITY YOU HAVE. Supply is minted per community member, and
//      the launch price is capped by what that community can actually absorb. A small early
//      community mints a small float AND clears it at a depressed price, so an early launch is
//      genuinely worth less on day one. A large late community clears near the anchor.
//   2. THE FOUNDER'S SHARE IS SET BY WHO IS ON THE OTHER SIDE OF THE TABLE. A small community of
//      early believers concedes a larger founder allocation (22%); a large late one demands more
//      of the supply and leaves the founder 10%. This is the channel that survives the algebra —
//      it changes `founderFraction`, not the scale.
//   3. THE VESTING CLOCK STARTS AT THE LAUNCH WEEK. Tokenise at week 20 on a standard schedule and
//      you finish the run fully vested; tokenise at week 80 and the run ends with your position
//      still behind the cliff, worth zero to the score. See `founderVestedTokens` in scoring.ts.
//
// Against those, late launches keep the advantages brief §76 names: real utility, lower
// speculation, a deeper market (all of which raise the liquidity discount) and a materially bigger
// cheque. That is a trade, which is what §76 asked for.
//
// ---------------------------------------------------------------------------------------------
// §7.7 — THE SALE IS NOT A FREE BUFF
//
// The brief lists "Treasury capital ↑" as a Quick Play benefit with no matching cost, which would
// violate §75. Three bounds apply here, and the binding one is usually the second:
//
//   • the nominal sale, a share of the community allocation at the anchor price;
//   • FLOAT DEPTH — how many dollars the community you have can actually absorb;
//   • a hard ceiling at 20% of enterprise value, the share an equity round of the same stage
//     raises, so the sale can match the round it replaces on the median and never beat it.
//
// DETERMINISM: nothing in this file draws from the RNG stream. Launch terms are a pure function of
// state, so the preview the player is shown is exactly what they get. The engine still wraps the
// launch in `seeded()`, so a later slice that wants a roll does not have to revisit the call site.

import { valuation } from '../engine'
import type { GameState } from '../types'
import {
  communityMultiplier,
  communityStrength,
  launchCommunityMembers,
  tokenFit,
  tokenisationBars,
  tokenMarketAppetite,
} from './eligibility'
import { createTokenState, splitSupply, VESTING_TERMS } from './state'
import type { TokenAllocationPlan, TokenLaunchPlan, TokenState, TokenUtilityModel, VestingPolicy } from './types'
import { TOKEN_BOUNDS } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t)

/** Round to `sig` significant figures, so minted supplies read like tokenomics and not like noise. */
function roundSig(n: number, sig = 2): number {
  if (!Number.isFinite(n) || n === 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - (sig - 1))
  return Math.round(n / mag) * mag
}

export const LAUNCH_TERMS = {
  /** Tokens minted per community member at launch — the §7.12 scale rule, stated once. */
  tokensPerCommunityMember: 5_000,
  minSupply: 1_000_000,
  maxSupply: 10_000_000_000,
  /** Share of the community allocation actually sold at launch; the rest is distributed over time. */
  initialSaleShare: 0.35,
  /** The equity round the sale replaces raises ~20% of enterprise value. The sale may match it,
   *  never beat it (§7.7). */
  saleCeilingOfValuation: 0.2,
  /** Dollars a single community member will put in, at zero and at full community strength. */
  spendPerMemberMin: 120,
  spendPerMemberMax: 800,
  /** A community this many times its minimum viable size counts as fully "late". */
  latenessSpan: 60,
  /** The horizon a "late" launch is measured against — the capped Career/daily run length. */
  latenessHorizonWeeks: 104,
  /** Founder allocation: a small early community concedes more, a large late one less. */
  founderShareEarly: 0.22,
  founderShareLate: 0.1,
  /** Community allocation moves the other way. */
  communityShareEarly: 0.34,
  communityShareLate: 0.5,
  teamShare: 0.12,
  partnerShare: 0.05,
} as const

// ---------- how late is this launch? ----------

/**
 * 0–1. How late in the company's life this launch is, from the community's point of view — which
 * is what decides how hard a bargain the community can drive on the allocation.
 *
 * Two halves, because neither alone is honest:
 *
 *   • SIZE, against the smallest community that could have launched at all. Mode- and
 *     sector-relative by construction, since the floor it divides by is.
 *   • ELAPSED WEEKS, against the run's horizon. Career user counts grow slowly — measured, a SaaS
 *     company goes from 333 accounts at week 40 to 451 at week 80 — so a size-only measure barely
 *     moves inside a run and §76's early-vs-late question would have no lever at all. A community
 *     that has been around for sixty weeks has standing that a month-old one does not.
 */
export function launchLateness(s: GameState): number {
  const bars = tokenisationBars(s)
  const floorMembers = Math.max(1, bars.minUsers * communityMultiplier(s))
  const members = Math.max(1, launchCommunityMembers(s))
  const bySize = clamp01(Math.log(members / floorMembers) / Math.log(LAUNCH_TERMS.latenessSpan))
  const byAge = clamp01((s.week - bars.minWeek) / Math.max(1, LAUNCH_TERMS.latenessHorizonWeeks - bars.minWeek))
  return clamp01(0.5 * bySize + 0.5 * byAge)
}

// ---------- the plan ----------

/**
 * The allocation the community would accept from this company today (brief §21).
 *
 * Slice 4 owns the tokenomics screen that lets the player move these. Slice 1 derives them,
 * because the founder-share band is one of the three channels that make §76 true and it cannot
 * wait three slices without the balance argument being untestable.
 */
export function defaultAllocation(s: GameState): TokenAllocationPlan {
  const lateness = launchLateness(s)
  const founder = lerp(LAUNCH_TERMS.founderShareEarly, LAUNCH_TERMS.founderShareLate, lateness)
  const community = lerp(LAUNCH_TERMS.communityShareEarly, LAUNCH_TERMS.communityShareLate, lateness)
  const treasury = 1 - founder - community - LAUNCH_TERMS.teamShare - LAUNCH_TERMS.partnerShare
  return {
    community: round4(community),
    treasury: round4(treasury),
    team: LAUNCH_TERMS.teamShare,
    founder: round4(founder),
    partners: LAUNCH_TERMS.partnerShare,
  }
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** Every field of the plan a player could set, before the derived terms are resolved. */
export interface LaunchDraft {
  allocation?: TokenAllocationPlan
  vesting?: VestingPolicy
  utilityModel?: TokenUtilityModel
  initialDecentralisation?: number
}

/** The utility model this company's product most naturally supports (brief §24). */
export function defaultUtilityModel(s: GameState): TokenUtilityModel {
  switch (s.sector) {
    case 'devtools':
      return 'ecosystem_incentive'
    case 'social':
      return 'rewards'
    case 'fintech':
      return 'marketplace_currency'
    case 'ecommerce':
      return 'rewards'
    case 'saas':
      return 'product_access'
  }
}

export interface LaunchTerms {
  plan: TokenLaunchPlan
  /** Dollars the initial sale clears, after all three bounds in §7.7. */
  saleProceeds: number
  saleTokens: number
  /** What the whole network is worth at the launch price. */
  networkValue: number
  /** The unbounded ask, so the UI can show what float depth cost you. */
  nominalProceeds: number
  /** Which of the three bounds actually bit. */
  boundBy: 'nominal' | 'float_depth' | 'valuation_ceiling'
  communityMembers: number
  communityStrength: number
  lateness: number
  utility: number
  speculation: number
  depth: number
  founderTokens: number
  cliffWeeks: number
  durationWeeks: number
}

/**
 * Everything the launch would produce, as a pure function of state. Shown to the player before
 * they confirm (§3) and used verbatim by `launchToken`, so the preview cannot lie.
 */
export function resolveLaunchTerms(s: GameState, draft: LaunchDraft = {}): LaunchTerms {
  const allocation = draft.allocation ?? defaultAllocation(s)
  const vesting = draft.vesting ?? 'standard'
  const utilityModel = draft.utilityModel ?? defaultUtilityModel(s)
  const initialDecentralisation = clamp(draft.initialDecentralisation ?? 25, 0, 100)

  const members = launchCommunityMembers(s)
  const strength = communityStrength(s)
  const lateness = launchLateness(s)
  const fit = tokenFit(s)

  // (1) Supply scale is set by the community at launch — the contract's §7.12 rule.
  const totalSupply = clamp(
    roundSig(Math.max(1, members) * LAUNCH_TERMS.tokensPerCommunityMember, 2),
    LAUNCH_TERMS.minSupply,
    LAUNCH_TERMS.maxSupply,
  )

  // (2) The anchor: what a token market would put on this network. Enterprise value, scaled by how
  //     well the sector/seed/strategy actually support a token. It is NOT added to valuation()
  //     anywhere — see scoring.ts.
  const enterprise = valuation(s)
  const anchor = enterprise * (0.5 + 0.8 * fit)
  const anchorPrice = anchor / totalSupply

  // (3) The sale, and the three bounds of §7.7.
  const saleTokens = Math.round(totalSupply * allocation.community * LAUNCH_TERMS.initialSaleShare)
  const nominalProceeds = saleTokens * anchorPrice
  const perMember = lerp(LAUNCH_TERMS.spendPerMemberMin, LAUNCH_TERMS.spendPerMemberMax, strength / 100) * (0.6 + 0.4 * fit)
  const floatDepth = members * perMember
  const valuationCeiling = enterprise * LAUNCH_TERMS.saleCeilingOfValuation

  const saleProceeds = Math.max(0, Math.min(nominalProceeds, floatDepth, valuationCeiling))
  const boundBy =
    saleProceeds >= nominalProceeds - 1 ? 'nominal' : floatDepth <= valuationCeiling ? 'float_depth' : 'valuation_ceiling'

  // The sale is what sets the price: it clears at what the community actually paid, not at what
  // the whitepaper asked for. A shallow community therefore launches a cheap token.
  const launchPrice = saleTokens > 0 ? Math.max(anchorPrice * TOKEN_BOUNDS.priceFloorFraction, saleProceeds / saleTokens) : anchorPrice

  // (4) Launch-day market character. Brief §76: early is hype with thin utility, late is
  //     fundamentals with less room to run.
  const product = clamp(s.features * 0.5 + s.quality * 0.5 - s.bugs * 0.6, 0, 100)
  const utility = clamp(5 + product * 0.2 + Math.min(s.week, 104) * 0.1, 0, 45)
  const speculation = clamp(78 - utility * 0.8 + tokenMarketAppetite(s) * 8, 0, 100)
  const depth = clamp(0.1 + 0.45 * (strength / 100) + 0.15 * lateness, 0, 1)

  const plan: TokenLaunchPlan = {
    allocation,
    vesting,
    utilityModel,
    initialDecentralisation,
    totalSupply,
    launchPrice,
  }
  const terms = VESTING_TERMS[vesting]

  return {
    plan,
    saleProceeds,
    saleTokens,
    networkValue: launchPrice * splitSupply(totalSupply, plan).circulating,
    nominalProceeds,
    boundBy,
    communityMembers: members,
    communityStrength: strength,
    lateness,
    utility,
    speculation,
    depth,
    founderTokens: Math.round(totalSupply * allocation.founder),
    cliffWeeks: terms.cliffWeeks,
    durationWeeks: terms.durationWeeks,
  }
}

/** Brief §20: the allocation must sum to 1 within `allocationEpsilon`, checked at LAUNCH. */
export function allocationValid(a: TokenAllocationPlan): boolean {
  const sum = a.community + a.treasury + a.team + a.founder + a.partners
  return (
    Math.abs(sum - 1) <= TOKEN_BOUNDS.allocationEpsilon &&
    [a.community, a.treasury, a.team, a.founder, a.partners].every((v) => Number.isFinite(v) && v >= 0)
  )
}

// ---------- the fork ----------

export interface LaunchResult {
  ok: boolean
  reason?: string
  terms?: LaunchTerms
  token?: TokenState
}

/**
 * Take the fork. Brief §3 and §4: irreversible, and the caller has already required an explicit
 * confirmation.
 *
 * Mutates `s` the way every other engine action does. What it does NOT do is remove anything the
 * founder already owns — brief §80: "existing capital/equity does not disappear". Cash stays,
 * equity stays, the board stays, debt stays. What closes is the FUTURE: institutional rounds and
 * the IPO (see restrictions.ts). Term sheets on the table evaporate, because the funds that wrote
 * them will not close into a token launch, and leaving them signable would be a way back.
 */
export function launchToken(s: GameState, draft: LaunchDraft = {}): LaunchResult {
  if (s.token) return { ok: false, reason: 'This company already launched a token.' }
  const terms = resolveLaunchTerms(s, draft)
  if (!allocationValid(terms.plan.allocation)) return { ok: false, reason: 'The allocation does not add up to 100%.' }
  if (terms.plan.totalSupply <= 0) return { ok: false, reason: 'There is no community to launch into.' }

  const token = createTokenState(
    terms.plan,
    s,
    {
      utility: terms.utility,
      speculation: terms.speculation,
      depth: terms.depth,
      communityMembers: terms.communityMembers,
      communityStrength: terms.communityStrength,
      founderTokens: terms.founderTokens,
      saleProceeds: terms.saleProceeds,
      saleTokens: terms.saleTokens,
    },
  )

  s.token = token
  s.cash += terms.saleProceeds
  // A token launch is the loudest week the company has had, and the institutional world reads it
  // as a founder who stopped taking their calls.
  s.hype = clamp(s.hype + 12, 0, 100)
  s.reputation = clamp(s.reputation - 3, 0, 100)
  s.energy = clamp(s.energy - 12, 0, 100)
  const abandoned = s.termSheets.length
  s.termSheets = []
  s.raiseCooldown = 0

  const dollars = (n: number) => `$${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`}`
  s.flash =
    `🪙 ${s.companyName} is a token network. The sale cleared ${dollars(terms.saleProceeds)} from ` +
    `${terms.communityMembers.toLocaleString()} holders. Institutional rounds and the IPO are closed — permanently.`
  s.inbox.unshift({
    id: `token-launch-${s.week}`,
    week: s.week,
    kind: 'system',
    title: `${s.companyName} launches its token`,
    body:
      `${roundSig(terms.plan.totalSupply, 2).toLocaleString()} tokens minted against a community of ` +
      `${terms.communityMembers.toLocaleString()}. The initial sale cleared ${dollars(terms.saleProceeds)} at ` +
      `$${terms.plan.launchPrice < 0.01 ? terms.plan.launchPrice.toExponential(2) : terms.plan.launchPrice.toFixed(4)} a token — ` +
      `${terms.boundBy === 'float_depth' ? 'the community absorbed everything it could, and that was the limit' : terms.boundBy === 'valuation_ceiling' ? 'capped at what an equity round of this size would have raised' : 'the book filled at the asking price'}. ` +
      `You hold ${(terms.plan.allocation.founder * 100).toFixed(0)}% of supply, vesting over ${terms.durationWeeks} weeks after a ` +
      `${terms.cliffWeeks}-week cliff. ` +
      (abandoned > 0 ? `${abandoned} term sheet${abandoned === 1 ? '' : 's'} came off the table within the hour. ` : '') +
      `There is no way back to the institutional path.`,
  })

  return { ok: true, terms, token }
}
