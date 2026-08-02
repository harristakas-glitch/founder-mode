import { Panel, Sparkline, StatCard } from '../components'
import { money } from '../format'
import { runwayWeeks, weeklyBurn, weeklyInfra, weeklyOffice, weeklyPayroll } from '../game/engine'
import { useStore } from '../store'

export function Finance() {
  const game = useStore((s) => s.game)!
  const runway = runwayWeeks(game)
  const rows = [...game.history].slice(-12).reverse()

  return (
    <div>
      <div className="screen-title">Finance</div>
      <div className="screen-sub">Cash is oxygen. Everything else is commentary.</div>

      <div className="grid cols-4">
        <StatCard label="Cash" value={money(game.cash)} />
        <StatCard label="Weekly burn" value={money(weeklyBurn(game))} delta={`payroll ${money(weeklyPayroll(game))} · infra ${money(weeklyInfra(game))} · office ${money(weeklyOffice(game))} · mktg ${money(game.marketingSpend)}`} />
        <StatCard label="Weekly revenue" value={money(game.lastRevenue)} />
        <StatCard
          label="Runway"
          value={runway === Infinity ? 'Profitable' : `${Math.max(0, Math.floor(runway))} weeks`}
          tone={runway !== Infinity && runway < 12 ? 'down' : 'up'}
        />
      </div>

      <div className="mt">
        <Panel title="Cash over time">
          <Sparkline data={game.history.map((h) => h.cash)} color="var(--good)" />
        </Panel>
      </div>

      <div className="mt">
        <Panel title="Last 12 weeks">
          {rows.length === 0 ? (
            <div className="muted">No history yet — advance the week.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th className="r">Revenue</th>
                  <th className="r">Payroll</th>
                  <th className="r">Infra</th>
                  <th className="r">Marketing</th>
                  <th className="r">Office</th>
                  <th className="r">Net</th>
                  <th className="r">Cash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const net = h.revenue - h.expenses
                  return (
                    <tr key={h.week}>
                      <td>{h.week}</td>
                      <td className="r">{money(h.revenue)}</td>
                      <td className="r">{money(h.payroll)}</td>
                      <td className="r">{money(h.infra ?? 0)}</td>
                      <td className="r">{money(h.marketing)}</td>
                      <td className="r">{money(h.office)}</td>
                      <td className={`r ${net >= 0 ? 'good-text' : 'bad-text'}`}>{money(net)}</td>
                      <td className="r">{money(h.cash)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  )
}
