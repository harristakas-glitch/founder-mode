// Career PMF bot strategies (brief §53). Purpose is to detect broken or dominant play,
// not to make every bot succeed.
//
// Run: `npm run bots` (saas + fintech), or `npm run bots -- all` for every sector.
//
// Read this before trusting a number out of it:
//
//  * **Determinism.** Every engine entry point the bot calls is seeded, so identical input
//    produces byte-identical output. The harness used to need its own `withSeed` wrapper because
//    `resolveChoiceOnState` drew from `Math.random`; that hole is closed in the engine now.
//  * **Fair levers.** Every strategy sets pricing, product focus and engineering allocation —
//    the levers that actually move Career outcomes. What differs is *how each one decides*:
//    Careless guesses, Enterprise bets a fixed hand, Disciplined reads its own beliefs. Giving
//    only one bot the levers measures the levers, not the strategy.
//  * **`gameOver` is not failure.** It also covers `acquired`, `unicorn` and `ipo`. This harness
//    used to report `alive = !gameOver`, which counted a premium acquisition as a death — and
//    since `common()` answers every choice with option 0, and option 0 on an acquisition offer is
//    *Sell the company*, every bot successful enough to be bought was scored as having died. That
//    single line produced the headline "coasting survives 24/24 while active play survives 5–21/24"
//    in `docs/gameplay-review.md`: `Coast` is only ever offered an exit above a $8M valuation,
//    which it never reaches, so it scored a perfect record by being worthless. Report `failed`
//    (bankrupt + fired) and `exits` separately, and never re-collapse them into one number.
//  * **Score off `gameOver.payout`.** For an acquisition that number carries the 1.1–2.0x premium
//    over `valuation()`; re-deriving `valuation(s) * founderEquity` throws the premium away and
//    understates exactly the runs that did best.
//  * **The `$2k/wk` milestone is gone (2026-08-12), so milestone columns printed before that date
//    do not compare against milestone columns printed after it.** (failed/exits/customers/
//    retention/rev/valuation/founder net are all untouched and still compare.) The $2k gate was
//    written before the careerArpu fix; after it, 15–24 of 24 runs cleared the bar in every
//    sector at a median of week 8–32, and it ordered the three strategies the same way in none —
//    a boolean that is almost always true measures the fix, not the strategy. Replaced with
//    **weeks to profitability** — the first week of four consecutive weeks with revenue covering
//    expenses (`profitabilityWeek`). Measured at the swap, same 24 seeds: it separates all three
//    strategies in every sector on BOTH count and timing — e.g. Fintech 2/24 Careless vs 15/24
//    Disciplined vs 6/24 Enterprise; SaaS medians wk 87/48/53; Social 2 vs 19 vs 18 (wk 61/31/36).
//    Note it is a milestone, not a score: an early premium exit while still burning reads 999.

import { advanceWeek, newGame, pitchInvestors, acceptTermSheet, resolveChoiceOnState, valuation } from '../src/game/engine'
import {
  canRunExperiment,
  experimentDef,
  segmentsForSector,
  segmentDef,
  startExperiment,
  totalCustomers,
  PMF_LABEL,
  PMF_CUSTOMER_FLOOR,
  derivePmfForSegment,
  segmentPriceFit,
  segmentProductFit,
  segmentCeiling,
} from '../src/game/career/pmf'
import { repositionTo, careerMarketingDrain } from '../src/game/career/tick'
import { sectorById } from '../src/game/data'
import type { GameState, SectorId } from '../src/game/types'
import type { ExperimentType } from '../src/game/career/types'

let ids = 0
const uid = () => `bot${ids++}`

/**
 * `npm run bots -- no-aggro` replays these three strategies against rivals that only grow, the way
 * they did before `rivalAggression` shipped. It exists so the before/after in
 * `docs/balance-baseline.md` §5 is an A/B on one capability inside ONE build rather than a
 * comparison against numbers printed by an older checkout — the same discipline
 * `test/rival-pressure-probe.ts` is built on. Absent the flag this is the live game.
 */
const AGGRO = !process.argv.includes('no-aggro')

function cfg(seed: number, sector: SectorId) {
  return { mode: 'career' as const, format: 'standard' as const, sector, seed, overrides: { rivalAggression: AGGRO } }
}

function common(s: GameState) {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
  if (s.raiseCooldown === 0 && s.cash < (s.lastExpenses || 5000) * 25) pitchInvestors(s)
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  // Hire against what the business can carry, not against a runway number. The earlier
  // version hired 8 people on $1k/wk of revenue and every strategy died of payroll, which
  // told us nothing about the strategies.
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

// 1. Picks the easiest segment, barely researches, spends hard. Ships features, never quality.
function carelessGrowth(seed: number, sector: SectorId, weeks = 90) {
  let s = newGame('Careless', sector, 'technical', { config: cfg(seed, sector) })
  const segs = segmentsForSector(sector)
  const easiest = [...segs].sort((a, b) => b.base.acquisitionAccessibility - a.base.acquisitionAccessibility)[0]
  repositionTo(s, easiest.id, 1)
  s.career!.pricing = 'low'
  s.career!.focus = segmentDef(sector, easiest.id).values[0]
  s.allocation = { features: 65, quality: 10, bugs: 10, research: 15, bet: 0 }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s)
    s.marketingSpend = Math.min(Math.max(2_000, s.lastRevenue * 1.2), s.cash * 0.06, 200_000)
    s = advanceWeek(s)
  }
  return s
}

// 2. Interviews → prototype → pricing → pilot, targets on evidence, prices and builds for the
//    segment its beliefs point at, and scales only once retention means something.
function disciplinedDiscovery(seed: number, sector: SectorId, weeks = 90) {
  let s = newGame('Disciplined', sector, 'technical', { config: cfg(seed, sector) })
  const retentionHistory: number[] = []
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s)
    const c = s.career!
    const target = c.primaryTargetSegmentId
    const b = c.segmentBeliefs[target]

    // Run the cheapest experiment that still answers an open question — but only when the
    // company can carry it. Without the budget rule the bot bought $28k pilots on a dwindling
    // balance forever: a pilot's reliability is throttled by segment reachability, so reaching
    // the old 0.7 bar on retention costs 8–13 pilots ($224k–$364k, 56–91 weeks) — more than the
    // starting cash and longer than the campaign. It went bankrupt buying evidence it could
    // never finish collecting. Confidence bars are the ones the game itself recommends to the
    // player in `suggestedExperiment`, rather than a stricter set invented here.
    const afford = (t: ExperimentType) => s.cash > experimentDef(t).cashCost * 8
    if (b.needIntensity.confidence < 0.4) { if (afford('interview')) tryExperiment(s, 'interview', target) }
    else if (b.acquisitionAccessibility.confidence < 0.4) { if (afford('landing_page')) tryExperiment(s, 'landing_page', target) }
    else if (b.productRequirement.confidence < 0.45) { if (afford('prototype')) tryExperiment(s, 'prototype', target) }
    else if (b.willingnessToPay.confidence < 0.55) { if (afford('pricing_test')) tryExperiment(s, 'pricing_test', target) }
    else if (b.retentionPotential.confidence < 0.65) { if (afford('pilot')) tryExperiment(s, 'pilot', target) }

    // after week 30, switch to the segment whose evidence looks best
    if (s.week === 30) {
      const scored = segmentsForSector(sector).map((sg) => {
        const bb = c.segmentBeliefs[sg.id]
        return { id: sg.id, v: bb.needIntensity.estimate * 0.4 + bb.willingnessToPay.estimate * 0.35 + bb.retentionPotential.estimate * 0.55 }
      })
      const best = scored.sort((x, y) => y.v - x.v)[0]
      if (best.id !== target) repositionTo(s, best.id, s.week)
    }

    // Act on the beliefs. A bot that researches willingness to pay and then never changes its
    // price is not disciplined, it is inert — and it was losing to bots that simply guessed.
    const now = c.primaryTargetSegmentId
    const belief = c.segmentBeliefs[now]
    c.pricing = belief.willingnessToPay.estimate >= 70 ? 'premium' : belief.willingnessToPay.estimate >= 40 ? 'market' : 'low'
    c.focus = segmentDef(sector, now).values[0]
    s.allocation =
      belief.productRequirement.estimate > 65
        ? { features: 30, quality: 45, bugs: 15, research: 10, bet: 0 }
        : { features: 45, quality: 30, bugs: 15, research: 10, bet: 0 }

    // Scale when the retention number MEANS something, not when it clears an absolute bar the
    // segment may be incapable of. Three conditions, all visible to a player:
    //   1. enough retained customers that the measurement is real (the game's own PMF floor),
    //   2. at or above the payback threshold the game itself states (`pmfBlocker`, 62%),
    //   3. not still falling.
    // The old test was `retention > 0.72`. In fintech and social that bar is out of reach for
    // most seeds; in saas and devtools it opened at week 6–11, but on 1–5 person cohorts whose
    // rounding makes them read 100% (see BACKLOG 4.6). Neither is a decision worth making.
    const retention = c.retentionBySegment[now] ?? 0
    retentionHistory.push(retention)
    const fourWeeksAgo = retentionHistory[retentionHistory.length - 5]
    const settled = fourWeeksAgo === undefined || retention >= fourWeeksAgo - 0.02
    const proven = totalCustomers(c, now) >= PMF_CUSTOMER_FLOOR && retention >= 0.62 && settled

    // Below the gate it still has to fund the marketing its own experiments consume — a landing
    // page test eats $3k/wk of budget, so a $3k budget bought literally no customers and the
    // company could never accumulate a cohort big enough to measure.
    const discoveryFloor = careerMarketingDrain(s) + 3_000
    s.marketingSpend = proven
      ? Math.min(Math.max(4_000, s.lastRevenue * 1.1), s.cash * 0.05, 180_000)
      : Math.min(discoveryFloor, s.cash * 0.02)
    s = advanceWeek(s)
  }
  return s
}

// 3. Bets on the high-value segment, invests in product, accepts slow growth.
function enterpriseBet(seed: number, sector: SectorId, weeks = 90) {
  let s = newGame('Enterprise', sector, 'technical', { config: cfg(seed, sector) })
  const segs = segmentsForSector(sector)
  const richest = [...segs].sort((a, b) => b.base.willingnessToPay - a.base.willingnessToPay)[0]
  repositionTo(s, richest.id, 1)
  s.career!.pricing = 'premium'
  s.career!.focus = segmentDef(sector, richest.id).values[0]
  s.allocation = { features: 30, quality: 45, bugs: 15, research: 10, bet: 0 }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    common(s)
    const c = s.career!
    if (s.week % 12 === 3) tryExperiment(s, 'pilot', c.primaryTargetSegmentId)
    s.marketingSpend = Math.min(Math.max(2_000, s.lastRevenue * 0.8), s.cash * 0.03, 60_000)
    s = advanceWeek(s)
  }
  return s
}

// ---------- reporting ----------
// Medians with a best/worst spread. With 24 seeds a 10% gap between two strategies is noise;
// only differences you can see in the spread are worth acting on.

const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]
const money = (n: number) => '$' + Math.round(n).toLocaleString()

function bestPmfLabel(r: GameState): string {
  if (!r.career) return 'n/a'
  const tam = sectorById(r.sector).tam
  const best = segmentsForSector(r.sector)
    .map((sg) => {
      const t = r.career!.segmentTruth[sg.id]
      return derivePmfForSegment({
        segmentId: sg.id,
        customers: totalCustomers(r.career!, sg.id),
        retention4wk: r.career!.retentionBySegment[sg.id] ?? 0,
        priceFit: segmentPriceFit(t, r.career!.pricing),
        productFit: segmentProductFit(t, r.quality, r.career!.focus, r.sector, sg.id),
        truth: t,
        beliefs: r.career!.segmentBeliefs[sg.id],
        ceiling: segmentCeiling(t, tam),
      })
    })
    .sort((a, b) => b.score - a.score)[0]
  return PMF_LABEL[best.status]
}

/** Bankruptcy and being fired are the only failures. An acquisition or an IPO is a win. */
export const failed = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'

/**
 * The milestone: first week of a 4-consecutive-week stretch where revenue covered expenses.
 * 999 = never reached before the run ended (which includes runs that exited early — a company
 * acquired in week 30 while still burning is a company that never reached profitability, and
 * saying so is correct, not a penalty).
 */
export const profitabilityWeek = (r: GameState): number => {
  const h = r.history
  for (let i = 0; i + 3 < h.length; i++) {
    if (h.slice(i, i + 4).every((x) => x.revenue >= x.expenses)) return h[i].week
  }
  return 999
}

/** What the founder walks away with — the ending's own number when there is one. */
export const founderNet = (s: GameState) => s.gameOver?.payout ?? valuation(s) * s.founderEquity + s.bankedPayout

function report(name: string, runs: GameState[]) {
  const bad = runs.filter(failed).length
  const exits = runs.filter((r) => r.gameOver && !failed(r)).length
  const net = runs.map(founderNet)
  const cust = runs.map((r) => r.users)
  const retention = runs.map((r) => (r.career ? (r.career.retentionBySegment[r.career.primaryTargetSegmentId] ?? 0) : 0))
  const rev = runs.map((r) => r.lastRevenue)
  const val = runs.map((r) => valuation(r))
  const profW = runs.map(profitabilityWeek)
  const profReached = profW.filter((w) => w < 999).length
  const counts: Record<string, number> = {}
  for (const r of runs) {
    const l = bestPmfLabel(r)
    counts[l] = (counts[l] ?? 0) + 1
  }
  const spread = (xs: number[], fmt: (n: number) => string) => `${fmt(q(xs, 0.5))} [${fmt(Math.min(...xs))}…${fmt(Math.max(...xs))}]`
  console.log(
    `  ${name.padEnd(22)} failed ${String(bad).padStart(2)}/${runs.length} · exits ${String(exits).padStart(2)} · customers ${spread(cust, (n) => Math.round(n).toLocaleString()).padEnd(24)} · 4wk retention ${spread(retention, (n) => `${Math.round(n * 100)}%`).padEnd(20)}`,
  )
  console.log(
    `  ${' '.repeat(22)} rev/wk ${spread(rev, money).padEnd(28)} · valuation ${spread(val, (n) => `$${(n / 1e6).toFixed(1)}M`).padEnd(26)} · profitable 4wk+ ${profReached}/${runs.length}${profReached ? ` (median wk ${q(profW.filter((w) => w < 999), 0.5)})` : ''}`,
  )
  console.log(
    `  ${' '.repeat(22)} founder net ${spread(net, (n) => `$${(n / 1e6).toFixed(1)}M`)}`,
  )
  console.log(`  ${' '.repeat(22)} best-segment PMF: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ')}`)
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 11 * (i + 1))
const ALL_SECTORS: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml']
const picked = ALL_SECTORS.filter((x) => process.argv.includes(x))
const SECTORS: SectorId[] = process.argv.includes('all') ? ALL_SECTORS : picked.length ? picked : ['saas', 'fintech']

console.log(
  `— Career bot strategies · ${SEEDS.length} seeds × 90 weeks · median [worst…best] · rivals ${AGGRO ? 'AGGRESSIVE (live game)' : 'passive (pre-rivalAggression baseline)'} —`,
)
for (const sector of SECTORS) {
  console.log(`\n${sectorById(sector).name}`)
  report('Careless Growth', SEEDS.map((s) => carelessGrowth(s, sector)))
  report('Disciplined Discovery', SEEDS.map((s) => disciplinedDiscovery(s, sector)))
  report('Enterprise Bet', SEEDS.map((s) => enterpriseBet(s, sector)))
}
