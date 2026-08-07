// Career-only: the Hypothesis Board, experiment catalogue and evidence log.
// This screen is the centre of early Career play — it is where you find out that you were
// wrong about your own market.
import { useState } from 'react'
import { Btn, Panel } from '../components'
import { money } from '../format'
import {
  EXPERIMENTS,
  PMF_CUSTOMER_FLOOR,
  METRIC_LABEL,
  TRUTH_METRICS,
  beliefBand,
  canRunExperiment,
  confidenceLabel,
  experimentDef,
  segmentDef,
  segmentsForSector,
  suggestedExperiment,
  totalCustomers,
} from '../game/career/pmf'
import type { ExperimentType, SegmentId } from '../game/career/types'
import { PMF_CAUSAL_CHAIN, SegmentHealth } from '../CareerUI'
import { useStore } from '../store'

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-black/40">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.round(value * 100)}%`, background: value < 0.35 ? 'var(--color-bad)' : value < 0.65 ? 'var(--color-warn)' : 'var(--color-good)' }}
      />
    </div>
  )
}

function SegmentHypotheses({ segmentId }: { segmentId: SegmentId }) {
  const game = useStore((s) => s.game)!
  const career = game.career!
  const beliefs = career.segmentBeliefs[segmentId]
  const def = segmentDef(game.sector, segmentId)
  const isTarget = career.primaryTargetSegmentId === segmentId
  const customers = totalCustomers(career, segmentId)
  const retention = career.retentionBySegment[segmentId] ?? 0
  const evidence = career.evidence.filter((e) => e.segmentId === segmentId).slice(0, 4)

  return (
    <Panel className={isTarget ? 'border-accent/50' : ''}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[15px] font-extrabold">{def.name}</span>
          {isTarget && (
            <span className="ml-2 rounded-full bg-accent/20 px-2 py-px text-[10px] font-bold tracking-wide text-accent uppercase">Primary target</span>
          )}
        </div>
        <span className="text-[12px] text-mut">
          {customers > 0 ? `${customers.toLocaleString()} customers` : 'no customers yet'}
          {retention > 0 && ` · ${Math.round(retention * 100)}% 4-wk retention`}
        </span>
      </div>
      <div className="mt-1 text-[12.5px] text-mut">{def.blurb}</div>

      <div className="mt-3 space-y-2">
        {TRUTH_METRICS.map((m) => {
          const b = beliefs[m]
          const band = beliefBand(b)
          return (
            <div key={m} className="rounded-lg border border-line/60 bg-surface2/40 px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold">{METRIC_LABEL[m]}</span>
                <span className="text-[12.5px] font-bold">{band.label}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <ConfidenceBar value={b.confidence} />
                <span className="w-16 shrink-0 text-right text-[10.5px] text-mut">{confidenceLabel(b.confidence)}</span>
              </div>
              {b.evidenceCount === 0 && <div className="mt-1 text-[10.5px] text-mut">Assumption — no evidence yet.</div>}
            </div>
          )
        })}
      </div>

      {evidence.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">Recent evidence</div>
          {evidence.map((e) => (
            <div key={e.id} className="border-b border-line/40 py-1.5 text-[12px] last:border-b-0">
              <span className={e.direction === 'positive' ? 'text-good' : e.direction === 'negative' ? 'text-bad' : 'text-mut'}>
                {e.direction === 'positive' ? '+' : e.direction === 'negative' ? '−' : '~'}
              </span>{' '}
              {e.summary}
              <span className="text-mut"> · wk {e.week}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

export function Discovery() {
  const game = useStore((s) => s.game)!
  const career = game.career
  const runExperiment = useStore((s) => s.runExperiment)
  const setExperimentStanding = useStore((s) => s.setExperimentStanding)
  const setTargetSegment = useStore((s) => s.setTargetSegment)
  const setPricing = useStore((s) => s.setPricing)
  const setProductFocus = useStore((s) => s.setProductFocus)
  if (!career) return null

  const segs = segmentsForSector(game.sector)
  const suggestion = suggestedExperiment(career, game.sector)
  const [segment, setSegment] = useState<SegmentId>(career.primaryTargetSegmentId)

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Discovery</h1>
      <div className="mb-4 text-[13px] text-mut">
        You don't know your market yet. Research improves what you <i>know</i>; customers prove whether you were <i>right</i>.
      </div>

      {/* the scoreboard: what customers are doing, before anything you believe about them */}
      <div className="mb-3.5">
        <SegmentHealth />
      </div>

      <div className="mb-3.5 rounded-2xl border border-line/70 bg-surface/60 px-4 py-3 text-[13px] leading-relaxed">
        {PMF_CAUSAL_CHAIN}
      </div>

      {/* strategy row */}
      <Panel title="Your bet">
        <div className="text-[12.5px] leading-snug text-mut">
          Who you are building for, what the product optimises for, and what you charge. All three are guesses until customers stay —
          and switching target costs weeks of velocity, because the roadmap was built for somebody else.
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {segs.map((sg) => (
            <button
              key={sg.id}
              onClick={() => setTargetSegment(sg.id)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-all ${
                career.primaryTargetSegmentId === sg.id ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-surface text-mut hover:border-accent/50'
              }`}
            >
              {sg.name}
            </button>
          ))}
        </div>
        {career.repositioning && (
          <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            Repositioning — {career.repositioning.remainingWeeks} week{career.repositioning.remainingWeeks === 1 ? '' : 's'} of reduced
            product velocity and weaker acquisition while the company turns.
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">Pricing</div>
            <div className="flex gap-1.5">
              {(['low', 'market', 'premium'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPricing(p)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold capitalize transition-all ${
                    career.pricing === p ? 'border-accent bg-accent/15' : 'border-line bg-surface text-mut hover:border-accent/50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">Product focus</div>
            <select
              value={career.focus}
              onChange={(e) => setProductFocus(e.target.value as never)}
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] font-semibold capitalize outline-none focus-visible:border-accent"
            >
              {(['simplicity', 'reliability', 'collaboration', 'enterprise_readiness', 'automation', 'performance'] as const).map((f) => (
                <option key={f} value={f}>
                  {f.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      {/* experiments */}
      <div className="mt-3.5">
        <Panel title="Experiments">
          <div className="mb-3 text-[12.5px] leading-snug text-mut">
            Experiments buy evidence, not customers. Each one costs cash, weeks and some engineering capacity; the slow, expensive ones
            measure behaviour and are hard to argue with, the cheap ones measure opinions and flatter you.
          </div>
          {career.activeExperiments.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {career.activeExperiments.map((e) => {
                const def = experimentDef(e.type)
                const done = e.completionWeek - e.startWeek
                const elapsed = Math.min(done, game.week - e.startWeek)
                return (
                  <div key={e.id} className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
                    <div className="flex justify-between text-[12.5px]">
                      <b>
                        {def.name} — {segmentDef(game.sector, e.segmentId).name}
                      </b>
                      <span className="flex items-center gap-2">
                        <button
                          className={`rounded-md border px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide transition-colors ${
                            e.standing ? 'border-good/50 bg-good/15 text-good' : 'border-line2 text-mut hover:border-accent hover:text-ink'
                          }`}
                          title={
                            e.standing
                              ? 'Standing study: restarts itself when it finishes, while the cash lasts. Click to let it stop.'
                              : 'One-off. Click to make it a standing study that renews itself.'
                          }
                          onClick={() => setExperimentStanding(e.id, !e.standing)}
                        >
                          ↻ {e.standing ? 'Standing' : 'One-off'}
                        </button>
                        <span className="text-mut tnum">
                          Week {elapsed} / {done}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/40">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(elapsed / done) * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {suggestion ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface2/50 px-3 py-2 text-[12.5px]">
              <span className="min-w-0 flex-1">
                <b>
                  Worth answering next: {experimentDef(suggestion.type).name} — {segmentDef(game.sector, suggestion.segmentId).name}
                </b>
                <div className="mt-0.5 text-mut">{suggestion.why}</div>
              </span>
              <Btn
                className="shrink-0"
                disabled={!canRunExperiment(career, suggestion.type, suggestion.segmentId, game.cash).ok}
                onClick={() => {
                  setSegment(suggestion.segmentId)
                  runExperiment(suggestion.type, suggestion.segmentId)
                }}
              >
                Run it
              </Btn>
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-good/30 bg-good/5 px-3 py-2 text-[12.5px] text-mut">
              Nothing cheap left to learn — every open question is either answered or already being tested. Go and win customers; their
              behaviour is the evidence you can't buy.
            </div>
          )}

          {/* Experiments run on ANY segment. Investigating only your current bet is how you end
              up certain about the wrong market. */}
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold tracking-wide text-mut uppercase">Investigate</span>
            {segs.map((sg) => (
              <button
                key={sg.id}
                onClick={() => setSegment(sg.id)}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-all ${
                  segment === sg.id ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-surface text-mut hover:border-accent/50'
                }`}
              >
                {sg.name}
                {sg.id === career.primaryTargetSegmentId && <span className="ml-1 text-[10px] text-accent">· target</span>}
              </button>
            ))}
          </div>

          <div className="mb-2.5 rounded-lg border border-line/60 bg-surface2/40 px-3 py-2 text-[12px] leading-relaxed text-mut">
            <b className="text-ink">What research does, exactly.</b> It moves what you <i>believe</i> about a segment — never what the
            segment <i>is</i>, and never PMF on its own. PMF is scored on customers who stay. Research is how you find out where to aim
            before you spend a quarter building for the wrong people, and below {PMF_CUSTOMER_FLOOR} customers it is the only thing that
            can move the number at all (to a ceiling of 40). <b className="text-ink">Designers run studies best</b> — they count triple
            toward how reliable a result is, marketers 1.5×, everyone else once. Product <i>quality</i> also raises reliability; shipping
            more <i>features</i> does nothing for it.
          </div>

          <div className="space-y-2">
            {EXPERIMENTS.map((def) => {
              const gate = canRunExperiment(career, def.type, segment, game.cash)
              return (
                <div key={def.type} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 text-[12.5px]">
                    <b>{def.name}</b> <span className="text-mut">· {def.weeks} wk · {money(def.cashCost)}</span>
                    <div className="text-[11.5px] text-mut">{def.blurb}</div>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Btn
                      variant="primary"
                      disabled={!gate.ok}
                      title={gate.reason}
                      onClick={() => runExperiment(def.type as ExperimentType, segment)}
                    >
                      Run once
                    </Btn>
                    <Btn
                      disabled={!gate.ok}
                      title={
                        gate.ok
                          ? `Keep this study running on ${segmentDef(game.sector, segment).name}: it restarts itself every ${def.weeks} wk while the cash lasts.`
                          : gate.reason
                      }
                      onClick={() => runExperiment(def.type as ExperimentType, segment, true)}
                    >
                      ↻ Standing
                    </Btn>
                  </span>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      {/* hypothesis board */}
      <div className="mt-3.5">
        <div className="mb-1 text-[11px] font-bold tracking-[0.1em] text-mut uppercase">Hypothesis board</div>
        <div className="mb-2.5 max-w-[95ch] text-[12.5px] leading-snug text-mut">
          What you currently believe about each segment, and how much of it is actually evidence. The bar under each line is confidence,
          not quality — a belief can be confident and wrong, and evidence changes these numbers without changing your PMF.
        </div>
        <div className="grid gap-3.5 lg:grid-cols-3">
          {segs.map((sg) => (
            <SegmentHypotheses key={sg.id} segmentId={sg.id} />
          ))}
        </div>
      </div>

      {/* journal */}
      {career.journal.length > 0 && (
        <div className="mt-3.5">
          <Panel title="Decision journal">
            {career.journal.slice(0, 8).map((j) => (
              <div key={j.id} className="border-b border-line/40 py-2 text-[12.5px] last:border-b-0">
                <span className="text-mut tnum">wk {j.week}</span> <b className="ml-1.5">{j.title}</b>
                <div className="text-[12px] text-mut">{j.description}</div>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  )
}
