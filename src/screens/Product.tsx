import { useState } from 'react'
import { Bar, BarRow, Btn, DemandGauge, Panel } from '../components'
import { money, num } from '../format'
import { sectorById } from '../game/data'
import {
  PIVOT_COOLDOWN,
  PIVOT_COST,
  RESONANCE_RANGE,
  availableVentureSectors,
  canPivot,
  canStartVenture,
  demandSignal,
  pivotBonus,
  pmfLabel,
  resonanceEstimate,
  ventureSignal,
} from '../game/engine'
import { hasCapability } from '../game/modes'
import { useStore } from '../store'

const SIGNAL_COPY: Record<string, { text: string; cls: string }> = {
  unknown: { text: 'Do more user research to read the market.', cls: 'text-mut' },
  weak: { text: 'Research says demand is WEAK. This idea may never take off — consider pivoting.', cls: 'text-bad' },
  mixed: { text: 'Research says demand is MIXED. It can work, but growth will be a grind.', cls: 'text-warn' },
  strong: { text: 'Research says demand is STRONG. Pour it on — this market wants you.', cls: 'text-good' },
}

// The pivot gate lives in `canPivot`, and until now the screen never showed it: the button looked
// live at every price, you spent two clicks arming it, and the refusal arrived afterwards as a
// flash message. The cost is on the button now and the reason it is off sits under it.
function PivotButton({ onPivot, bonusPct, gate }: { onPivot: () => void; bonusPct: number; gate: { ok: boolean; reason?: string } }) {
  const [arming, setArming] = useState(false)
  if (!arming) {
    return (
      <div className="mt-3">
        <Btn variant="danger" disabled={!gate.ok} onClick={() => setArming(true)}>
          Pivot the company — {money(PIVOT_COST)} ↻
        </Btn>
        <div className="mt-1.5 text-xs leading-relaxed text-mut">
          {gate.ok
            ? `${money(PIVOT_COST)} in wind-down and rebuild, then ${PIVOT_COOLDOWN} weeks before you can pivot again.`
            : gate.reason}
        </div>
      </div>
    )
  }
  return (
    <div className="rise-in mt-3 rounded-xl border border-bad/40 bg-bad/5 p-3 text-[13px]">
      <b>What a pivot does, exactly:</b>
      <ul className="mt-1.5 ml-4 list-disc space-y-1 leading-relaxed">
        <li>
          <span className="text-good">Keep</span>: 50% of features, 70% of quality, 70% of users, your whole team
        </li>
        <li>
          <span className="text-bad">Lose</span>: 40% of hype, 60% of PMF, some morale, the demand signal — and no second pivot for{' '}
          {PIVOT_COOLDOWN} weeks
        </li>
        <li>
          <span className="text-good">Gain</span>: a fresh idea with a new demand roll, tilted <b>+{bonusPct}%</b> in your favor by
          lifetime research and pivot experience
        </li>
      </ul>
      <div className="mt-3 flex gap-2">
        <Btn
          variant="danger"
          onClick={() => {
            setArming(false)
            onPivot()
          }}
        >
          Yes — pivot for {money(PIVOT_COST)}
        </Btn>
        <Btn onClick={() => setArming(false)}>Cancel</Btn>
      </div>
    </div>
  )
}

const VENTURE_SIGNAL_COPY: Record<string, { text: string; cls: string }> = {
  unknown: { text: 'Signal unknown — keep the tiger team exploring.', cls: 'text-mut' },
  weak: { text: 'Demand looks WEAK. Shelve it and try a different market.', cls: 'text-bad' },
  mixed: { text: 'Demand looks MIXED — it can work, slowly.', cls: 'text-warn' },
  strong: { text: 'Demand looks STRONG. Feed this bet!', cls: 'text-good' },
}

function Ventures() {
  const game = useStore((s) => s.game)!
  const startBet = useStore((s) => s.startBet)
  const shelveBet = useStore((s) => s.shelveBet)
  const gate = canStartVenture(game)
  const open = availableVentureSectors(game)
  const active = game.ventures.find((v) => !v.launched)
  const launched = game.ventures.filter((v) => v.launched)
  const sig = active ? ventureSignal(active) : 'unknown'

  return (
    <div className="mt-3.5">
      <Panel title="Product lines — escape the S-curve">
        {launched.length > 0 && (
          <div className="mb-3 space-y-1.5">
            <div className="flex justify-between border-b border-line/40 pb-1.5 text-[13px]">
              <span>
                <b>Core — {sectorById(game.sector).name}</b>
              </span>
              <span className="tnum">{num(game.users)} users</span>
            </div>
            {launched.map((v) => (
              <div key={v.id} className="flex justify-between border-b border-line/40 pb-1.5 text-[13px] last:border-b-0">
                <span>
                  <b>{sectorById(v.sector).name}</b> <span className="text-mut">· launched wk {v.startedWeek} · PMF {Math.round(v.pmf)}</span>
                </span>
                <span className="tnum">{num(v.users)} users</span>
              </div>
            ))}
          </div>
        )}

        {active ? (
          <div className="rounded-xl border border-accent2/40 bg-accent2/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>Exploring: {sectorById(active.sector).name}</b>
              <span className={`text-[13px] font-semibold ${VENTURE_SIGNAL_COPY[sig].cls}`}>{VENTURE_SIGNAL_COPY[sig].text}</span>
            </div>
            <div className={`mt-2.5 grid gap-2 ${sig === 'unknown' ? 'sm:grid-cols-2' : ''}`}>
              <div>
                <div className="mb-1 text-[11px] text-mut">PMF — launches as a product line at 50</div>
                <Bar value={(active.pmf / 50) * 100} color="var(--color-accent2)" />
              </div>
              {/* Only while it is still counting up. The moment the signal is readable this bar is
                  pinned at 100% for the rest of the run, and the verdict above it says more. */}
              {sig === 'unknown' && (
                <div>
                  <div className="mb-1 text-[11px] text-mut">
                    Demand signal research ({Math.min(100, Math.round((active.researchSignal / 14) * 100))}%)
                  </div>
                  <Bar value={Math.min(100, (active.researchSignal / 14) * 100)} />
                </div>
              )}
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-mut">
              Progress comes from the <b className="text-accent2">New bet</b> slider in Team focus above — the share of engineering
              exploring this market.
            </div>
            <Btn variant="danger" className="mt-2.5" onClick={() => shelveBet(active.id)}>
              Shelve this bet
            </Btn>
          </div>
        ) : (
          <>
            <div className="text-[13px] leading-relaxed text-mut">
              When your core market saturates, growth dies with it — unless you open a second one. A new bet runs the whole discovery
              loop again in a fresh sector: new demand roll (boosted by everything you've learned), new TAM, new S-curve. Launched
              lines add their users and revenue to the company — and to the growth rate your board stares at.
            </div>
            {gate.ok ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {open.map((id) => (
                  <Btn key={id} variant="primary" onClick={() => startBet(id)}>
                    Explore {sectorById(id).name}
                  </Btn>
                ))}
                {open.length === 0 && <span className="text-mut">Every market is already yours. Impressive.</span>}
              </div>
            ) : (
              <div className="mt-3 text-[13px] text-warn">◻ {gate.reason}</div>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}

export function Product() {
  const game = useStore((s) => s.game)!
  const setAllocation = useStore((s) => s.setAllocation)
  const doPivot = useStore((s) => s.doPivot)
  const setScreen = useStore((s) => s.setScreen)
  const engineers = game.employees.filter((e) => e.role === 'engineer').length
  const a = game.allocation
  const hasBet = game.ventures.some((v) => !v.launched)
  // Career derives PMF from segments, so the research slider has no path to it and the engine
  // now excludes it from the denominator entirely. Showing it would invite players to spend a
  // fifth of engineering on nothing — which is exactly what the shipped default did.
  const career = hasCapability(game, 'detailedPMF')
  const sum = Math.max(1, a.features + a.quality + a.bugs + (career ? 0 : a.research) + (hasBet ? a.bet : 0))
  const signal = demandSignal(game)
  const est = resonanceEstimate(game)

  const codebase = (
    <Panel title="State of the codebase">
      <BarRow name="Features" value={game.features} />
      <BarRow name="Quality" value={game.quality} color="var(--color-good)" />
      <BarRow name="Bugs" value={game.bugs} color="var(--color-bad)" />
      {game.sector === 'fintech' && (
        <div className="mt-3 text-xs leading-relaxed text-warn">Fintech: a bug costs you roughly double what it costs anyone else.</div>
      )}
    </Panel>
  )

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Product</h1>
      <div className="mb-4 text-[13px] text-mut">
        {engineers} engineer{engineers === 1 ? '' : 's'}
        {game.founderKind === 'technical' ? ' + you' : ''} · building things is easy — building the <i>right</i> thing is the game
      </div>

      {/* Career used to get a full-height panel here whose entire message was "the thing you want
          is on Discovery". That is a link. */}
      {career && (
        <div className="mb-3.5 text-[13px] leading-relaxed text-mut">
          Quality is the only lever on this screen that reaches PMF, and it reaches it weeks later, never the week you move it.{' '}
          <button className="font-semibold text-accent underline underline-offset-2 hover:brightness-125" onClick={() => setScreen('discovery')}>
            Segments, experiments and repositioning live on Discovery →
          </button>
        </div>
      )}

      {/* The allocation sliders are the only decision on this screen, so they are no longer the
          last thing on it — everything below is the readout you check them against. */}
      <Panel title="Team focus (share of effort)">
        {(
          [
            'features',
            'quality',
            'bugs',
            ...(career ? [] : (['research'] as const)),
            ...(hasBet ? (['bet'] as const) : []),
          ] as const
        ).map((key) => {
          // THE THUMB AND THE LABEL MUST BE THE SAME NUMBER. They were not: the label showed the
          // normalized share (a[key]/sum) while the thumb was bound to the raw weight (a[key]) —
          // so dragging one slider changed the sum, every OTHER row's percentage recomputed, and
          // every other thumb sat still, visibly contradicting its own label (owner bug report,
          // with screenshot). Both now render the share. Dragging to share p solves for the raw
          // weight that produces p with the other weights unchanged — raw = rest·p/(100−p) — so
          // one action still writes one key and the replay journal keeps its shape. The share is
          // capped at 90% while other buckets hold anything, which bounds the solved weight at
          // 9× the rest; the way to give one bucket everything is to zero the others, which
          // drags cleanly to 0%.
          const rest = sum - a[key]
          const share = Math.round((a[key] / sum) * 100)
          return (
          <div className="mb-4 last:mb-0" key={key}>
            <div className="mb-1 flex justify-between text-[13px]">
              <span className={key === 'bet' ? 'font-semibold text-accent2' : ''}>
                {key === 'features'
                  ? 'New features'
                  : key === 'quality'
                    ? 'Polish & quality'
                    : key === 'bugs'
                      ? 'Bug fixing'
                      : key === 'research'
                        ? 'User research'
                        : 'New bet (tiger team)'}
              </span>
              <span className="font-bold tnum">{share}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={rest > 0 ? 90 : 100}
              value={share}
              style={{ ['--fill' as string]: `${share}%` }}
              onChange={(e) => {
                const p = Number(e.target.value)
                const raw = rest <= 0 ? p : Math.round((rest * Math.min(90, p)) / (100 - Math.min(90, p)))
                setAllocation(key, raw)
              }}
            />
          </div>
          )
        })}
        <div className="mt-2 text-xs leading-relaxed text-mut">
          Features attract users. Quality retains them. Bugs strangle both.
          {career ? '' : ' Research finds out what the market actually wants — without it, you are building in the dark.'}
        </div>
      </Panel>

      {career ? (
        <div className="mt-3.5">{codebase}</div>
      ) : (
        <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
          <Panel title={`Product-market fit — ${pmfLabel(game.pmf)}`}>
            <Bar value={game.pmf} color={game.pmf < 40 ? 'var(--color-warn)' : 'var(--color-good)'} />

            <div className="mt-4 mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-mut">
              Idea quality — your team's estimate of true market demand
            </div>
            {!est ? (
              <div>
                <Bar value={Math.min(100, (game.researchSignal / 14) * 100)} color="var(--color-accent2)" />
                <div className="mt-1.5 text-xs text-mut">
                  Not enough user research yet to read the market ({Math.round(Math.min(100, (game.researchSignal / 14) * 100))}% there).
                  Raise the research slider above to find out faster.
                </div>
              </div>
            ) : (
              <DemandGauge lo={est.lo} hi={est.hi} {...RESONANCE_RANGE} />
            )}
            <div className={`mt-3 text-[13px] font-semibold ${SIGNAL_COPY[signal].cls}`}>{SIGNAL_COPY[signal].text}</div>
            <div className="mt-2 text-xs leading-relaxed text-mut">
              The white band is where your idea's true demand sits, as far as research can tell — more research narrows it. PMF gates
              everything: retention, word of mouth, and how many users actually pay.
            </div>
            <PivotButton onPivot={doPivot} bonusPct={Math.round(pivotBonus(game) * 100)} gate={canPivot(game)} />
          </Panel>
          {codebase}
        </div>
      )}

      <Ventures />
    </div>
  )
}
