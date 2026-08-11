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
import { founderStanding, networkValue, realisableTokenValue } from '../src/game/token/scoring'
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

function common(s: GameState, alwaysRaise = false) {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
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
}

function play(seed: number, sector: SectorId, token: TokenPolicy, weeks = 90): RunResult {
  let s = newGame('Bot', sector, 'technical', { config: cfg(seed, sector) })
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

  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s, token.alwaysRaise === true)
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
    }

    const floor = careerMarketingDrain(s) + 3_000
    const want = proven
      ? Math.max(4_000, Math.min(s.lastRevenue * 1.1, s.cash * 0.05))
      : Math.min(floor, s.cash * 0.02)
    s.marketingSpend = token.ignoreCap ? Math.max(0, Math.min(want, s.cash)) : spendCap(s, want)
    if (!token.ignoreCap && want > marketingMax(s) + 1) cappedWeeks++
    cashMarketing += s.marketingSpend
    s = advanceWeek(s)
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

interface Row {
  name: string
  runs: RunResult[]
}

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
const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social']
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

// ---------- what a `network` ending would be worth ----------
//
// Slices 5–7 are unbuilt: `GameOver['type']` has no `'network'` and nothing awards one. The
// architecture's §1.4 specifies its payout as `founderStanding(s)` — equity leg at 1.0×. This
// block prices that: for every token run still trading at week 90, what the score is now, and what
// it would be at the IPO band (0.95–1.80×) and at the acquisition median (2.05×) the fork closed.

if (process.argv.includes('endings')) {
  console.log('\n— what the missing endings are worth (token runs still trading at wk 90) —')
  for (const sector of SECTORS) {
    for (const arm of [armBy('Early Token'), armBy('Utility-First Token')]) {
      const runs = SEEDS.map((seed) => play(seed, sector, arm.policy)).filter((r) => r.tokenisedWeek !== null && !r.state.gameOver)
      if (!runs.length) continue
      const now = runs.map((r) => founderNet(r.state))
      // A `network` ending as specified: founderStanding at 1.0x. Identical to `now`.
      const spec = runs.map((r) => founderStanding(r.state))
      // Counterfactual premiums applied to the EQUITY LEG only, as every existing ending does.
      const atIpo = runs.map((r) => founderStanding(r.state, { equityMultiplier: 1.35 }))
      const atAcq = runs.map((r) => founderStanding(r.state, { exitValue: valuation(r.state) * 2.05 }))
      console.log(
        `  ${pad(sectorById(sector).name + ' · ' + arm.name, 40)} n=${padL(String(runs.length), 2)}` +
          ` · now ${padL(money(q(now, 0.5)), 9)} · §1.4 network ${padL(money(q(spec, 0.5)), 9)}` +
          ` · at IPO 1.35× ${padL(money(q(atIpo, 0.5)), 9)} · at acq 2.05× ${padL(money(q(atAcq, 0.5)), 9)}`,
      )
    }
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
