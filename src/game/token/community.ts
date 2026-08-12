// Tokenisation — the community as a counterparty. Slice 5.
//
// Brief §32–§35 and §38. docs/ico-architecture.md §4 loop E and §7.9.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// Slice 5 is the COST side of the token path, and the cost was measured missing. Before this file:
//
//   • `trust` reached exactly ONE term — engagement at weight 0.35, which reaches the liquidity
//     discount at weight 0.2. A maximum treasury sale's 14-point trust hit cost the founder about
//     one point of market quality, and then reverted away inside a quarter because nothing held
//     the target down.
//   • `founderInfluence` was written once at launch and never read OR written again. §34 promised
//     a value that "can decline through decentralisation"; it was a constant.
//   • `decentralisationDemand` was written at launch and only ever DECREASED (by the community-
//     treasury category). The type promised it "rises when founderInfluence outruns trust";
//     nothing raised it.
//
// So the community noticed everything and could do nothing about any of it. This file gives it a
// memory (the conduct ledger), a temper (crash shocks, amplified by centralisation), a voice
// (decentralisation demand and the §38 pressure message) and, at the floor, feet (the exodus).
//
// ---------------------------------------------------------------------------------------------
// THE ANCHOR RULE, RESTATED FOR TRUST
//
// Trust is PARTIALLY BUYABLE — the community-treasury category pays `communityTrustGain` for it —
// so trust must never reach `fairValue`, `utility` or any other fundamental anchor input. Every
// consequence in this file runs through the community's own BODY instead:
//
//   trust → members target      (organic community growth; members → holders → depth)
//   trust → depth target        (depth is 45% of the liquidity discount's market quality)
//   trust → exodus              (members/holders leave AND sell — supply pressure on the price)
//   trust → sentiment target    (already wired in Slice 2, weight 0.35 — kept, not duplicated)
//
// Depth and members are already reversion-governed levels with bounded targets; scaling the TARGET
// keeps the reversion the mechanism and the clamp decorative, per the standing contract.
//
// ---------------------------------------------------------------------------------------------
// EVERY REACTION HAS A RESTORING FORCE (the funding-climate lesson, applied five times)
//
//   • CONDUCT DRAGS sit on the trust TARGET, not on trust: stop selling, stop renting users, let
//     the memory window lapse, and the target recovers — trust follows at `sentimentReversion`.
//     Nothing ratchets, nothing accumulates, nothing is absorbing.
//   • CRASH SHOCKS saturate at the boundary (the same `saturatingAdd` the speculation shock uses)
//     and are one-off: momentum mean-reverts by construction, so the shock source dies out.
//   • DEMAND reverts toward a target set by the influence−trust gap; hand over control (or earn
//     trust) and the target falls, taking demand with it.
//   • INFLUENCE reverts toward (100 − decentralisation) at the contract's own rate. It never
//     jumps (§34), which is what makes the resilience factor a real trade: giving control away
//     protects you only once the community believes it.
//   • The EXODUS removes the people who would have left: each week's departure shrinks the base
//     the next is drawn from, and a recovering trust re-grows members through the ordinary
//     members target. The floor is somewhere you pass through, not somewhere you stay.
//
// ---------------------------------------------------------------------------------------------
// DETERMINISM: NOTHING IN THIS FILE DRAWS
//
// Every function is a pure read of state or a deterministic write computed from the tick's `prev`
// snapshot. `tickToken` keeps its fixed one-draw-per-week contract; a run with `tokenCommunity`
// off — or with no token slice — is byte-identical to the game before this slice.

import { hasCapability } from '../modes'
import type { GameState } from '../types'
import { VESTING_TERMS } from './state'
import { incentivisedUsers } from './users'
import {
  TOKEN_BOUNDS,
  TOKEN_COMMUNITY,
  TOKEN_INCENTIVES,
  TOKEN_LIMITS,
  type TokenState,
} from './types'
import type { IncentiveEffects } from './incentives'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t)

/** Move `current` a fraction of the way to `target` — the same reversion the tick uses. */
const approach = (current: number, target: number, rate: number) => current + (target - current) * clamp01(rate)

/** The saturating shock from tick.ts: full effect mid-range, nothing at the boundary it heads for. */
function saturatingAdd(current: number, delta: number, lo = 0, hi = 100): number {
  const span = hi - lo
  if (span <= 0) return current
  const headroom = delta > 0 ? (hi - current) / span : (current - lo) / span
  return current + delta * clamp01(headroom)
}

/** Is the community a live counterparty for this run? Both halves required, as every slice. */
export function communityActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenCommunity')
}

// ---------- the resilience trade (§35, loop E) ----------

/**
 * How hard a trust shock lands, 0.5–1.5, by who the network IS.
 *
 * Reads `founderInfluence`, never `decentralisation` directly: influence reverts toward
 * (100 − decentralisation) at 0.1/wk and never jumps, so control given away starts protecting you
 * about a quarter later — the community has to watch you not take it back. That lag is the reason
 * this reads the slow variable, and it is what makes decentralising BEFORE the crisis a strategy
 * and decentralising DURING one a gesture.
 */
export function resilienceFactor(founderInfluence: number): number {
  return lerp(TOKEN_COMMUNITY.resilienceAmpMin, TOKEN_COMMUNITY.resilienceAmpMax, clamp(founderInfluence, 0, 100) / 100)
}

// ---------- the conduct ledger (§33's list, priced) ----------

/** One line of the ledger: a named drag on the trust target, in points, with its evidence. */
export interface ConductDrag {
  id: 'treasury_sales' | 'mercenary_growth' | 'founder_overhang' | 'centralisation'
  /** Points currently subtracted from the trust target. ≥ 0. */
  points: number
  /** 0–1 how engaged this drag is, for bars and tests. */
  intensity: number
}

export interface CommunityConduct {
  /** 0–1 memory of the last treasury sale, fresh = 1. 0 when there has never been one. */
  saleMemory: number
  /** 0–1 incentivised share of the user base. */
  mercenaryShare: number
  /** Founder vested-unsold tokens as a share of circulating supply. */
  overhang: number
  /** 0–1: decentralisation demand × founder influence — how loudly control is being demanded
   *  from someone who actually still holds it. THE `founderInfluence` read. */
  unmetDemand: number
  drags: ConductDrag[]
  /** Total points off the trust target. ≥ 0, bounded by the four coefficients' sum. */
  totalDrag: number
}

/**
 * Founder tokens that could actually hit the market: vested and unsold, as a share of the float.
 *
 * Derived from (week, plan, granted, sold) with no stored counter — the same pure-function rule
 * `founderVestedTokens` follows, computed locally so the tick does not pull scoring.ts (and with
 * it the engine) into its import graph.
 */
export function founderOverhang(t: TokenState, week: number): number {
  const terms = VESTING_TERMS[t.plan.vesting] ?? VESTING_TERMS.standard
  const elapsed = week - t.launchWeek
  if (elapsed < terms.cliffWeeks) return 0
  const vestedUnsold = Math.max(0, (t.founder.granted - t.founder.sold) * clamp01(elapsed / terms.durationWeeks))
  return vestedUnsold / Math.max(1, t.supply.circulating)
}

/**
 * What the community currently holds against the founder. Pure, so the UI can show the ledger the
 * tick charges — the §47 rule ("do not silently hide it") applied to a cost instead of a button.
 *
 * Every drag is a DEVIATION-from-acceptable, floored at zero: clean conduct is a clean ledger, not
 * a credit. Trust is EARNED through the base target (decentralisation, sentiment, the community
 * treasury); this ledger only ever subtracts, which is what keeps the two sides legible.
 */
export function communityConduct(s: GameState): CommunityConduct {
  const t = s.token
  const empty: CommunityConduct = { saleMemory: 0, mercenaryShare: 0, overhang: 0, unmetDemand: 0, drags: [], totalDrag: 0 }
  if (!t) return empty

  // §33 "founder token sales" / "treasury spending": the community remembers who sold, linearly
  // fading over the same window the sale's own confidence cost uses.
  const since = s.week - t.treasurySales.lastSaleWeek
  const saleMemory = t.treasurySales.lastSaleWeek > 0 ? clamp01(1 - since / TOKEN_COMMUNITY.saleMemoryWeeks) : 0

  // §33 "broken promises", in the one currency this game can measure: growth that was bought and
  // called growth. Reads the same population the §53 warning reads.
  const users = Math.max(0, Math.round(s.users))
  const mercenaryShare = users > 0 ? clamp01(incentivisedUsers(s) / users) : 0
  const mercenaryExcess = clamp01(
    (mercenaryShare - TOKEN_COMMUNITY.mercenaryShareFloor) / (1 - TOKEN_COMMUNITY.mercenaryShareFloor),
  )

  // §22's sell-pressure fear, ongoing: a founder whose SELLABLE position is a large share of the
  // float is a supply overhang every holder prices. Behind the cliff this is zero — the forums
  // count the weeks, but fear of a locked bag is speculation's job, not trust's.
  const overhang = founderOverhang(t, s.week)
  const overhangExcess = clamp01((overhang - TOKEN_COMMUNITY.overhangFloatFloor) / (1 - TOKEN_COMMUNITY.overhangFloatFloor))

  // §33 "excessive centralisation" — and the read that makes `founderInfluence` a real value.
  // Demand for control costs trust only to the degree the founder still HOLDS the control being
  // demanded: the same demand against a decentralised network is a settled argument.
  const unmetDemand = clamp01(t.community.decentralisationDemand / 100) * clamp01(t.community.founderInfluence / 100)

  const drags: ConductDrag[] = [
    { id: 'treasury_sales', points: TOKEN_COMMUNITY.saleMemoryDrag * saleMemory, intensity: saleMemory },
    { id: 'mercenary_growth', points: TOKEN_COMMUNITY.mercenaryTrustDrag * mercenaryExcess, intensity: mercenaryExcess },
    { id: 'founder_overhang', points: TOKEN_COMMUNITY.overhangTrustDrag * overhangExcess, intensity: overhangExcess },
    { id: 'centralisation', points: TOKEN_COMMUNITY.centralisationTrustDrag * unmetDemand, intensity: unmetDemand },
  ]
  return {
    saleMemory,
    mercenaryShare,
    overhang,
    unmetDemand,
    drags,
    totalDrag: drags.reduce((a, d) => a + d.points, 0),
  }
}

// ---------- the trust target (the full Slice-5 model) ----------

/**
 * Where trust is heading this week. The Slice-4 base — decentralisation's concave benefit,
 * sentiment coupling, the community-treasury programme — MINUS the conduct ledger.
 *
 * Uses the exact constants incentives.ts uses for the base, so with a clean ledger this is the
 * identical target Slice 4 computed: turning `tokenCommunity` on does not re-price good conduct,
 * it prices bad conduct. `sentiment` and `decentralisation` are the tick's SNAPSHOT values —
 * nothing here reads a value the current tick wrote.
 */
export function communityTrustTarget(
  s: GameState,
  prev: { sentiment: number; decentralisation: number },
  communityStock: number,
): number {
  const d = clamp01(prev.decentralisation / 100)
  const base =
    TOKEN_INCENTIVES.trustBase +
    TOKEN_BOUNDS.decentralisationTrustGain * Math.sqrt(d) +
    TOKEN_INCENTIVES.trustSentimentWeight * prev.sentiment +
    TOKEN_INCENTIVES.communityTrustGain * clamp01(communityStock)
  return clamp(base - communityConduct(s).totalDrag, 0, 100)
}

// ---------- the modifiers the tick folds into its level targets ----------

/**
 * What the community's mood does to the week, computed BEFORE any write from the same snapshot the
 * tick uses. Neutral (all scales 1, all pressures 0) when the capability is off or there is no
 * token — which is what keeps the acceptance test byte-identical by construction.
 */
export interface CommunityModifiers {
  active: boolean
  /** Multiplies the members TARGET: a trusted network grows its community, a betrayed one starves it. */
  membersScale: number
  /** Multiplies the depth TARGET: market makers price counterparty risk too. */
  depthScale: number
  /** 0–1 share of holders leaving THIS week. Applied to members and holders after their reversion. */
  exodusFraction: number
  /** 0–1 how deep below the exodus floor trust sits. */
  exodusSeverity: number
  /** Float-fraction of sell pressure the departures create, handed to `priceStep` and charged at
   *  the same `supplyPressurePerFloatPct` every other release pays. */
  sellPressure: number
  /** Points of engagement shock this week (≥ 0, subtracted with saturation). */
  engagementShock: number
}

export const NEUTRAL_MODIFIERS: CommunityModifiers = {
  active: false,
  membersScale: 1,
  depthScale: 1,
  exodusFraction: 0,
  exodusSeverity: 0,
  sellPressure: 0,
  engagementShock: 0,
}

export function communityModifiers(s: GameState, prev: { trust: number }): CommunityModifiers {
  if (!communityActive(s)) return NEUTRAL_MODIFIERS
  const trust = clamp(prev.trust, 0, 100)

  // Pivoted at `trustNeutral`, so a typical healthy community (~55) changes nothing and the scale
  // is a consequence of moving trust, not a flat re-rating of every token run.
  const membersScale = Math.max(0.1, 1 + TOKEN_COMMUNITY.membersTrustSpan * (trust / 100 - TOKEN_COMMUNITY.trustNeutral))
  const depthScale = Math.max(0.1, 1 + TOKEN_COMMUNITY.depthTrustSpan * (trust / 100 - TOKEN_COMMUNITY.trustNeutral))

  // The exodus: a PROCESS, not an event roll. Severity scales linearly below the floor, so the
  // first week under it is a trickle and trust at zero is a rout — and recovering trust above the
  // floor stops it the same week, which is the player's brake being inside the loop (loop C.2).
  const exodusSeverity = clamp01((TOKEN_COMMUNITY.exodusTrustFloor - trust) / TOKEN_COMMUNITY.exodusTrustFloor)
  const exodusFraction = TOKEN_COMMUNITY.exodusRateMax * exodusSeverity
  return {
    active: true,
    membersScale,
    depthScale,
    exodusFraction,
    exodusSeverity,
    sellPressure: TOKEN_COMMUNITY.exodusSellFloatPct * exodusSeverity,
    engagementShock: TOKEN_COMMUNITY.exodusEngagementShock * exodusSeverity,
  }
}

// ---------- the weekly community step ----------

/** What the community decided this week, for tests and the probe. Nothing in-game reads it. */
export interface CommunityTickReport {
  ran: boolean
  trustTarget: number
  conduct: CommunityConduct
  crashShock: number
  resilience: number
  demandTarget: number
  exodus: boolean
}

export const COMMUNITY_IDLE: CommunityTickReport = {
  ran: false,
  trustTarget: 0,
  conduct: { saleMemory: 0, mercenaryShare: 0, overhang: 0, unmetDemand: 0, drags: [], totalDrag: 0 },
  crashShock: 0,
  resilience: 1,
  demandTarget: 0,
  exodus: false,
}

/**
 * The Slice-5 writes: trust, decentralisation demand, founder influence, and the exodus's
 * bookkeeping. Called from `tickToken` inside the `tokenCommunity` gate, AFTER the market levels
 * and the incentive-effects block, with the same `prev` snapshot the whole tick reads.
 *
 * Owns everything about trust from here on — the seam Slice 4 left ("Slice 5 owns everything else
 * about it — conduct, delivery, revolt") — including folding the community-treasury programme's
 * contribution into the full target, so there is ONE trust write per week, not two.
 */
export function tickCommunity(
  s: GameState,
  prev: {
    trust: number
    sentiment: number
    momentum: number
    decentralisation: number
    decentralisationDemand: number
    founderInfluence: number
  },
  effects: IncentiveEffects,
  mods: CommunityModifiers,
  communityStock: number,
): CommunityTickReport {
  const t = s.token
  if (!t || !communityActive(s)) return COMMUNITY_IDLE

  // ---- trust: revert toward the conduct-priced target, then take the week's shock ----
  const conduct = communityConduct(s)
  const target = communityTrustTarget(s, prev, communityStock)
  const resilience = resilienceFactor(prev.founderInfluence)
  // A crash is a trust event, not just a sentiment event (§33 "token performance") — and how hard
  // it lands is the §35 trade: the same red week costs a founder-run network triple what it costs
  // a community-run one. Momentum mean-reverts by construction, so the shock source dies out.
  const crashShock = TOKEN_COMMUNITY.crashTrustGain * Math.min(0, prev.momentum) * resilience
  t.community.trust = clamp(
    saturatingAdd(approach(prev.trust, target, TOKEN_BOUNDS.sentimentReversion), crashShock),
    0,
    100,
  )

  // ---- decentralisation demand: rises when influence outruns trust, settles when it stops ----
  const demandTarget = clamp(
    TOKEN_COMMUNITY.demandBase + TOKEN_COMMUNITY.demandGapGain * Math.max(0, prev.founderInfluence - prev.trust),
    0,
    100,
  )
  let demand = approach(prev.decentralisationDemand, demandTarget, TOKEN_COMMUNITY.demandReversion)
  // Slice 4's relief, moved here so there is one demand write: handing over control is what the
  // loudest holders were asking for.
  if (effects.decentralisation > 0) demand = saturatingAdd(demand, -effects.decentralisation * 1.5)
  t.community.decentralisationDemand = clamp(demand, 0, 100)

  // ---- founder influence: the contract's own reversion, finally running (§34, loop E) ----
  t.community.founderInfluence = clamp(
    approach(prev.founderInfluence, 100 - prev.decentralisation, TOKEN_BOUNDS.founderInfluenceReversion),
    0,
    100,
  )

  // ---- the exodus's ledger entries (the population cuts are folded into the tick's writes) ----
  const exodus = mods.exodusFraction > 0
  if (exodus) {
    const last = [...t.history].reverse().find((h) => h.type === 'crisis' && h.metadata.kind === 'exodus')
    if (!last || s.week - last.week >= TOKEN_COMMUNITY.exodusInboxCooldownWeeks) {
      t.history.push({
        week: s.week,
        type: 'crisis',
        importance: Math.min(100, Math.round(60 + 40 * mods.exodusSeverity)),
        metadata: {
          kind: 'exodus',
          trust: Math.round(prev.trust),
          severity: Math.round(mods.exodusSeverity * 100) / 100,
          members: t.community.members,
        },
      })
      s.inbox.unshift({
        id: `token-exodus-${s.week}`,
        week: s.week,
        kind: 'system',
        title: 'Holders are leaving',
        body:
          `Trust is at ${Math.round(prev.trust)} and the community is voting with its wallets: roughly ` +
          `${Math.round(mods.exodusFraction * 100)}% of holders left this week, and they sold on the way out. ` +
          `Departures thin the market — depth, engagement and the community itself all shrink, and every one of those ` +
          `is a number your own position is priced against.\n\n` +
          `This stops when the conduct stops. ` +
          (conduct.drags.filter((d) => d.points >= 1).length
            ? `What they hold against you right now: ${conduct.drags
                .filter((d) => d.points >= 1)
                .map((d) => CONDUCT_LABELS[d.id].toLowerCase())
                .join(', ')}.`
            : `Nothing specific is on the ledger — trust simply has not recovered yet.`),
      })
    }
  }

  // ---- §38: community pressure, before it becomes an exodus ----
  if (
    !exodus &&
    t.community.decentralisationDemand >= TOKEN_COMMUNITY.pressureDemand &&
    t.community.founderInfluence >= TOKEN_COMMUNITY.pressureInfluence
  ) {
    const last = [...t.history].reverse().find((h) => h.type === 'community_milestone' && h.metadata.kind === 'pressure')
    if (!last || s.week - last.week >= TOKEN_COMMUNITY.pressureCooldownWeeks) {
      t.history.push({
        week: s.week,
        type: 'community_milestone',
        importance: 45,
        metadata: {
          kind: 'pressure',
          demand: Math.round(t.community.decentralisationDemand),
          influence: Math.round(t.community.founderInfluence),
        },
      })
      s.inbox.unshift({
        id: `token-pressure-${s.week}`,
        week: s.week,
        kind: 'system',
        title: 'Community pressure',
        body:
          `Token holders are demanding more say. Decentralisation demand is at ` +
          `${Math.round(t.community.decentralisationDemand)} while you still hold ` +
          `${Math.round(t.community.founderInfluence)}% of the influence, and every week that gap stands open costs trust.\n\n` +
          `Funding the community treasury hands over control — permanently — and settles the argument. ` +
          `Ignoring it is also a choice, and the community is pricing it.`,
      })
    }
  }
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)

  return { ran: true, trustTarget: target, conduct, crashShock, resilience, demandTarget, exodus }
}

// ---------- readouts for the UI ----------

export const CONDUCT_LABELS: Record<ConductDrag['id'], string> = {
  treasury_sales: 'The treasury sold into the float',
  mercenary_growth: 'Growth is mostly bought',
  founder_overhang: 'Your sellable bag overhangs the float',
  centralisation: 'Control is being demanded, and you hold it',
}

/** Brief §9: words, not candles. One scale for every 0–100 community mood. */
export function moodLabel(v: number): string {
  if (v < 20) return 'Hostile'
  if (v < 35) return 'Uneasy'
  if (v < 50) return 'Wary'
  if (v < 65) return 'Steady'
  if (v < 80) return 'Strong'
  return 'Devoted'
}

/** Everything the community panel needs, in one call. */
export interface CommunityReadout {
  active: boolean
  members: number
  holders: number
  sentiment: number
  trust: number
  engagement: number
  decentralisation: number
  decentralisationDemand: number
  founderInfluence: number
  conduct: CommunityConduct
  resilience: number
  exodusSeverity: number
  /** Trust points to the exodus floor. Negative while an exodus is running. */
  trustHeadroom: number
}

export function communityReadout(s: GameState): CommunityReadout {
  const t = s.token
  const idle: CommunityReadout = {
    active: false,
    members: 0,
    holders: 0,
    sentiment: 0,
    trust: 0,
    engagement: 0,
    decentralisation: 0,
    decentralisationDemand: 0,
    founderInfluence: 0,
    conduct: COMMUNITY_IDLE.conduct,
    resilience: 1,
    exodusSeverity: 0,
    trustHeadroom: 0,
  }
  if (!t || !communityActive(s)) return idle
  const c = t.community
  return {
    active: true,
    members: c.members,
    holders: c.holders,
    sentiment: c.sentiment,
    trust: c.trust,
    engagement: c.engagement,
    decentralisation: c.decentralisation,
    decentralisationDemand: c.decentralisationDemand,
    founderInfluence: c.founderInfluence,
    conduct: communityConduct(s),
    resilience: resilienceFactor(c.founderInfluence),
    exodusSeverity: clamp01((TOKEN_COMMUNITY.exodusTrustFloor - c.trust) / TOKEN_COMMUNITY.exodusTrustFloor),
    trustHeadroom: c.trust - TOKEN_COMMUNITY.exodusTrustFloor,
  }
}
