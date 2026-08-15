// Balance diagnosis harness (Slice -1). Not part of `npm test` — it is a sweep, not an assertion.
//
// Run: npx tsx test/balance-probe.ts <mode> [sector...]
//
//   ladder     decompose Coast → Reference one activity at a time (why does playing kill you?)
//   unit       marginal CAC vs marginal LTV of a marketing dollar, measured off the engine's own
//              functions rather than a transcribed formula
//   heads      headcount sweep: what does the Nth employee return?
//   pricing    the three pricing levers as the belief-driven bot uses them
//   landgrab   the three pricing levers against all three segment tiers — the test `pricing` and
//              the review's `always low` never ran, because both let beliefs pick the SEGMENT
//   margin     revenue-denominated vs margin-denominated hiring (the Social question)
//
// Read this before trusting a number out of it:
//
//  * Every budget goes through `spend()`, which applies `marketingMax` and the cash balance. A bot
//    that sets `s.marketingSpend` directly is describing a game nobody can play.
//  * `unit` never transcribes an engine formula. Marginal customers come from calling
//    `resolveSegmentAcquisition` twice with a *constant* rng so the noise term cancels; revenue per
//    customer comes from the run's own `lastRevenue / users`, not from re-deriving it.
//  * The ladder strategies differ from `Reference` in exactly one lever each, so a difference
//    between two rows is attributable to that lever and nothing else.
//  * **`alive` is not a fitness measure and this harness does not report one.** `gameOver` covers
//    `acquired`, `unicorn` and `ipo` as well as `bankrupt` and `fired`, and the acquisition offer's
//    choice 0 is *Sell the company* — a premium exit. Every bot in `career-bots.ts` and
//    `exploit-probe.ts` resolves choices with index 0, so any bot valuable enough to be bought
//    sells, and those harnesses counted the sale as a death. `Coast` is never offered an exit
//    (the trigger is valuation > $8M) so it scores a perfect record by being worthless.
//    Rows below report `failed` (bankrupt + fired) and `exit` separately, and score off
//    `gameOver.payout` when there is one so the acquisition premium is not thrown away.

import {
  advanceWeek,
  newGame,
  pitchInvestors,
  acceptTermSheet,
  resolveChoiceOnState,
  valuation,
  marketingMax,
  weeklyPayroll,
  weeklyOffice,
  weeklyInfra,
} from '../src/game/engine'
import {
  canRunExperiment,
  experimentDef,
  segmentsForSector,
  segmentDef,
  startExperiment,
  totalCustomers,
  PMF_CUSTOMER_FLOOR,
  resolveSegmentAcquisition,
  resolveCohortRetention,
  segmentPriceFit,
  segmentProductFit,
  segmentCeiling,
} from '../src/game/career/pmf'
import { careerAcqScale, repositionTo, careerMarketingDrain } from '../src/game/career/tick'
import { sectorById } from '../src/game/data'
import type { GameState, SectorId } from '../src/game/types'
import type { ExperimentType, PricingStrategy } from '../src/game/career/types'

let ids = 0
const uid = () => `b${ids++}`
/** `npm run balance -- <mode> no-aggro` replays against rivals that only grow — the world as it was
 *  before the `rivalAggression` capability. Same A/B-in-one-build discipline as career-bots.ts. */
const AGGRO = !process.argv.includes('no-aggro')
const cfg = (seed: number, sector: SectorId) => ({
  mode: 'career' as const,
  format: 'standard' as const,
  sector,
  seed,
  overrides: { rivalAggression: AGGRO },
})
const spend = (s: GameState, want: number) => Math.max(0, Math.min(want, marketingMax(s), s.cash))

export interface Telemetry {
  state: GameState
  /** every week's marginal CAC and marginal LTV, sampled from the live state */
  cac: number[]
  ltv: number[]
  /** the target segment's 4-week retention at the moment each sample was taken */
  ret: number[]
  marketingSpent: number
  payrollSpent: number
  revenueEarned: number
}

export interface Levers {
  pricing?: PricingStrategy
  /** false = never hire */
  hire?: boolean
  /** cap on total heads; the bot hires up to min(this, revenue rule) */
  maxHeads?: number
  /** hire against gross margin instead of revenue (the Social question) */
  marginHiring?: boolean
  experiments?: boolean
  raise?: boolean
  spendScale?: number
  /** measure marginal CAC/LTV every week */
  telemetry?: boolean
  /** override the pricing decision with a function of the state */
  priceBy?: (s: GameState) => PricingStrategy
  /** false = decline acquisition offers and keep building (choice 1 instead of choice 0) */
  sell?: boolean
  /** lock the target segment from week 1 instead of letting beliefs choose it */
  target?: 'cheapest' | 'middle' | 'richest'
  /** land grab: switch to this pricing at this week */
  switchTo?: { week: number; pricing: PricingStrategy }
}

/**
 * The price-sensitive end of the market: every sector has one high-volume, high-reach, low-WTP
 * archetype (Freelancers, Individual Developers, Individual Sellers, Everyday Consumers, Casual
 * Users). This is the situation `low` pricing exists for, and no existing probe ever pointed a
 * low-price policy at it — `always low` priced low while its beliefs steered it at the ENTERPRISE
 * segment, which measures the lever against the wrong market and answers a question nobody asked.
 */
function pickSegment(s: GameState, which: 'cheapest' | 'middle' | 'richest'): string {
  const t = s.career!.segmentTruth
  const byWtp = segmentsForSector(s.sector)
    .map((sg) => sg.id)
    .sort((a, b) => t[a].willingnessToPay - t[b].willingnessToPay)
  return which === 'cheapest' ? byWtp[0] : which === 'richest' ? byWtp[byWtp.length - 1] : byWtp[Math.floor(byWtp.length / 2)]
}

/** Resolve the inbox. Acquisition offers are the one choice where index 0 ends the run. */
function clearInbox(s: GameState, lv: Levers) {
  for (const m of s.inbox) {
    if (m.kind !== 'choice' || m.resolved || !m.choices) continue
    const isAcquisition = m.meta?.acquisitionAmount !== undefined
    resolveChoiceOnState(s, m.id, isAcquisition && lv.sell === false ? 1 : 0)
  }
}

/** Gross margin this week: revenue minus the costs a customer causes, before payroll/marketing. */
function grossMargin(s: GameState): number {
  return s.lastRevenue - weeklyInfra(s) - weeklyOffice(s)
}

function hireStep(s: GameState, lv: Levers) {
  if (lv.hire === false) return
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  // The shared rule every existing bot uses: headcount denominated in REVENUE.
  const byRevenue = 1 + Math.floor(s.lastRevenue / 2500)
  // The alternative: denominated in what the business actually keeps. A social app doing $10k/wk
  // on $1.8 ARPU is carrying a far bigger infra bill than a SaaS doing $10k/wk on $22.
  const byMargin = 1 + Math.floor(Math.max(0, grossMargin(s)) / 2500)
  const affordable = Math.min(lv.maxHeads ?? 8, lv.marginHiring ? byMargin : byRevenue)
  if (s.cash / Math.max(1, s.lastExpenses || 5000) > 25 && staff < affordable && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
}

function common(s: GameState, lv: Levers) {
  clearInbox(s, lv)
  if (lv.raise !== false) {
    if (s.raiseCooldown === 0 && s.cash < (s.lastExpenses || 5000) * 25) pitchInvestors(s)
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  }
  hireStep(s, lv)
}

function tryExperiment(s: GameState, type: ExperimentType, seg: string) {
  if (!s.career) return
  if (canRunExperiment(s.career, type, seg, s.cash).ok) {
    startExperiment(s.career, s.week, type, seg, uid())
    s.cash -= experimentDef(type).cashCost
  }
}

/**
 * Marginal unit economics, sampled off the LIVE state.
 *
 * CAC: call the engine's own `resolveSegmentAcquisition` at the current budget and at the current
 * budget + $1,000, with a constant rng so the ±15% noise term is identical in both calls. The
 * difference is the customers the last $1,000 bought.
 *
 * LTV: the run's measured revenue per customer, less the infra a customer costs, discounted by the
 * engine's own weekly keep rate for a settled cohort. No formula is copied.
 */
function unitEconomics(s: GameState, budget: number): { cac: number; ltv: number } {
  const c = s.career!
  const sector = sectorById(s.sector)
  const target = c.primaryTargetSegmentId
  const truth = c.segmentTruth[target]
  const fixed = () => 0.5
  const base = {
    truth,
    productFit: segmentProductFit(truth, s.quality, c.focus, s.sector, target),
    priceFit: segmentPriceFit(truth, c.pricing),
    hype: s.hype,
    currentCustomers: totalCustomers(c, target),
    ceiling: segmentCeiling(truth, sector.tam),
    marketingPenalty: c.repositioning ? c.repositioning.marketingPenalty : 1,
    acqScale: careerAcqScale(sector.acqBase),
    rng: fixed,
  }
  const bump = 1_000
  const at = resolveSegmentAcquisition({ ...base, marketingSpend: Math.max(0, budget) })
  const up = resolveSegmentAcquisition({ ...base, marketingSpend: Math.max(0, budget) + bump })
  const marginal = up - at
  const cac = marginal > 0 ? bump / marginal : Infinity

  const keep = resolveCohortRetention({
    truth,
    productFit: base.productFit,
    priceFit: base.priceFit,
    bugs: s.bugs,
    weeksSinceAcquired: 8, // past the honeymoon: the rate a customer actually settles at
  })
  const revPerCustomer = s.users > 0 ? s.lastRevenue / s.users : 0
  const netPerWeek = revPerCustomer - sector.infraCost
  const ltv = netPerWeek > 0 ? netPerWeek / Math.max(1e-6, 1 - keep) : 0
  return { cac, ltv }
}

/** The reference policy, with one lever at a time changed. */
export function play(seed: number, sector: SectorId, lv: Levers = {}, weeks = 90): Telemetry {
  let s = newGame('Probe', sector, 'technical', { config: cfg(seed, sector) })
  const history: number[] = []
  const t: Telemetry = { state: s, cac: [], ltv: [], ret: [], marketingSpent: 0, payrollSpent: 0, revenueEarned: 0 }
  if (lv.target) repositionTo(s, pickSegment(s, lv.target), 1)
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s, lv)
    const c = s.career!
    const target = c.primaryTargetSegmentId
    const b = c.segmentBeliefs[target]
    if (lv.experiments !== false) {
      const afford = (x: ExperimentType) => s.cash > experimentDef(x).cashCost * 8
      if (b.needIntensity.confidence < 0.4) { if (afford('interview')) tryExperiment(s, 'interview', target) }
      else if (b.acquisitionAccessibility.confidence < 0.4) { if (afford('landing_page')) tryExperiment(s, 'landing_page', target) }
      else if (b.productRequirement.confidence < 0.45) { if (afford('prototype')) tryExperiment(s, 'prototype', target) }
      else if (b.willingnessToPay.confidence < 0.55) { if (afford('pricing_test')) tryExperiment(s, 'pricing_test', target) }
      else if (b.retentionPotential.confidence < 0.65) { if (afford('pilot')) tryExperiment(s, 'pilot', target) }

      if (s.week === 30 && !lv.target) {
        const scored = segmentsForSector(sector).map((sg) => {
          const bb = c.segmentBeliefs[sg.id]
          return { id: sg.id, v: bb.needIntensity.estimate * 0.4 + bb.willingnessToPay.estimate * 0.35 + bb.retentionPotential.estimate * 0.55 }
        })
        const best = scored.sort((x, y) => y.v - x.v)[0]
        if (best.id !== target) repositionTo(s, best.id, s.week)
      }
    }

    const now = c.primaryTargetSegmentId
    const belief = c.segmentBeliefs[now]
    c.pricing =
      lv.switchTo && s.week >= lv.switchTo.week
        ? lv.switchTo.pricing
        : lv.priceBy
          ? lv.priceBy(s)
          : (lv.pricing ?? (belief.willingnessToPay.estimate >= 70 ? 'premium' : belief.willingnessToPay.estimate >= 40 ? 'market' : 'low'))
    c.focus = segmentDef(sector, now).values[0]
    s.allocation = belief.productRequirement.estimate > 65
      ? { features: 30, quality: 45, bugs: 15, research: 10, bet: 0 }
      : { features: 45, quality: 30, bugs: 15, research: 10, bet: 0 }

    const retention = c.retentionBySegment[now] ?? 0
    history.push(retention)
    const back = history[history.length - 5]
    const settled = back === undefined || retention >= back - 0.02
    const proven = totalCustomers(c, now) >= PMF_CUSTOMER_FLOOR && retention >= 0.62 && settled
    const floor = careerMarketingDrain(s) + 3_000
    const scale = lv.spendScale ?? 1
    s.marketingSpend = proven
      ? spend(s, scale * Math.max(4_000, Math.min(s.lastRevenue * 1.1, s.cash * 0.05)))
      : spend(s, scale * Math.min(floor, s.cash * 0.02))

    if (lv.telemetry && s.users > 20 && s.marketingSpend > 0) {
      const { cac, ltv } = unitEconomics(s, s.marketingSpend)
      if (Number.isFinite(cac)) { t.cac.push(cac); t.ltv.push(ltv); t.ret.push(retention) }
    }
    t.marketingSpent += s.marketingSpend
    t.payrollSpent += weeklyPayroll(s)
    s = advanceWeek(s)
    t.revenueEarned += s.lastRevenue
  }
  t.state = s
  return t
}

/** Do nothing at all: the floor the game has to beat. */
export function coast(seed: number, sector: SectorId, weeks = 90): Telemetry {
  let s = newGame('Coast', sector, 'technical', { config: cfg(seed, sector) })
  const t: Telemetry = { state: s, cac: [], ltv: [], ret: [], marketingSpent: 0, payrollSpent: 0, revenueEarned: 0 }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    clearInbox(s, {})
    s.marketingSpend = 0
    s = advanceWeek(s)
    t.revenueEarned += s.lastRevenue
  }
  t.state = s
  return t
}

// ---------- reporting ----------

const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]
const m$ = (n: number) => (Number.isFinite(n) ? '$' + (n / 1e6).toFixed(1) + 'M' : 'n/a')

/** Bankruptcy and being fired are the only failures. An acquisition or an IPO is a win. */
export const failed = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'

/**
 * What the founder actually walks away with. When the run ended, the ending already computed it —
 * and for an acquisition that number carries the 1.1–2.0x premium over `valuation()`, which
 * re-deriving from `valuation(s) * founderEquity` silently discards.
 */
export const founderNet = (s: GameState) => s.gameOver?.payout ?? valuation(s) * s.founderEquity + s.bankedPayout

export function report(name: string, runs: Telemetry[]) {
  const st = runs.map((r) => r.state)
  const bad = st.filter(failed).length
  const exits = st.filter((r) => r.gameOver && !failed(r)).length
  const net = st.map(founderNet)
  const kinds: Record<string, number> = {}
  for (const r of st) if (r.gameOver) kinds[r.gameOver.type] = (kinds[r.gameOver.type] ?? 0) + 1
  console.log(
    `  ${name.padEnd(26)} failed ${String(bad).padStart(2)}/${runs.length}` +
      ` · exits ${String(exits).padStart(2)}` +
      ` · founder net ${m$(q(net, 0.5)).padStart(8)} [${m$(q(net, 0.1))}…${m$(q(net, 0.9))}]` +
      ` · rev/wk ${('$' + Math.round(q(st.map((r) => r.lastRevenue), 0.5)).toLocaleString()).padStart(9)}` +
      ` · heads ${String(q(st.map((r) => r.employees.length), 0.5)).padStart(2)}` +
      ` · ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ') || 'all running'}`,
  )
}

// ---------- CLI ----------
// Guarded so the regression suite can import `play`/`coast` and reuse the exact bot this sweep
// measures, instead of keeping a second copy that can silently drift away from it.
if (process.argv[1]?.endsWith('balance-probe.ts')) {
  const SEEDS = Array.from({ length: 24 }, (_, i) => 11 * (i + 1))
  const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml']
  const picked = ALL.filter((x) => process.argv.includes(x))
  const SECTORS: SectorId[] = process.argv.includes('all') ? ALL : picked.length ? picked : ['saas', 'social']
  const mode = process.argv[2] ?? 'ladder'

  if (mode === 'ladder') {
    // One activity at a time, Coast → Reference. Each row differs from `Reference` in one lever.
    console.log(`— Coast → Reference ladder · ${SEEDS.length} seeds × 90 wk —`)
    for (const sector of SECTORS) {
      console.log(`\n${sectorById(sector).name}`)
      report('Coast (nothing)', SEEDS.map((s) => coast(s, sector)))
      report('+ experiments only', SEEDS.map((s) => play(s, sector, { hire: false, raise: false, spendScale: 0 })))
      report('+ raise only', SEEDS.map((s) => play(s, sector, { hire: false, experiments: false, spendScale: 0 })))
      report('+ marketing only', SEEDS.map((s) => play(s, sector, { hire: false, experiments: false, raise: false })))
      report('+ hiring only', SEEDS.map((s) => play(s, sector, { experiments: false, raise: false, spendScale: 0 })))
      report('Reference (all)', SEEDS.map((s) => play(s, sector, {})))
      report('Reference − hiring', SEEDS.map((s) => play(s, sector, { hire: false })))
      report('Reference − marketing', SEEDS.map((s) => play(s, sector, { spendScale: 0 })))
      report('Reference, never sells', SEEDS.map((s) => play(s, sector, { sell: false })))
    }
  }

  if (mode === 'unit') {
    console.log(`— marginal unit economics · ${SEEDS.length} seeds × 90 wk · median over sampled weeks —`)
    for (const sector of SECTORS) {
      const runs = SEEDS.map((s) => play(s, sector, { telemetry: true }))
      const cac = runs.flatMap((r) => r.cac)
      const ltv = runs.flatMap((r) => r.ltv)
      const pairs = runs.flatMap((r) => r.cac.map((c, i) => ({ ratio: r.ltv[i] / c, ret: r.ret[i] }))).filter((x) => Number.isFinite(x.ratio))
      const ratio = pairs.map((x) => x.ratio)
      console.log(
        `  ${sectorById(sector).name.padEnd(12)} marginal CAC $${Math.round(q(cac, 0.5)).toLocaleString().padStart(7)}` +
          ` · LTV $${Math.round(q(ltv, 0.5)).toLocaleString().padStart(7)}` +
          ` · LTV/CAC ${q(ratio, 0.5).toFixed(2).padStart(5)}` +
          ` [p10 ${q(ratio, 0.1).toFixed(2)} · p90 ${q(ratio, 0.9).toFixed(2)}]` +
          ` · ${(ratio.filter((x) => x >= 1).length / Math.max(1, ratio.length) * 100).toFixed(0)}% of weeks pay back`,
      )
      // Conditioned on retention: does playing WELL make marketing pay back? If even the best-retained
      // cohorts are under 1.0, growth cannot fund itself at any level of skill and that is structural.
      const bands: [string, number, number][] = [['ret <50%', 0, 0.5], ['50–65%', 0.5, 0.65], ['65–80%', 0.65, 0.8], ['≥80%', 0.8, 1.01]]
      const parts = bands.map(([label, lo, hi]) => {
        const inBand = pairs.filter((x) => x.ret >= lo && x.ret < hi).map((x) => x.ratio)
        return `${label} ${inBand.length ? q(inBand, 0.5).toFixed(2) : ' n/a'} (n=${inBand.length})`
      })
      console.log(`  ${' '.repeat(12)} by retention: ${parts.join(' · ')}`)
    }
  }

  if (mode === 'heads') {
    console.log(`— headcount sweep · ${SEEDS.length} seeds × 90 wk —`)
    for (const sector of SECTORS) {
      console.log(`\n${sectorById(sector).name}`)
      for (const n of [0, 1, 2, 3, 4, 6, 8]) {
        report(`max ${n} heads`, SEEDS.map((s) => play(s, sector, n === 0 ? { hire: false } : { maxHeads: n })))
      }
    }
  }

  if (mode === 'pricing') {
    console.log(`— pricing levers · ${SEEDS.length} seeds × 90 wk —`)
    for (const sector of SECTORS) {
      console.log(`\n${sectorById(sector).name}`)
      for (const p of ['low', 'market', 'premium'] as PricingStrategy[]) report(`always ${p}`, SEEDS.map((s) => play(s, sector, { pricing: p })))
      report('belief-priced', SEEDS.map((s) => play(s, sector, {})))
      report('oracle-priced', SEEDS.map((s) => play(s, sector, {
        priceBy: (s2) => {
          const wtp = s2.career!.segmentTruth[s2.career!.primaryTargetSegmentId].willingnessToPay
          return wtp >= 70 ? 'premium' : wtp >= 40 ? 'market' : 'low'
        },
      })))
    }
  }

  if (mode === 'landgrab') {
    // The question `always low` never asked: does low pricing win on the market it is FOR?
    console.log(`— pricing on the price-sensitive segment · ${SEEDS.length} seeds × 90 wk —`)
    for (const sector of SECTORS) {
      for (const [label, target] of [['LOWEST', 'cheapest'], ['MIDDLE', 'middle'], ['HIGHEST', 'richest']] as const) {
        console.log(`\n${sectorById(sector).name} — targeting the ${label} willingness-to-pay segment from week 1`)
        for (const p of ['low', 'market', 'premium'] as PricingStrategy[]) {
          report(`  ${p}`, SEEDS.map((s) => play(s, sector, { pricing: p, target })))
        }
      }
      report('  land grab: low → market @45', SEEDS.map((s) => play(s, sector, { pricing: 'low', target: 'cheapest', switchTo: { week: 45, pricing: 'market' } })))
    }
  }

  if (mode === 'margin') {
    console.log(`— revenue- vs margin-denominated hiring · ${SEEDS.length} seeds × 90 wk —`)
    for (const sector of SECTORS) {
      console.log(`\n${sectorById(sector).name}`)
      report('revenue-denominated', SEEDS.map((s) => play(s, sector, {})))
      report('margin-denominated', SEEDS.map((s) => play(s, sector, { marginHiring: true })))
      report('no hires', SEEDS.map((s) => play(s, sector, { hire: false })))
    }
  }
}
