import { BarRow, Panel, Sparkline, StatCard } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import { growthRate, productScore } from '../game/engine'
import { useStore } from '../store'

export function Growth() {
  const game = useStore((s) => s.game)!
  const setMarketing = useStore((s) => s.setMarketing)
  const sector = sectorById(game.sector)
  const marketers = game.employees.filter((e) => e.role === 'marketer').length
  const pScore = productScore(game)
  const churnRate = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))

  return (
    <div>
      <div className="screen-title">Growth</div>
      <div className="screen-sub">
        {sector.name} · {marketers} marketer{marketers === 1 ? '' : 's'}
        {game.founderKind === 'business' ? ' + you' : ''} on the megaphone
      </div>

      <div className="grid cols-3">
        <StatCard label="Users" value={num(game.users)} delta={`${pct(growthRate(game), 1)}/wk avg growth`} />
        <StatCard label="Hype" value={`${Math.round(game.hype)}/100`} delta="Decays ~8% weekly — keep feeding it" />
        <StatCard label="Est. weekly churn" value={pct(churnRate, 1)} delta={game.pmf < 50 ? 'Without PMF, users leak out as fast as they arrive' : 'Users are sticking'} tone={game.pmf < 50 ? 'down' : 'up'} />
      </div>

      <div className="mt">
        <Panel title={`Marketing budget: ${money(game.marketingSpend)}/week`}>
          <input
            type="range"
            min={0}
            max={30000}
            step={500}
            value={game.marketingSpend}
            onChange={(e) => setMarketing(Number(e.target.value))}
          />
          <div className="muted mt" style={{ fontSize: '0.82rem' }}>
            Spend builds hype with diminishing returns; marketers multiply its effect. Hype converts to new users —
            but without product-market fit they will not stick, and paying to acquire users who churn is how startups
            burn fortunes. Word of mouth ({pct(sector.viral, 1)}/wk max for {sector.name}) only kicks in once PMF is real.
          </div>
        </Panel>
      </div>

      <div className="grid cols-2 mt">
        <Panel title="Users over time">
          <Sparkline data={game.history.map((h) => h.users)} />
        </Panel>
        <Panel title="What drives acquisition">
          <BarRow name="Hype" value={game.hype} />
          <BarRow name="Product" value={pScore} color="var(--good)" />
          <BarRow name="Reputation" value={game.reputation} color="var(--accent-2)" />
        </Panel>
      </div>
    </div>
  )
}
