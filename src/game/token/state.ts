// Tokenisation — the capital path, and the state that IS the path. Slice 1.
//
// Brief §4 and docs/ico-architecture.md §2.
//
// ABSENCE IS `institutional`. There is deliberately no `capitalPath` field on GameState: a save
// written before this feature has no token slice, and that is exactly what the traditional path
// looks like, so brief §74 ("existing games default to institutional") is satisfied with zero
// migration writes rather than with a back-fill that could fail. Everything reads the path through
// `capitalPath(s)`; two ways to say the same thing is one way to desync.
//
// CREATED WHOLE, ONCE. `createTokenState` returns every sub-object present. Optionality lives at
// exactly one level — `GameState.token` — so no consumer ever writes `s.token?.market?.price ?? 0`.
// Sub-slices a later phase owns (incentives, governance) are present and empty.

import { hasCapability, type CapabilityKey } from '../modes'
import type { GameState } from '../types'
import {
  TOKEN_INCENTIVES,
  TOKEN_STATE_VERSION,
  type CapitalPath,
  type TokenLaunchPlan,
  type TokenState,
  type TokenUtilityModel,
} from './types'

/** Every switch that means "some part of the token subsystem is live for this run". */
export const TOKEN_CAPABILITY_KEYS: CapabilityKey[] = [
  'tokenisation',
  'tokenEconomy',
  'tokenUserComposition',
  'tokenIncentives',
  'tokenCommunity',
  'tokenGovernance',
  'tokenNarrative',
]

/**
 * Brief §4. `community` once a token launched, `institutional` otherwise — including on every save
 * that predates this feature, which is the point.
 */
export function capitalPath(s: GameState | null | undefined): CapitalPath {
  return s?.token?.capitalPath ?? 'institutional'
}

/**
 * Is the token subsystem running for this run?
 *
 * This is the gate docs/ico-architecture.md §3.2 requires around any weekly token work:
 *
 *     if (tokenActive(s)) seeded(s, () => tickToken(s))
 *
 * exactly as `livingWorldActive` gates `tickLivingWorld`. It is false when there is no slice OR
 * when no token capability is on, so a run without the feature draws zero times and the RNG stream
 * every daily challenge, Arena match and golden trace depends on is untouched.
 *
 * Slice 1 adds NO weekly tick — the fork needs none — so today this function has no call site
 * inside `advanceWeek`. Slice 2 is where it earns its keep, and it exists now so that slice has
 * nothing to invent.
 */
export function tokenActive(s: GameState | null | undefined): boolean {
  if (!s?.token) return false
  return TOKEN_CAPABILITY_KEYS.some((k) => hasCapability(s, k))
}

/** Is the fork on the table at all in this run? (The capability, not the eligibility.) */
export function tokenisationOffered(s: GameState | null | undefined): boolean {
  return hasCapability(s, 'tokenisation')
}

/** True once the fork has been taken. Irreversible for Phase 1 (brief §4). */
export function isTokenised(s: GameState | null | undefined): boolean {
  return capitalPath(s) === 'community'
}

// ---------- vesting (brief §23) ----------

/**
 * Cliff and duration per policy. Slice 4 owns the tokenomics screen that lets a player pick one;
 * Slice 1 needs the table because the vesting CLOCK STARTS AT THE LAUNCH WEEK, and that clock is
 * the mechanism that keeps early and late launches from collapsing into the same decision
 * (docs/ico-architecture.md §7.12 — see `launch.ts` for the full argument).
 */
export const VESTING_TERMS = {
  short: { cliffWeeks: 4, durationWeeks: 26 },
  standard: { cliffWeeks: 12, durationWeeks: 52 },
  long: { cliffWeeks: 26, durationWeeks: 104 },
} as const

// ---------- the primary utility model (brief §24, Slice 4) ----------

/**
 * 0.5–1. How well a utility model suits a sector. The sector's natural model scores 1.
 *
 * Lives here rather than in launch.ts because the weekly tick needs it and launch.ts imports
 * `valuation` from the engine — a module the tick must not pull in.
 */
export function utilityModelFitFor(sector: string, model: TokenUtilityModel): number {
  return TOKEN_INCENTIVES.utilityModelFit[sector]?.[model] ?? 0.7
}

/**
 * The multiplier the chosen model puts on EARNED utility, forever.
 *
 * The first cut of this slice applied the fit only to launch-day utility, and the probe caught it:
 * five models produced launch utilities of 12.7 down to 8.9 in devtools and then IDENTICAL utility
 * (36.4) and identical founder standing by week 60. Utility reverts at 6%/wk, so a launch-day
 * difference has a half-life of eleven weeks and §24's "each sector may have different
 * compatibility" was decoration for eighty of the run's hundred weeks.
 *
 * A permanent multiplier on the TARGET is the honest reading of §25 as well: utility "emerges from
 * actual product behaviour", and the model is precisely the question of how much of that behaviour
 * the token is in. A marketplace currency in a company with no marketplace is not a token anyone
 * needs, however good the product gets. It cannot be bought, cannot be changed after launch, and is
 * a multiplier on an earned quantity rather than an addition to it — so `fairValue` stays an anchor.
 */
export function utilityModelMultiplier(sector: string, model: TokenUtilityModel): number {
  const fit = utilityModelFitFor(sector, model)
  return (
    TOKEN_INCENTIVES.utilityFitMin +
    (TOKEN_INCENTIVES.utilityFitMax - TOKEN_INCENTIVES.utilityFitMin) * Math.min(1, Math.max(0, (fit - 0.5) / 0.5))
  )
}

// ---------- unlocks (brief §41, Slice 4) ----------

/**
 * Team, founder and partner tokens are `locked` at launch and released on the vesting schedule.
 * `splitSupply` below computes the same number the same way; this reads it back off the plan so an
 * unlock never has to trust a field the player's localStorage could have edited.
 */
export function lockedAtLaunch(t: TokenState): number {
  const a = t.plan.allocation
  return Math.round(t.plan.totalSupply * (a.team + a.founder + a.partners))
}

/** 0–1 of the locked allocation that the schedule says should be free by `week`. */
export function unlockedFraction(t: TokenState, week: number): number {
  const terms = VESTING_TERMS[t.plan.vesting] ?? VESTING_TERMS.standard
  const elapsed = week - t.launchWeek
  if (elapsed < terms.cliffWeeks) return 0
  return Math.min(1, Math.max(0, elapsed / terms.durationWeeks))
}

/**
 * Tokens that come out of `locked` this week — brief §41, and the vesting policy's price.
 *
 * This is AGGREGATE SUPPLY PRESSURE, never simulated wallets. It is also the reason vesting is a
 * real decision rather than a flavour text: `short` dumps the whole team allocation into the float
 * inside half a year, which dilutes `fairValue` (a per-token number) and pushes the price down
 * exactly when the founder's own cliff passes; `long` spreads the same tokens over two years and
 * most of them never reach the float inside a 104-week run at all.
 *
 * Derived from (week, plan, current locked) with no stored counter, so it cannot desync from the
 * clock and a reloaded save unlocks exactly what it should.
 */
export function pendingUnlock(t: TokenState, week: number): number {
  const atLaunch = lockedAtLaunch(t)
  const due = Math.round(atLaunch * unlockedFraction(t, week))
  const alreadyReleased = atLaunch - t.supply.locked
  return Math.max(0, Math.min(t.supply.locked, due - alreadyReleased))
}

// ---------- creation ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** How the launch splits the minted supply across the three buckets the invariant names. */
export interface LaunchSupplySplit {
  circulating: number
  treasury: number
  locked: number
}

/**
 * Allocation fractions → exact integer token counts that satisfy
 * `circulating + treasury + locked === total`.
 *
 * Community allocation is circulating from day one (it is distributed and sold into the community);
 * treasury is the company's; team, founder and partner allocations are `locked` and released by the
 * vesting schedule. Rounding remainder lands in the treasury so the identity is exact rather than
 * approximately true.
 */
export function splitSupply(total: number, plan: TokenLaunchPlan): LaunchSupplySplit {
  const circulating = Math.round(total * plan.allocation.community)
  const locked = Math.round(total * (plan.allocation.team + plan.allocation.founder + plan.allocation.partners))
  const treasury = total - circulating - locked
  return { circulating, treasury, locked }
}

/**
 * The launch itself, as state. Every sub-object present, market seeded with launch-consistent
 * values (a price of zero is absorbing, so it is never a valid starting point) and every system a
 * later slice owns present and empty.
 *
 * `rng` is accepted because the contract names it and because Slice 2's launch flavour will want
 * it; Slice 1 draws nothing, which is why a launch is reproducible from state alone. The call site
 * still wraps this in `seeded()`, so a slice that starts drawing does not have to revisit the
 * engine.
 */
export function createTokenState(
  plan: TokenLaunchPlan,
  s: GameState,
  opts: {
    /** 0–100, the token's real utility on day one. Low for an early launch (brief §76). */
    utility: number
    /** 0–100. High when utility is thin — an early launch is a story, not a product. */
    speculation: number
    /** 0–1 how much size the market absorbs without moving. */
    depth: number
    /** The community the token launched into (brief §54: not the customer list). */
    communityMembers: number
    /** 0–100. */
    communityStrength: number
    /** Tokens the founder was granted, from the allocation plan. */
    founderTokens: number
    /** Dollars the initial sale cleared. Recorded for the postmortem; the engine banks the cash. */
    saleProceeds: number
    saleTokens: number
    /**
     * Slice 4, brief §21–§23. What the community made of the tokenomics — the founder's share
     * against the share they expected, and the vesting policy. Absent means "exactly what was
     * expected", which is what the default plan is, so a launch that takes the defaults produces
     * the identical state Slice 1 produced.
     */
    trust?: number
    sentiment?: number
  },
  _rng?: () => number,
): TokenState {
  const supply = { total: plan.totalSupply, ...splitSupply(plan.totalSupply, plan) }
  const vesting = VESTING_TERMS[plan.vesting]
  const sentiment = clamp(opts.sentiment ?? 52 + opts.communityStrength * 0.25, 0, 100)
  const trust = clamp(opts.trust ?? 40 + opts.communityStrength * 0.3, 0, 100)

  return {
    version: TOKEN_STATE_VERSION,
    capitalPath: 'community',
    launchWeek: s.week,
    plan,
    supply,
    market: {
      price: plan.launchPrice,
      launchPrice: plan.launchPrice,
      // The EMA starts AT the price: momentum on week one is zero, so nothing reads a rally that
      // did not happen. Slice 2's speculative demand is a difference term against this anchor.
      emaPrice: plan.launchPrice,
      // Fair value starts at the price the sale cleared: the launch IS the market's first opinion.
      fairValue: plan.launchPrice,
      volatility: clamp(30 + opts.speculation * 0.35, 0, 100),
      speculation: clamp(opts.speculation, 0, 100),
      utility: clamp(opts.utility, 0, 100),
      depth: clamp(opts.depth, 0, 1),
      lastDemand: 0,
      lastSupplyPressure: 0,
    },
    community: {
      members: Math.max(0, Math.round(opts.communityMembers)),
      holders: Math.max(0, Math.round(opts.communityMembers * 0.6)),
      sentiment,
      trust,
      engagement: clamp(opts.communityStrength, 0, 100),
      decentralisationDemand: clamp(20 + (100 - plan.initialDecentralisation) * 0.2, 0, 100),
      decentralisation: clamp(plan.initialDecentralisation, 0, 100),
      founderInfluence: clamp(100 - plan.initialDecentralisation, 0, 100),
    },
    founder: {
      granted: Math.max(0, Math.round(opts.founderTokens)),
      // Nothing is vested at the cliff's start. `founderVestedTokens` in scoring.ts is the truth;
      // this field mirrors it and is rewritten wherever the state is touched.
      vested: 0,
      sold: 0,
      realisedProceeds: 0,
    },
    // Owned by Slice 6: present, empty, and no reader here creates it.
    incentives: [],
    treasurySales: { tokensSold: 0, proceeds: 0, lastSaleWeek: 0 },
    governance: { proposals: [], lastProposalWeek: s.week },
    // Authoritative only when detailedPMF is off (Career reads the cohorts). Every user at launch
    // is organic — nothing has been paid for yet.
    users: { organic: Math.max(0, Math.round(s.users)), incentivised: 0 },
    history: [
      {
        week: s.week,
        type: 'launch',
        importance: 100,
        metadata: {
          totalSupply: plan.totalSupply,
          launchPrice: plan.launchPrice,
          saleTokens: Math.round(opts.saleTokens),
          saleProceeds: Math.round(opts.saleProceeds),
          communityMembers: Math.round(opts.communityMembers),
          utilityModel: plan.utilityModel,
          vesting: plan.vesting,
          cliffWeeks: vesting.cliffWeeks,
          durationWeeks: vesting.durationWeeks,
        },
      },
    ],
    series: [
      {
        week: s.week,
        price: plan.launchPrice,
        circulating: supply.circulating,
        treasuryTokens: supply.treasury,
        utility: clamp(opts.utility, 0, 100),
        speculation: clamp(opts.speculation, 0, 100),
        sentiment,
        organicUsers: Math.max(0, Math.round(s.users)),
        incentivisedUsers: 0,
      },
    ],
    lastTickedWeek: s.week,
  }
}
