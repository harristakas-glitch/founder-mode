// Tokenisation — governance. Slice 6.
//
// Brief §36 (occasional votes, low frequency, major issues only), §37 (outcomes derive from state,
// "do not use pure random votes"), §38 (community pressure), §43 (community revolt), §69 (the UI
// contract); docs/ico-architecture.md §7.9 (a revolt that removes the founder IS `fired`).
//
// ---------------------------------------------------------------------------------------------
// THE GATE: VOTES RESOLVE FROM STATE, NEVER RANDOMLY
//
// Nothing in this file draws. Three consequences, each deliberate:
//
//   • A proposal is TABLED when the state's own need for it crosses a threshold — high
//     decentralisation demand tables a handover, a fresh treasury sale tables a sale freeze, an
//     under-funded ecosystem tables a grants mandate. Slice 5 computed the pressure; this file is
//     the mechanism that turns pressure into a question with a deadline.
//   • SUPPORT is a pure function of the community state §37 lists — sentiment, proposal utility,
//     founder influence, holder composition, recent token performance, trust, decentralisation —
//     recomputed every tick from the same `prev` snapshot the rest of the tick reads, and stored
//     on the proposal so the player watches the vote move as the state moves.
//   • The RESOLUTION at `closesWeek` is that function's value that week against a fixed bar. Two
//     founders in identical states get identical votes; the only way to change a vote is to
//     change the state it reads.
//
// ---------------------------------------------------------------------------------------------
// OUTCOMES BIND
//
// A passed vote is not a mood. It becomes a MANDATE: a floor under part of the weekly incentive
// budget (enforced inside `setIncentiveShares`, the one write, and re-asserted weekly here), a
// freeze on treasury sales (enforced inside `maxTreasurySale`), or an immediate, monotone handover
// of control. The founder's decision surface is:
//
//   COMPLY   — do nothing. Mandates enforce themselves; compliance is the default, not a chore.
//   CAMPAIGN — take a public position, once per proposal, priced in energy (and reputation when
//              opposing). It shifts the weekly tally from the NEXT tick through the influence ×
//              trust sway term. It never re-rolls a resolved vote.
//   DEFY     — tear up a standing mandate, priced in trust, reputation, energy and a
//              decentralisation-demand spike — and in LEGITIMACY: every later vote carries a
//              support term that remembers how many mandates you tore up. Defiance is also one of
//              the two gates on the no-confidence path, which is the price with the long tail.
//
// The ouster itself (§43's revolt terminus) routes to the existing `fired` ending, exactly as the
// architecture's §7.9 decided: the engine reads `founderRemovalPassed(s)` after the token tick and
// applies the board's own payout shape (equity leg halved, token position untouched). It is rare —
// trust under 25 AND influence over 60 AND legitimacy already broken, sustained for ~8 weeks
// before it is even tabled — and telegraphed twice by this file on top of the exodus and pressure
// messages Slice 5 already fires in that territory.
//
// ---------------------------------------------------------------------------------------------
// DETERMINISM AND THE IMPORT GRAPH
//
// No RNG, no clock. This file is called from inside `tickToken` and therefore must not pull
// engine.ts into the tick's import graph (the same constraint community.ts documents): it imports
// token-module files and modes.ts only. The one engine-side effect — ending the run — is exported
// as a pure read (`founderRemovalPassed`) that engine.ts polls after the tick, following exactly
// how the board's `fired` ending works. The cycle with incentives.ts (this file calls
// `setIncentiveShares` to materialise floors; incentives.ts calls `governanceShareFloors` to
// enforce them) is function-body-only in both directions, the same shape as market ↔ users.

import { hasCapability } from '../modes'
import type { GameState } from '../types'
import { communityConduct } from './community'
import { incentiveShares, setIncentiveShares } from './incentives'
import {
  TOKEN_GOVERNANCE,
  TOKEN_LIMITS,
  type GovernanceMandate,
  type GovernanceProposal,
  type GovernanceProposalType,
  type TokenIncentiveCategory,
  type TokenState,
} from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/** The saturating shock from tick.ts, for the handover write. */
function saturatingAdd(current: number, delta: number, lo = 0, hi = 100): number {
  const span = hi - lo
  if (span <= 0) return current
  const headroom = delta > 0 ? (hi - current) / span : (current - lo) / span
  return current + delta * clamp01(headroom)
}

/** Is governance a live counterparty for this run? Both halves required, as every slice. */
export function governanceActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenGovernance')
}

/** Old saves migrated mid-session and probe-built states may predate the Slice-6 fields. The
 *  migration back-fills on load; this is the same belt-and-suspenders `merge` applies globally. */
function ensureGovernanceShape(t: TokenState): void {
  t.governance.mandates ??= []
  t.governance.defiances ??= 0
  t.governance.revoltHeat ??= 0
  t.governance.lastWarnWeek ??= 0
}

// ---------- the content table (§36's examples; keys persisted, prose not) ----------

export type ProposalStance = 'constructive' | 'restraint' | 'hostile'

export interface ProposalContent {
  title: string
  /** What the community is asking for, in words the panel shows before the vote. */
  ask: string
  /** What passing BINDS — shown before the vote, because a cost you cannot see is not a cost. */
  binds: string
  stance: ProposalStance
}

export const PROPOSAL_CONTENT: Record<GovernanceProposalType, ProposalContent> = {
  treasury_allocation: {
    title: 'Fund the community treasury',
    ask: 'Holders want treasury resources moved into funds the community itself controls — grants and programmes decided by them, not by you.',
    binds: `Passing holds at least ${Math.round(TOKEN_GOVERNANCE.communityFloorShare * 100)}% of your weekly incentive budget in the community-treasury programme for ${TOKEN_GOVERNANCE.mandateWeeks} weeks. Decentralisation it buys does not come back.`,
    stance: 'constructive',
  },
  ecosystem_initiative: {
    title: 'Expand ecosystem grants',
    ask: 'Builders are asking for a serious grants programme — the network has more engagement than utility, and they want to close the gap themselves.',
    binds: `Passing holds at least ${Math.round(TOKEN_GOVERNANCE.grantFloorShare * 100)}% of your weekly incentive budget in developer grants for ${TOKEN_GOVERNANCE.mandateWeeks} weeks.`,
    stance: 'constructive',
  },
  protocol_change: {
    title: 'Freeze treasury sales',
    ask: 'Holders are afraid of the sell pressure hanging over the float — the treasury selling into it, or your own vested position — and want the treasury barred from the market.',
    binds: `Passing freezes treasury sales entirely for ${TOKEN_GOVERNANCE.saleFreezeWeeks} weeks. The round you can still raise closes for a season.`,
    stance: 'restraint',
  },
  expansion_subsidy: {
    title: 'Subsidise expansion',
    ask: 'The community is hot and wants growth bought while the wanting is good — partnership subsidies to push the network into new markets.',
    binds: `Passing holds at least ${Math.round(TOKEN_GOVERNANCE.expansionFloorShare * 100)}% of your weekly incentive budget in partnerships for ${TOKEN_GOVERNANCE.expansionMandateWeeks} weeks.`,
    stance: 'constructive',
  },
  decentralisation: {
    title: 'Hand over control',
    ask: 'Holders are demanding the network be governed by the people who hold it. This is the §38 pressure with a deadline attached.',
    binds: `Passing decentralises the network by about ${TOKEN_GOVERNANCE.decentralisationStep} points, immediately and permanently — control given away is not taken back.`,
    stance: 'constructive',
  },
  founder_removal: {
    title: 'Vote of no confidence',
    ask: 'The community no longer believes the network should be run by you. This vote removes you.',
    binds: 'Passing ends the run: you are removed exactly as a board would remove you — half the equity leg, your token position untouched.',
    stance: 'hostile',
  },
}

export const PROPOSAL_TYPES: GovernanceProposalType[] = [
  'treasury_allocation',
  'ecosystem_initiative',
  'protocol_change',
  'expansion_subsidy',
  'decentralisation',
  'founder_removal',
]

/** §9's rule applied to the tally: words before numbers. */
export function supportLabel(v: number): string {
  if (v < 40) return 'Failing'
  if (v < TOKEN_GOVERNANCE.passBar) return 'Short of the bar'
  if (v < TOKEN_GOVERNANCE.passBar + 12) return 'Passing narrowly'
  if (v < 80) return 'Passing comfortably'
  return 'Overwhelming'
}

// ---------- the inputs (§37's list, snapshotted) ----------

/**
 * Everything the support function reads, as one plain struct. The tick builds it from its `prev`
 * snapshot so governance obeys the same lag rule as every other level; the UI builds it from
 * current state through `governanceInputs(s)` and gets the identical arithmetic.
 */
export interface GovernanceInputs {
  week: number
  trust: number
  sentiment: number
  engagement: number
  decentralisation: number
  decentralisationDemand: number
  founderInfluence: number
  /** `price/emaPrice − 1`, bounded — the same difference term the whole price model reads. */
  momentum: number
  speculation: number
  utility: number
  holders: number
  members: number
}

export function governanceInputs(s: GameState): GovernanceInputs {
  const t = s.token
  if (!t) {
    return {
      week: s.week, trust: 50, sentiment: 50, engagement: 50, decentralisation: 25,
      decentralisationDemand: 20, founderInfluence: 75, momentum: 0, speculation: 50,
      utility: 0, holders: 0, members: 0,
    }
  }
  const ema = Math.max(t.plan.launchPrice * 0.01, t.market.emaPrice)
  return {
    week: s.week,
    trust: t.community.trust,
    sentiment: t.community.sentiment,
    engagement: t.community.engagement,
    decentralisation: t.community.decentralisation,
    decentralisationDemand: t.community.decentralisationDemand,
    founderInfluence: t.community.founderInfluence,
    momentum: clamp(t.market.price / ema - 1, -0.95, 4),
    speculation: t.market.speculation,
    utility: t.market.utility,
    holders: t.community.holders,
    members: t.community.members,
  }
}

// ---------- proposal need: the state's own case for each question (§37's "proposal utility") ----------

/**
 * 0–1 how much the current state argues FOR this proposal. It is both the emergence trigger (a
 * proposal is tabled when its need crosses `tablingNeedFloor`) and the dominant support term, so
 * the same recovery that stops a proposal being tabled also sinks one already on the ballot.
 */
export function proposalNeed(s: GameState, type: GovernanceProposalType, inp: GovernanceInputs = governanceInputs(s)): number {
  const t = s.token
  if (!t) return 0
  const shares = incentiveShares(s)
  const treasuryRich = clamp01(t.supply.treasury / Math.max(1, t.supply.total) / TOKEN_GOVERNANCE.treasuryRichFloor)
  const conduct = communityConduct(s)

  switch (type) {
    case 'decentralisation':
      // The §38 pressure zone: control is being demanded from someone who still holds it.
      return clamp01((inp.decentralisationDemand - 35) / 45) * clamp01((inp.founderInfluence - 30) / 50)
    case 'treasury_allocation':
      // Moderate demand for say, a treasury with something in it, and no community fund running.
      // Capped at 0.85: this is the MILDER sibling of the handover — when demand for control is
      // saturated under a founder who still holds it, the decentralisation question outbids it,
      // and this one surfaces in the wide middle band where holders want funds, not the keys.
      return (
        0.85 *
        treasuryRich *
        clamp01((inp.decentralisationDemand - 20) / 60) *
        clamp01(1 - shares.community_treasury / TOKEN_GOVERNANCE.communityFloorShare)
      )
    case 'ecosystem_initiative':
      // Engagement outrunning utility: people who want to build and nothing funding them.
      return (
        treasuryRich *
        clamp01(inp.engagement / 100) *
        clamp01((60 - inp.utility) / 45) *
        clamp01(1 - shares.developer_grants / TOKEN_GOVERNANCE.grantFloorShare)
      )
    case 'expansion_subsidy':
      // A hot crowd wants growth bought while the wanting is good (§36's expansion subsidy).
      return (
        treasuryRich *
        clamp01((inp.sentiment - 45) / 40) *
        clamp01((inp.speculation - 40) / 45) *
        clamp01(1 - shares.partnerships / TOKEN_GOVERNANCE.expansionFloorShare)
      )
    case 'protocol_change': {
      // Sell-pressure fear: a fresh treasury sale on the books, or a founder bag overhanging the
      // float. The same two ledger lines the community already prices (Slice 5).
      const overhang = conduct.drags.find((d) => d.id === 'founder_overhang')?.intensity ?? 0
      return clamp01(Math.max(conduct.saleMemory, overhang))
    }
    case 'founder_removal':
      // Deep distrust of a founder who still holds the network. Steep in trust: the case is FULL
      // by trust 10 and gone by trust 35, so the vote passes only from genuinely bottomed-out
      // trust and any real recovery sinks it. The legitimacy gate (defiances or a recent exodus)
      // is enforced at TABLING, not here — so a tabled vote's support still tracks the state.
      return clamp01((35 - inp.trust) / 25) * clamp01((inp.founderInfluence - 40) / 50)
  }
}

// ---------- the support function (§37, the whole point of the slice) ----------

export interface SupportTerm {
  id: 'need' | 'mood' | 'performance' | 'holders' | 'legitimacy' | 'founder'
  label: string
  points: number
}

export interface SupportBreakdown {
  support: number
  need: number
  turnout: number
  terms: SupportTerm[]
}

/**
 * The vote, as arithmetic. PURE — same inputs, same tally, every time. §37's seven inputs each
 * have a named term, and the breakdown is returned whole so the UI can show the player WHY the
 * vote sits where it sits rather than a bare percentage.
 */
export function proposalSupport(
  s: GameState,
  p: Pick<GovernanceProposal, 'type' | 'founderPosition'>,
  inp: GovernanceInputs = governanceInputs(s),
): SupportBreakdown {
  const G = TOKEN_GOVERNANCE
  const stance = PROPOSAL_CONTENT[p.type].stance
  const t = s.token
  const defiances = Math.min(G.maxDefiances, t?.governance?.defiances ?? 0)

  // Proposal utility — the dominant term.
  const need = proposalNeed(s, p.type, inp)
  const needTerm = G.needBase + G.needGain * need - 50 // recentred so the sum below starts at 50

  // Community sentiment. A happy crowd funds ambition and keeps its founder; a sour one reaches
  // for restraint and, eventually, the door.
  const mood = (clamp(inp.sentiment, 0, 100) / 100 - 0.5) * 2
  const moodTerm = stance === 'hostile' ? -G.hostileMoodGain * mood : stance === 'restraint' ? -6 * mood : G.moodGain * mood

  // Recent token performance. A falling chart radicalises: it feeds restraint and hostility and
  // starves expansion.
  const perf = Math.tanh(inp.momentum / 0.25)
  const perfTerm = stance === 'constructive' ? G.perfGain * perf : -(stance === 'hostile' ? G.hostilePerfGain : G.perfGain) * perf

  // Holder composition. Holders vote their bag: they back restraint (it protects the float) and
  // resist spending programmes (every released token dilutes them). Hostile votes are fear-driven
  // either way, so composition washes out there.
  const holderShare = inp.members > 0 ? clamp01(inp.holders / inp.members) : 0.5
  const composition = (holderShare - 0.5) * 2
  const holderTerm = stance === 'restraint' ? G.holderGain * composition : stance === 'constructive' ? -G.holderGain * composition : 0

  // Legitimacy: every mandate the founder tore up makes every later vote angrier.
  const legitimacyTerm = G.legitimacyGain * (defiances / G.maxDefiances)

  // The founder's word: influence is the megaphone, trust is whether anyone believes it. Opposing
  // moves more than endorsing — a founder against their own community is news.
  const belief = G.swayTrustFloor + (1 - G.swayTrustFloor) * clamp01(inp.trust / 100)
  const swayScale = G.swayMax * clamp01(inp.founderInfluence / 100) * belief
  const founderTerm =
    p.founderPosition === 'oppose' ? -swayScale : p.founderPosition === 'support' ? swayScale * G.swaySupportRatio : 0

  // Turnout: engagement is whether the community organises; decentralisation is whether its votes
  // are decisive. Both scale the DEVIATION from 50, so a disengaged, centralised network's votes
  // drift back toward "nothing happens" — in both directions.
  //
  // EXCEPT for a hostile vote, which skips the engagement half: rage organises itself. The exodus
  // that accompanies rock-bottom trust collapses engagement, and if disengagement muted the
  // no-confidence vote, the very abandonment that justifies removing a founder would be what
  // protects them — the ouster would be unreachable from exactly the states it exists for.
  const engagementFactor =
    stance === 'hostile' ? 1 : G.turnoutEngagementBase + G.turnoutEngagementSpan * clamp01(inp.engagement / 100)
  const turnout = clamp(
    engagementFactor * (G.turnoutDecentralisationBase + G.turnoutDecentralisationSpan * clamp01(inp.decentralisation / 100)),
    G.turnoutMin,
    G.turnoutMax,
  )

  const raw = 50 + needTerm + moodTerm + perfTerm + holderTerm + legitimacyTerm + founderTerm
  const support = clamp(50 + (raw - 50) * turnout, 0, 100)

  return {
    support,
    need,
    turnout,
    terms: [
      { id: 'need', label: 'The case for it', points: needTerm },
      { id: 'mood', label: "The crowd's mood", points: moodTerm },
      { id: 'performance', label: 'The chart', points: perfTerm },
      { id: 'holders', label: 'Holders voting their bag', points: holderTerm },
      { id: 'legitimacy', label: 'Votes you have defied', points: legitimacyTerm },
      { id: 'founder', label: 'Your public position', points: founderTerm },
    ],
  }
}

/** The bar this proposal must clear at the close. */
export function passBarFor(type: GovernanceProposalType): number {
  return type === 'founder_removal' ? TOKEN_GOVERNANCE.removalPassBar : TOKEN_GOVERNANCE.passBar
}

// ---------- mandates: what a passed vote binds ----------

export function activeMandates(s: GameState | null | undefined): GovernanceMandate[] {
  const t = s?.token
  if (!t || !governanceActive(s)) return []
  return (t.governance.mandates ?? []).filter((m) => m.untilWeek > s!.week)
}

/**
 * The floors a live mandate holds under the incentive shares. Enforced inside
 * `setIncentiveShares` — the one write — so a player's slider physically cannot go below a
 * mandated floor while the mandate runs.
 */
export function governanceShareFloors(s: GameState | null | undefined): Partial<Record<TokenIncentiveCategory, number>> {
  const out: Partial<Record<TokenIncentiveCategory, number>> = {}
  for (const m of activeMandates(s)) {
    if (!m.category || !(m.shareFloor && m.shareFloor > 0)) continue
    out[m.category] = Math.max(out[m.category] ?? 0, clamp01(m.shareFloor))
  }
  return out
}

/** 0–1 multiplier a live mandate puts on `maxTreasurySale`. 0 while a sale freeze runs. */
export function governanceSaleFactor(s: GameState | null | undefined): number {
  let factor = 1
  for (const m of activeMandates(s)) if (m.saleFactor !== undefined) factor = Math.min(factor, clamp01(m.saleFactor))
  return factor
}

/** The freeze, with its deadline, for the treasury panel's reason string. */
export function treasurySaleFreeze(s: GameState | null | undefined): { frozen: boolean; untilWeek: number } {
  let untilWeek = 0
  for (const m of activeMandates(s)) if (m.saleFactor === 0) untilWeek = Math.max(untilWeek, m.untilWeek)
  return { frozen: untilWeek > 0, untilWeek }
}

// ---------- the founder's decision surface ----------

export interface GovernanceActionResult {
  ok: boolean
  reason?: string
}

/**
 * Take a public position on an active proposal — the campaign. Priced ONCE (energy, and
 * reputation when opposing your own community), locked once taken, and it shifts the weekly tally
 * from the next tick through the sway term. It never re-rolls a resolved vote.
 */
export function setGovernanceStance(s: GameState, proposalId: string, stance: 'support' | 'oppose'): GovernanceActionResult {
  const t = s.token
  if (!t || !governanceActive(s)) return { ok: false, reason: 'Governance is not live for this run.' }
  if (s.gameOver) return { ok: false, reason: 'The run is over.' }
  const p = t.governance.proposals.find((x) => x.id === proposalId)
  if (!p) return { ok: false, reason: 'No such proposal.' }
  if (p.status !== 'active') return { ok: false, reason: 'That vote has already closed. Nothing re-rolls a resolved vote.' }
  if (p.campaigned) return { ok: false, reason: 'You already took a position in public. It stands.' }

  p.founderPosition = stance
  p.campaigned = true
  const G = TOKEN_GOVERNANCE
  if (hasCapability(s, 'founderEnergy'))
    s.energy = clamp(s.energy - (stance === 'oppose' ? G.campaignEnergyCost : G.endorseEnergyCost), 0, 100)
  if (stance === 'oppose') s.reputation = clamp(s.reputation - G.campaignReputationCost, 0, 100)

  s.flash =
    stance === 'oppose'
      ? `📣 You came out against "${PROPOSAL_CONTENT[p.type].title}". Your word carries what your influence and their trust say it carries — the tally moves from next week.`
      : `📣 You backed "${PROPOSAL_CONTENT[p.type].title}". The community heard it.`
  return { ok: true }
}

/**
 * Tear up a standing mandate. The priced defiance: trust, reputation, energy, a demand spike —
 * and a legitimacy mark that makes every later vote angrier and is one of the two gates on the
 * no-confidence path. The decentralisation handover cannot be defied (§35: monotone), and neither
 * can the ouster.
 */
export function defyGovernanceMandate(s: GameState, proposalId: string): GovernanceActionResult {
  const t = s.token
  if (!t || !governanceActive(s)) return { ok: false, reason: 'Governance is not live for this run.' }
  if (s.gameOver) return { ok: false, reason: 'The run is over.' }
  ensureGovernanceShape(t)
  const idx = t.governance.mandates.findIndex((m) => m.proposalId === proposalId && m.untilWeek > s.week)
  if (idx < 0) return { ok: false, reason: 'No live mandate to defy.' }
  const m = t.governance.mandates[idx]

  const G = TOKEN_GOVERNANCE
  t.governance.mandates.splice(idx, 1)
  t.governance.defiances += 1
  t.community.trust = clamp(t.community.trust - G.defyTrustCost, 0, 100)
  t.community.decentralisationDemand = clamp(saturatingAdd(t.community.decentralisationDemand, G.defyDemandSpike), 0, 100)
  s.reputation = clamp(s.reputation - G.defyReputationCost, 0, 100)
  if (hasCapability(s, 'founderEnergy')) s.energy = clamp(s.energy - G.defyEnergyCost, 0, 100)

  t.history.push({
    week: s.week,
    type: 'governance_vote',
    importance: 60,
    metadata: { kind: 'defied', proposal: m.type, defiances: t.governance.defiances },
  })
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)

  s.flash = `🔥 You tore up "${PROPOSAL_CONTENT[m.type].title}". Trust −${G.defyTrustCost}, and every vote from here remembers it.`
  s.inbox.unshift({
    id: `gov-defied-${m.type}-${s.week}`,
    week: s.week,
    kind: 'system',
    title: 'You defied the vote',
    body:
      `The "${PROPOSAL_CONTENT[m.type].title}" mandate is void — you voided it. The community funded this company, ` +
      `voted on how its treasury moves, and watched you tear the result up.\n\n` +
      `Trust fell ${G.defyTrustCost} points and holders are demanding more control. Every future vote now carries a ` +
      `legitimacy penalty against you (${t.governance.defiances} defied so far), and a founder who ignores votes while trust ` +
      `collapses is how no-confidence movements start.`,
  })
  return { ok: true }
}

/** The engine's ouster read: did a no-confidence vote pass THIS week? Pure; polled after the tick. */
export function founderRemovalPassed(s: GameState): boolean {
  const t = s.token
  if (!t || !governanceActive(s)) return false
  return (t.governance.proposals ?? []).some(
    (p) => p.type === 'founder_removal' && p.status === 'passed' && p.resolvedWeek === s.week,
  )
}

// ---------- the weekly step ----------

export interface GovernanceTickReport {
  ran: boolean
  /** Proposal tabled this week, if any. */
  tabled: GovernanceProposalType | null
  /** Vote that closed this week, if any. */
  resolved: { type: GovernanceProposalType; passed: boolean; support: number } | null
  heat: number
  warned: boolean
}

export const GOVERNANCE_IDLE: GovernanceTickReport = { ran: false, tabled: null, resolved: null, heat: 0, warned: false }

/**
 * The Slice-6 writes. Called from `tickToken` inside the `tokenGovernance` gate, LAST — after the
 * market, the incentive effects and the community step — with the same `prev`-derived inputs the
 * whole tick reads, so every DECISION here obeys the lag rule. The two accumulation writes (the
 * handover, the demand relief) use the current value as their base, exactly as the tick's own
 * monotone decentralisation write does.
 *
 * Draws nothing. The tick's one-draw-per-week contract is untouched.
 */
export function tickGovernance(s: GameState, inp: GovernanceInputs): GovernanceTickReport {
  const t = s.token
  if (!t || !governanceActive(s)) return GOVERNANCE_IDLE
  ensureGovernanceShape(t)
  const g = t.governance
  const G = TOKEN_GOVERNANCE
  const report: GovernanceTickReport = { ran: true, tabled: null, resolved: null, heat: 0, warned: false }

  // ---- 1. expired mandates lapse quietly; the panel showed the countdown all along ----
  g.mandates = g.mandates.filter((m) => m.untilWeek > s.week)

  // ---- 2. the weekly tally: support is derived from state every tick (§37, the type's own contract) ----
  for (const p of g.proposals) {
    if (p.status !== 'active') continue
    p.support = Math.round(proposalSupport(s, p, inp).support * 10) / 10
  }

  // ---- 3. votes at their close resolve — from the tally the state set, never from a roll ----
  for (const p of g.proposals) {
    if (p.status !== 'active' || s.week < p.closesWeek) continue
    const passed = p.support >= passBarFor(p.type)
    p.status = passed ? 'passed' : 'rejected'
    p.resolvedWeek = s.week
    report.resolved = { type: p.type, passed, support: p.support }
    if (passed) applyPassedProposal(s, t, p)

    t.history.push({
      week: s.week,
      type: 'governance_vote',
      importance: p.type === 'founder_removal' ? 100 : passed ? 55 : 40,
      metadata: { kind: passed ? 'passed' : 'rejected', proposal: p.type, support: p.support },
    })
    s.inbox.unshift({
      id: `gov-${passed ? 'passed' : 'rejected'}-${p.type}-${s.week}`,
      week: s.week,
      kind: 'system',
      title: passed ? `Vote passed: ${PROPOSAL_CONTENT[p.type].title}` : `Vote failed: ${PROPOSAL_CONTENT[p.type].title}`,
      body: passed
        ? `The community voted ${p.support.toFixed(0)}–${(100 - p.support).toFixed(0)} for it, and the outcome binds. ${PROPOSAL_CONTENT[p.type].binds}` +
          (p.type === 'founder_removal'
            ? ''
            : `\n\nComplying costs you nothing further. Defying it is on the table — priced in trust, reputation, and every future vote's opinion of you.`)
        : `Support closed at ${p.support.toFixed(0)} against a bar of ${passBarFor(p.type)}. The question is settled for now — the same argument does not come back for ${G.typeCooldownWeeks} weeks unless the state that raised it gets worse.`,
    })
  }

  // ---- 4. the no-confidence path: heat, warnings, tabling (§43; rare and telegraphed) ----
  const conduct = communityConduct(s)
  const exodusRecent = t.history.some(
    (h) => h.type === 'crisis' && h.metadata.kind === 'exodus' && s.week - h.week <= G.removalExodusWindowWeeks,
  )
  const legitimacyBroken = g.defiances >= 1 || exodusRecent
  const preconditions =
    inp.trust < G.removalTrustCeiling && inp.founderInfluence >= G.removalInfluenceFloor && legitimacyBroken
  const removalActive = g.proposals.some((p) => p.type === 'founder_removal' && p.status === 'active')
  const removalResolvedRecently = g.proposals.some(
    (p) => p.type === 'founder_removal' && p.status !== 'active' && p.resolvedWeek !== undefined && s.week - p.resolvedWeek < G.typeCooldownWeeks,
  )

  if (preconditions && !removalActive && !removalResolvedRecently) {
    g.revoltHeat = Math.min(G.removalHeatMax, g.revoltHeat + G.removalHeatBuild)
  } else if (!preconditions) {
    g.revoltHeat = Math.max(0, g.revoltHeat - G.removalHeatDecay)
  }
  report.heat = g.revoltHeat

  // First telegraph: the warning, before anything is tabled, with the exit spelled out.
  if (
    g.revoltHeat >= G.removalWarnAt &&
    g.revoltHeat < G.removalHeatTabling &&
    !removalActive &&
    s.week - g.lastWarnWeek >= G.warnCooldownWeeks
  ) {
    g.lastWarnWeek = s.week
    report.warned = true
    s.inbox.unshift({
      id: `gov-revolt-warning-${s.week}`,
      week: s.week,
      kind: 'system',
      title: 'A no-confidence vote is brewing',
      body:
        `Trust is at ${Math.round(inp.trust)} and you still hold ${Math.round(inp.founderInfluence)}% of the influence — and the community ` +
        `has stopped treating your governance as legitimate${g.defiances > 0 ? ` (you have defied ${g.defiances} vote${g.defiances > 1 ? 's' : ''})` : ' (holders have already walked out once)'}. ` +
        `Organisers are counting votes to remove you.\n\n` +
        `This stops the way everything here stops: change the state it reads. Get trust back above ${G.removalTrustCeiling} — stop the conduct on the ledger` +
        (conduct.drags.filter((d) => d.points >= 1).length
          ? ` (right now: ${conduct.drags.filter((d) => d.points >= 1).map((d) => d.id.replace(/_/g, ' ')).join(', ')})`
          : '') +
        ` — or hand over control before they take the question to a vote. If it is tabled, you get ${G.votingWeeks} more weeks.`,
    })
  }

  // Second telegraph: the tabling itself, an urgent message with the arithmetic attached.
  if (g.revoltHeat >= G.removalHeatTabling && !removalActive && !removalResolvedRecently && preconditions) {
    const p = tableProposal(s, t, 'founder_removal', inp)
    report.tabled = p.type
  }

  // ---- 5. ordinary emergence: one question at a time, cooled down, thresholded (§36) ----
  const anyActive = g.proposals.some((p) => p.status === 'active')
  if (!anyActive && report.tabled === null && s.week - g.lastProposalWeek >= G.proposalCooldownWeeks) {
    const incentivesOn = hasCapability(s, 'tokenIncentives')
    let best: { type: GovernanceProposalType; need: number } | null = null
    for (const type of PROPOSAL_TYPES) {
      if (type === 'founder_removal') continue // the heat path owns it
      // Budget mandates and the sale freeze bind Slice-4 controls; without them there is nothing
      // for the outcome to bind, and a vote that binds nothing is a mood (§37 would not forgive it).
      if (type !== 'decentralisation' && !incentivesOn) continue
      const recent = g.proposals.some((p) => p.type === type && s.week - p.week < G.typeCooldownWeeks)
      if (recent) continue
      const need = proposalNeed(s, type, inp)
      if (need >= G.tablingNeedFloor && (!best || need > best.need)) best = { type, need }
    }
    if (best) {
      const p = tableProposal(s, t, best.type, inp)
      report.tabled = p.type
    }
  }

  // ---- 6. keep the ledger inside its byte budget: prune the oldest RESOLVED proposals ----
  while (g.proposals.length > TOKEN_LIMITS.proposals) {
    const idx = g.proposals.findIndex((p) => p.status !== 'active')
    if (idx < 0) break
    g.proposals.splice(idx, 1)
  }
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)

  return report
}

/** Table a proposal: deterministic id, §69's countdown, the inbox message with the ask attached. */
function tableProposal(s: GameState, t: TokenState, type: GovernanceProposalType, inp: GovernanceInputs): GovernanceProposal {
  const g = t.governance
  const content = PROPOSAL_CONTENT[type]
  const p: GovernanceProposal = {
    id: `gov-${type}-${s.week}`,
    week: s.week,
    type,
    descriptionKey: type,
    support: 0,
    founderPosition: 'neutral',
    closesWeek: s.week + TOKEN_GOVERNANCE.votingWeeks,
    status: 'active',
  }
  p.support = Math.round(proposalSupport(s, p, inp).support * 10) / 10
  g.proposals.push(p)
  g.lastProposalWeek = s.week

  t.history.push({
    week: s.week,
    type: 'governance_vote',
    importance: type === 'founder_removal' ? 90 : 45,
    metadata: { kind: 'tabled', proposal: type, support: p.support },
  })
  s.inbox.unshift({
    id: `gov-tabled-${type}-${s.week}`,
    week: s.week,
    kind: 'system',
    title: type === 'founder_removal' ? 'GOVERNANCE: vote of no confidence' : `Governance proposal: ${content.title}`,
    body:
      `${content.ask}\n\n${content.binds}\n\n` +
      `Support opens at ${p.support.toFixed(0)} — ${supportLabel(p.support).toLowerCase()} against a bar of ${passBarFor(type)} — ` +
      `and the vote closes week ${p.closesWeek}. The tally is arithmetic, not a roll: it reads trust, sentiment, the chart, who holds ` +
      `the float and your own standing, every week, so what you do between now and the close IS the vote. You can also campaign — ` +
      `take a public position from the governance panel — and your word carries what your influence and their trust say it carries.`,
  })
  return p
}

/** Apply what a passed vote binds. Mandates are pushed; the handover is immediate and monotone. */
function applyPassedProposal(s: GameState, t: TokenState, p: GovernanceProposal): void {
  const G = TOKEN_GOVERNANCE
  const g = t.governance
  switch (p.type) {
    case 'treasury_allocation':
      g.mandates.push({ proposalId: p.id, type: p.type, category: 'community_treasury', shareFloor: G.communityFloorShare, untilWeek: s.week + G.mandateWeeks })
      break
    case 'ecosystem_initiative':
      g.mandates.push({ proposalId: p.id, type: p.type, category: 'developer_grants', shareFloor: G.grantFloorShare, untilWeek: s.week + G.mandateWeeks })
      break
    case 'expansion_subsidy':
      g.mandates.push({ proposalId: p.id, type: p.type, category: 'partnerships', shareFloor: G.expansionFloorShare, untilWeek: s.week + G.expansionMandateWeeks })
      break
    case 'protocol_change':
      g.mandates.push({ proposalId: p.id, type: p.type, saleFactor: 0, untilWeek: s.week + G.saleFreezeWeeks })
      break
    case 'decentralisation':
      // Monotone, immediate, undefiable — §35: control given away is not taken back. The demand
      // that tabled it is relieved: the loudest holders got what they were asking for.
      t.community.decentralisation = clamp(saturatingAdd(t.community.decentralisation, G.decentralisationStep), 0, 100)
      t.community.decentralisationDemand = clamp(saturatingAdd(t.community.decentralisationDemand, -G.decentralisationRelief), 0, 100)
      t.history.push({
        week: s.week,
        type: 'decentralisation',
        importance: 60,
        metadata: { kind: 'vote', decentralisation: Math.round(t.community.decentralisation) },
      })
      break
    case 'founder_removal':
      // The marker the engine reads after the tick. The ending itself — `fired`, equity leg
      // halved, token position untouched — is engine territory and stays there (§7.9).
      break
  }
  // Materialise share floors into programmes immediately: a no-op request through the one write,
  // which applies the floors and creates any missing programme row. Without this a founder who
  // never opens the panel would never "comply" with a vote that passed.
  if (p.type === 'treasury_allocation' || p.type === 'ecosystem_initiative' || p.type === 'expansion_subsidy') {
    setIncentiveShares(s, {})
  }
}

// ---------- readouts for the UI ----------

export interface GovernancePanelData {
  active: boolean
  proposal:
    | (GovernanceProposal & {
        content: ProposalContent
        breakdown: SupportBreakdown
        passBar: number
        weeksLeft: number
      })
    | null
  mandates: (GovernanceMandate & { content: ProposalContent; weeksLeft: number })[]
  recent: GovernanceProposal[]
  defiances: number
  revoltHeat: number
}

export function governancePanel(s: GameState): GovernancePanelData {
  const idle: GovernancePanelData = { active: false, proposal: null, mandates: [], recent: [], defiances: 0, revoltHeat: 0 }
  const t = s.token
  if (!t || !governanceActive(s)) return idle
  const g = t.governance
  const active = (g.proposals ?? []).find((p) => p.status === 'active') ?? null
  const inp = governanceInputs(s)
  return {
    active: true,
    proposal: active
      ? {
          ...active,
          content: PROPOSAL_CONTENT[active.type],
          breakdown: proposalSupport(s, active, inp),
          passBar: passBarFor(active.type),
          weeksLeft: Math.max(0, active.closesWeek - s.week),
        }
      : null,
    mandates: activeMandates(s).map((m) => ({ ...m, content: PROPOSAL_CONTENT[m.type], weeksLeft: m.untilWeek - s.week })),
    recent: (g.proposals ?? [])
      .filter((p) => p.status !== 'active')
      .slice(-3)
      .reverse(),
    defiances: g.defiances ?? 0,
    revoltHeat: g.revoltHeat ?? 0,
  }
}
