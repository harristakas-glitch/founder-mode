import { BarRow, LineChart, Panel, StatCard } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import { estimatedCac, growthRate, marketingMax, paidUsersPerWeek, productScore } from '../game/engine'
import { useStore } from '../store'

export function Growth() {
  const game = useStore((s) => s.game)!
  const setMarketing = useStore((s) => s.setMarketing)
  const sector = sectorById(game.sector)
  const marketers = game.employees.filter((e) => e.role === 'marketer').length
  const pScore = productScore(game)
  const churnRate = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))
  const startWeek = game.history[0]?.week ?? 1

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Growth</div>
      <div className="mb-4 text-[13px] text-mut">
        {sector.name} · {marketers} marketer{marketers === 1 ? '' : 's'}
        {game.founderKind === 'business' ? ' + you' : ''} on the megaphone
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <StatCard label="Users" numeric={game.users} format={num} delta={`${pct(growthRate(game), 1)}/wk avg growth`} />
        <StatCard label="Hype" numeric={game.hype} format={(n) => `${Math.round(n)}/100`} delta="Decays ~8% weekly — keep feeding it" />
        <StatCard
          label="Est. weekly churn"
          value={pct(churnRate, 1)}
          delta={game.pmf < 50 ? 'Without PMF, users leak out as fast as they arrive' : 'Users are sticking'}
          tone={game.pmf < 50 ? 'down' : 'up'}
        />
      </div>

      <div className="mt-3.5">
        <Panel title={`Marketing budget: ${money(game.marketingSpend)}/week (cap ${money(marketingMax(game))} at ${game.stage})`}>
          <input
            type="range"
            min={0}
            max={marketingMax(game)}
            step={marketingMax(game) > 100_000 ? 5000 : 500}
            value={Math.min(game.marketingSpend, marketingMax(game))}
            style={{ ['--fill' as string]: `${(game.marketingSpend / marketingMax(game)) * 100}%` }}
            onChange={(e) => setMarketing(Number(e.target.value))}
          />
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <span>
              <span className="text-mut">Est. cost per paid user (CAC):</span> <b className="tnum">{money(estimatedCac(game))}</b>
            </span>
            <span>
              <span className="text-mut">≈ paid users this budget buys:</span>{' '}
              <b className="tnum">{num(Math.round(paidUsersPerWeek(game, game.marketingSpend)))}/wk</b>
              <span className="text-mut"> (channels fatigue past ~$150k/wk)</span>
            </span>
          </div>
          <div className="mt-3 text-xs leading-relaxed text-mut">
            Spend does two things: builds hype (diminishing returns, amplified by marketers) and buys users directly at the CAC above —
            which climbs as the market saturates and falls with PMF. The budget cap grows with your funding stage. Word of mouth
            ({pct(sector.viral, 1)}/wk max for {sector.name}) only kicks in once PMF is real.
          </div>
        </Panel>
      </div>

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
        <Panel title="Users over time">
          <LineChart data={game.history.map((h) => h.users)} formatY={num} startWeek={startWeek} />
        </Panel>
        <Panel title="What drives acquisition">
          <BarRow name="Hype" value={game.hype} />
          <BarRow name="Product" value={pScore} color="var(--color-good)" />
          <BarRow name="PMF" value={game.pmf} color="var(--color-accent2)" />
          <BarRow name="Reputation" value={game.reputation} color="var(--color-warn)" />
        </Panel>
      </div>
    </div>
  )
}
