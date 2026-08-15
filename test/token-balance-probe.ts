// ICO Slice 8 — do the two capital paths balance?
//
// Run: npx tsx test/token-balance-probe.ts [all|<sector>...] [exploits] [free] [endings]
//
// Deliberately NOT in `npm test` — it plays several thousand full careers.
//
// ---------------------------------------------------------------------------------------------
// WHAT IS MEASURED, AND WHY IT IS NOT SURVIVAL
//
// `docs/balance-baseline.md` §0: `alive = !gameOver` counted acquisitions and IPOs as deaths, and
// every bot here answers inbox choices with option 0 — which on an acquisition offer is *Sell the
// company*. So fitness is `gameOver.payout` when there is one, and `founderStanding(s)` otherwise.
//
// `founderStanding`, NOT `valuation(s) * founderEquity + bankedPayout`. That fallback (still in
// test/career-bots.ts) omits the entire token leg, which for a tokenised founder is most of their
// score. It is identical for a traditional run — the token leg is 0 without a token slice — so
// using it everywhere costs nothing and stops the harness understating exactly the arm it exists
// to measure.
//
// ---------------------------------------------------------------------------------------------
// FAIR LEVERS
//
// Every arm plays the SAME base career policy: the reference `disciplined` bot from
// test/exploit-probe.ts, clamped to `marketingMax` so it is measuring a game a player could play.
// What differs between arms is exactly one thing at a time:
//
//   * WHEN it tokenises (never / as soon as eligible / once PMF is proven / late),
//   * WHERE the treasury points (the six incentive categories),
//   * WHETHER it sells treasury tokens for cash.
//
// Timing arms share an incentive policy and policy arms share a timing rule, so a difference
// between two arms is attributable to the one lever that differs.
//
// ---------------------------------------------------------------------------------------------
// PER SECTOR, NEVER POOLED
//
// `docs/balance-baseline.md`'s caveat for this slice: Social's ceiling is 26M customers and its
// `careerArpu` scale boost is logarithmic in users, so Social's top end dominates any average
// regardless of which capital path produced it.

import {
  acceptTermSheet,
  advanceWeek,
  marketingMax,
  newGame,
  pitchInvestors,
  resolveChoiceOnState,
  sellFounderTokens,
  sellTokenTreasury,
  tokeniseCompany,
  valuation,
} from '../src/game/engine'
import {
  canRunExperiment,
  experimentDef,
  segmentsForSector,
  segmentDef,
  startExperiment,
  totalCustomers,
  PMF_CUSTOMER_FLOOR,
} from '../src/game/career/pmf'
import { repositionTo, careerMarketingDrain } from '../src/game/career/tick'
import { STAGE_THRESHOLDS, sectorById } from '../src/game/data'
import type { Stage } from '../src/game/types'
import { canTokenise } from '../src/game/token/eligibility'
import { fairValue } from '../src/game/token/market'
import { resolveLaunchTerms } from '../src/game/token/launch'
import { setIncentiveShares, type IncentiveShares } from '../src/game/token/incentives'
import { maxTreasurySale } from '../src/game/token/treasury'
import { maxFounderSale } from '../src/game/token/founder'
import { networkEndingProgress } from '../src/game/token/endings'
import { founderStanding, networkExitPremium, networkValue, realisableTokenValue } from '../src/game/token/scoring'
import { organicShare } from '../src/game/token/users'
import { isTokenised } from '../src/game/token/state'
import type { GameState, SectorId } from '../src/game/types'
import type { ExperimentType } from '../src/game/career/types'

/** The fundraising ladder, in order. `marketingMax` reads it as a floor. */
const STAGE_ORDER: Stage[] = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C']

let ids = 0
const uid = () => `t${ids++}`
const cfg = (seed: number, sector: SectorId) => ({ mode: 'career' as const, format: 'standard' as const, sector, seed })

/** The marketing budget a PLAYER could actually set this week. */
const spendCap = (s: GameState, want: number) => Math.max(0, Math.min(want, marketingMax(s), s.cash))

function common(s: GameState, alwaysRaise = false, takeNetworkExit = false) {
  for (const m of s.inbox) {
    if (m.kind !== 'choice' || m.resolved || !m.choices) continue
    // ICO Slice 7: every bot answers 0 on everything, and 0 on the network offer is "keep
    // building". That is deliberate — it is what makes the core table above unchanged by the
    // ending, so the ending's balance effect is measured on the arm that OPTS IN rather than
    // smeared across every token arm by a bot's default.
    const isNetworkOffer = m.id.startsWith('token-network-offer-')
    resolveChoiceOnState(s, m.id, isNetworkOffer && takeNetworkExit ? 1 : 0)
  }
  if (s.raiseCooldown === 0 && (alwaysRaise || s.cash < (s.lastExpenses || 5000) * 25)) pitchInvestors(s)
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  const affordable = Math.min(8, 1 + Math.floor(s.lastRevenue / 2500))
  if (s.cash / Math.max(1, s.lastExpenses || 5000) > 25 && staff < affordable && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
}

function tryExperiment(s: GameState, type: ExperimentType, seg: string) {
  if (!s.career) return
  if (canRunExperiment(s.career, type, seg, s.cash).ok) {
    startExperiment(s.career, s.week, type, seg, uid())
    s.cash -= experimentDef(type).cashCost
  }
}

// ---------- the token policy an arm carries ----------

/** When, if ever, this arm takes the fork. */
type Timing =
  | { kind: 'never' }
  /** The first week `canTokenise` is true. */
  | { kind: 'asap' }
  /** Eligible AND the reference bot's own PMF gate has fired — "wait for PMF". */
  | { kind: 'proven' }
  /** Eligible AND at or past this week. */
  | { kind: 'after'; week: number }

interface TokenPolicy {
  timing: Timing
  /** Incentive shares, as a function of the state — so "build utility before incentives" is
   *  expressible rather than a fixed vector. Returns null to leave the policy alone. */
  shares?: (s: GameState) => Partial<IncentiveShares> | null
  /** Sell this fraction of the maximum permitted treasury sale, every week it is allowed. */
  sellEvery?: number
  /**
   * ICO Slice 7, §42. Sell this fraction of the maximum permitted FOUNDER sale, every week the
   * cooldown and the lifetime cap allow one. This is the arm that prices the mechanic: if the
   * founder path pulls the token arm out of the measured band, §42 is a buff rather than a
   * decision and the caps are wrong.
   */
  founderSellEvery?: number
  /** Only sell on weeks where this is true (used by the pump-and-dump arm). */
  sellWhen?: (s: GameState) => boolean
  /**
   * Give a TRADITIONAL company the same free stage promotion `engine.ts` gives a tokenised one.
   *
   * This is a counterfactual, not a strategy — no player can do it. It exists because the engine
   * block at `advanceWeekInner` promotes a tokenised company one stage whenever
   * `valuation(s) >= STAGE_THRESHOLDS[s.stage]`, and `marketingMax` reads `s.stage` as a FLOOR
   * ($30k at Pre-seed, $1.5M at Series C). Reproducing exactly that rule on the institutional path
   * isolates how much of the two paths' gap is tokenomics and how much is that one asymmetry.
   */
  freeStages?: boolean
  /**
   * Ignore `marketingMax` entirely. Also a counterfactual, not a strategy: it measures how much of
   * the gap is the CAP rather than the capital. If an uncapped institutional run closes the gap,
   * the two paths differ by a marketing-budget rule, not by tokenomics.
   */
  ignoreCap?: boolean
  /**
   * Raise whenever the cooldown allows, rather than only when the bank is nearly empty.
   *
   * FAIR LEVERS. `common()` pitches only when `cash < lastExpenses × 25` — a defensive rule. The
   * token path's capital arrives unconditionally, as a one-off sale at launch, so comparing it
   * against a defensive raiser measures the BOT'S RAISE RULE, not the two capital paths. This arm
   * is the institutional path playing its own capital lever as hard as the token path plays its.
   */
  alwaysRaise?: boolean
  /**
   * Take the initial sale's cash straight back out again. Isolates how much of the fork's advantage
   * is simply the undiluted cheque it writes on day one.
   */
  burnSaleCash?: boolean
  /**
   * ICO Slice 7. Play the identical policy with `tokenNarrative` OFF, so the `network` ending
   * cannot fire and §42 sales are refused. This is the counterfactual the ending has to be priced
   * against: an ending that TERMINATES a run pays at week W instead of letting it compound to
   * week 90, so "does reaching it beat playing on?" is the question that decides whether it is an
   * outcome or a trap — and it cannot be answered from the ending's payout alone.
   */
  noSlice7?: boolean
  /** ICO Slice 7. Answer the network-ending offer with "step back" instead of "keep building". */
  takeNetworkExit?: boolean
}

const NO_TOKEN: TokenPolicy = { timing: { kind: 'never' } }

// ---------- the shared base policy ----------

interface RunResult {
  state: GameState
  tokenisedWeek: number | null
  /** The founder's standing on the week the token launched — the counterfactual's baseline. */
  standingAtLaunch: number
  /** Launch-day diagnosis: what the sale cleared at against what the fundamentals said. */
  launchPrice: number
  launchFair: number
  saleProceeds: number
  valuationAtLaunch: number
  /** Dollars, cumulative over the run. The two acquisition budgets, side by side. */
  cashMarketing: number
  tokenRewards: number
  /** Weeks the marketing cap was the binding constraint on the bot's own budget rule. */
  cappedWeeks: number
  boundBy: string
  lateness: number
  /** ICO Slice 7. How many §42 sales the arm actually got, and what they banked. */
  founderSaleCount: number
  founderBanked: number
  /** The week the `network` ending fired, or null. */
  networkWeek: number | null
  /** The week the offer was first TABLED — the gate closing, whether or not it was taken. */
  networkOfferWeek: number | null
}

function play(seed: number, sector: SectorId, token: TokenPolicy, weeks = 90): RunResult {
  let s = newGame('Bot', sector, 'technical', { config: cfg(seed, sector) })
  // The one capability flip the counterfactual needs. Written after construction rather than
  // through a second config, so everything else about the run — seed, sector, draw order — is
  // identical to the arm it is being compared with.
  if (token.noSlice7) s.capabilities = { ...s.capabilities, tokenNarrative: false }
  const history: number[] = []
  let tokenisedWeek: number | null = null
  let standingAtLaunch = 0
  let sharesSet = ''
  let launchPrice = 0
  let launchFair = 0
  let saleProceeds = 0
  let valuationAtLaunch = 0
  let cashMarketing = 0
  let tokenRewards = 0
  let cappedWeeks = 0
  let boundBy = '—'
  let lateness = 0
  let founderSaleCount = 0
  let founderBanked = 0
  let networkOfferWeek: number | null = null

  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s, token.alwaysRaise === true, token.takeNetworkExit === true)
    const c = s.career!
    const target = c.primaryTargetSegmentId
    const b = c.segmentBeliefs[target]
    const afford = (t: ExperimentType) => s.cash > experimentDef(t).cashCost * 8
    if (b.needIntensity.confidence < 0.4) { if (afford('interview')) tryExperiment(s, 'interview', target) }
    else if (b.acquisitionAccessibility.confidence < 0.4) { if (afford('landing_page')) tryExperiment(s, 'landing_page', target) }
    else if (b.productRequirement.confidence < 0.45) { if (afford('prototype')) tryExperiment(s, 'prototype', target) }
    else if (b.willingnessToPay.confidence < 0.55) { if (afford('pricing_test')) tryExperiment(s, 'pricing_test', target) }
    else if (b.retentionPotential.confidence < 0.65) { if (afford('pilot')) tryExperiment(s, 'pilot', target) }

    if (s.week === 30) {
      const scored = segmentsForSector(sector).map((sg) => {
        const bb = c.segmentBeliefs[sg.id]
        return { id: sg.id, v: bb.needIntensity.estimate * 0.4 + bb.willingnessToPay.estimate * 0.35 + bb.retentionPotential.estimate * 0.55 }
      })
      const best = scored.sort((x, y) => y.v - x.v)[0]
      if (best.id !== target) repositionTo(s, best.id, s.week)
    }

    const now = c.primaryTargetSegmentId
    const belief = c.segmentBeliefs[now]
    c.pricing = belief.willingnessToPay.estimate >= 70 ? 'premium' : belief.willingnessToPay.estimate >= 40 ? 'market' : 'low'
    c.focus = segmentDef(sector, now).values[0]
    s.allocation = belief.productRequirement.estimate > 65
      ? { features: 30, quality: 45, bugs: 15, research: 10, bet: 0 }
      : { features: 45, quality: 30, bugs: 15, research: 10, bet: 0 }

    const retention = c.retentionBySegment[now] ?? 0
    history.push(retention)
    const back = history[history.length - 5]
    const settled = back === undefined || retention >= back - 0.02
    const proven = totalCustomers(c, now) >= PMF_CUSTOMER_FLOOR && retention >= 0.62 && settled

    // ---- the fork ----
    if (!isTokenised(s) && token.timing.kind !== 'never' && canTokenise(s)) {
      const ready =
        token.timing.kind === 'asap' ||
        (token.timing.kind === 'proven' && proven) ||
        (token.timing.kind === 'after' && s.week >= token.timing.week)
      if (ready) {
        standingAtLaunch = founderStanding(s)
        valuationAtLaunch = valuation(s)
        // Which of §7.7's three bounds actually bit on the day, and how late the launch reads. If
        // the valuation ceiling never binds early, then lowering it early cannot price the head
        // start and the lever is the wrong one.
        const pre = resolveLaunchTerms(s)
        boundBy = pre.boundBy
        lateness = pre.lateness
        const cashBefore = s.cash
        if (tokeniseCompany(s).ok) {
          tokenisedWeek = s.week
          saleProceeds = s.cash - cashBefore
          if (token.burnSaleCash) s.cash = cashBefore
          launchPrice = s.token!.market.price
          // The fundamental anchor on the day the sale cleared. `fairValue` is a per-token price,
          // so this is directly comparable to what the community paid.
          launchFair = fairValue(s)
        }
      }
    }

    // ---- the treasury policy ----
    if (isTokenised(s)) {
      if (token.shares) {
        const next = token.shares(s)
        if (next) {
          const key = JSON.stringify(next)
          if (key !== sharesSet) {
            setIncentiveShares(s, next)
            sharesSet = key
          }
        }
      }
      if (token.sellEvery && (!token.sellWhen || token.sellWhen(s))) {
        const max = maxTreasurySale(s)
        if (max > 0) sellTokenTreasury(s, Math.floor(max * token.sellEvery))
      }
      if (token.founderSellEvery) {
        const max = maxFounderSale(s)
        if (max > 0) {
          const before = s.bankedPayout
          if (sellFounderTokens(s, Math.floor(max * token.founderSellEvery)).ok) {
            founderSaleCount++
            founderBanked += s.bankedPayout - before
          }
        }
      }
    }

    const floor = careerMarketingDrain(s) + 3_000
    const want = proven
      ? Math.max(4_000, Math.min(s.lastRevenue * 1.1, s.cash * 0.05))
      : Math.min(floor, s.cash * 0.02)
    s.marketingSpend = token.ignoreCap ? Math.max(0, Math.min(want, s.cash)) : spendCap(s, want)
    if (!token.ignoreCap && want > marketingMax(s) + 1) cappedWeeks++
    cashMarketing += s.marketingSpend
    s = advanceWeek(s)
    if (networkOfferWeek === null) {
      const offer = s.inbox.find((m) => typeof m.id === 'string' && m.id.startsWith('token-network-offer-'))
      if (offer) networkOfferWeek = offer.week
    }
    // The engine's tokenised-only promotion, replayed on the institutional path. Applied after
    // `advanceWeek` and once per week, exactly where and how the engine applies it.
    if (token.freeStages && !s.gameOver && !isTokenised(s)) {
      const i = STAGE_ORDER.indexOf(s.stage)
      const up = STAGE_ORDER[i + 1]
      if (up && valuation(s) >= STAGE_THRESHOLDS[s.stage]) s.stage = up
    }
    // `advanceIncentiveStocks` writes the week's actual release onto the programme, so this is what
    // the treasury really deployed at customer acquisition, in dollars.
    const rewards = s.token?.incentives.find((p) => p.category === 'customer_rewards')
    if (rewards && s.token) tokenRewards += rewards.tokensPerWeek * s.token.market.price
  }
  return {
    state: s,
    tokenisedWeek,
    standingAtLaunch,
    launchPrice,
    launchFair,
    saleProceeds,
    valuationAtLaunch,
    cashMarketing,
    tokenRewards,
    cappedWeeks,
    boundBy,
    lateness,
    founderSaleCount,
    founderBanked,
    networkWeek: s.gameOver?.type === 'network' ? s.gameOver.week : null,
    networkOfferWeek,
  }
}

// ---------- the incentive policies ----------

const share = (v: Partial<IncentiveShares>): Partial<IncentiveShares> => v

/** Growth-led. What a founder who tokenised to buy users would do. */
const REWARDS_LED = () => share({ customer_rewards: 0.6, liquidity_incentives: 0.2, partnerships: 0.2 })

/** Utility-led, and it CHANGES: grants and liquidity until the market has real utility, then a
 *  third into rewards. "Build utility before incentives", expressed as a policy rather than a
 *  fixed vector. */
const UTILITY_LED = (s: GameState) => {
  const u = s.token?.market.utility ?? 0
  return u < 40
    ? share({ developer_grants: 0.5, liquidity_incentives: 0.3, partnerships: 0.2 })
    : share({ developer_grants: 0.3, liquidity_incentives: 0.25, partnerships: 0.15, customer_rewards: 0.3 })
}

const ONLY = (c: keyof IncentiveShares) => () => share({ [c]: 1 } as Partial<IncentiveShares>)

// ---------- the arms ----------

interface Arm {
  name: string
  policy: TokenPolicy
}

const CORE: Arm[] = [
  { name: 'Traditional', policy: NO_TOKEN },
  // The counterfactual, not a strategy: the institutional path with the tokenised-only stage
  // promotion. Anything it recovers against `Traditional` was never tokenomics.
  { name: 'Traditional +free stages', policy: { timing: { kind: 'never' }, freeStages: true } },
  { name: 'Traditional, uncapped', policy: { timing: { kind: 'never' }, ignoreCap: true } },
  { name: 'Traditional, always raise', policy: { timing: { kind: 'never' }, alwaysRaise: true } },
  { name: 'Early Token', policy: { timing: { kind: 'asap' }, shares: REWARDS_LED } },
  { name: 'Utility-First Token', policy: { timing: { kind: 'proven' }, shares: UTILITY_LED } },
  { name: 'Late Token (wk60+)', policy: { timing: { kind: 'after', week: 60 }, shares: REWARDS_LED } },
  // Timing isolated: same policy as Utility-First, launched as early as possible.
  { name: 'Early Token · utility', policy: { timing: { kind: 'asap' }, shares: UTILITY_LED } },
  // Policy isolated: same timing as Early Token, no policy at all.
  { name: 'Token, idle treasury', policy: { timing: { kind: 'asap' } } },
  { name: 'Token, idle, sale burned', policy: { timing: { kind: 'asap' }, burnSaleCash: true } },
  // ICO Slice 7, §42. The same Early Token policy plus a founder who takes the maximum off the
  // table every time the cooldown and the lifetime cap permit it. The gap against `Early Token`
  // is the mechanic's whole price, measured rather than argued.
  { name: 'Early Token +§42 sales', policy: { timing: { kind: 'asap' }, shares: REWARDS_LED, founderSellEvery: 1 } },
  { name: 'Utility-First +§42 sales', policy: { timing: { kind: 'proven' }, shares: UTILITY_LED, founderSellEvery: 1 } },
  // The Slice-7-off counterfactuals. Same policy, same seeds, no `network` ending and no §42.
  { name: 'Early Token (Slice 6)', policy: { timing: { kind: 'asap' }, shares: REWARDS_LED, noSlice7: true } },
  { name: 'Utility-First (Slice 6)', policy: { timing: { kind: 'proven' }, shares: UTILITY_LED, noSlice7: true } },
  { name: 'Late Token (Slice 6)', policy: { timing: { kind: 'after', week: 60 }, shares: REWARDS_LED, noSlice7: true } },
  // The arms that TAKE the ending the first time it is offered. Everything else about them is
  // identical to the arm they are named after, so the difference is the decision and nothing else.
  { name: 'Early Token, steps back', policy: { timing: { kind: 'asap' }, shares: REWARDS_LED, takeNetworkExit: true } },
  { name: 'Utility-First, steps back', policy: { timing: { kind: 'proven' }, shares: UTILITY_LED, takeNetworkExit: true } },
  { name: 'Late Token, steps back', policy: { timing: { kind: 'after', week: 60 }, shares: REWARDS_LED, takeNetworkExit: true } },
]

const EXPLOITS: Arm[] = [
  { name: 'Rewards only', policy: { timing: { kind: 'asap' }, shares: ONLY('customer_rewards') } },
  { name: 'Grants only', policy: { timing: { kind: 'asap' }, shares: ONLY('developer_grants') } },
  { name: 'Liquidity only', policy: { timing: { kind: 'asap' }, shares: ONLY('liquidity_incentives') } },
  { name: 'Partnerships only', policy: { timing: { kind: 'asap' }, shares: ONLY('partnerships') } },
  { name: 'Employee comp only', policy: { timing: { kind: 'asap' }, shares: ONLY('employee_compensation') } },
  { name: 'Community treasury only', policy: { timing: { kind: 'asap' }, shares: ONLY('community_treasury') } },
  // The degenerate capital line: tokenise, sell the treasury into the float every week it lets you,
  // spend the cash on marketing. No incentives at all.
  { name: 'Treasury raid (100%)', policy: { timing: { kind: 'asap' }, sellEvery: 1 } },
  { name: 'Treasury raid (25%)', policy: { timing: { kind: 'asap' }, sellEvery: 0.25 } },
  // Pump then dump: buy the chart with liquidity + rewards, sell into the strength.
  {
    name: 'Pump and dump',
    policy: {
      timing: { kind: 'asap' },
      shares: () => share({ liquidity_incentives: 0.5, customer_rewards: 0.5 }),
      sellEvery: 1,
      sellWhen: (s) => {
        const t = s.token
        return !!t && t.market.price > t.market.emaPrice * 1.02
      },
    },
  },
]

// ---------- reporting ----------

const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]
const money = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`)
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

export const failed = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'
/** The score. `gameOver.payout` when the run ended, `founderStanding` — token leg included — when
 *  it is still trading at the horizon. */
export const founderNet = (s: GameState) => s.gameOver?.payout ?? founderStanding(s)

function summarise(name: string, runs: RunResult[]): string {
  const states = runs.map((r) => r.state)
  const net = states.map(founderNet)
  const bad = states.filter(failed).length
  const tokenised = runs.filter((r) => r.tokenisedWeek !== null).length
  const launchWeeks = runs.filter((r) => r.tokenisedWeek !== null).map((r) => r.tokenisedWeek!)
  const endings: Record<string, number> = {}
  for (const s of states) endings[s.gameOver?.type ?? 'trading'] = (endings[s.gameOver?.type ?? 'trading'] ?? 0) + 1
  // The token leg's share of standing, over the runs where it can be read at all: tokenised and
  // still trading. An acquired run has already collapsed both legs into one payout number.
  const legs = runs
    .filter((r) => r.tokenisedWeek !== null && !r.state.gameOver)
    .map((r) => {
      const total = founderStanding(r.state)
      return total > 0 ? realisableTokenValue(r.state) / total : 0
    })
  const eq = states.map((s) => s.founderEquity)
  return (
    `  ${pad(name, 24)} failed ${padL(String(bad), 2)}/${runs.length}` +
    ` · net ${padL(money(q(net, 0.5)), 8)} [${money(q(net, 0.1))}…${money(q(net, 0.9))}]`.padEnd(36) +
    ` · equity ${padL(`${Math.round(q(eq, 0.5) * 100)}%`, 4)}` +
    ` · tokenised ${padL(String(tokenised), 2)}/${runs.length}${launchWeeks.length ? ` (wk ${padL(String(q(launchWeeks, 0.5)), 2)})` : '      '}` +
    ` · token leg ${padL(legs.length ? `${Math.round(q(legs, 0.5) * 100)}%` : '—', 4)}` +
    ` · capped ${padL(String(q(runs.map((r) => r.cappedWeeks), 0.5)), 2)}wk` +
    (() => {
      // §7.7's three bounds, on the runs that actually forked. Which one bites decides whether the
      // sale ceiling is a lever at all: a ceiling that never binds cannot be lowered to any effect.
      const forked = runs.filter((r) => r.tokenisedWeek !== null)
      if (!forked.length) return ''
      const by: Record<string, number> = {}
      for (const r of forked) by[r.boundBy] = (by[r.boundBy] ?? 0) + 1
      const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0]
      return ` · bound ${pad(`${top[0]}×${top[1]}`, 18)} · late ${q(forked.map((r) => r.lateness), 0.5).toFixed(2)}`
    })() +
    ` · ${Object.entries(endings).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ')}`
  )
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 11 * (i + 1))
const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml']
const picked = ALL.filter((x) => process.argv.includes(x))
const SECTORS: SectorId[] = process.argv.includes('all') ? ALL : picked.length ? picked : ALL

const arms = process.argv.includes('exploits') ? [...CORE, ...EXPLOITS] : CORE
const armBy = (name: string): Arm => {
  const a = [...CORE, ...EXPLOITS].find((x) => x.name === name)
  if (!a) throw new Error(`no arm named ${name}`)
  return a
}

console.log(`— ICO Slice 8 · capital-path balance · ${SEEDS.length} seeds × 90 weeks · median [p10…p90] —`)
const table: Record<string, Record<string, number>> = {}
for (const sector of SECTORS) {
  console.log(`\n${sectorById(sector).name}`)
  for (const arm of arms) {
    const runs = SEEDS.map((seed) => play(seed, sector, arm.policy))
    console.log(summarise(arm.name, runs))
    ;(table[arm.name] ??= {})[sector] = q(runs.map((r) => founderNet(r.state)), 0.5)
  }
}

console.log('\n— median founder net, by sector —')
console.log(`  ${pad('', 24)}${SECTORS.map((x) => padL(x, 12)).join('')}`)
for (const arm of arms) {
  const row = table[arm.name]
  if (!row) continue
  console.log(`  ${pad(arm.name, 24)}${SECTORS.map((x) => padL(money(row[x] ?? 0), 12)).join('')}`)
}

// ---------- WHY. The two mechanisms, measured directly ----------
//
// 1. THE LAUNCH DISCOUNT. `resolveLaunchTerms` clears the sale against FLOAT DEPTH — what the
//    community can absorb — and the launch price is `saleProceeds / saleTokens`. `fairValue` is the
//    per-token anchor gravity pulls toward, built from revenue and organic users. If the sale
//    clears far below the anchor, the founder's allocation is bought at a discount and gravity
//    re-rates it. §7.12 designed the depressed clearing price as the COST of launching early; this
//    measures whether it is instead a free option.
//
// 2. THE TREASURY AS A MARKETING BUDGET. `treasuryCommitment` caps the weekly release in TOKENS,
//    which bounds the FLOAT FRACTION and therefore the price impact. But
//    `resolveIncentivisedAcquisition` is handed DOLLARS (`tokens × price`), so the same 2% of the
//    treasury buys N× more customers after the price has risen N×. This prints both budgets.

if (process.argv.includes('why')) {
  console.log('\n— why: the launch discount, and the two acquisition budgets (Early Token) —')
  for (const sector of SECTORS) {
    const runs = SEEDS.map((seed) => play(seed, sector, armBy('Early Token').policy)).filter((r) => r.tokenisedWeek !== null)
    if (!runs.length) continue
    const disc = runs.filter((r) => r.launchFair > 0).map((r) => r.launchFair / r.launchPrice)
    const rerate = runs.filter((r) => r.state.token).map((r) => r.state.token!.market.price / r.state.token!.market.launchPrice)
    const saleVsVal = runs.filter((r) => r.valuationAtLaunch > 0).map((r) => r.saleProceeds / r.valuationAtLaunch)
    const cash = runs.map((r) => r.cashMarketing)
    const tok = runs.map((r) => r.tokenRewards)
    const ratio = runs.filter((r) => r.cashMarketing > 0).map((r) => r.tokenRewards / r.cashMarketing)
    console.log(
      `  ${pad(sectorById(sector).name, 12)} fair/launch price ${padL(q(disc, 0.5).toFixed(1) + '×', 7)} [${q(disc, 0.1).toFixed(1)}…${q(disc, 0.9).toFixed(1)}]` +
        ` · re-rated ${padL(q(rerate, 0.5).toFixed(1) + '×', 7)}` +
        ` · sale ${padL(`${Math.round(q(saleVsVal, 0.5) * 100)}%`, 4)} of EV` +
        ` · cash marketing ${padL(money(q(cash, 0.5)), 8)} vs token rewards ${padL(money(q(tok, 0.5)), 8)} (${q(ratio, 0.5).toFixed(1)}×)`,
    )
  }
}

// ---------- decomposition: where does the gap actually come from? ----------
//
// `Token, idle treasury` takes the fork and then does nothing with it — no incentives, no sales —
// so anything it gains over `Traditional` is the FORK itself. This prints the end state of both on
// the same seeds so the gap can be attributed rather than guessed at: enterprise value, users,
// revenue, founder equity, the stage the company reached (which is what `marketingMax` reads), and
// the cash each one actually put into marketing over ninety weeks.

if (process.argv.includes('decompose')) {
  const STAGES = STAGE_ORDER as string[]
  console.log('\n— decomposition: Traditional vs the fork with an idle treasury —')
  for (const sector of SECTORS) {
    for (const [label, policy] of [
      ['Traditional', NO_TOKEN],
      ['Token, idle', { timing: { kind: 'asap' } } as TokenPolicy],
    ] as [string, TokenPolicy][]) {
      const runs = SEEDS.map((seed) => play(seed, sector, policy))
      const st = runs.map((r) => r.state)
      console.log(
        `  ${pad(sectorById(sector).name + ' · ' + label, 26)}` +
          ` EV ${padL(money(q(st.map(valuation), 0.5)), 8)}` +
          ` · users ${padL(Math.round(q(st.map((s) => s.users), 0.5)).toLocaleString(), 8)}` +
          ` · rev/wk ${padL(money(q(st.map((s) => s.lastRevenue), 0.5)), 7)}` +
          ` · equity ${padL(`${Math.round(q(st.map((s) => s.founderEquity), 0.5) * 100)}%`, 4)}` +
          ` · stage ${pad(STAGES[Math.round(q(st.map((s) => STAGES.indexOf(s.stage)), 0.5))] ?? '?', 9)}` +
          ` · mktg spent ${padL(money(q(runs.map((r) => r.cashMarketing), 0.5)), 8)}` +
          ` · sale ${padL(money(q(runs.map((r) => r.saleProceeds), 0.5)), 7)}` +
          ` · net ${padL(money(q(runs.map((r) => founderNet(r.state)), 0.5)), 8)}`,
      )
    }
  }
}

// ---------- is tokenising ever free? ----------
//
// The question the plan asks directly: "is there a timing window where tokenising is free — all
// upside, no cost?" The `Token, idle treasury` arm is the control that answers it — it takes the
// fork and then does nothing with it, so any difference against `Traditional` is the FORK's price,
// with no incentive policy on top. Below, the same comparison per launch week band.

if (process.argv.includes('free')) {
  console.log('\n— the fork\'s own price, by launch week (idle treasury, no incentives, no sales) —')
  for (const sector of SECTORS) {
    const trad = SEEDS.map((seed) => founderNet(play(seed, sector, NO_TOKEN).state))
    const bands: Record<string, { tok: number[]; base: number[] }> = {}
    for (const after of [0, 20, 40, 60, 75]) {
      const runs = SEEDS.map((seed, i) => {
        const r = play(seed, sector, { timing: { kind: 'after', week: after } })
        return { net: founderNet(r.state), week: r.tokenisedWeek, base: trad[i] }
      })
      const took = runs.filter((r) => r.week !== null)
      if (!took.length) continue
      const key = `wk≥${after}`
      bands[key] = { tok: took.map((r) => r.net), base: took.map((r) => r.base) }
    }
    console.log(`  ${sectorById(sector).name}`)
    for (const [k, v] of Object.entries(bands)) {
      const t = q(v.tok, 0.5)
      const b = q(v.base, 0.5)
      console.log(
        `    ${pad(k, 8)} n=${padL(String(v.tok.length), 2)} · token ${padL(money(t), 9)} · same seeds traditional ${padL(money(b), 9)} · ratio ${(t / Math.max(1, b)).toFixed(2)}×`,
      )
    }
  }
}

// ---------- the `network` ending: does it fire, and is it worth anything? ----------
//
// ICO Slice 7. Two questions, both of which the brief for the slice insisted be MEASURED rather
// than asserted, because the pre-slice measurements said the specified design failed both:
//
//   1. DOES IT FIRE? §1.4's `networkValue >= $1B` gate fires in zero of ~450 measured runs (see
//      the `reach` block below for the distribution that shows why). `TOKEN_ENDINGS.networkValue`
//      is the amended bar; this block counts how often the whole six-clause gate actually closes.
//   2. IS IT WORTH ANYTHING? §1.4's payout — `founderStanding` at 1.0x — is character-for-character
//      what a still-trading token run already scores, so as specified the ending is worth $0.00.
//      `networkExitPremium` is the term that changes that, and this prints its measured size and
//      the payout delta it produces, per sector.

/** The token leg's share of standing — the number that decides how much a token-leg premium is
 *  worth on the whole score, and the one this slice's report has to quote honestly. */
const legShare = (s: GameState) => {
  const total = founderStanding(s)
  return total > 0 ? realisableTokenValue(s) / total : 0
}

if (process.argv.includes('endings')) {
  console.log('\n- the network ending: how often the gate closes and an offer is tabled -')
  for (const sector of SECTORS) {
    for (const arm of [armBy('Early Token'), armBy('Utility-First Token'), armBy('Late Token (wk60+)')]) {
      const runs = SEEDS.map((seed) => play(seed, sector, arm.policy))
      const tokenised = runs.filter((r) => r.tokenisedWeek !== null)
      if (!tokenised.length) continue
      const fired = tokenised.filter((r) => r.networkOfferWeek !== null)
      // How close the ones that did NOT fire got. A gate everybody misses by a mile is set wrong in
      // a different way from one everybody misses by a single clause.
      const near = tokenised
        .filter((r) => r.networkOfferWeek === null && !r.state.gameOver)
        .map((r) => networkEndingProgress(r.state).readiness)
      console.log(
        `  ${pad(sectorById(sector).name + ' . ' + arm.name, 42)} fired ${padL(String(fired.length), 2)}/${padL(String(tokenised.length), 2)}` +
          ` (${padL(`${Math.round((fired.length / tokenised.length) * 100)}%`, 4)})` +
          (fired.length
            ? ` . median offered wk ${padL(String(q(fired.map((r) => r.networkOfferWeek!), 0.5)), 2)}`
            
            : ' '.repeat(46)) +
          (near.length ? ` . near-miss readiness ${q(near, 0.5).toFixed(2)}` : ''),
      )
    }
  }

  // The premium, priced on the runs that can still be read: tokenised and still trading. `spec` is
  // §1.4's payout exactly; `slice7` is what the ending actually pays.
  console.log('\n- the exit premium: §1.4 as specified vs what Slice 7 pays (token runs still trading at wk 90) -')
  for (const sector of SECTORS) {
    for (const arm of [armBy('Early Token'), armBy('Utility-First Token')]) {
      const runs = SEEDS.map((seed) => play(seed, sector, arm.policy)).filter((r) => r.tokenisedWeek !== null && !r.state.gameOver)
      if (!runs.length) continue
      const spec = runs.map((r) => founderStanding(r.state))
      const slice7 = runs.map((r) => founderStanding(r.state, { tokenMultiplier: networkExitPremium(r.state) }))
      const prem = runs.map((r) => networkExitPremium(r.state))
      const delta = runs.map((_, i) => (spec[i] > 0 ? slice7[i] / spec[i] : 1))
      console.log(
        `  ${pad(sectorById(sector).name + ' . ' + arm.name, 42)} n=${padL(String(runs.length), 2)}` +
          ` . spec ${padL(money(q(spec, 0.5)), 9)} . slice7 ${padL(money(q(slice7, 0.5)), 9)}` +
          ` . token-leg premium ${q(prem, 0.5).toFixed(2)}x . on the whole score ${q(delta, 0.5).toFixed(3)}x` +
          ` (token leg is ${Math.round(q(runs.map((r) => legShare(r.state)), 0.5) * 100)}% of standing)`,
      )
    }
  }
}

// ---------- is the ending a TRAP? per-seed, against the run that was allowed to continue ----------
//
// The `network` ending terminates the run. So its payout has to be compared not with zero but with
// what the SAME SEED scored by playing on to week 90 with Slice 7 off. If it pays less, reaching
// the game's newest success state is a punishment, and no amount of ceremony fixes that.

if (process.argv.includes('counterfactual')) {
  console.log('\n- the network ending vs playing on: same seed, Slice 7 on and off -')
  for (const sector of SECTORS) {
    for (const [on, off] of [
      ['Early Token, steps back', 'Early Token (Slice 6)'],
      ['Utility-First, steps back', 'Utility-First (Slice 6)'],
      ['Late Token, steps back', 'Late Token (Slice 6)'],
    ] as [string, string][]) {
      const a = SEEDS.map((seed) => play(seed, sector, armBy(on).policy))
      const b = SEEDS.map((seed) => play(seed, sector, armBy(off).policy))
      const pairs = a.map((r, i) => ({ r, base: b[i] })).filter((x) => x.r.networkWeek !== null)
      if (!pairs.length) continue
      const ratios = pairs.map((x) => (x.r.state.gameOver!.payout ?? 0) / Math.max(1, founderNet(x.base.state)))
      const better = ratios.filter((x) => x >= 1).length
      console.log(
        `  ${pad(sectorById(sector).name + ' . ' + on, 42)} n=${padL(String(pairs.length), 2)}` +
          ` . ending ${padL(money(q(pairs.map((x) => x.r.state.gameOver!.payout ?? 0), 0.5)), 9)}` +
          ` . kinds ${Object.entries(
            pairs.reduce<Record<string, number>>((acc, x) => {
              const k = x.r.state.gameOver!.tokenEnding ?? '?'
              acc[k] = (acc[k] ?? 0) + 1
              return acc
            }, {}),
          )
            .sort((x, y) => y[1] - x[1])
            .map(([k, v]) => `${k}x${v}`)
            .join(' ')}` +
          ` . same seed playing on ${padL(money(q(pairs.map((x) => founderNet(x.base.state)), 0.5)), 9)}` +
          ` . ratio ${q(ratios, 0.5).toFixed(2)}x [${q(ratios, 0.1).toFixed(2)}...${q(ratios, 0.9).toFixed(2)}]` +
          ` . better in ${better}/${pairs.length}`,
      )
    }
  }
}

// ---------- §42: what does selling your own position cost, and what does it buy? ----------
//
// The hazard this arm exists to catch: `liquidityDiscount` says a founder realises 0.20-0.85 of
// their bag at the horizon because a block sale does not clear at the screen price. If selling in
// slices clears at ~spot, the discount stops being the token path's exit multiple and §42 is a pure
// buff. The caps (4% of float per sale, one sale per 16 weeks, half the grant across the run) and
// the trust cost are what is supposed to stop that. This measures whether they do.

if (process.argv.includes('founder')) {
  console.log('\n- §42 founder sales: the same arm with and without them -')
  for (const sector of SECTORS) {
    for (const [base, withSales] of [
      ['Early Token', 'Early Token +§42 sales'],
      ['Utility-First Token', 'Utility-First +§42 sales'],
    ] as [string, string][]) {
      const a = SEEDS.map((seed) => play(seed, sector, armBy(base).policy))
      const b = SEEDS.map((seed) => play(seed, sector, armBy(withSales).policy))
      const forked = b.filter((r) => r.tokenisedWeek !== null && r.state.token)
      const baseForked = a.filter((r) => r.tokenisedWeek !== null && r.state.token)
      if (!forked.length || !baseForked.length) continue
      const na = q(a.map((r) => founderNet(r.state)), 0.5)
      const nb = q(b.map((r) => founderNet(r.state)), 0.5)
      const sold = forked.filter((r) => r.founderSaleCount > 0)
      console.log(
        `  ${pad(sectorById(sector).name + ' . ' + base, 40)} without ${padL(money(na), 9)} . with ${padL(money(nb), 9)}` +
          ` . ratio ${(nb / Math.max(1, na)).toFixed(2)}x` +
          ` . sales ${padL(String(q(forked.map((r) => r.founderSaleCount), 0.5)), 2)}/max ${Math.max(...forked.map((r) => r.founderSaleCount))}` +
          ` . banked ${padL(money(sold.length ? q(sold.map((r) => r.founderBanked), 0.5) : 0), 8)}` +
          ` . trust ${padL(q(baseForked.map((r) => r.state.token!.community.trust), 0.5).toFixed(0), 3)}` +
          ` -> ${q(forked.map((r) => r.state.token!.community.trust), 0.5).toFixed(0)}` +
          ` . token leg ${(q(baseForked.map((r) => legShare(r.state)), 0.5) * 100).toFixed(0)}%` +
          ` -> ${(q(forked.map((r) => legShare(r.state)), 0.5) * 100).toFixed(0)}%`,
      )
    }
  }
}

// ---------- REACH: what a token run actually gets to, so a gate can be set against it ----------

if (process.argv.includes('reach')) {
  console.log('\n— reach: the distribution a gate has to clear (all token arms pooled, wk 90) —')
  const armsR = [armBy('Early Token'), armBy('Utility-First Token'), armBy('Late Token (wk60+)'), armBy('Token, idle treasury')]
  for (const sector of SECTORS) {
    const runs = armsR.flatMap((a) => SEEDS.map((seed) => play(seed, sector, a.policy))).filter((r) => r.tokenisedWeek !== null && r.state.token)
    if (!runs.length) continue
    const st = runs.map((r) => r.state)
    const col = (label: string, xs: number[], f: (n: number) => string) =>
      `${label} ${padL(f(q(xs, 0.5)), 8)}/${padL(f(q(xs, 0.9)), 8)}/${padL(f(q(xs, 0.99)), 8)}`
    console.log(
      `  ${pad(sectorById(sector).name, 12)} n=${padL(String(runs.length), 3)} (p50/p90/p99)  ` +
        col('net', st.map(networkValue), money) +
        ' · ' + col('util', st.map((s) => s.token!.market.utility), (n) => n.toFixed(0)) +
        ' · ' + col('org', st.map(organicShare), (n) => `${Math.round(n * 100)}%`) +
        ' · ' + col('dec', st.map((s) => s.token!.community.decentralisation), (n) => n.toFixed(0)) +
        ' · ' + col('trust', st.map((s) => s.token!.community.trust), (n) => n.toFixed(0)) +
        ' · ' + col('hold', st.map((s) => s.token!.community.holders), (n) => Math.round(n).toLocaleString()),
    )
  }
}

// ---------- the shape of a token run ----------

if (process.argv.includes('shape')) {
  console.log('\n— the shape of a token run (Early Token, tokenised runs only) —')
  for (const sector of SECTORS) {
    const runs = SEEDS.map((seed) => play(seed, sector, armBy('Early Token').policy)).filter((r) => r.tokenisedWeek !== null)
    if (!runs.length) continue
    const s0 = runs.map((r) => r.state)
    const price = s0.map((s) => (s.token ? s.token.market.price / s.token.market.launchPrice : 0))
    const util = s0.map((s) => s.token?.market.utility ?? 0)
    const spec = s0.map((s) => s.token?.market.speculation ?? 0)
    const depth = s0.map((s) => s.token?.market.depth ?? 0)
    const nv = s0.map((s) => networkValue(s))
    const org = s0.map((s) => organicShare(s))
    console.log(
      `  ${pad(sectorById(sector).name, 12)} price ${q(price, 0.5).toFixed(2)}× launch [${q(price, 0.1).toFixed(2)}…${q(price, 0.9).toFixed(2)}]` +
        ` · utility ${Math.round(q(util, 0.5))} · spec ${Math.round(q(spec, 0.5))} · depth ${q(depth, 0.5).toFixed(2)}` +
        ` · network ${money(q(nv, 0.5))} · organic ${Math.round(q(org, 0.5) * 100)}%`,
    )
  }
}
