import { useState } from 'react'
import { Bar, BarRow, Btn, DemandGauge, Panel, StatCard } from '../components'
import { RESONANCE_RANGE, demandSignal, pivotBonus, pmfLabel, productScore, resonanceEstimate } from '../game/engine'
import { useStore } from '../store'

const SIGNAL_COPY: Record<string, { text: string; cls: string }> = {
  unknown: { text: 'Do more user research to read the market.', cls: 'text-mut' },
  weak: { text: 'Research says demand is WEAK. This idea may never take off — consider pivoting.', cls: 'text-bad' },
  mixed: { text: 'Research says demand is MIXED. It can work, but growth will be a grind.', cls: 'text-warn' },
  strong: { text: 'Research says demand is STRONG. Pour it on — this market wants you.', cls: 'text-good' },
}

function PivotButton({ onPivot, bonusPct }: { onPivot: () => void; bonusPct: number }) {
  const [arming, setArming] = useState(false)
  if (!arming) {
    return (
      <Btn variant="danger" className="mt-3" onClick={() => setArming(true)}>
        Pivot the company ↻
      </Btn>
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
          <span className="text-bad">Lose</span>: 40% of hype, 60% of PMF, some morale — and the demand signal resets to unknown
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
          Yes — pivot now
        </Btn>
        <Btn onClick={() => setArming(false)}>Cancel</Btn>
      </div>
    </div>
  )
}

export function Product() {
  const game = useStore((s) => s.game)!
  const setAllocation = useStore((s) => s.setAllocation)
  const doPivot = useStore((s) => s.doPivot)
  const engineers = game.employees.filter((e) => e.role === 'engineer').length
  const a = game.allocation
  const sum = Math.max(1, a.features + a.quality + a.bugs + a.research)
  const signal = demandSignal(game)
  const est = resonanceEstimate(game)

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Product</div>
      <div className="mb-4 text-[13px] text-mut">
        {engineers} engineer{engineers === 1 ? '' : 's'}
        {game.founderKind === 'technical' ? ' + you' : ''} · building things is easy — building the <i>right</i> thing is the game
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel title={`Product-market fit — ${pmfLabel(game.pmf)}`}>
          <Bar value={game.pmf} color={game.pmf < 40 ? 'var(--color-warn)' : 'var(--color-good)'} />

          <div className="mt-4 mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-mut">
            Idea quality — your team's estimate of true market demand
          </div>
          {!est ? (
            <div>
              <Bar value={Math.min(100, (game.researchSignal / 14) * 100)} color="var(--color-accent2)" />
              <div className="mt-1.5 text-xs text-mut">
                Not enough user research yet to read the market ({Math.round(Math.min(100, (game.researchSignal / 14) * 100))}% there).
                Raise the research slider below to find out faster.
              </div>
            </div>
          ) : (
            <DemandGauge lo={est.lo} hi={est.hi} {...RESONANCE_RANGE} />
          )}
          <div className={`mt-3 text-[13.5px] font-semibold ${SIGNAL_COPY[signal].cls}`}>{SIGNAL_COPY[signal].text}</div>
          <div className="mt-2 text-xs leading-relaxed text-mut">
            The white band is where your idea's true demand sits, as far as research can tell — more research narrows it. PMF gates
            everything: retention, word of mouth, and how many users actually pay.
          </div>
          <div className="mt-3 text-xs leading-relaxed text-mut">
            Thinking of pivoting? Research done <i>before</i> a pivot carries over — it tilts the next idea's demand roll in your favor
            (currently <b className="text-good">+{Math.round(pivotBonus(game) * 100)}%</b>).
          </div>
          <PivotButton onPivot={doPivot} bonusPct={Math.round(pivotBonus(game) * 100)} />
          {game.pivots > 0 && (
            <span className="ml-2.5 text-xs text-mut">
              {game.pivots} pivot{game.pivots === 1 ? '' : 's'} so far
            </span>
          )}
        </Panel>

        <div className="space-y-3.5">
          <StatCard
            label="Product score (execution quality)"
            numeric={productScore(game)}
            format={(n) => `${Math.round(n)}/100`}
            delta={game.sector === 'fintech' ? 'Fintech: bugs hurt double here' : undefined}
          />
          <Panel title="State of the codebase">
            <BarRow name="Features" value={game.features} />
            <BarRow name="Quality" value={game.quality} color="var(--color-good)" />
            <BarRow name="Bugs" value={game.bugs} color="var(--color-bad)" />
          </Panel>
        </div>
      </div>

      <div className="mt-3.5">
        <Panel title="Team focus (share of effort)">
          {(['features', 'quality', 'bugs', 'research'] as const).map((key) => (
            <div className="mb-4 last:mb-0" key={key}>
              <div className="mb-1 flex justify-between text-[13.5px]">
                <span>
                  {key === 'features' ? 'New features' : key === 'quality' ? 'Polish & quality' : key === 'bugs' ? 'Bug fixing' : 'User research'}
                </span>
                <span className="font-bold tnum">{Math.round((a[key] / sum) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={a[key]}
                style={{ ['--fill' as string]: `${a[key]}%` }}
                onChange={(e) => setAllocation(key, Number(e.target.value))}
              />
            </div>
          ))}
          <div className="mt-2 text-xs leading-relaxed text-mut">
            Features attract users. Quality retains them. Bugs strangle both. Research finds out what the market actually wants —
            without it, you are building in the dark.
          </div>
        </Panel>
      </div>
    </div>
  )
}
