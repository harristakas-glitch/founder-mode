// Tokenisation — the `network` ending. Slice 7.
//
// docs/ico-architecture.md §1.4, brief §44. One new `GameOver['type']`, five `TokenEndingKind`
// faces, one gate, one payout.
//
// ---------------------------------------------------------------------------------------------
// THE TWO THINGS THIS FILE HAD TO GET RIGHT, BOTH OF THEM MEASURED FIRST
//
// 1. **A gate a run reaches.** §1.4 gated on `networkValue >= $1B`. Measured over 24 seeds × 6
//    sectors × 4 token arms (`npx tsx test/token-balance-probe.ts reach`), the p99 of the best
//    sector is $836M and the p50 is $7.6M–$32.5M: that gate fires in **zero of ~450 runs**. It is
//    the IPO's defect (zero IPO endings in ~9,000 Career runs) rebuilt in a new subsystem. The
//    value bar therefore comes down to `TOKEN_ENDINGS.networkValue`, and the two §1.4 clauses that
//    stop a bubble ringing the bell stay verbatim and gain three more — see TOKEN_ENDINGS.
//
// 2. **A payout that is not ceremony.** §1.4 specified `founderStanding(s)` at 1.0×, which
//    `docs/balance-deep-dive.md` priced at **$0.00**: it is character-for-character what a
//    still-trading token run already scores, so the ending would change no number in any sector.
//    The premium is `networkExitPremium` in scoring.ts — the exit-impact haircut coming off the
//    liquidity discount, on the token leg only, because the gate IS the statement that a block sale
//    is no longer the constraint. Its measured size is in the slice report, not asserted here.
//
// ---------------------------------------------------------------------------------------------
// DETERMINISM AND STATE
//
// Nothing here draws and nothing here stores. The sustain window is read back off `t.series`, which
// the tick already writes one row per week — so "held for six weeks" cannot desync from the clock,
// survives a reload exactly, and needs no counter that a later slice could forget to reset. Same
// rule `founderVestedTokens` and `pendingUnlock` follow.

import { valuation } from '../engine'
import { hasCapability } from '../modes'
import type { GameState } from '../types'
import { networkValue } from './scoring'
import { TOKEN_ENDINGS, type TokenEndingKind, type TokenSeriesPoint, type TokenState } from './types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Is the ending system live for this run? Rides Slice 7's capability, per the rollout ratchet. */
export function tokenEndingsActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenNarrative')
}

// ---------- the clauses, one at a time, each with its own progress ----------

export interface EndingClause {
  id: 'network_value' | 'utility' | 'organic_share' | 'network_over_company' | 'trust' | 'sustained' | 'age'
  /** One sentence, quoting this run's own numbers — the §1 rule eligibility.ts already follows. */
  label: string
  met: boolean
  /** 0–1 how close this clause is. Never a raw score. */
  progress: number
}

export interface NetworkEndingProgress {
  /** True when every clause is met and the run can be ended this week. */
  reached: boolean
  /** Which face the ending wears, decided even when `reached` is false so the UI can preview it. */
  kind: TokenEndingKind
  clauses: EndingClause[]
  /** 0–1 mean of the clause progresses — the "how close am I" readout. */
  readiness: number
  /** Consecutive weeks (including this one) the three value clauses have held. */
  sustainedWeeks: number
}

/** The three clauses a PAST week can be judged on, recomputed from a `series` row. */
function seriesClausesHold(p: TokenSeriesPoint): boolean {
  const users = Math.max(0, p.organicUsers) + Math.max(0, p.incentivisedUsers)
  const organic = users > 0 ? clamp01(p.organicUsers / users) : 1
  return (
    p.price * p.circulating >= TOKEN_ENDINGS.networkValue &&
    p.utility >= TOKEN_ENDINGS.minUtility &&
    organic >= TOKEN_ENDINGS.minOrganicShare
  )
}

/**
 * How many consecutive weeks up to and including the last recorded one have held all three value
 * clauses. Walks `series` backwards and stops at the first week that fails OR at the first gap in
 * the week numbers — a run whose series has a hole did not hold anything across it.
 */
export function sustainedNetworkWeeks(t: TokenState): number {
  const series = t.series
  if (!Array.isArray(series) || series.length === 0) return 0
  let held = 0
  let expected = series[series.length - 1]?.week
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i]
    if (!p || p.week !== expected) break
    if (!seriesClausesHold(p)) break
    held++
    expected = p.week - 1
  }
  return held
}

/**
 * The gate, as a readable object. Pure — the panel shows exactly what the engine checks, which is
 * §47's rule ("never silently hide why a control is dark") applied to an ending.
 */
export function networkEndingProgress(s: GameState): NetworkEndingProgress {
  const t = s.token
  const empty: NetworkEndingProgress = { reached: false, kind: 'self_sustaining_protocol', clauses: [], readiness: 0, sustainedWeeks: 0 }
  if (!t || !tokenEndingsActive(s)) return empty

  const nv = networkValue(s)
  const ev = Math.max(0, valuation(s))
  const users = Math.max(0, Math.round(s.users))
  const organic = users > 0 ? clamp01(Math.max(0, t.users.organic) / users) : 1
  const sustained = sustainedNetworkWeeks(t)
  const age = s.week - t.launchWeek

  const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n / 1000)}k`)
  const clauses: EndingClause[] = [
    {
      id: 'network_value',
      label: `The network is worth ${money(nv)} — it needs ${money(TOKEN_ENDINGS.networkValue)}`,
      met: nv >= TOKEN_ENDINGS.networkValue,
      progress: clamp01(nv / TOKEN_ENDINGS.networkValue),
    },
    {
      id: 'utility',
      label: `Real utility is ${Math.round(t.market.utility)}/100 — it needs ${TOKEN_ENDINGS.minUtility}. A bubble does not count as a network`,
      met: t.market.utility >= TOKEN_ENDINGS.minUtility,
      progress: clamp01(t.market.utility / TOKEN_ENDINGS.minUtility),
    },
    {
      id: 'organic_share',
      label: `${Math.round(organic * 100)}% of your users arrived on their own — it needs ${Math.round(TOKEN_ENDINGS.minOrganicShare * 100)}%. Rented growth is not a network either`,
      met: organic >= TOKEN_ENDINGS.minOrganicShare,
      progress: clamp01(organic / TOKEN_ENDINGS.minOrganicShare),
    },
    {
      id: 'network_over_company',
      label: `The network is worth ${ev > 0 ? `${(nv / ev).toFixed(1)}×` : '—'} the company — it needs ${TOKEN_ENDINGS.minNetworkToEnterprise}×. This is a network ending, so the network has to be what happened`,
      met: nv >= ev * TOKEN_ENDINGS.minNetworkToEnterprise,
      progress: ev > 0 ? clamp01(nv / (ev * TOKEN_ENDINGS.minNetworkToEnterprise)) : 1,
    },
    {
      id: 'trust',
      label: `Community trust is ${Math.round(t.community.trust)}/100 — it needs ${TOKEN_ENDINGS.minTrust}. A community that has written you off does not hand you a success state`,
      met: t.community.trust >= TOKEN_ENDINGS.minTrust,
      progress: clamp01(t.community.trust / TOKEN_ENDINGS.minTrust),
    },
    {
      id: 'sustained',
      label: `Held for ${sustained} straight weeks — it needs ${TOKEN_ENDINGS.sustainWeeks}. One good print is a spike, not a state`,
      met: sustained >= TOKEN_ENDINGS.sustainWeeks,
      progress: clamp01(sustained / TOKEN_ENDINGS.sustainWeeks),
    },
    {
      id: 'age',
      label: `${Math.max(0, age)} weeks since launch — it needs ${TOKEN_ENDINGS.minWeeksSinceLaunch}`,
      met: age >= TOKEN_ENDINGS.minWeeksSinceLaunch,
      progress: clamp01(age / TOKEN_ENDINGS.minWeeksSinceLaunch),
    },
  ]

  return {
    reached: clauses.every((c) => c.met),
    kind: tokenEndingKind(s),
    clauses,
    readiness: clauses.reduce((a, c) => a + c.progress, 0) / clauses.length,
    sustainedWeeks: sustained,
  }
}

/** The one boolean the engine reads. */
export function networkEndingReached(s: GameState): boolean {
  return networkEndingProgress(s).reached
}

// ---------- which of §44's five success states this was ----------

/**
 * Brief §44 lists five success states; §1.4 resolved them into ONE `GameOver` type with five faces,
 * because five ending types would mean five entries in `theme.ts`, `store.ts`, `Career.tsx`,
 * `sound.ts` and the leaderboard whitelist for four cosmetic variants of the same dollar score.
 *
 * Ordered, first match wins, and each test is a genuinely different fact about the run rather than
 * a band of the same one: the value, then what the founder did with control, then how far the
 * network outgrew the company, then how large and how convinced the community is.
 */
export function tokenEndingKind(s: GameState): TokenEndingKind {
  const t = s.token
  if (!t) return 'self_sustaining_protocol'
  const nv = networkValue(s)
  const ev = Math.max(1, valuation(s))
  if (nv >= TOKEN_ENDINGS.unicornValue) return 'network_unicorn'
  if (
    t.community.decentralisation >= TOKEN_ENDINGS.decentralisedMinDecentralisation &&
    t.community.founderInfluence <= TOKEN_ENDINGS.decentralisedMaxInfluence
  )
    return 'founder_decentralised'
  if (nv >= ev * TOKEN_ENDINGS.categoryProtocolRatio) return 'category_protocol'
  if (t.community.trust >= TOKEN_ENDINGS.communityMinTrust && t.community.holders >= TOKEN_ENDINGS.communityMinHolders)
    return 'community_network'
  return 'self_sustaining_protocol'
}

/** How each face is told. `name` is the compact label; `line` is the ending screen's sentence. */
export const TOKEN_ENDING_FACES: Record<TokenEndingKind, { name: string; line: string }> = {
  network_unicorn: {
    name: 'Network unicorn',
    line: 'A billion dollars of network, and not one dollar of it is a valuation somebody put on a pitch deck. The market decided this, continuously, in public.',
  },
  category_protocol: {
    name: 'Category protocol',
    line: 'The network is worth several times the company that started it. What you built stopped being a product with a token and became the thing other people build on.',
  },
  community_network: {
    name: 'Community network',
    line: 'Thousands of holders who still trust you after everything the chart did to them. The community is not your user base — it is the institution.',
  },
  founder_decentralised: {
    name: 'Handed over',
    line: 'You gave away control before anyone forced you to, and the network kept working without you holding it together. That is the version of this ending nobody has to be talked into.',
  },
  self_sustaining_protocol: {
    name: 'Self-sustaining protocol',
    line: 'Real utility, organic users, a market deep enough to stand on its own. It does not need the next raise, the next press cycle, or you.',
  },
}
