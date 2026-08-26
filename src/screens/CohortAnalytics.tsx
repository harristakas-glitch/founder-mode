// Career-only: the cohort triangle, and the answer to the question this project has been asked
// more than any other — "why does my PMF go up and then down when I changed nothing?"
//
// THE SHORT ANSWER, WHICH THIS SCREEN EXISTS TO MAKE VISIBLE. `retentionBySegment` is a
// size-weighted mean of the last TEN cohorts' four-week snapshots (src/game/career/tick.ts). Those
// ten snapshots routinely spread 6–19 percentage points apart on an unchanged strategy, because a
// company-wide user loss — an outage event, a rival's price war — is charged against the newest
// cohort on the books rather than spread across the base. So one cohort in the window reads 45%
// while its neighbours read 76%, the mean twitches a point or two as that cohort enters and leaves
// the window, and PMF follows it. Measured across six seeds and four sectors, the average
// week-over-week move in the segment number is 0.3–1.2pp against a cohort spread of 1.9–10.1pp:
// the movement is essentially NEVER outside the noise. See docs/cohort-retention-noise.md.
//
// So this screen never shows the average alone. It always shows the average WITH the spread of the
// cohorts it is made of, because a two-point dip inside a fourteen-point band is not news and the
// player deserves to be able to see that for themselves.
//
// PRESENTATION ONLY. Nothing here writes to the simulation, and every number is read off
// `CustomerCohort` as it already exists. Two facts are measured per cohort — the four-week snapshot
// frozen by `tick.ts`, and today's survivor count — and the triangle says so rather than pretending
// the cells between them were observed.
import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, Panel } from '../components'
import { cohortDecaysApplied, RETENTION_WINDOW_WEEKS, segmentDef, segmentsForSector } from '../game/career/pmf'
import { usesBusinessSimulationV2 } from '../game/modes'
import type { BusinessSimulationV2State } from '../game/sim2/types'
import type { CustomerCohort, SegmentId } from '../game/career/types'
import { useStore } from '../store'

/** Cohorts stop being counted by `tick.ts` at ten, so this is the window the player is shown. */
const WINDOW = 10
/** Weeks-since-joining shown as columns before the triangle starts scrolling. */
const AGE_COLUMNS = 13
const ROWS_COLLAPSED = 12

const pct = (v: number) => `${Math.round(v * 100)}%`
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}pp`

const isOrganic = (c: CustomerCohort) => c.origin !== 'incentivised'
const survivors = (c: CustomerCohort) => c.exactCustomers ?? c.activeCustomers

// ---------------------------------------------------------------------------------------------
// reading the cohorts
// ---------------------------------------------------------------------------------------------

export interface Row {
  cohort: CustomerCohort
  /**
   * WEEKS OF CHURN, not calendar offset — `cohortDecaysApplied`, i.e. `week - acquiredWeek + 1`.
   *
   * `tick.ts` churns a cohort in the very week it arrives, so its acquisition week IS its first
   * week of churn. Indexing the triangle by calendar offset put the frozen four-week snapshot in
   * the column labelled 3 and made column 4 a fifth week of decay — the display half of the bug
   * `RETENTION_WINDOW_WEEKS` fixed. Indexed this way, column `n` means "after n weeks of churn",
   * column 0 is the join, and column 4 really is the four-week number.
   */
  age: number
  /** frozen after `RETENTION_WINDOW_WEEKS` weeks of churn by tick.ts — undefined until then */
  atFour?: number
  /** survivors / starting size, right now */
  now: number
  incentivised: boolean
}

/** The week a cohort acquired in `acquiredWeek` freezes its four-week snapshot. It is charged
 *  churn on arrival, so that is `RETENTION_WINDOW_WEEKS - 1` weeks later, not four. */
export const snapshotWeek = (acquiredWeek: number) => acquiredWeek + RETENTION_WINDOW_WEEKS - 1

/**
 * The window `tick.ts` averages, rebuilt for an arbitrary past week.
 *
 * It is the same filter, the same order and the same `slice(-10)`, so for any week in which no
 * cohort has yet been dropped this reproduces `retentionBySegment` exactly. Cohorts leave the list
 * when their last customer goes (`activeCustomers > 0`) or when the 60-cohort cap pushes them off,
 * so the deep past thins out — the chart's per-week readout says how many cohorts each point
 * averages, which is where a player can see it thinning.
 */
export function windowAt(cohorts: CustomerCohort[], week: number): CustomerCohort[] {
  return cohorts
    .filter((c) => isOrganic(c) && c.retentionAt4wk !== undefined && cohortDecaysApplied(week, c.acquiredWeek) >= RETENTION_WINDOW_WEEKS)
    .slice(-WINDOW)
}

export interface Point {
  week: number
  mean: number
  /** size-weighted standard deviation of the snapshots in the window — the spread, not a CI */
  spread: number
  n: number
  people: number
}

export function summarise(window: CustomerCohort[], week: number): Point | null {
  const people = window.reduce((a, c) => a + c.startingCustomers, 0)
  if (people <= 0) return null
  const mean = window.reduce((a, c) => a + c.retentionAt4wk! * c.startingCustomers, 0) / people
  const variance = window.reduce((a, c) => a + c.startingCustomers * (c.retentionAt4wk! - mean) ** 2, 0) / people
  return { week, mean, spread: Math.sqrt(variance), n: window.length, people }
}

// ---------------------------------------------------------------------------------------------
// the average, with the spread of the cohorts behind it
// ---------------------------------------------------------------------------------------------

/**
 * The band is DESCRIPTIVE: it is ±1 size-weighted standard deviation of the ten snapshots the
 * average is made of. It is deliberately not sold as a confidence interval — the shipped estimator
 * carries a measured −4pp bias (docs/cohort-retention-noise.md §3), so a CI drawn around it would
 * be a promise the number cannot keep. "How far apart are the cohorts I averaged?" is a question
 * the data answers honestly, and it is the question that settles whether a dip means anything.
 */
function AverageWithSpread({ points, dots }: { points: Point[]; dots: { week: number; value: number; size: number; incentivised: boolean }[] }) {
  // The readout was bound to onMouseMove/onMouseLeave, which put every per-week number on this
  // chart out of reach of a touch device. It is an index into `points` now, driven by pointer
  // events — hover to scrub with a mouse, tap or drag with a finger — and by the arrow keys once
  // the plot has focus. A tap pins it, because a finger has no way to keep hovering.
  const [sel, setSel] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  if (points.length < 2)
    return <EmptyState title="Not enough weeks yet" hint="Each cohort reports its first number four weeks after it joins. Come back in a few weeks." />

  const w0 = points[0].week
  const w1 = points[points.length - 1].week
  const span = Math.max(1, w1 - w0)
  const lo = Math.max(0, Math.min(...points.map((p) => p.mean - p.spread), ...dots.map((d) => d.value)) - 0.04)
  const hi = Math.min(1, Math.max(...points.map((p) => p.mean + p.spread), ...dots.map((d) => d.value)) + 0.04)
  const range = Math.max(0.08, hi - lo)
  const X = (week: number) => ((week - w0) / span) * 100
  const Y = (v: number) => 100 - ((v - lo) / range) * 100

  const top = points.map((p) => `${X(p.week)},${Y(Math.min(hi, p.mean + p.spread))}`)
  const bottom = points.map((p) => `${X(p.week)},${Y(Math.max(lo, p.mean - p.spread))}`).reverse()
  const line = points.map((p) => `${X(p.week)},${Y(p.mean)}`).join(' ')
  const near = sel === null ? null : (points[Math.min(sel, points.length - 1)] ?? null)
  const maxSize = Math.max(...dots.map((d) => d.size), 1)

  /** Nearest point to a client x, in index space — the one target pointer and keyboard share. */
  const nearestTo = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * 100
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(X(points[i].week) - x) < Math.abs(X(points[best].week) - x)) best = i
    return best
  }
  /** Tapping the week that is already pinned lets go of it — otherwise a finger can never dismiss. */
  const pick = (i: number, mouse: boolean) => {
    const same = pinned && sel === i
    setPinned(!same)
    setSel(same && !mouse ? null : i)
  }
  // A dot below the band is the only mark here the legend cannot label, and it is worth a sentence
  // only in the weeks where one exists.
  const hasOutlier = dots.some((d) => {
    const p = points.find((q) => q.week === d.week)
    return !d.incentivised && p !== undefined && d.value < p.mean - p.spread
  })

  return (
    <div>
      <div className="flex">
        <div className="relative w-11 shrink-0 text-[10px] text-mut tnum">
          <span className="absolute top-0 right-2">{pct(hi)}</span>
          <span className="absolute top-1/2 right-2 -translate-y-1/2 text-mut/70">{pct((hi + lo) / 2)}</span>
          <span className="absolute right-2 bottom-0">{pct(lo)}</span>
        </div>
        <div
          className="relative min-w-0 flex-1 touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          style={{ height: 170 }}
          tabIndex={0}
          role="group"
          aria-label="Four-week retention by week. Point at it, tap it, or use the arrow keys to read one week."
          onPointerDown={(e) => pick(nearestTo(e.clientX, e.currentTarget), e.pointerType === 'mouse')}
          onPointerMove={(e) => {
            // A mouse scrubs on hover until a click pins it; a finger only reports while it is down,
            // and `touch-pan-y` leaves the vertical drag to the page so the screen still scrolls.
            if (e.pointerType === 'mouse' ? pinned : e.buttons === 0) return
            setSel(nearestTo(e.clientX, e.currentTarget))
          }}
          onPointerLeave={() => {
            if (!pinned) setSel(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSel(null)
              setPinned(false)
              return
            }
            const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
            if (!step) return
            e.preventDefault()
            setPinned(true)
            setSel((prev) => Math.max(0, Math.min(points.length - 1, (prev === null ? points.length - 1 : prev) + step)))
          }}
        >
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points={[...top, ...bottom].join(' ')} fill="var(--color-accent)" fillOpacity="0.14" />
            <polyline points={[...top].join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth="1" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
            <polyline points={[...bottom].join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth="1" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
            {near && <line x1={X(near.week)} y1="0" x2={X(near.week)} y2="100" stroke="var(--color-line2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
            {/* the line last, and heavy: it is the number being argued about */}
            <polyline points={line} fill="none" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* Every cohort's own four-week number, at the week it was frozen. Area ∝ cohort size, so
              a wild reading from a small cohort cannot shout as loudly as a big one. */}
          {dots.map((d, i) => {
            const r = 3 + 5 * Math.sqrt(d.size / maxSize)
            return (
              <span
                key={i}
                className="pointer-events-none absolute rounded-full"
                style={{
                  left: `${X(d.week)}%`,
                  top: `${Y(d.value)}%`,
                  width: r,
                  height: r,
                  transform: 'translate(-50%,-50%)',
                  background: d.incentivised ? 'var(--color-warn)' : 'var(--color-accent2)',
                  opacity: 0.75,
                }}
              />
            )
          })}
          {/* The live region is always mounted, not conditionally rendered with the readout: a
              region that appears at the same moment as its text is announced unreliably, and the
              arrow keys are worthless if the numbers only exist as pixels. */}
          <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-1">
            {near && (
              <div
                className="absolute rounded-lg border border-line bg-surface2 px-2 py-1 text-[11px] whitespace-nowrap"
                style={{ left: `${X(near.week)}%`, transform: `translateX(-${X(near.week)}%)` }}
              >
                <span className="text-mut">wk {near.week}</span>{' '}
                <span className="font-bold tnum">{pct(near.mean)}</span>{' '}
                <span className="text-mut tnum">± {(near.spread * 100).toFixed(1)}pp</span>{' '}
                <span className="text-mut/70">({near.n} cohorts)</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-11 text-[10px] text-mut tnum">
        <span>wk {w0}</span>
        <span>wk {w1}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-11 text-[11.5px] text-mut">
        <span className="flex items-center gap-1.5">
          <span className="h-[2.5px] w-5 rounded-full bg-ink" /> the average you are scored on
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-[3px] bg-accent/25" /> spread of the cohorts inside it
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent2/75" /> one cohort's own result, sized by the people in it
        </span>
        {dots.some((d) => d.incentivised) && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-warn/75" /> a cohort you paid for — not in the average
          </span>
        )}
      </div>
      {hasOutlier && (
        <p className="mt-2 max-w-[70ch] pl-11 text-[11.5px] leading-relaxed text-mut">
          A dot below the band is usually a company-wide loss — an outage, a rival's price war — charged to whichever cohort was newest that week, not a product
          that got worse.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// the triangle
// ---------------------------------------------------------------------------------------------

/** Dark-surface sequential ramp. The number is printed in every cell — colour is never the only cue. */
function cellStyle(v: number, measured: boolean): React.CSSProperties {
  const t = Math.max(0, Math.min(1, (v - 0.25) / 0.6))
  return {
    background: `color-mix(in oklab, var(--color-good) ${(8 + t * 62).toFixed(0)}%, var(--color-surface2))`,
    opacity: measured ? 1 : 0.42,
    color: t > 0.55 ? 'var(--color-bg)' : 'var(--color-ink)',
  }
}

/**
 * Survival at `age` weeks, from the two facts the cohort actually carries.
 *
 * Churn is a constant weekly rate between the two anchors, so a geometric interpolation is the
 * shape of the real curve rather than a guess at it — but it is still an interpolation, and the
 * cells it fills are drawn faded with no ring so the eye can tell them from the two that were
 * measured. Returns null past today: a cohort cannot report a week it has not lived.
 *
 * TODAY WINS OVER THE JOIN COLUMN, and that ordering is load-bearing. Column 0 is the cohort's own
 * size — 100% by definition, the denominator rather than an observation, so it never gets the
 * measured ring. But `tick.ts` churns a cohort in the very week it arrives, so a cohort that is
 * nought weeks old is already below its starting size: showing it a decorative 100% would be the
 * only false number on the screen. When today IS week zero, today's real survival is what the cell
 * shows, and it is a measurement.
 */
export function survivalAt(row: Row, age: number): { value: number; measured: boolean } | null {
  if (age > row.age) return null
  if (age === row.age) return { value: row.now, measured: true }
  if (age === 0) return { value: 1, measured: false }
  if (row.atFour !== undefined && age === RETENTION_WINDOW_WEEKS) return { value: row.atFour, measured: true }
  const anchors: [number, number][] = [[0, 1]]
  if (row.atFour !== undefined) anchors.push([RETENTION_WINDOW_WEEKS, Math.max(1e-4, row.atFour)])
  anchors.push([row.age, Math.max(1e-4, row.now)])
  let a = anchors[0]
  let b = anchors[anchors.length - 1]
  for (let i = 0; i < anchors.length - 1; i++) {
    if (age >= anchors[i][0] && age <= anchors[i + 1][0]) {
      a = anchors[i]
      b = anchors[i + 1]
      break
    }
  }
  if (b[0] === a[0]) return { value: a[1], measured: false }
  const keep = Math.pow(b[1] / a[1], 1 / (b[0] - a[0]))
  return { value: Math.max(0, Math.min(1, a[1] * Math.pow(keep, age - a[0]))), measured: false }
}

function Triangle({ rows }: { rows: Row[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, ROWS_COLLAPSED)
  const maxAge = Math.min(AGE_COLUMNS, Math.max(...rows.map((r) => r.age), 4))
  const ages = Array.from({ length: maxAge + 1 }, (_, i) => i)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-[560px] border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th className="px-2 pb-1 text-left text-[10px] font-bold tracking-[0.08em] text-mut uppercase">Joined</th>
              <th className="px-2 pb-1 text-right text-[10px] font-bold tracking-[0.08em] text-mut uppercase">Size</th>
              {ages.map((a) => (
                <th key={a} className="w-9 pb-1 text-center text-[10px] font-semibold text-mut tnum">
                  {a === 0 ? 'join' : a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.cohort.id}>
                <td className="px-2 text-[12px] whitespace-nowrap tnum">
                  wk {r.cohort.acquiredWeek}
                  {r.incentivised && <span className="ml-1 text-[10px] font-bold text-warn">$</span>}
                </td>
                <td className="px-2 text-right text-[12px] text-mut tnum">{r.cohort.startingCustomers.toLocaleString()}</td>
                {ages.map((a) => {
                  const cell = survivalAt(r, a)
                  if (!cell) return <td key={a} className="h-7 w-9 rounded-[5px] bg-surface2/25" />
                  return (
                    <td
                      key={a}
                      className={`h-7 w-9 rounded-[5px] text-center text-[11px] font-semibold tnum ${cell.measured ? 'ring-1 ring-white/25' : ''}`}
                      style={cellStyle(cell.value, cell.measured)}
                      title={`${r.cohort.startingCustomers.toLocaleString()} joined week ${r.cohort.acquiredWeek} · ${Math.round(cell.value * 100)}% still here ${a} week${a === 1 ? '' : 's'} later${cell.measured ? '' : ' (implied)'}`}
                    >
                      {Math.round(cell.value * 100)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-mut">
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-5 rounded-[3px] ring-1 ring-white/25" style={cellStyle(0.8, true)} />
          measured
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-5 rounded-[3px]" style={cellStyle(0.8, false)} />
          implied between the measured weeks
        </span>
        {rows.some((r) => r.incentivised) && (
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-warn">$</span> bought with token incentives — excluded from the average
          </span>
        )}
        {rows.length > ROWS_COLLAPSED && (
          <button className="ml-auto font-semibold text-accent hover:underline" onClick={() => setAll(!all)}>
            {all ? 'Show recent only' : `Show all ${rows.length} cohorts`}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** V2 runs track cohorts in the causal engine, not the career discovery model — adapt them to
 *  the exact shape this screen's triangle and trend already read (owner playtest 2026-08-25:
 *  "cohorts don't work, i don't see either of 2 graphs" — both graphs read career.cohorts,
 *  which the V2 branch never populates). Same visuals, the V2 engine's own facts. */
function adaptV2Cohorts(v2: BusinessSimulationV2State): CustomerCohort[] {
  return v2.cohorts
    .filter((c) => (c.sizeAtAcquisition ?? c.size) >= 2)
    .map(
      (c) =>
        ({
          id: c.id,
          acquiredWeek: c.acquiredWeek,
          segmentId: c.segmentId as unknown as SegmentId,
          startingCustomers: Math.round(c.sizeAtAcquisition ?? c.size),
          activeCustomers: Math.round(c.size),
          exactCustomers: c.size,
          retentionAt4wk: c.retentionAt4wk,
          acquisitionCost: 0,
          priceAtAcquisition: c.priceAtAcquisition,
          productQualityAtAcquisition: Math.round((c.fitAtAcquisition ?? 0.5) * 100),
          origin: 'organic',
        }) as unknown as CustomerCohort,
    )
}

export function CohortAnalytics() {
  const game = useStore((s) => s.game)
  const career = game?.career
  const v2 = game && usesBusinessSimulationV2(game) && game.simV2 ? game.simV2 : null
  const [picked, setPicked] = useState<SegmentId | null>(null)

  const segments = useMemo(
    () =>
      v2
        ? v2.segments.filter((x) => x.id !== 'none').map((x) => ({ id: x.id as unknown as SegmentId, name: x.name }))
        : game
          ? segmentsForSector(game.sector)
          : [],
    [game, v2],
  )
  const sourceCohorts = useMemo<CustomerCohort[]>(() => (v2 ? adaptV2Cohorts(v2) : (career?.cohorts ?? [])), [v2, career])
  const v2Target = v2?.positioning?.targetSegmentId as SegmentId | undefined
  const segment = picked ?? (v2 ? (v2Target ?? (segments[0]?.id as SegmentId)) : (career?.primaryTargetSegmentId ?? segments[0]?.id))

  const rows = useMemo<Row[]>(() => {
    if (!game || !segment) return []
    return sourceCohorts
      .filter((c) => c.segmentId === segment)
      .map((c) => ({
        cohort: c,
        age: Math.max(0, cohortDecaysApplied(game.week, c.acquiredWeek)),
        atFour: c.retentionAt4wk,
        now: c.startingCustomers > 0 ? Math.max(0, Math.min(1, survivors(c) / c.startingCustomers)) : 0,
        incentivised: !isOrganic(c),
      }))
      .reverse()
  }, [sourceCohorts, game, segment])

  const trend = useMemo<Point[]>(() => {
    if (!game || !segment) return []
    const mine = sourceCohorts.filter((c) => c.segmentId === segment)
    const first = mine.reduce((a, c) => (c.retentionAt4wk !== undefined ? Math.min(a, snapshotWeek(c.acquiredWeek)) : a), Infinity)
    if (!Number.isFinite(first)) return []
    const out: Point[] = []
    for (let w = first; w <= game.week; w++) {
      const p = summarise(windowAt(mine, w), w)
      if (p) out.push(p)
    }
    return out
  }, [sourceCohorts, game, segment])

  if (!game || (!career && !v2))
    return (
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">Cohorts</h1>
        <div className="mt-3">
          <EmptyState title="Career mode only" hint="Cohort tracking comes with the Career campaign's discovery model." />
        </div>
      </div>
    )

  const latest = trend[trend.length - 1] ?? null
  const prior = trend.length > 1 ? trend[trend.length - 2] : null
  const sixBack = trend.length > 6 ? trend[trend.length - 7] : null
  const move = latest && prior ? latest.mean - prior.mean : 0
  const sixMove = latest && sixBack ? latest.mean - sixBack.mean : 0
  const insideNoise = latest ? Math.abs(move) <= latest.spread : true
  const dots = rows
    .filter((r) => r.atFour !== undefined)
    .map((r) => ({ week: snapshotWeek(r.cohort.acquiredWeek), value: r.atFour!, size: r.cohort.startingCustomers, incentivised: r.incentivised }))

  const def = v2 ? { name: segments.find((x) => x.id === segment)?.name ?? 'Segment' } : segment ? segmentDef(game.sector, segment) : null

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Cohorts</h1>
      <div className="mb-4 text-[13px] text-mut">
        Everyone who joined in the same week, tracked as a group. This is where retention — and therefore PMF — actually comes from.
      </div>

      {segments.length > 1 && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          {segments.map((s) => {
            const n = sourceCohorts.filter((c) => c.segmentId === s.id).length
            const on = s.id === segment
            return (
              <button
                key={s.id}
                onClick={() => setPicked(s.id)}
                className={`rounded-xl border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  on ? 'border-accent/60 bg-accent/15 text-ink' : 'border-line/70 text-mut hover:border-line2 hover:text-ink'
                }`}
              >
                {s.name}
                <span className="ml-1.5 text-[11px] font-normal text-mut">{n || '—'}</span>
                {(v2 ? v2Target === s.id : career?.primaryTargetSegmentId === s.id) && (
                  <span className="ml-1.5 text-[10px] font-bold tracking-wide text-accent uppercase">target</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!latest ? (
        <Panel title={def ? def.name : 'Cohorts'}>
          <EmptyState
            title="No cohort has reported yet"
            hint="A cohort's retention is frozen four weeks after it joins. Once the first one is four weeks old, its number appears here."
          />
        </Panel>
      ) : (
        <>
          {/* ---- the verdict, and the picture of the same claim, in one card ------------------
              The sentence says the move is inside the noise; the chart draws the noise. Split over
              two cards the reader had to carry the claim to its evidence, and the chart's caption
              re-explained both — the legend already names every mark on it. */}
          <Panel title="This week's read">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <div className="text-[34px] leading-none font-extrabold tnum">{pct(latest.mean)}</div>
                <div className="mt-1 text-[12px] text-mut">4-week retention, {def?.name}</div>
              </div>
              <div>
                <div className="text-[20px] leading-none font-bold text-mut tnum">± {(latest.spread * 100).toFixed(1)}pp</div>
                <div className="mt-1 text-[12px] text-mut">spread across the {latest.n} cohorts averaged</div>
              </div>
              <div>
                <div className={`text-[20px] leading-none font-bold tnum ${insideNoise ? 'text-mut' : move > 0 ? 'text-good' : 'text-bad'}`}>{pp(move)}</div>
                <div className="mt-1 text-[12px] text-mut">since last week</div>
              </div>
            </div>
            <p className="mt-3.5 max-w-[70ch] text-[13px] leading-relaxed">
              {insideNoise ? (
                <>
                  <span className="font-semibold text-ink">That move is smaller than the gap between your own cohorts.</span> The ten cohorts behind this
                  average range from {pct(Math.min(...windowAt(sourceCohorts.filter((c) => c.segmentId === segment), game.week).map((c) => c.retentionAt4wk!)))} to{' '}
                  {pct(Math.max(...windowAt(sourceCohorts.filter((c) => c.segmentId === segment), game.week).map((c) => c.retentionAt4wk!)))}, so the headline
                  number twitches by a point or two every week purely as old cohorts drop out of the window and new ones enter. Nothing about your product
                  changed. Judge it over six weeks, not one.
                </>
              ) : (
                <>
                  <span className={`font-semibold ${move > 0 ? 'text-good' : 'text-bad'}`}>That move is bigger than the spread between your cohorts</span> — it is
                  large enough to be real rather than sampling. Over the last six weeks the number has moved {pp(sixMove)}.
                </>
              )}
            </p>
            <div className="mt-4 border-t border-line/60 pt-4">
              <AverageWithSpread points={trend} dots={dots} />
            </div>
          </Panel>

          {/* ---- the triangle — OPEN by default (owner call, 2026-08-24: this page IS the
              triangle; hiding its centrepiece behind a click made the screen feel empty).
              Still a real <details>, so it collapses for anyone who wants the summary only. */}
          <div className="mt-3.5">
            <Panel>
              <details className="group" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md text-[15px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={16} className="shrink-0 text-mut transition-transform group-open:rotate-90" />
                  Cohort triangle
                  <span className="text-[12.5px] font-normal text-mut">
                    {rows.length} cohort{rows.length === 1 ? '' : 's'}, week by week
                  </span>
                  {v2 && rows.some((r) => r.atFour === undefined && r.age > RETENTION_WINDOW_WEEKS) && (
                    <span className="text-[11px] font-normal text-warn">
                      · cohorts from before this week's update show unmeasured — new ones report normally
                    </span>
                  )}
                </summary>
                <div className="mt-3.5">
                  <Triangle rows={rows} />
                  <p className="mt-3 max-w-[74ch] text-[12.5px] leading-relaxed text-mut">
                    Read <span className="text-ink">across</span> a row to watch one week's arrivals leave over time. Read <span className="text-ink">down</span>{' '}
                    a column to compare like with like: if the numbers in the week-4 column are climbing as you go up the table, newer customers are sticking
                    better than older ones and the product is genuinely improving. Two cells per row are measured — the four-week mark the game freezes, and
                    today. The <span className="text-ink">join</span> column is the cohort's own size, so it is 100% by definition, and the faded cells are the
                    steady weekly rate the measured ones imply.
                  </p>
                </div>
              </details>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
