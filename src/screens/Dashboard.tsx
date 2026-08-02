import { BenchRow, Panel, Sparkline, StatCard } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import {
  MILESTONES,
  avgMorale,
  growthRate,
  pmfLabel,
  productScore,
  runwayWeeks,
  valuation,
  weeklyBurn,
} from '../game/engine'
import { useStore } from '../store'

function Benchmarks() {
  const game = useStore((s) => s.game)!
  const sector = sectorById(game.sector)
  const growth = growthRate(game)
  const growthTarget = game.board ? game.board.targetGrowth : 0.04
  const churn = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))
  const churnBench = sector.churn // market-average churn for the sector
  const pmfPace = Math.min(85, game.week * 1.6) // roughly "fit by week ~40"
  const runway = runwayWeeks(game)
  const bestRival = [...game.rivals.filter((r) => r.alive)].sort((a, b) => b.product - a.product)[0]
  const pScore = productScore(game)

  const tone = (ok: boolean, mid: boolean): 'good' | 'warn' | 'bad' => (ok ? 'good' : mid ? 'warn' : 'bad')

  return (
    <Panel title="How you compare — benchmarks">
      <BenchRow metric="User growth" tone={tone(growth >= growthTarget, growth >= growthTarget * 0.6)}>
        <b>{pct(growth, 1)}/wk</b> <span className="muted">vs {pct(growthTarget, 1)} {game.board ? 'board target' : 'healthy pre-seed pace'}</span>
      </BenchRow>
      <BenchRow metric="Churn" tone={tone(churn <= churnBench, churn <= churnBench * 1.5)}>
        <b>{pct(churn, 1)}/wk</b> <span className="muted">vs {pct(churnBench, 1)} market average for {sector.name} — driven by PMF, quality, bugs</span>
      </BenchRow>
      <BenchRow metric="PMF pace" tone={tone(game.pmf >= pmfPace, game.pmf >= pmfPace * 0.6)}>
        <b>{Math.round(game.pmf)}</b> <span className="muted">vs ~{Math.round(pmfPace)} expected by week {game.week} — winners find fit by ~week 40</span>
      </BenchRow>
      <BenchRow metric="Runway" tone={tone(runway === Infinity || runway >= 30, runway >= 15)}>
        <b>{runway === Infinity ? 'profitable' : `${Math.floor(runway)} wk`}</b> <span className="muted">vs 30+ wk healthy — under 10 and candidates refuse offers</span>
      </BenchRow>
      {bestRival && (
        <BenchRow metric="Product vs rivals" tone={tone(pScore >= bestRival.product, pScore >= bestRival.product - 15)}>
          <b>{Math.round(pScore)}</b> <span className="muted">vs {Math.round(bestRival.product)} for {bestRival.name} (best rival) — fall 15+ behind and they steal your users</span>
        </BenchRow>
      )}
    </Panel>
  )
}

export function Dashboard() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const val = valuation(game)
  const runway = runwayWeeks(game)
  const growth = growthRate(game)
  const recent = game.inbox.slice(0, 4)

  return (
    <div>
      <div className="screen-title">Dashboard</div>
      <div className="screen-sub">
        Week {game.week} · {game.stage} · You own {pct(game.founderEquity, 1)} of the company
      </div>

      <div className="grid cols-4">
        <StatCard label="Cash" value={money(game.cash)} delta={`burn ${money(weeklyBurn(game))}/wk`} tone={game.lastRevenue >= weeklyBurn(game) ? 'up' : undefined} />
        <StatCard
          label="Runway"
          value={runway === Infinity ? 'Profitable 🎉' : `${Math.max(0, Math.floor(runway))} weeks`}
          tone={runway !== Infinity && runway < 12 ? 'down' : undefined}
          delta={runway !== Infinity && runway < 12 ? 'Danger zone — raise or cut costs' : undefined}
        />
        <StatCard label="Users" value={num(game.users)} delta={`${growth >= 0 ? '+' : ''}${pct(growth, 1)} /wk avg`} tone={growth >= 0 ? 'up' : 'down'} />
        <StatCard label="Valuation" value={money(val)} delta={`Goal: $1B (${pct(val / 1e9, 1)} there)`} />
      </div>

      <div className="grid cols-2 mt">
        <Panel title="Users over time">
          <Sparkline data={game.history.map((h) => h.users)} />
        </Panel>
        <Panel title="Cash over time">
          <Sparkline data={game.history.map((h) => h.cash)} color={game.cash > 0 ? 'var(--good)' : 'var(--bad)'} />
        </Panel>
      </div>

      <div className="grid cols-3 mt">
        <StatCard label="Product-market fit" value={`${Math.round(game.pmf)}/100`} delta={pmfLabel(game.pmf)} tone={game.pmf >= 60 ? 'up' : game.pmf < 30 ? 'down' : undefined} />
        <StatCard label="Hype" value={`${Math.round(game.hype)}/100`} delta={game.hype < 15 ? 'Nobody is talking about you' : undefined} />
        <StatCard label="Team morale" value={`${Math.round(avgMorale(game))}/100`} tone={avgMorale(game) < 45 ? 'down' : undefined} delta={avgMorale(game) < 45 ? 'People are looking at the exits' : undefined} />
      </div>

      <div className="mt">
        <Benchmarks />
      </div>

      <div className="grid cols-2 mt">
        <Panel title={`Milestones (${game.milestones.length}/${MILESTONES.length})`}>
          {MILESTONES.filter((m) => !game.milestones.includes(m.id))
            .slice(0, 4)
            .map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: '0.88rem' }}>
                <span className="muted">◻</span>
                <span>
                  <b>{m.title}</b> <span className="muted">— {m.goal}</span>
                </span>
              </div>
            ))}
          {game.milestones.length === MILESTONES.length && (
            <div className="good-text">All milestones achieved. There is only the unicorn left.</div>
          )}
          {game.milestones.length > 0 && (
            <div className="muted mt" style={{ fontSize: '0.78rem' }}>
              Done: {game.milestones.map((id) => MILESTONES.find((m) => m.id === id)?.title).join(' · ')}
            </div>
          )}
        </Panel>
        <Panel title="Latest news">
          {recent.length === 0 && <div className="muted">Nothing yet. Advance the week to get things moving.</div>}
          {recent.map((m) => (
            <div key={m.id} className={`msg ${m.kind} ${m.resolved ? 'resolved' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setScreen('inbox')}>
              <div className="when">Week {m.week}</div>
              <div className="title">{m.title}</div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  )
}
