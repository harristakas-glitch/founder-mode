// Career-only presentation. Every one of these components renders nothing unless the
// `detailedPMF` capability is on, so Quick Play, Daily and Arena never see them.
//
// The simulation already computes all of this every week — the weekly briefing, the causal
// explanations, the per-segment retention. Until now none of it was rendered, which is why
// Career's central lesson (PMF is an OUTPUT, read off customers who stayed) was invisible.
import { Panel } from './components'
import { money, num, pct } from './format'
import { sectorById } from './game/data'
import {
  PMF_CUSTOMER_FLOOR,
  PMF_LABEL,
  explanationText,
  pmfBlocker,
  settledCohortRetention,
  segmentDef,
  segmentPriceFit,
  segmentProductFit,
  segmentSnapshots,
  totalCustomers,
  type SegmentSnapshot,
} from './game/career/pmf'
import type { PricingStrategy, ProductFocus, SegmentTruth } from './game/career/types'
import { hasCapability } from './game/modes'
import type { GameState } from './game/types'
import { useStore } from './store'

/** The causal chain, in one line. Used on the Dashboard and as the topbar PMF tooltip. */
export const PMF_CAUSAL_CHAIN =
  'PMF is earned, not built. Product work raises quality → quality raises fit for your target segment → fit raises retention → retention is what moves PMF. Customers who leave don\'t count.'

export function careerActive(game: GameState | null | undefined): boolean {
  return !!game && !!game.career && hasCapability(game, 'detailedPMF')
}

/** Every segment, scored the way this week's tick scored it. */
export function useSegmentSnapshots(): SegmentSnapshot[] {
  const game = useStore((s) => s.game)
  if (!careerActive(game) || !game) return []
  return segmentSnapshots({
    career: game.career!,
    sector: game.sector,
    quality: game.quality,
    sectorTam: sectorById(game.sector).tam,
  })
}

const retentionTone = (r: number) => (r >= 0.72 ? 'text-good' : r >= 0.55 ? 'text-warn' : 'text-bad')

// ---------------------------------------------------------------------------------------
// 0. Why the number is the number
//
// The single most-repeated question about Career is "why is my PMF stuck?", and until now the
// game could not answer it: `derivePmfForSegment` returns one rounded score and nothing else, so
// a player at 100/100 product with 34k customers and a plateaued number had nowhere to look.
//
// Everything below is DERIVED IN THE UI from what `src/game/career` already exports. Exactly ONE
// thing is restated here rather than imported, because the simulation exposes no way to ask:
//
//   1. PMF_WEIGHTS — the five terms of `derivePmfForSegment` and their maximums.
//
// The cohort lifecycle used to be a second restatement, and it was restated WRONG on purpose —
// five decays, to agree with a tick that snapshotted a week late. Both halves are fixed: the
// lifecycle is one exported fact (`settledCohortRetention`) and this file forwards to it.
//
// What remains is guarded. `pmfDiagnosis` recomputes the total from the weights and refuses to
// render if it does not round to the score the weekly tick actually produced, and the retention
// forecast is shown beside the measured number so a drift between the two is visible rather than
// hidden. If someone reweights the formula, this panel disappears instead of lying about it.
// ---------------------------------------------------------------------------------------

/** The five terms of `derivePmfForSegment`, in the order they are summed, with their maximums. */
const PMF_WEIGHTS = { retention: 46, paying: 20, fit: 14, scale: 12, headroom: 8 } as const
type PmfTerm = keyof typeof PMF_WEIGHTS

const PMF_TERM_LABEL: Record<PmfTerm, string> = {
  retention: 'Retention',
  paying: 'They pay',
  fit: 'Product fit',
  scale: 'Scale',
  headroom: 'Market size',
}

/**
 * The status gates in `derivePmfForSegment`. A score alone is not enough — each band also demands
 * a four-week retention floor, which is why a segment can be arithmetically capped out of a band
 * it has the points for.
 */
const PMF_BANDS = [
  { status: 'scalable' as const, score: 80, retention: 0.8 },
  { status: 'strong' as const, score: 66, retention: 0.72 },
  { status: 'emerging' as const, score: 52, retention: 0.62 },
]

/**
 * The four-week retention a cohort acquired today will report.
 *
 * This used to restate the cohort lifecycle here — five decays, because the tick pushed a cohort,
 * decayed it in the same week, and then snapshotted a week too late. The lifecycle is now a single
 * exported fact (`settledCohortRetention` / `RETENTION_WINDOW_WEEKS` in career/pmf.ts) and this
 * forwards to it, so the forecast cannot drift from the measurement again.
 */
function settledRetention(truth: SegmentTruth, productFit: number, priceFit: number, bugs: number): number {
  return settledCohortRetention({ truth, productFit, priceFit, bugs })
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function pmfTerms(a: { retention: number; priceFit: number; productFit: number; customers: number; ceiling: number; marketSize: number }) {
  return {
    retention: clamp01((a.retention - 0.4) / 0.5) * PMF_WEIGHTS.retention,
    paying: (a.priceFit / 100) * PMF_WEIGHTS.paying,
    fit: (a.productFit / 100) * PMF_WEIGHTS.fit,
    scale: clamp01(a.customers / Math.max(200, a.ceiling * 0.12)) * PMF_WEIGHTS.scale,
    headroom: clamp01(a.marketSize / 60) * PMF_WEIGHTS.headroom,
  }
}

export interface PmfLever {
  label: string
  /** Projected PMF change if you pulled it, scored exactly the way the weekly tick scores. */
  delta: number
  detail: string
  /** true when the lever has nothing left to give — it is already at its maximum. */
  exhausted: boolean
}

export interface PmfDiagnosis {
  seg: SegmentSnapshot
  terms: { key: PmfTerm; points: number; max: number; note: string; exhausted: boolean }[]
  total: number
  /** What a cohort won TODAY will report at four weeks, at the current product and price. */
  settledNow: number
  /** The best four-week retention this segment can produce at any price with a perfect product. */
  retentionCeiling: number
  /** The best score reachable at today's customer count, over every price and focus. */
  ceilingScore: number
  /** …and with the scale term maxed out as well. */
  ceilingScoreAtScale: number
  customersToMaxScale: number
  levers: PmfLever[]
  productSaturated: boolean
  /** Within a couple of points of everything this segment can give at this size. */
  atCeiling: boolean
  /** The best band this segment's retention ceiling allows it to reach, ever. */
  bestReachableBand: (typeof PMF_BANDS)[number]['status'] | 'showing_value'
}

const ALL_FOCUS: ProductFocus[] = ['simplicity', 'reliability', 'collaboration', 'enterprise_readiness', 'automation', 'performance']
const ALL_PRICING: PricingStrategy[] = ['low', 'market', 'premium']

/**
 * The full account of one segment's score: what it is made of, what is already exhausted, and what
 * each remaining lever is measured to be worth. Returns null when the score cannot be explained —
 * too few customers to be scored on behaviour at all, or a formula that has moved underneath this
 * file.
 */
export function pmfDiagnosis(game: GameState, segmentId: string, seg: SegmentSnapshot): PmfDiagnosis | null {
  const career = game.career
  const truth = career?.segmentTruth[segmentId]
  if (!career || !truth) return null
  // Below the floor the score is research-derived, not behaviour-derived, and `pmfBlocker` already
  // says so in one sentence. There is nothing to decompose.
  if (seg.customers < PMF_CUSTOMER_FLOOR || seg.retention4wk <= 0) return null

  const sector = game.sector
  const ceiling = seg.ceiling
  const project = (quality: number, bugs: number, pricing: PricingStrategy, focus: ProductFocus, customers: number) => {
    const productFit = segmentProductFit(truth, quality, focus, sector, segmentId)
    const priceFit = segmentPriceFit(truth, pricing)
    const retention = settledRetention(truth, productFit, priceFit, bugs)
    const t = pmfTerms({ retention, priceFit, productFit, customers, ceiling, marketSize: truth.marketSize })
    return { score: Object.values(t).reduce((x, y) => x + y, 0), retention, productFit, priceFit }
  }

  const now = { quality: game.quality, bugs: game.bugs, pricing: career.pricing, focus: career.focus }
  const live = pmfTerms({
    retention: seg.retention4wk,
    priceFit: seg.priceFit,
    productFit: seg.productFit,
    customers: seg.customers,
    ceiling,
    marketSize: truth.marketSize,
  })
  const total = Object.values(live).reduce((a, b) => a + b, 0)
  // The guard: if the restated weights no longer reproduce the tick's own score, say nothing.
  if (Math.abs(Math.round(total) - seg.score) > 1) return null

  const settledNow = settledRetention(truth, seg.productFit, seg.priceFit, game.bugs)
  const perfect = ALL_PRICING.map((p) => settledRetention(truth, 100, segmentPriceFit(truth, p), 0))
  const retentionCeiling = Math.max(...perfect)

  // Best reachable score, over every price and focus, with a flawless product.
  let ceilingScore = -1
  let ceilingScoreAtScale = -1
  for (const p of ALL_PRICING)
    for (const f of ALL_FOCUS) {
      ceilingScore = Math.max(ceilingScore, project(100, 0, p, f, seg.customers).score)
      ceilingScoreAtScale = Math.max(ceilingScoreAtScale, project(100, 0, p, f, ceiling).score)
    }

  const baseline = project(now.quality, now.bugs, now.pricing, now.focus, seg.customers).score
  const delta = (v: number) => Math.round(v - baseline)

  // --- the levers, each measured rather than asserted ------------------------------------
  const bestOtherPrice = ALL_PRICING.filter((p) => p !== now.pricing)
    .map((p) => ({ p, score: project(now.quality, now.bugs, p, now.focus, seg.customers).score }))
    .sort((a, b) => b.score - a.score)[0]
  const bestOtherFocus = ALL_FOCUS.filter((f) => f !== now.focus)
    .map((f) => ({ f, score: project(now.quality, now.bugs, now.pricing, f, seg.customers).score }))
    .sort((a, b) => b.score - a.score)[0]
  const perfectProduct = project(100, 0, now.pricing, now.focus, seg.customers).score
  const productSaturated = seg.productFit >= 100 && game.bugs === 0

  // How many customers the scale term needs before it is worth one more point.
  const perPoint = Math.max(200, ceiling * 0.12) / PMF_WEIGHTS.scale
  const customersToMaxScale = Math.round(Math.max(200, ceiling * 0.12))
  const nextScalePoint = Math.max(0, Math.ceil((Math.floor(live.scale) + 1) * perPoint) - seg.customers)

  const levers: PmfLever[] = [
    {
      label: `Price ${bestOtherPrice.p}`,
      delta: delta(bestOtherPrice.score),
      detail:
        delta(bestOtherPrice.score) > 0
          ? `${bestOtherPrice.p} pricing is worth more here than ${now.pricing}.`
          : `Both alternatives are worse: fewer of them convert and the ones who do leave sooner. ${now.pricing} is already the right call for these customers.`,
      exhausted: delta(bestOtherPrice.score) <= 0,
    },
    {
      label: `Product focus → ${bestOtherFocus.f.replace('_', ' ')}`,
      delta: delta(bestOtherFocus.score),
      detail:
        delta(bestOtherFocus.score) > 0
          ? `This segment values ${bestOtherFocus.f.replace('_', ' ')} more than ${now.focus.replace('_', ' ')}.`
          : seg.productFit >= 100
            ? 'Product fit is already 100/100 — no roadmap changes it.'
            : `Nothing this segment values is better served by another focus.`,
      exhausted: delta(bestOtherFocus.score) <= 0,
    },
    {
      label: 'Perfect the product (quality 100, zero bugs)',
      delta: delta(perfectProduct),
      detail: productSaturated
        ? 'Already there. Quality is measured against this segment’s bar, not in the abstract, and you have cleared it completely — further product work cannot move this number.'
        : `Raising quality and clearing bugs would lift product fit from ${Math.round(seg.productFit)} to ${Math.round(project(100, 0, now.pricing, now.focus, seg.customers).productFit)}.`,
      exhausted: delta(perfectProduct) <= 0,
    },
    {
      // Deliberately quoted at TEN TIMES the current base rather than at the segment ceiling. The
      // ceiling figure is arithmetically true and practically a lie: on a large-TAM segment the
      // scale term does not fill until ~90x the customers a real run ever reaches, so quoting it
      // would rank "grow" first and drown out the finding that everything else is spent.
      label: 'Win ten times as many customers',
      delta: delta(project(now.quality, now.bugs, now.pricing, now.focus, seg.customers * 10).score),
      detail:
        nextScalePoint > 0
          ? `The scale term is worth ${live.scale.toFixed(1)} of ${PMF_WEIGHTS.scale} and only fills at ${num(customersToMaxScale)} customers — ${Math.round(customersToMaxScale / Math.max(1, seg.customers))}× what you have. The next single point alone costs about ${num(nextScalePoint)} more.`
          : 'The scale term is already full — there is nothing here.',
      exhausted: delta(project(now.quality, now.bugs, now.pricing, now.focus, seg.customers * 10).score) <= 0,
    },
  ].sort((a, b) => b.delta - a.delta)

  // --- notes on each term -----------------------------------------------------------------
  const noteFor: Record<PmfTerm, string> = {
    retention: `${pct(seg.retention4wk, 0)} of a cohort is still here after four weeks. Cohorts you win today settle at ${pct(settledNow, 0)}.`,
    paying: `Price fit ${Math.round(seg.priceFit)}/100 at ${career.pricing} pricing.`,
    fit: seg.productFit >= 100 ? 'Maxed — the product clears this segment’s bar completely.' : `Product fit ${Math.round(seg.productFit)}/100.`,
    scale: `${num(seg.customers)} customers against the ${num(customersToMaxScale)} this term wants.`,
    headroom: live.headroom >= PMF_WEIGHTS.headroom ? 'Maxed — there are plenty of these people.' : 'A small segment caps this term.',
  }

  const terms = (Object.keys(PMF_WEIGHTS) as PmfTerm[]).map((key) => ({
    key,
    points: live[key],
    max: PMF_WEIGHTS[key],
    note: noteFor[key],
    exhausted: live[key] >= PMF_WEIGHTS[key] - 0.05,
  }))

  const band = PMF_BANDS.find((b) => retentionCeiling > b.retention && ceilingScoreAtScale >= b.score)
  return {
    seg,
    terms,
    total,
    settledNow,
    retentionCeiling,
    ceilingScore,
    ceilingScoreAtScale,
    customersToMaxScale,
    levers,
    productSaturated,
    atCeiling: ceilingScore - seg.score <= 2,
    bestReachableBand: band?.status ?? 'showing_value',
  }
}

/** The one segment worth explaining: your target if it is scored on behaviour, else your best. */
export function usePmfDiagnosis(): PmfDiagnosis | null {
  const game = useStore((s) => s.game)
  const rows = useSegmentSnapshots()
  if (!careerActive(game) || !game || rows.length === 0) return null
  const target = rows.find((r) => r.isTarget)
  const ordered = [target, ...[...rows].sort((a, b) => b.score - a.score)].filter(Boolean) as SegmentSnapshot[]
  for (const r of ordered) {
    const d = pmfDiagnosis(game, r.segmentId, r)
    if (d) return d
  }
  return null
}

function TermBar({ points, max }: { points: number; max: number }) {
  const full = points >= max - 0.05
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(1, Math.round((points / max) * 100))}%`,
          background: full ? 'var(--color-good)' : points / max < 0.3 ? 'var(--color-bad)' : 'var(--color-warn)',
        }}
      />
    </div>
  )
}

/**
 * The answer to "why is it 63, and what would change it?" — the five terms, which of them are
 * already exhausted, and the honest sentence when a segment has nothing left to give.
 */
export function PmfBreakdown({ compact = false }: { compact?: boolean }) {
  const game = useStore((s) => s.game)
  const d = usePmfDiagnosis()
  if (!d || !game) return null
  const name = d.seg.name
  const bandNames: Record<string, string> = { scalable: 'Scalable PMF', strong: 'Strong PMF', emerging: 'Emerging PMF', showing_value: 'Showing value' }
  const nextBand = PMF_BANDS.filter((b) => b.score > d.seg.score).sort((a, z) => a.score - z.score)[0]
  const blockedByRetention = nextBand && d.retentionCeiling <= nextBand.retention

  const body = (
    <>
      <div className="text-[12.5px] leading-snug text-mut">
        {name} scores <b className="text-ink">{d.seg.score}</b> out of 100. Every point comes from one of five things, and the bar shows
        how much of each you have already collected.
      </div>

      <div className="mt-2.5 space-y-1.5">
        {d.terms.map((t) => (
          <div key={t.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1 sm:grid-cols-[7.2rem_4rem_1fr]">
            <span className="text-[12.5px] font-semibold">{PMF_TERM_LABEL[t.key]}</span>
            <span className="tnum text-right text-[12.5px]">
              <b className={t.exhausted ? 'text-good' : ''}>{t.points.toFixed(1)}</b>
              <span className="text-mut">/{t.max}</span>
            </span>
            <span className="col-span-2 sm:col-span-1">
              <TermBar points={t.points} max={t.max} />
            </span>
            <span className="col-span-2 text-[11.5px] leading-snug text-mut sm:col-span-2 sm:col-start-2">{t.note}</span>
          </div>
        ))}
      </div>

      <div className="mt-2.5 border-t border-line/60 pt-2 text-[12.5px] leading-relaxed">
        <b>What is actually holding it back.</b>{' '}
        {d.productSaturated ? (
          <>
            Nothing you can build. Quality is measured against the bar <i>{name}</i> set, not in the abstract, and your product already
            clears it completely — product fit is {Math.round(d.seg.productFit)}/100 with no bugs, so more quality, more features and a
            different roadmap focus are all worth <b>zero</b> here. What is left is the segment itself: how long these people stay, and how
            much they will pay.
          </>
        ) : (
          <>
            {d.terms
              .filter((t) => !t.exhausted)
              .sort((a, b) => b.max - b.points - (a.max - a.points))[0]
              ?.note ?? 'Every term is at its maximum.'}
          </>
        )}
      </div>

      <div className="mt-2 text-[12.5px] leading-relaxed">
        <b>The ceiling.</b> With a flawless product at the best price for them, a cohort of {name} settles at{' '}
        <b className={retentionTone(d.retentionCeiling)}>{pct(d.retentionCeiling, 0)}</b> four-week retention — that is the most this
        segment can give, at any quality. At your current size that caps the score at about <b>{Math.round(d.ceilingScore)}</b>
        {d.ceilingScoreAtScale > d.ceilingScore + 1 && (
          <> (about {Math.round(d.ceilingScoreAtScale)} if you ever reached {num(d.customersToMaxScale)} customers)</>
        )}
        .{' '}
        {d.atCeiling && (
          <b className="text-warn">
            {Math.round(d.ceilingScore) <= d.seg.score
              ? `You are sitting on it.`
              : `You are ${Math.round(d.ceilingScore - d.seg.score)} point${Math.round(d.ceilingScore - d.seg.score) === 1 ? '' : 's'} below it.`}{' '}
            {name} has essentially nothing left to give.
          </b>
        )}
      </div>

      {blockedByRetention && (
        <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] leading-relaxed text-warn">
          {bandNames[nextBand.status]} needs four-week retention above {pct(nextBand.retention, 0)}. {name} cannot reach it — not at any
          price, not at any quality. The best band this segment can ever reach is{' '}
          <b>{bandNames[d.bestReachableBand] ?? d.bestReachableBand}</b>. Going higher is not a product problem; it means selling to
          different people.
        </div>
      )}

      {/* The lever ledger is the long part, and the Dashboard is not where a player wants to read
          it — the compact card ends on the punchline and points at Discovery, which is one click
          away directly below. */}
      {compact ? (
        <div className="mt-2 text-[12px] leading-relaxed text-mut">
          Discovery scores what each remaining lever is worth, in points.
        </div>
      ) : (
      <div className="mt-2.5">
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.09em] text-mut">What would move it</div>
        <div className="space-y-1">
          {d.levers.map((l) => (
            <div key={l.label} className="grid grid-cols-[2.4rem_1fr] gap-x-2 text-[12.5px]">
              <span className={`tnum text-right font-bold ${l.delta > 0 ? 'text-good' : l.delta < 0 ? 'text-bad' : 'text-mut'}`}>
                {l.delta > 0 ? `+${l.delta}` : l.delta < 0 ? l.delta : '±0'}
              </span>
              <div>
                <span className={l.delta > 0 ? 'font-semibold' : 'text-mut'}>{l.label}</span>
                {l.delta === 0 && (
                  <span className="ml-1.5 rounded-full bg-black/30 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-mut">
                    maxed
                  </span>
                )}
                <div className="text-[11.5px] leading-snug text-mut">{l.detail}</div>
              </div>
            </div>
          ))}
          {d.atCeiling && (
            <div className="grid grid-cols-[2.4rem_1fr] gap-x-2 text-[12.5px]">
              <span className="tnum text-right font-bold text-good">?</span>
              <div>
                <span className="font-semibold">Target a different segment</span>
                <div className="text-[11.5px] leading-snug text-mut">
                  The only lever with room left — and the one the game cannot price for you, because you have not run these people yet.
                  Repositioning costs weeks of product velocity and weaker acquisition while the company turns; research is how you find out
                  whether it is worth it before you pay for it.
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-2.5 text-[11.5px] leading-relaxed text-mut">
          Retention is measured, not forecast: it is the size-weighted average of your recent cohorts&rsquo; four-week survival, so it lags
          a change by about a month. The &ldquo;settles at&rdquo; figures are what a cohort won <i>today</i> will report.
        </div>
      </div>
      )}
    </>
  )

  // Compact = no card of its own. It is folded into `PmfExplainer`, which already has one.
  if (compact) return <div className="mt-2.5 border-t border-line/60 pt-2.5">{body}</div>
  return <Panel title={`Why PMF is ${d.seg.score} — ${name}`}>{body}</Panel>
}

// ---------------------------------------------------------------------------------------
// 1. The weekly founder briefing
// ---------------------------------------------------------------------------------------

function Delta({
  label,
  value,
  format,
  suffix = '',
}: {
  label: string
  value: number
  format: (n: number) => string
  suffix?: string
}) {
  const flat = Math.abs(value) < 0.05
  const cls = flat ? 'text-mut' : value > 0 ? 'text-good' : 'text-bad'
  return (
    <span className="whitespace-nowrap text-[13px]">
      <span className="text-mut">{label}</span>{' '}
      <b className={`tnum ${cls}`}>
        {flat ? '±0' : `${value > 0 ? '▲' : '▼'} ${format(Math.abs(value))}`}
        {suffix}
      </b>
    </span>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="w-[9.5rem] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.09em] text-mut">{label}</span>
      <div className="flex-1 text-[13px] leading-snug">{children}</div>
    </div>
  )
}

/**
 * Brief §32 — what changed, why, what we learned, what we still don't know. Sits above the
 * AttentionStrip on the Dashboard: the strip says what needs doing, this says what happened.
 */
export function FounderBriefing() {
  const game = useStore((s) => s.game)
  const setScreen = useStore((s) => s.setScreen)
  if (!careerActive(game) || !game) return null
  const career = game.career!
  const b = career.lastBriefing
  if (!b) return null

  // Absolute change for the money figure, and the engine-computed percentage beside it —
  // the brief asks for a revenue MOVE, and "+$412 (+18.4%)" reads better than either alone.
  const h = game.history
  const revenueDelta = h.length >= 2 ? h[h.length - 1].revenue - h[h.length - 2].revenue : 0
  const explanations = career.lastExplanations ?? []
  // `why` is the first explanation's primary cause, so rendering both would say it twice.
  const causes = explanations.length > 0 ? explanations : null
  const targetName = segmentDef(game.sector, career.primaryTargetSegmentId).name

  return (
    <div className="mb-3.5 rounded-2xl border border-accent/25 bg-accent/[0.04] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-mut">Week {b.week} briefing</span>
        <Delta label="Customers" value={b.customersDelta} format={num} />
        <Delta
          label="Revenue"
          value={revenueDelta}
          format={(n) => `${money(n)}${b.revenueDeltaPct ? ` (${b.revenueDeltaPct > 0 ? '+' : ''}${b.revenueDeltaPct}%)` : ''}`}
        />
        <Delta label="4-wk retention" value={b.retentionDeltaPct} format={(n) => n.toFixed(1)} suffix="pp" />
        <button
          className="ml-auto shrink-0 rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-semibold text-mut transition-colors hover:border-accent hover:text-ink"
          onClick={() => setScreen('discovery')}
        >
          Discovery →
        </button>
      </div>

      <Line label="Why">
        {causes ? (
          <ul className="space-y-1">
            {causes.map((e, i) => (
              <li key={i}>
                {explanationText(e)}
                {e.secondaryCauses.length > 0 && <span className="text-mut"> {e.secondaryCauses.join(' ')}</span>}
              </li>
            ))}
          </ul>
        ) : (
          b.why
        )}
      </Line>

      {b.learned && <Line label="What we learned">{b.learned}</Line>}

      <Line label="Biggest uncertainty">
        <span className="text-mut">{b.uncertainty}</span>
      </Line>

      <div className="mt-2.5 border-t border-line/50 pt-2 text-[12px] leading-snug text-mut">
        Targeting <b className="text-ink">{targetName}</b> · {num(totalCustomers(career, career.primaryTargetSegmentId))} customers ·{' '}
        {career.pricing} pricing · optimising for {career.focus.replace('_', ' ')}.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// 2. Per-segment retention — the most important number in Career, previously invisible
// ---------------------------------------------------------------------------------------

export function SegmentHealth({ title = 'Segments — what customers are actually doing' }: { title?: string }) {
  const game = useStore((s) => s.game)
  const rows = useSegmentSnapshots()
  if (rows.length === 0 || !game) return null

  return (
    <Panel title={title}>
      <div className="text-[12.5px] leading-snug text-mut">
        4-week retention is the share of a cohort still paying a month after they arrived. It is most of the PMF score — nothing you
        believe about a segment counts until this number holds.
      </div>
      <div className="mt-2.5 overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[0.06em] text-mut">
              <th className="border-b border-line pb-1.5 pr-2 text-left font-semibold">Segment</th>
              <th className="border-b border-line pb-1.5 pr-2 text-right font-semibold">Customers</th>
              <th className="border-b border-line pb-1.5 pr-2 text-right font-semibold">4-wk retention</th>
              <th className="border-b border-line pb-1.5 pr-2 pl-5 text-left font-semibold">PMF</th>
              <th className="border-b border-line pb-1.5 pr-2 pl-3 text-right font-semibold" title="The most this segment can score at your current size, with a flawless product at the best price for them.">
                Its ceiling
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // The ceiling is only shown for segments you have actually RUN. A segment with no
              // customers is still a discovery question, and printing its ceiling would answer it
              // for free.
              const diag = pmfDiagnosis(game, r.segmentId, r)
              const blocker = diag?.atCeiling
                ? `At its ceiling. With a perfect product at the best price for them, ${r.name} tops out around ${Math.round(diag.ceilingScore)} — the constraint is the segment, not the roadmap.`
                : pmfBlocker(r)
              return (
                <tr key={r.segmentId} className={r.isTarget ? 'bg-accent/[0.07]' : ''}>
                  <td className="border-b border-line/40 py-2 pr-2 align-top text-[13px]">
                    <b>{r.name}</b>
                    {r.isTarget && (
                      <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-accent">
                        Target
                      </span>
                    )}
                    {blocker && <div className="mt-0.5 max-w-[46ch] text-[11.5px] leading-snug text-mut">{blocker}</div>}
                  </td>
                  <td className="border-b border-line/40 py-2 pr-2 text-right align-top text-[13px] tnum">{num(r.customers)}</td>
                  <td className="border-b border-line/40 py-2 pr-2 text-right align-top text-[13px] tnum">
                    {r.retention4wk > 0 ? (
                      <b className={retentionTone(r.retention4wk)}>{pct(r.retention4wk, 0)}</b>
                    ) : (
                      <span className="text-mut" title="Needs a cohort at least four weeks old before it can be measured.">
                        not measured
                      </span>
                    )}
                  </td>
                  <td className="border-b border-line/40 py-2 pr-2 pl-5 align-top text-[13px]">
                    {PMF_LABEL[r.status]} <span className="text-mut tnum">· {r.score}</span>
                  </td>
                  <td className="border-b border-line/40 py-2 pr-2 pl-3 text-right align-top text-[13px] tnum">
                    {diag ? (
                      <b className={diag.atCeiling ? 'text-warn' : 'text-mut'}>{Math.round(diag.ceilingScore)}</b>
                    ) : (
                      <span className="text-mut" title="Nothing to measure yet — this segment has no customer behaviour to read.">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11.5px] leading-relaxed text-mut">
        A segment with fewer than {PMF_CUSTOMER_FLOOR} retained customers cannot score above <i>problem validated</i>, no matter how much
        research you have done. Only customers who stay and pay move PMF. <b className="text-ink">Its ceiling</b> is the most a segment
        could score at your current size with a flawless product at the best price for it — when your score is sitting on that number, more
        product work cannot help and the move is to sell to somebody else.
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------------------
// 3. What PMF actually is, next to where the player reads the number
// ---------------------------------------------------------------------------------------

export function PmfExplainer() {
  const game = useStore((s) => s.game)
  const setScreen = useStore((s) => s.setScreen)
  const rows = useSegmentSnapshots()
  if (!careerActive(game) || !game || rows.length === 0) return null
  const career = game.career!
  const target = rows.find((r) => r.isTarget) ?? rows[0]
  const best = [...rows].sort((a, b) => b.score - a.score)[0]
  const blocker = pmfBlocker(target)

  return (
    <div className="mt-3.5 rounded-2xl border border-line/70 bg-surface/60 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-mut">Why PMF is {Math.round(game.pmf)}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed">{PMF_CAUSAL_CHAIN}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mut">
        The company scores as its best <i>proven</i> segment: <b className="text-ink">{best.name}</b> at {PMF_LABEL[best.status]} (
        {best.score}). You are targeting <b className="text-ink">{target.name}</b> — {num(target.customers)} customers,{' '}
        {target.retention4wk > 0 ? `${pct(target.retention4wk, 0)} four-week retention` : 'retention not measurable yet'}.
        {blocker && ` ${blocker}`}
      </p>

      {/* The decomposition. This is the part that answers the question rather than restating it. */}
      <PmfBreakdown compact />

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          className="rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-semibold text-mut transition-colors hover:border-accent hover:text-ink"
          onClick={() => setScreen('discovery')}
        >
          Discovery — segments &amp; experiments →
        </button>
        <button
          className="rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-semibold text-mut transition-colors hover:border-accent hover:text-ink"
          onClick={() => setScreen('product')}
        >
          Product — quality &amp; bugs →
        </button>
      </div>
      {career.repositioning && (
        <div className="mt-2 text-[12px] text-warn">
          Repositioning for {career.repositioning.remainingWeeks} more week
          {career.repositioning.remainingWeeks === 1 ? '' : 's'} — acquisition and product output are both reduced until the company
          finishes turning.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// 5. What the team thinks — Living World Phase 6 (brief §28-§33, panel format §76)
//
// The advisor panel: named people reading the same week through different weights and
// disagreeing about it. Everything shown was composed once, when the week resolved, and
// persisted in world.advisorPanel — this component only renders; it never recomputes prose
// (§68/§72). Gated on the advisorOpinions capability, so Quick Play and Arena never see it.
// ---------------------------------------------------------------------------------------

export function TeamOpinions() {
  const game = useStore((s) => s.game)
  if (!game || !hasCapability(game, 'advisorOpinions')) return null
  const panel = game.world?.advisorPanel
  // Only this week's read. A panel from an earlier week is stale advice; a quiet week is quiet.
  if (!panel || panel.week !== game.week || panel.opinions.length === 0) return null

  return (
    <div className="mt-3.5">
      <Panel title="What the team thinks">
      <div className="space-y-2.5">
        {panel.opinions.map((o) => (
          <div key={o.id} className="flex gap-3">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${o.direction < 0 ? 'bg-warn' : 'bg-good'}`}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="text-[12px] text-mut">
                <b className="text-ink">{o.speaker}</b>
                {o.title ? ` · ${o.title}` : ''}
              </div>
              <div className="text-[13.5px] font-semibold leading-snug">{o.headline}</div>
              <div className="text-[13px] leading-snug text-mut">{o.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-[11px] text-mut">
        Each of them weighs the same week differently. None of them is automatically right.
      </div>
      </Panel>
    </div>
  )
}
