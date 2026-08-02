import { BenchRow, LineChart, Panel, StatCard } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import {
  MILESTONES,
  avgMorale,
  boardEffectiveTarget,
  committedCosts,
  growthRate,
  pmfLabel,
  productScore,
  runwayWeeks,
  totalUsers,
  valuation,
  weeklyBurn,
} from '../game/engine'
import { useStore } from '../store'

function Benchmarks() {
  const game = useStore((s) => s.game)!
  const sector = sectorById(game.sector)
  const growth = growthRate(game)
  const growthTarget = game.board ? boardEffectiveTarget(game) : 0.04
  const churn = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))
  const churnBench = sector.churn
  const pmfPace = Math.min(85, game.week * 1.6)
  const runway = runwayWeeks(game)
  const bestRival = [...game.rivals.filter((r) => r.alive)].sort((a, b) => b.product - a.product)[0]
  const pScore = productScore(game)
  const tone = (ok: boolean, mid: boolean): 'good' | 'warn' | 'bad' => (ok ? 'good' : mid ? 'warn' : 'bad')

  return (
    <Panel title="How you compare — benchmarks">
      <BenchRow metric="User growth" tone={tone(growth >= growthTarget, growth >= growthTarget * 0.6)}>
        <b className="tnum">{pct(growth, 1)}/wk</b>{' '}
        <span className="text-mut">vs {pct(growthTarget, 1)} {game.board ? 'board target' : 'healthy pre-seed pace'}</span>
      </BenchRow>
      <BenchRow metric="Churn" tone={tone(churn <= churnBench, churn <= churnBench * 1.5)}>
        <b className="tnum">{pct(churn, 1)}/wk</b>{' '}
        <span className="text-mut">vs {pct(churnBench, 1)} market average — driven by PMF, quality, bugs</span>
      </BenchRow>
      <BenchRow metric="PMF pace" tone={tone(game.pmf >= pmfPace, game.pmf >= pmfPace * 0.6)}>
        <b className="tnum">{Math.round(game.pmf)}</b>{' '}
        <span className="text-mut">vs ~{Math.round(pmfPace)} expected by week {game.week} — winners find fit by ~week 40</span>
      </BenchRow>
      <BenchRow metric="Runway" tone={tone(runway === Infinity || runway >= 30, runway >= 15)}>
        <b className="tnum">{runway === Infinity ? 'profitable' : `${Math.floor(runway)} wk`}</b>{' '}
        <span className="text-mut">vs 30+ wk healthy — under 10 and candidates refuse offers</span>
      </BenchRow>
      <BenchRow
        metric="Cash buffer"
        tone={tone(game.cash >= committedCosts(game).recommended, game.cash >= committedCosts(game).recommended * 0.5)}
      >
        <b className="tnum">{money(game.cash)}</b>{' '}
        <span className="text-mut">
          vs {money(committedCosts(game).recommended)} recommended — covers committed fees + a worst-case bill (see Finance)
        </span>
      </BenchRow>
      {bestRival && (
        <BenchRow metric="Product vs rivals" tone={tone(pScore >= bestRival.product, pScore >= bestRival.product - 15)}>
          <b className="tnum">{Math.round(pScore)}</b>{' '}
          <span className="text-mut">vs {Math.round(bestRival.product)} for {bestRival.name} — fall 15+ behind and they steal users</span>
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
  const startWeek = game.history[0]?.week ?? 1

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Dashboard</div>
      <div className="mb-4 text-[13px] text-mut">
        Week {game.week} · {game.stage} · You own {pct(game.founderEquity, 1)} of the company
      </div>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <StatCard
          label="Cash"
          numeric={game.cash}
          format={money}
          delta={
            game.cash < 40_000 && game.week > 6
              ? 'Buffer is thin — one bad event (cloud bill, recruiter fee) could end you'
              : `burn ${money(weeklyBurn(game))}/wk`
          }
          tone={game.cash < 40_000 && game.week > 6 ? 'down' : game.lastRevenue >= weeklyBurn(game) ? 'up' : undefined}
        />
        <StatCard
          label="Runway"
          value={runway === Infinity ? 'Profitable 🎉' : `${Math.max(0, Math.floor(runway))} weeks`}
          tone={runway !== Infinity && runway < 12 ? 'down' : undefined}
          delta={runway !== Infinity && runway < 12 ? 'Danger zone — raise or cut costs' : undefined}
        />
        <StatCard
          label={game.ventures.some((v) => v.launched) ? 'Users (all product lines)' : 'Users'}
          numeric={totalUsers(game)}
          format={num}
          delta={`${growth >= 0 ? '+' : ''}${pct(growth, 1)} /wk avg`}
          tone={growth >= 0 ? 'up' : 'down'}
        />
        <StatCard label="Valuation" numeric={val} format={money} delta={`Goal: $1B (${pct(val / 1e9, 1)} there)`} />
      </div>

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
        <Panel title="Users over time">
          <LineChart data={game.history.map((h) => h.users)} formatY={num} startWeek={startWeek} />
        </Panel>
        <Panel title="Cash over time">
          <LineChart data={game.history.map((h) => h.cash)} color={game.cash > 0 ? 'var(--color-good)' : 'var(--color-bad)'} formatY={money} startWeek={startWeek} />
        </Panel>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <StatCard label="Product-market fit" numeric={game.pmf} format={(n) => `${Math.round(n)}/100`} delta={pmfLabel(game.pmf)} tone={game.pmf >= 60 ? 'up' : game.pmf < 30 ? 'down' : undefined} />
        <StatCard label="Hype" numeric={game.hype} format={(n) => `${Math.round(n)}/100`} delta={game.hype < 15 ? 'Nobody is talking about you' : undefined} />
        <StatCard label="Team morale" numeric={avgMorale(game)} format={(n) => `${Math.round(n)}/100`} tone={avgMorale(game) < 45 ? 'down' : undefined} delta={avgMorale(game) < 45 ? 'People are looking at the exits' : undefined} />
      </div>

      <div className="mt-3.5">
        <Benchmarks />
      </div>

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
        <Panel title={`Milestones (${game.milestones.length}/${MILESTONES.length})`}>
          {MILESTONES.filter((m) => !game.milestones.includes(m.id))
            .slice(0, 4)
            .map((m) => (
              <div key={m.id} className="flex gap-2 py-1 text-[13.5px]">
                <span className="text-mut">◻</span>
                <span>
                  <b>{m.title}</b> <span className="text-mut">— {m.goal}</span>
                </span>
              </div>
            ))}
          {game.milestones.length === MILESTONES.length && <div className="text-good">All milestones achieved. There is only the unicorn left.</div>}
          {game.milestones.length > 0 && (
            <div className="mt-2 text-xs text-mut">
              Done: {game.milestones.map((id) => MILESTONES.find((m) => m.id === id)?.title).join(' · ')}
            </div>
          )}
        </Panel>
        <Panel title="Latest news">
          {recent.length === 0 && <div className="text-mut">Nothing yet. Advance the week to get things moving.</div>}
          {recent.map((m) => (
            <button
              key={m.id}
              className="block w-full border-b border-line/40 py-2 text-left last:border-b-0 hover:bg-surface2/50"
              onClick={() => setScreen('inbox')}
            >
              <div className="text-[10.5px] text-mut">Week {m.week}</div>
              <div className="text-[13.5px] font-semibold">{m.title}</div>
            </button>
          ))}
        </Panel>
      </div>
    </div>
  )
}
