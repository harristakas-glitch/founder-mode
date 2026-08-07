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
  segmentDef,
  segmentSnapshots,
  totalCustomers,
  type SegmentSnapshot,
} from './game/career/pmf'
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
  const rows = useSegmentSnapshots()
  if (rows.length === 0) return null

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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const blocker = pmfBlocker(r)
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
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11.5px] leading-relaxed text-mut">
        A segment with fewer than {PMF_CUSTOMER_FLOOR} retained customers cannot score above <i>problem validated</i>, no matter how much
        research you have done. Only customers who stay and pay move PMF.
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
      <div className="mt-2 flex flex-wrap gap-2">
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
