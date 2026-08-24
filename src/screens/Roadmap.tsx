// The Product Roadmap — Strategic Systems Expansion phase 1 (master brief §6). Game verb:
// PRIORITISE. The screen is scheduling, not Jira: what we're building NOW, what's NEXT, what
// we are deliberately not building — and the visible cost (active work draws engineering
// output away from the weekly sliders).
import { Hammer, ListOrdered, Play, X } from 'lucide-react'
import { EmptyState } from '../components'
import { systemDepth } from '../game/modes'
import { roadmapDef } from '../game/strategic/content'
import { availableInitiatives, effortRequired, ROADMAP_DRAW_PER_ITEM, roadmapSlots } from '../game/strategic/roadmap'
import { createDefaultRoadmap, type RoadmapInitiativeDef } from '../game/strategic/types'
import { segmentDef } from '../game/career/pmf'
import { alignmentWord, bigBetDef, initiativeAlignment } from '../game/strategic/bigbets'
import { AI_AREA_META, AI_AREAS, aiInitiativeDef, aiLeverage, availableAIInitiatives, createDefaultAI, MATURITY_WORDS } from '../game/strategic/ai'
import { money } from '../format'
import { useStore } from '../store'

const fitWord = (m: number) => (m >= 1.3 ? 'Very high' : m >= 0.95 ? 'High' : m >= 0.55 ? 'Medium' : 'Low')
const fitTone = (m: number) => (m >= 1.3 ? 'text-good' : m >= 0.95 ? 'text-ink' : m >= 0.55 ? 'text-mut' : 'text-warn')

const IMPACT_LABEL: Record<string, string> = {
  acquisition: 'Growth',
  retention: 'Retention',
  monetization: 'Revenue',
  productQuality: 'Quality',
  reliability: 'Reliability',
  developerVelocity: 'Velocity',
  operatingEfficiency: 'Efficiency',
}

function ImpactChips({ def }: { def: RoadmapInitiativeDef }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {Object.entries(def.impact).map(([k, v]) =>
        v ? (
          <span key={k} className="rounded-md border border-line2 bg-surface2 px-1.5 py-px text-[10px] font-semibold text-mut">
            {IMPACT_LABEL[k] ?? k} {'·'.repeat(v)}
          </span>
        ) : null,
      )}
      {def.techDebtReduced ? (
        <span className="rounded-md border border-good/40 bg-good/10 px-1.5 py-px text-[10px] font-semibold text-good">Debt −{def.techDebtReduced}</span>
      ) : null}
      {def.techDebtCreated ? (
        <span className="rounded-md border border-warn/30 bg-warn/5 px-1.5 py-px text-[10px] font-semibold text-warn/80">Debt +{def.techDebtCreated}</span>
      ) : null}
    </span>
  )
}

export function Roadmap() {
  const game = useStore((s) => s.game)!
  const roadmapStart = useStore((s) => s.roadmapStart)
  const roadmapCancel = useStore((s) => s.roadmapCancel)
  const depth = systemDepth(game, 'roadmap')
  if (depth === 'off') return null // stale persisted screen state in a mode without the roadmap
  const rm = game.roadmap ?? createDefaultRoadmap()
  const slots = roadmapSlots(depth)
  const pool = availableInitiatives(game, depth)
  const target = game.career?.primaryTargetSegmentId
  const activeBet = game.bigBet?.status === 'active' ? game.bigBet : null
  const targetName = target ? segmentDef(game.sector, target).name : null

  const debtWord = rm.debt >= 70 ? 'Critical' : rm.debt >= 45 ? 'High' : rm.debt >= 20 ? 'Rising' : 'Low'
  const debtTone = rm.debt >= 70 ? 'text-bad' : rm.debt >= 45 ? 'text-warn' : rm.debt >= 20 ? 'text-warn/80' : 'text-good'
  const drawPct = Math.round(Math.min(0.44, rm.active.length * ROADMAP_DRAW_PER_ITEM) * 100)

  return (
    <div className="max-w-[980px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Product Roadmap</h1>
          <div className="text-[13px] text-mut">
            What we build next — and what we deliberately don&apos;t.
            {rm.active.length > 0 && (
              <>
                {' '}
                Active work draws <b className="text-warn">{drawPct}%</b> of engineering output.
              </>
            )}
          </div>
        </div>
        <div className="text-right text-[12px]">
          <span className="text-[10px] font-bold tracking-wider text-mut uppercase">Tech debt </span>
          <b className={debtTone}>{debtWord}</b>
        </div>
      </div>

      {/* NOW — the active slots */}
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-mut uppercase">
        <Hammer size={12} /> Now · {rm.active.length}/{slots} slots
      </div>
      {rm.active.length === 0 ? (
        <div className="mb-5 rounded-xl border border-line/60 bg-surface px-4 py-4 text-[13px] text-mut">
          Nothing in flight. Every week without a priority is a week the sliders spend on maintenance — pick something below.
        </div>
      ) : (
        <div className="mb-5 space-y-2">
          {rm.active.map((item) => {
            const def = roadmapDef(game.sector, item.id)
            if (!def) return null
            const pct = Math.min(100, Math.round((item.progress / effortRequired(def, depth)) * 100))
            return (
              <div key={item.id} className="rounded-xl border border-line bg-surface p-4 shadow-[var(--elev-1)]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold">{def.name}</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-mut">{def.blurb}</div>
                  </div>
                  <button
                    className="shrink-0 rounded-lg border border-line2 p-1.5 text-mut transition-colors hover:border-bad/50 hover:text-bad"
                    title="Cancel — sunk effort stays sunk, and a half-built thing leaves residue"
                    aria-label={`Cancel ${def.name}`}
                    onClick={() => roadmapCancel(item.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
                    <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[12px] font-bold tnum">{pct}%</span>
                  <span className="text-[11px] text-mut tnum">since wk {item.startedWeek}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* NEXT — the queue */}
      {rm.queued.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-mut uppercase">
            <ListOrdered size={12} /> Next
          </div>
          <div className="mb-5 space-y-1.5">
            {rm.queued.map((id) => {
              const def = roadmapDef(game.sector, id)
              if (!def) return null
              return (
                <div key={id} className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface2 px-3.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{def.name}</span>
                  <span className="text-[11px] text-mut tnum">~{def.weeks} wks</span>
                  <button className="text-mut transition-colors hover:text-bad" aria-label={`Remove ${def.name} from queue`} onClick={() => roadmapCancel(id)}>
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* AVAILABLE — the pool */}
      <div className="mb-2 text-[11px] font-bold tracking-[0.12em] text-mut uppercase">
        Available{targetName && <span className="ml-2 font-semibold normal-case tracking-normal text-mut">target fit shown for {targetName}</span>}
      </div>
      {pool.length === 0 ? (
        <EmptyState icon={<Hammer size={22} />} title="The roadmap is built out." hint="Everything this stage offers is shipped or in flight." />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {pool.map((def) => {
            const segVals = Object.values(def.segmentImpact)
            const mean = segVals.length ? segVals.reduce((a: number, b) => a + (b ?? 0), 0) / segVals.length : 1
            const rel = target ? (def.segmentImpact[target] ?? mean) : mean
            return (
              <div key={def.id} className="flex flex-col rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14.5px] font-bold">{def.name}</div>
                  <span className="shrink-0 text-[11px] text-mut tnum">~{def.weeks} wks</span>
                </div>
                <div className="mt-1 flex-1 text-[12.5px] leading-snug text-mut">{def.blurb}</div>
                <div className="mt-2.5">
                  <ImpactChips def={def} />
                </div>
                {activeBet && (() => {
                  const w = alignmentWord(initiativeAlignment(activeBet.type, game.sector, def.id))
                  const label = { strongly_supports: 'Strongly supports', supports: 'Supports', neutral: 'Neutral to', competes: 'Competes with' }[w]
                  const tone = w === 'strongly_supports' ? 'text-good' : w === 'supports' ? 'text-good/80' : w === 'neutral' ? 'text-mut' : 'text-warn'
                  return (
                    <div className={`mt-2 text-[11px] font-semibold ${tone}`}>
                      {label} {bigBetDef(activeBet.type).name}
                    </div>
                  )
                })()}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11.5px]">
                    <span className="text-mut">{targetName ? 'Target fit ' : 'Market fit '}</span>
                    <b className={fitTone(rel)}>{fitWord(rel)}</b>
                  </span>
                  <button
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--color-accent)]/45 bg-[var(--color-accent)]/10 px-3 py-1.5 text-[12px] font-bold text-accent transition-colors hover:bg-accent hover:text-bg"
                    onClick={() => roadmapStart(def.id)}
                  >
                    <Play size={12} /> {rm.active.length < slots ? 'Start' : 'Queue'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* AI ADOPTION (phase 5, deep only) — Product → Systems per the brief §5.9: game-like
          initiatives, not a maturity dashboard. Lives on the roadmap because it competes for the
          same engineering week the roadmap does. */}
      <AISection />
    </div>
  )
}

function AISection() {
  const game = useStore((s) => s.game)!
  const aiStart = useStore((s) => s.aiStart)
  const aiCancel = useStore((s) => s.aiCancel)
  if (systemDepth(game, 'aiAdoption') !== 'deep') return null
  const ai = game.aiAdoption ?? createDefaultAI()
  const available = availableAIInitiatives(game)
  const leverage = aiLeverage(game)
  const anyAdoption = AI_AREAS.some((a) => (ai.areas[a]?.maturity ?? 0) > 0)

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-mut uppercase">
        🤖 AI adoption — how the company itself runs
      </div>

      {/* maturity chips per area */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {AI_AREAS.map((area) => {
          const st = ai.areas[area]
          const m = st?.maturity ?? 0
          return (
            <span
              key={area}
              title={`${AI_AREA_META[area].moves}${st && st.resistance >= 30 ? ' · the team is resisting — show them it works for them' : ''}`}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${
                m === 0 ? 'border-line2 text-mut' : st!.quality < 40 ? 'border-warn/50 bg-warn/10 text-warn' : 'border-accent/45 bg-accent/10 text-ink'
              }`}
            >
              {AI_AREA_META[area].icon} {AI_AREA_META[area].label} · {MATURITY_WORDS[m]}
              {st && st.resistance >= 30 && ' ⚡'}
            </span>
          )
        })}
      </div>

      {/* current leverage — the §5.9 lines, real numbers from the composer's own parts */}
      {anyAdoption && leverage.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-line/60 bg-surface px-4 py-2.5 text-[12.5px]">
          {leverage.map((l) => (
            <span key={l.label}>
              <span className="text-mut">{l.label}</span>{' '}
              <b className={`tnum ${l.label === 'Quality risk' ? 'text-warn' : 'text-good'}`}>{l.value}</b>
            </span>
          ))}
        </div>
      )}

      {/* active rollout */}
      {ai.active.map((a) => {
        const def = aiInitiativeDef(a.id)
        if (!def) return null
        return (
          <div key={a.id} className="mb-3 rounded-xl border border-accent/40 bg-accent/[0.05] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="text-[14px]">{def.name} — rolling out</b>
              <button onClick={() => aiCancel(a.id)} className="text-[11.5px] text-mut underline decoration-dotted hover:text-bad">
                Cancel
              </button>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.min(100, a.progress)}%` }} />
            </div>
            <div className="mt-1 text-[11.5px] text-mut">
              An overloaded org rolls out slowly, and a resistant team slower still — the Organisation panel on Team says which you are.
            </div>
          </div>
        )
      })}

      {/* available initiatives — the next rung per area */}
      {available.length > 0 && ai.active.length === 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {available.map((d) => (
            <div key={d.id} className="flex flex-col rounded-xl border border-line/60 bg-surface p-3.5">
              <div className="flex items-start justify-between gap-2">
                <b className="text-[13.5px] leading-tight">{d.name}</b>
                <span className="shrink-0 rounded-full border border-line2 px-2 py-[2px] text-[10px] font-bold text-mut">
                  → {MATURITY_WORDS[d.target]}
                </span>
              </div>
              <div className="mt-1 flex-1 text-[12px] leading-snug text-mut">{d.blurb}</div>
              <div className="mt-2 flex items-center justify-between text-[11.5px]">
                <span className="text-mut tnum">
                  ~{d.weeks.deep} wk · {money(d.cash)} · {Math.round(d.draw * 100)}% of eng
                </span>
                <button
                  onClick={() => aiStart(d.id)}
                  disabled={game.cash < d.cash}
                  className="rounded-lg border border-accent/50 bg-accent/15 px-2.5 py-1 text-[12px] font-bold text-ink transition-colors hover:bg-accent/25 disabled:opacity-40"
                >
                  Start
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[11px] leading-snug text-mut/80">
        Leverage over headcount — but the benefit is only as good as the implementation: transform while overloaded and indebted and the
        rollout ships bugs instead of speed. One rollout at a time; it draws from the same engineering week as the roadmap.
      </div>
    </div>
  )
}
