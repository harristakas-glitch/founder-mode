import { BarRow, LineChart, Panel, StatCard } from '../components'
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
        <Panel title={`Marketing budget: ${money(game.marketingSpend)}/week`}>
          <input
            type="range"
            min={0}
            max={30000}
            step={500}
            value={game.marketingSpend}
            style={{ ['--fill' as string]: `${(game.marketingSpend / 30000) * 100}%` }}
            onChange={(e) => setMarketing(Number(e.target.value))}
          />
          <div className="mt-3 text-xs leading-relaxed text-mut">
            Spend builds hype with diminishing returns; marketers multiply its effect. Hype converts to new users — but without
            product-market fit they will not stick, and paying to acquire users who churn is how startups burn fortunes. Word of mouth
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
