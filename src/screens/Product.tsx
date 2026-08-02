import { useState } from 'react'
import { Bar, BarRow, DemandGauge, Panel, StatCard } from '../components'
import { RESONANCE_RANGE, demandSignal, pivotBonus, pmfLabel, productScore, resonanceEstimate } from '../game/engine'
import { useStore } from '../store'

const SIGNAL_COPY: Record<string, { text: string; cls: string }> = {
  unknown: { text: 'Do more user research to read the market.', cls: 'muted' },
  weak: { text: 'Research says demand is WEAK. This idea may never take off — consider pivoting.', cls: 'bad-text' },
  mixed: { text: 'Research says demand is MIXED. It can work, but growth will be a grind.', cls: '' },
  strong: { text: 'Research says demand is STRONG. Pour it on — this market wants you.', cls: 'good-text' },
}

function PivotButton({ onPivot, bonusPct }: { onPivot: () => void; bonusPct: number }) {
  const [arming, setArming] = useState(false)
  if (!arming) {
    return (
      <button className="btn danger mt" onClick={() => setArming(true)}>
        Pivot the company ↻
      </button>
    )
  }
  return (
    <div className="mt" style={{ fontSize: '0.85rem' }}>
      <div style={{ marginBottom: 8 }}>
        <b>What a pivot does, exactly:</b>
        <ul style={{ margin: '6px 0 0 18px', lineHeight: 1.7 }}>
          <li>
            <span className="good-text">Keep</span>: 50% of features, 70% of quality, 70% of users, your whole team
          </li>
          <li>
            <span className="bad-text">Lose</span>: 40% of hype, 60% of PMF, some morale — and the demand signal resets
            to unknown
          </li>
          <li>
            <span className="good-text">Gain</span>: a fresh idea with a new demand roll, tilted{' '}
            <b>+{bonusPct}%</b> in your favor by lifetime research and pivot experience
          </li>
        </ul>
      </div>
      <button
        className="btn danger"
        style={{ marginRight: 8 }}
        onClick={() => {
          setArming(false)
          onPivot()
        }}
      >
        Yes — pivot now
      </button>
      <button className="btn" onClick={() => setArming(false)}>
        Cancel
      </button>
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

  return (
    <div>
      <div className="screen-title">Product</div>
      <div className="screen-sub">
        {engineers} engineer{engineers === 1 ? '' : 's'}
        {game.founderKind === 'technical' ? ' + you' : ''} · building things is easy — building the <i>right</i> thing is the game
      </div>

      <div className="grid cols-2">
        <Panel title={`Product-market fit — ${pmfLabel(game.pmf)}`}>
          <Bar value={game.pmf} color={game.pmf < 40 ? 'var(--warn)' : 'var(--good)'} />

          <div className="mt" style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 6 }}>
            IDEA QUALITY — your team's estimate of true market demand
          </div>
          {(() => {
            const est = resonanceEstimate(game)
            if (!est) {
              const progress = Math.min(100, (game.researchSignal / 14) * 100)
              return (
                <div>
                  <Bar value={progress} color="var(--accent-2)" />
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                    Not enough user research yet to read the market ({Math.round(progress)}% there). Raise the research
                    slider below to find out faster.
                  </div>
                </div>
              )
            }
            return <DemandGauge lo={est.lo} hi={est.hi} {...RESONANCE_RANGE} />
          })()}
          <div className={`mt ${SIGNAL_COPY[signal].cls}`} style={{ fontSize: '0.88rem' }}>
            {SIGNAL_COPY[signal].text}
          </div>
          <div className="muted mt" style={{ fontSize: '0.82rem' }}>
            The white band is where your idea's true demand sits, as far as research can tell — more research narrows
            it. PMF gates everything: retention, word of mouth, and how many users actually pay. It grows from research
            and shipping — multiplied by this idea quality.
          </div>
          <div className="muted mt" style={{ fontSize: '0.82rem' }}>
            Thinking of pivoting? Research done <i>before</i> a pivot carries over — every hour of user research tilts
            the next idea's demand roll in your favor (currently{' '}
            <b className="good-text">+{Math.round(pivotBonus(game) * 100)}%</b>).
          </div>
          <PivotButton onPivot={doPivot} bonusPct={Math.round(pivotBonus(game) * 100)} />
          {game.pivots > 0 && (
            <span className="muted" style={{ marginLeft: 10, fontSize: '0.8rem' }}>
              {game.pivots} pivot{game.pivots === 1 ? '' : 's'} so far
            </span>
          )}
        </Panel>

        <div>
          <StatCard
            label="Product score (execution quality)"
            value={`${Math.round(productScore(game))}/100`}
            delta={game.sector === 'fintech' ? 'Fintech: bugs hurt double here' : undefined}
          />
          <div className="mt">
            <Panel title="State of the codebase">
              <BarRow name="Features" value={game.features} />
              <BarRow name="Quality" value={game.quality} color="var(--good)" />
              <BarRow name="Bugs" value={game.bugs} color="var(--bad)" />
            </Panel>
          </div>
        </div>
      </div>

      <div className="mt">
        <Panel title="Team focus (share of effort)">
          {(['features', 'quality', 'bugs', 'research'] as const).map((key) => (
            <div className="slider-row" key={key}>
              <div className="head">
                <span>
                  {key === 'features'
                    ? 'New features'
                    : key === 'quality'
                      ? 'Polish & quality'
                      : key === 'bugs'
                        ? 'Bug fixing'
                        : 'User research'}
                </span>
                <span>{Math.round((a[key] / sum) * 100)}%</span>
              </div>
              <input type="range" min={0} max={100} value={a[key]} onChange={(e) => setAllocation(key, Number(e.target.value))} />
            </div>
          ))}
          <div className="muted" style={{ fontSize: '0.82rem' }}>
            Features attract users. Quality retains them. Bugs strangle both. Research finds out what the market
            actually wants — without it, you are building in the dark.
          </div>
        </Panel>
      </div>
    </div>
  )
}
