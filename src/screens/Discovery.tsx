// Career-only: the Hypothesis Board, experiment catalogue and evidence log.
// This screen is the centre of early Career play — it is where you find out that you were
// wrong about your own market.
import { Clock, DollarSign, FileText, MessageSquare, MousePointerClick, Rocket, Tag, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Btn, Disclosure, NESTED, Panel } from '../components'
import { money } from '../format'
import {
  EXPERIMENTS,
  EXPERIMENT_ANSWERS,
  METRIC_LABEL,
  PMF_CUSTOMER_FLOOR,
  TRUTH_METRICS,
  beliefBand,
  canRunExperiment,
  confidenceLabel,
  experimentDef,
  organicCustomers,
  segmentDef,
  segmentsForSector,
  suggestedExperiment,
  totalCustomers,
} from '../game/career/pmf'
import type { ExperimentType, SegmentId } from '../game/career/types'
import { CustomerInterview, PmfBreakdown, SegmentHealth } from '../CareerUI'
import { useStore } from '../store'

// The catalogue's icon grammar from the sample mock: one lucide glyph per way of learning,
// sitting in a NESTED square tile at the head of each row.
const EXPERIMENT_ICON: Record<ExperimentType, LucideIcon> = {
  interview: MessageSquare,
  landing_page: FileText,
  prototype: MousePointerClick,
  pricing_test: Tag,
  pilot: Rocket,
}

// Duration / cost read as small bordered chips, not prose — the mock's metadata treatment.
const CHIP = 'inline-flex items-center gap-1 rounded-md border border-line/70 bg-surface2 px-2 py-0.5 text-[11.5px] font-semibold text-mut tnum'

/**
 * The mock's segmented control for "Your bet": one bordered NESTED container, the chosen option a
 * filled accent pill. Pure presentation over choices the store already owns — every pill fires the
 * exact store action the old buttons and <select> fired.
 */
function PillGroup<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onSelect: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-line/70 bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onSelect(o.id)}
          className={`min-h-[38px] flex-1 rounded-full px-3.5 text-[12.5px] font-semibold whitespace-nowrap capitalize transition-colors duration-[120ms] ${
            value === o.id ? 'bg-accent text-ink' : 'text-mut hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

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

      {/* The board can look broken on a segment with real customers — 32 people retaining at 74%
          while every row still reads "no evidence yet" (owner report, 2026-08-21). It is not
          broken, it is superseded: past the floor the tick scores behaviour, not beliefs. Say so
          on the card, in the gap between the real numbers above and the assumptions below. */}
      {organicCustomers(career, segmentId) >= PMF_CUSTOMER_FLOOR && (
        <div className="mt-2.5 rounded-lg border border-line/60 bg-surface2 px-2.5 py-2 text-[11.5px] leading-snug text-mut">
          PMF for this segment has moved past this board — with {customers.toLocaleString()} customers it is scored on what they do,
          staying and paying{retention > 0 && <> ({Math.round(retention * 100)}% stay four weeks)</>}, not on what you believe. The rows
          below still steer your bet; only experiments move them.
        </div>
      )}

      <div className="mt-3 space-y-2">
        {TRUTH_METRICS.map((m) => {
          const b = beliefs[m]
          const band = beliefBand(b)
          return (
            <div key={m} className="rounded-lg border border-line/60 bg-surface2 px-2.5 py-2">
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
  // Every hook runs before the first `return`. This used to sit under `if (!career) return null`,
  // which meant the hook count changed the week a run became a Career run — React's one rule.
  const [picked, setPicked] = useState<SegmentId | null>(career?.primaryTargetSegmentId ?? null)
  // Which catalogue rows are armed as standing studies. Replaces a second Run button per row.
  const [standingTypes, setStandingTypes] = useState<ReadonlySet<string>>(() => new Set())
  if (!career) return null

  const segs = segmentsForSector(game.sector)
  const suggestion = suggestedExperiment(career, game.sector)
  // Falls back to the live target for the one render where the board opened before there was a
  // career to read one from.
  const segment = picked ?? career.primaryTargetSegmentId
  const toggleStanding = (type: string) =>
    setStandingTypes((prev) => {
      const next = new Set(prev)
      if (!next.delete(type)) next.add(type)
      return next
    })

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Discovery</h1>
      <div className="mb-4 text-[13px] text-mut">
        You don't know your market yet. Research improves what you <i>know</i>; customers prove whether you were <i>right</i>.
      </div>

      {/* The screen's verb, first. This was the fifth block, ~1,200px down and undercut by a
          catalogue of identical buttons: the one thing that knows what to do next was the hardest
          thing here to reach. */}
      <Panel title="Run this next">
        {suggestion ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-[12.5px]">
              <b>
                {experimentDef(suggestion.type).name} — {segmentDef(game.sector, suggestion.segmentId).name}
              </b>
              <div className="mt-0.5 text-mut">{suggestion.why}</div>
            </span>
            <Btn
              variant="primary"
              className="shrink-0"
              disabled={!canRunExperiment(career, suggestion.type, suggestion.segmentId, game.cash).ok}
              onClick={() => {
                setPicked(suggestion.segmentId)
                runExperiment(suggestion.type, suggestion.segmentId)
              }}
            >
              Run it
            </Btn>
          </div>
        ) : (
          <div className="text-[12.5px] leading-snug text-mut">
            Nothing cheap left to learn — every open question is either answered or already being tested. Go and win customers; their
            behaviour is the evidence you can't buy.
          </div>
        )}
      </Panel>

      {/* the scoreboard: what customers are doing, before anything you believe about them */}
      <div className="mt-3.5">
        <SegmentHealth />
      </div>

      {/* …and immediately underneath it, why that score is that score. The scoreboard alone tells a
          stuck player what the number is; this tells them which of the five terms is holding it,
          which levers are already spent, and when the segment simply has nothing left to give.
          The causal-chain paragraph that used to follow was the fourth rendering of the same
          string; it survives on the Product screen and in the PMF explainer, next to the number. */}
      <div className="mt-3.5">
        <PmfBreakdown />
      </div>

      {/* strategy row */}
      <Panel title="Your bet" className="mt-3.5">
        <div className="text-[12.5px] leading-snug text-mut">
          Who you are building for, what the product optimises for, and what you charge. All three are guesses until customers stay —
          and switching target costs weeks of velocity, because the roadmap was built for somebody else.
        </div>
        <div className="mt-2.5">
          <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">Target segment</div>
          <PillGroup
            options={segs.map((sg) => ({ id: sg.id, label: sg.name }))}
            value={career.primaryTargetSegmentId}
            onSelect={(id) => setTargetSegment(id)}
          />
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
            <PillGroup
              options={(['low', 'market', 'premium'] as const).map((p) => ({ id: p, label: p }))}
              value={career.pricing}
              onSelect={setPricing}
            />
          </div>
          <div>
            <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">Product focus</div>
            {/* Was a <select>; the mock's segmented grammar covers it too, and the six options
                surface at a glance instead of hiding behind a dropdown. Same setProductFocus call. */}
            <PillGroup
              options={(['simplicity', 'reliability', 'collaboration', 'enterprise_readiness', 'automation', 'performance'] as const).map((f) => ({
                id: f,
                label: f.replace('_', ' '),
              }))}
              value={career.focus}
              onSelect={setProductFocus}
            />
          </div>
        </div>
      </Panel>

      {/* experiments. The sample mock also heads this panel with a stats banner — experiments run /
          "insight velocity" / a confidence score. Deliberately NOT built: the state holds none of
          those numbers and inventing metrics is out of scope for a presentation pass. */}
      <div className="mt-3.5">
        <Panel title="Experiments">
          <div className="mb-3 text-[12.5px] leading-snug text-mut">
            Experiments buy evidence, not customers. Each one costs cash, weeks and some engineering capacity; the slow, expensive ones
            measure behaviour and are hard to argue with, the cheap ones measure opinions and flatter you. A study moves exactly the
            hypothesis-board rows named on it — the bold one is the question it exists to answer — pulling your estimate toward the
            segment's hidden truth and raising its confidence. It never adds customers, quality or revenue.
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
                          type="button"
                          role="switch"
                          aria-checked={e.standing}
                          className={`rounded-md border px-1.5 py-px text-[11px] font-semibold transition-colors ${
                            e.standing ? 'border-accent bg-accent/15 text-ink' : 'border-line2 text-mut hover:border-accent hover:text-ink'
                          }`}
                          title={
                            e.standing
                              ? 'Standing study: restarts itself when it finishes, while the cash lasts. Click to let it stop.'
                              : 'One-off. Click to make it a standing study that renews itself.'
                          }
                          onClick={() => setExperimentStanding(e.id, !e.standing)}
                        >
                          ↻ Standing
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

          {/* Experiments run on ANY segment. Investigating only your current bet is how you end
              up certain about the wrong market. */}
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold tracking-wide text-mut uppercase">Investigate</span>
            {segs.map((sg) => (
              <button
                key={sg.id}
                onClick={() => setPicked(sg.id)}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-all ${
                  segment === sg.id ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-surface text-mut hover:border-accent/50'
                }`}
              >
                {sg.name}
                {sg.id === career.primaryTargetSegmentId && <span className="ml-1 text-[10px] text-accent">· target</span>}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {EXPERIMENTS.map((def) => {
              const gate = canRunExperiment(career, def.type, segment, game.cash)
              const standing = standingTypes.has(def.type)
              const Icon = EXPERIMENT_ICON[def.type]
              return (
                <div key={def.type} className="flex flex-wrap items-center gap-3 border-b border-line/40 py-2.5 last:border-b-0">
                  <div className={`${NESTED} flex h-10 w-10 shrink-0 items-center justify-center`}>
                    <Icon size={20} className="text-accent" aria-hidden="true" />
                  </div>
                  <span className="min-w-0 flex-1 text-[12.5px]">
                    <b>{def.name}</b>
                    <div className="text-[11.5px] text-mut">{def.blurb}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={CHIP}>
                        <Clock size={16} aria-hidden="true" /> {def.weeks} wk
                      </span>
                      <span className={CHIP}>
                        {/* money() already prints the $, the icon replaces it */}
                        <DollarSign size={16} aria-hidden="true" /> {money(def.cashCost).replace('$', '')}
                      </span>
                    </div>
                    {/* Which board rows this instrument moves — def.metrics verbatim, the
                        EXPERIMENT_ANSWERS headline bolded. The player's exact question ("what does
                        research do, which metric moves?") answered where the Run button is. */}
                    <div className="mt-1 text-[11px] leading-snug text-mut">
                      Moves{' '}
                      <b className="text-ink/85">{METRIC_LABEL[EXPERIMENT_ANSWERS[def.type].metric]}</b>
                      {def.metrics
                        .filter((m) => m !== EXPERIMENT_ANSWERS[def.type].metric)
                        .map((m) => ` · ${METRIC_LABEL[m]}`)
                        .join('')}
                    </div>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/* Standing is the mode Run runs in, so it is a switch, not the second
                        full-size button it used to be on all five rows. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={standing}
                      onClick={() => toggleStanding(def.type)}
                      title={`Standing: this study restarts itself every ${def.weeks} wk on ${segmentDef(game.sector, segment).name} while the cash lasts.`}
                      className={`rounded-md border px-2 py-1 text-[11.5px] font-semibold transition-colors ${
                        standing ? 'border-accent bg-accent/15 text-ink' : 'border-line2 text-mut hover:border-accent hover:text-ink'
                      }`}
                    >
                      ↻ Standing
                    </button>
                    <Btn
                      variant="primary"
                      disabled={!gate.ok}
                      title={gate.reason}
                      onClick={() => runExperiment(def.type as ExperimentType, segment, standing)}
                    >
                      Run
                    </Btn>
                  </span>
                </div>
              )
            })}
          </div>

          {/* All that survives of the research explainer: the scoreboard above already says what
              PMF is scored on and where the floor sits, but nothing anywhere says who makes a
              result reliable. One interaction away, not on the face of the screen. */}
          <Disclosure label="What makes a study reliable" className="mt-3">
            <div className={`mt-1.5 ${NESTED} px-3 py-2 text-[12px] leading-relaxed text-mut`}>
              <b className="text-ink">Designers run studies best</b> — they count triple toward how reliable a result is, marketers 1.5×,
              everyone else once. Product <i>quality</i> also raises reliability; shipping more <i>features</i> does nothing for it.
            </div>
          </Disclosure>
        </Panel>
      </div>

      {/* Living World Phase 8 (§41-§45): the human face of the interview study that just landed —
          eight questions, a budget, and three people with hidden biases. Sits directly under the
          experiment catalogue that produced it. Renders null without the capability. */}
      <CustomerInterview />

      {/* hypothesis board */}
      <div className="mt-3.5">
        <div className="mb-1 text-[11px] font-bold tracking-[0.1em] text-mut uppercase">Hypothesis board</div>
        <div className="mb-2.5 max-w-[95ch] text-[12.5px] leading-snug text-mut">
          What you currently believe about each segment, and how much of it is actually evidence. The bar under each line is confidence,
          not quality — a belief can be confident and wrong. Where this board bites: below {PMF_CUSTOMER_FLOOR} customers, a segment's
          PMF score is <i>built from it</i> — confidence here is the only thing that raises the score, capped at "Problem validated" —
          so research is how PMF moves before anyone has bought. From {PMF_CUSTOMER_FLOOR} customers on, the score switches to what
          those customers actually do, and this board becomes the map you choose your bet with: target, pricing, product focus, all set
          above.
        </div>
        <div className="grid gap-3.5 lg:grid-cols-3">
          {segs.map((sg) => (
            <SegmentHypotheses key={sg.id} segmentId={sg.id} />
          ))}
        </div>
      </div>
    </div>
  )
}
