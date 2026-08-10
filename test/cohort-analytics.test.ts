// The Cohorts screen. Run: npx tsx test/cohort-analytics.test.ts
//
// The screen is presentation — it writes nothing and the simulation cannot tell it exists. So the
// only way it can be wrong is by DISAGREEING WITH THE GAME: showing a retention number that is not
// the one `tickCareerPMF` scored the player on, or drawing a survival curve that never happened.
// Both are worse than showing nothing, because the whole point of the screen is to settle an
// argument about whether a number moved.
//
// So this file pins three things:
//   1. the screen's rebuilt segment average is BIT-IDENTICAL to `career.retentionBySegment`
//   2. every cell the triangle marks "measured" is a fact off the cohort, and the faded ones
//      between them decay at one constant weekly rate that lands exactly on those facts
//   3. the band is size-weighted, so a 10-person outlier beside a 10,000-person cohort cannot
//      widen it — the band is read as evidence, and evidence is weighted by how much of it there is
//
// Mutation-verified: 11 mutants planted in CohortAnalytics.tsx (a shorter window, an off-by-one on
// the four-week gate, dropping the organic filter, nudging the four-week cell, changing the
// interpolation rate, nudging today's cell, ringing the join column, reading one week past today,
// unweighting the variance, dropping the sqrt, unweighting the mean). All 11 fail this file.
//
// The screen imports the zustand store, which reads localStorage at module load, so that is shimmed
// before the dynamic import below.

import { advanceWeek, newGame, marketingMax, resolveChoiceOnState } from '../src/game/engine'
import { cohortDecaysApplied, RETENTION_WINDOW_WEEKS, segmentDef, segmentsForSector, totalCustomers, PMF_CUSTOMER_FLOOR } from '../src/game/career/pmf'
import type { GameState, SectorId } from '../src/game/types'
import type { CustomerCohort, PricingStrategy } from '../src/game/career/types'

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size
  },
}

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

/** A stable policy: nothing changes strategy, so any movement in the number is the number's own. */
function play(seed: number, sector: SectorId, weeks: number, switchWeek: number, after: PricingStrategy): GameState {
  let s = newGame('Probe', sector, 'technical', { config: { mode: 'career', format: 'standard', sector, seed } })
  const spend = (want: number) => Math.max(0, Math.min(want, marketingMax(s), s.cash))
  const history: number[] = []
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    for (const m of s.inbox) {
      if (m.kind !== 'choice' || m.resolved || !m.choices) continue
      resolveChoiceOnState(s, m.id, m.meta?.acquisitionAmount !== undefined ? 1 : 0)
    }
    const c = s.career!
    const target = c.primaryTargetSegmentId
    c.pricing = s.week >= switchWeek ? after : 'market'
    c.focus = segmentDef(sector, target).values[0]
    s.allocation = { features: 45, quality: 30, bugs: 15, research: 10, bet: 0 }
    const retention = c.retentionBySegment[target] ?? 0
    history.push(retention)
    const back = history[history.length - 5]
    const proven = totalCustomers(c, target) >= PMF_CUSTOMER_FLOOR && retention >= 0.62 && (back === undefined || retention >= back - 0.02)
    s.marketingSpend = proven ? spend(Math.max(4_000, Math.min(s.lastRevenue * 1.1, s.cash * 0.05))) : spend(Math.min(3_000, s.cash * 0.02))
    s = advanceWeek(s)
  }
  return s
}

const CASES: [number, SectorId][] = [
  [4242, 'social'],
  [7, 'social'],
  [991, 'saas'],
  [13, 'saas'],
  [555, 'marketplace'],
  [2024, 'fintech'],
  [88, 'devtools'],
  [301, 'ecommerce'],
]

type Screen = typeof import('../src/screens/CohortAnalytics')

void import('../src/screens/CohortAnalytics').then((M: Screen) => {
  console.log('— The number on the screen is the number the game scored you on —')
  let checked = 0
  let worst = 0
  let mismatches = 0
  for (const [seed, sector] of CASES) {
    const s = play(seed, sector, 70, 30, 'low')
    const career = s.career!
    for (const segId of segmentsForSector(sector).map((x) => x.id)) {
      const mine = career.cohorts.filter((c) => c.segmentId === segId)
      const p = M.summarise(M.windowAt(mine, s.week), s.week)
      if (p === null) continue
      checked++
      const delta = Math.abs(p.mean - (career.retentionBySegment[segId] ?? 0))
      worst = Math.max(worst, delta)
      if (delta > 0) mismatches++
    }
  }
  ok(checked >= 8, `${checked} live segment readings across ${CASES.length} seeds and 6 sectors`)
  ok(mismatches === 0 && worst === 0, `every one is bit-identical to retentionBySegment (worst |Δ| ${worst})`)

  console.log('\n— A dot sits on the week its cohort actually entered the average —')
  {
    // `snapshotWeek` places each frozen cohort's dot on the chart's x-axis and picks the week the
    // trend line starts. It is the same off-by-one as everything else on this screen — a cohort is
    // charged churn on arrival, so it freezes `RETENTION_WINDOW_WEEKS - 1` weeks after joining, not
    // four — and nothing else here can see it: `windowAt`, `summarise` and `survivalAt` are all
    // correct with a wrong `snapshotWeek`, so the dots simply slide one week right of the line they
    // are drawn against.
    //
    // The property, without restating the arithmetic: the week a dot is drawn on must be the FIRST
    // week `windowAt` would have counted that cohort, and it must not have counted it the week
    // before.
    const bad: string[] = []
    let checked = 0
    for (const [seed, sector] of CASES) {
      const s = play(seed, sector, 70, 30, 'low')
      for (const c of s.career!.cohorts) {
        if (c.retentionAt4wk === undefined || c.origin === 'incentivised') continue
        const w = M.snapshotWeek(c.acquiredWeek)
        if (w > s.week) continue
        checked++
        const inAt = M.windowAt([c], w).length === 1
        const inBefore = M.windowAt([c], w - 1).length === 1
        if (!inAt) bad.push(`${c.id}: its dot is at week ${w} but the average had not counted it yet`)
        if (inBefore) bad.push(`${c.id}: the average counted it at week ${w - 1}, before its dot`)
      }
    }
    ok(checked > 200, `${checked} frozen organic cohorts placed on the chart`)
    ok(bad.length === 0, bad.length === 0 ? 'every dot lands on the week the line first included it' : bad.slice(0, 3).join('; '))
  }

  console.log('\n— Bought cohorts never reach the average (ICO §52, at the display layer) —')
  {
    const s = play(4242, 'social', 60, 30, 'low')
    const career = s.career!
    const seg = career.primaryTargetSegmentId
    const mine = career.cohorts.filter((c) => c.segmentId === seg)
    const clean = M.summarise(M.windowAt(mine, s.week), s.week)!
    // mark every other measured cohort as bought, at a retention it could not fail to drag down
    const doped: CustomerCohort[] = mine.map((c, i) =>
      c.retentionAt4wk !== undefined && i % 2 === 0 ? { ...c, origin: 'incentivised' as const, retentionAt4wk: 0.01 } : c,
    )
    const w = M.windowAt(doped, s.week)
    ok(w.length > 0 && !w.some((c) => c.origin === 'incentivised'), 'no incentivised cohort survives into the window')
    const after = M.summarise(w, s.week)!
    ok(after.mean > 0.3, `and the average holds at ${(after.mean * 100).toFixed(1)}% rather than collapsing toward the 1% it was fed`)
    ok(after.mean !== clean.mean, 'the doped run is a different window from the clean one, so this is a real test and not a tautology')
  }

  console.log('\n— The triangle only claims what the cohort actually knows —')
  {
    let cohorts = 0
    const bad: string[] = []
    for (const [seed, sector] of CASES) {
      const s = play(seed, sector, 70, 30, 'low')
      for (const c of s.career!.cohorts) {
        const row: M2Row = {
          cohort: c,
          // WEEKS OF CHURN, the same index the screen builds. A cohort is decayed in the week it
          // arrives, so calendar offset and weeks-of-churn differ by one; indexing by calendar
          // offset is what put the frozen four-week number in column 3.
          age: Math.max(0, cohortDecaysApplied(s.week, c.acquiredWeek)),
          atFour: c.retentionAt4wk,
          now: c.startingCustomers > 0 ? Math.min(1, (c.exactCustomers ?? c.activeCustomers) / c.startingCustomers) : 0,
          incentivised: c.origin === 'incentivised',
        }
        cohorts++
        if (M.survivalAt(row, row.age + 1) !== null) bad.push(`${c.id}: reported a week it has not lived`)
        const today = M.survivalAt(row, row.age)
        if (!today || Math.abs(today.value - row.now) > 1e-12 || !today.measured) bad.push(`${c.id}: today's cell is not today's survivors`)
        if (row.age > 0) {
          const join = M.survivalAt(row, 0)
          if (!join || join.value !== 1 || join.measured) bad.push(`${c.id}: the join column must be 100% and must not claim to be measured`)
        }
        if (row.atFour !== undefined && row.age > RETENTION_WINDOW_WEEKS) {
          const four = M.survivalAt(row, RETENTION_WINDOW_WEEKS)
          if (!four || Math.abs(four.value - row.atFour) > 1e-12 || !four.measured) bad.push(`${c.id}: the four-week cell is not the frozen snapshot`)
        }
        // The snapshot column must exist for every cohort old enough to have one, and must NOT
        // exist for one that is not — the off-by-one this file now pins in both directions.
        if (row.age >= RETENTION_WINDOW_WEEKS && row.atFour === undefined) bad.push(`${c.id}: ${row.age} weeks of churn and still no frozen snapshot`)
        if (row.age < RETENTION_WINDOW_WEEKS && row.atFour !== undefined) bad.push(`${c.id}: froze a four-week snapshot after only ${row.age} weeks of churn`)
        // monotone, and constant-rate inside each anchor bracket
        let prev = 1 + 1e-9
        for (let a = 0; a <= row.age; a++) {
          const v = M.survivalAt(row, a)!
          if (v.value > prev + 1e-9) {
            bad.push(`${c.id}: survival rose at week ${a}`)
            break
          }
          prev = v.value
        }
        const brackets: [number, number][] =
          row.atFour !== undefined && row.age > RETENTION_WINDOW_WEEKS
            ? [[0, RETENTION_WINDOW_WEEKS], [RETENTION_WINDOW_WEEKS, row.age]]
            : row.age > 1
              ? [[0, row.age]]
              : []
        for (const [lo, hi] of brackets) {
          if (hi - lo < 2) continue
          const vals: number[] = []
          for (let a = lo; a <= hi; a++) vals.push(M.survivalAt(row, a)!.value)
          const ratios = vals.slice(1).map((v, i) => v / Math.max(1e-12, vals[i]))
          if (Math.max(...ratios) - Math.min(...ratios) > 1e-6) bad.push(`${c.id}: weeks ${lo}–${hi} do not decay at one steady rate`)
        }
      }
    }
    ok(cohorts > 300, `${cohorts} cohorts inspected`)
    ok(bad.length === 0, bad.length === 0 ? 'every measured cell is a fact and every implied cell lands on one' : bad.slice(0, 3).join('; '))
  }

  console.log('\n— The band is evidence-weighted, not cohort-counted —')
  {
    const mk = (r: number, n: number, i: number): CustomerCohort => ({
      id: 'x' + i,
      acquiredWeek: i,
      segmentId: 's',
      startingCustomers: n,
      activeCustomers: n,
      acquisitionCost: 0,
      priceAtAcquisition: 52,
      productQualityAtAcquisition: 50,
      retentionAt4wk: r,
    })
    const lopsided = M.summarise([mk(0.7, 10_000, 1), mk(0.2, 10, 2)], 10)!
    const even = M.summarise([mk(0.7, 10, 1), mk(0.2, 10, 2)], 10)!
    ok(lopsided.spread < 0.02, `a 10-person outlier beside a 10,000-person cohort barely widens the band (±${(lopsided.spread * 100).toFixed(2)}pp)`)
    ok(even.spread > 0.2, `the same two results at equal size widen it properly (±${(even.spread * 100).toFixed(1)}pp)`)
    ok(lopsided.mean > 0.69, `and the average follows the people, not the cohort count (${(lopsided.mean * 100).toFixed(1)}%)`)
  }

  console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
  process.exit(fails.length === 0 ? 0 : 1)
})

type M2Row = Parameters<Screen['survivalAt']>[0]
