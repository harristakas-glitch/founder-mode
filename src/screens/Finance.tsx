import { LineChart, Panel, StatCard, Td, Th } from '../components'
import { money } from '../format'
import { committedCosts, recruiterFee, runwayWeeks, weeklyBurn, weeklyInfra, weeklyOffice, weeklyPayroll } from '../game/engine'
import { useStore } from '../store'

function UpcomingPayments() {
  const game = useStore((s) => s.game)!
  const { due, potential, recommended } = committedCosts(game)
  if (due === 0 && potential === 0 && game.cash > recommended) return null
  return (
    <div className="mt-3.5">
      <Panel title="Upcoming one-off payments — no hidden bills">
        {game.pendingHires.map((p) => (
          <div key={p.candidate.id} className="flex justify-between border-b border-line/40 py-1.5 text-[13.5px] last:border-b-0">
            <span>
              Recruiter fee — <b>{p.candidate.name}</b>{' '}
              <span className="text-mut">
                starts in {p.weeksUntilStart} wk{p.weeksUntilStart === 1 ? '' : 's'}
              </span>
            </span>
            <b className="tnum">{money(recruiterFee(p.candidate))}</b>
          </div>
        ))}
        {game.offersOut.map((c) => (
          <div key={c.id} className="flex justify-between border-b border-line/40 py-1.5 text-[13.5px] last:border-b-0">
            <span>
              Recruiter fee — <b>{c.name}</b> <span className="text-mut">only if they accept your offer</span>
            </span>
            <b className="tnum text-mut">{money(recruiterFee(c))}</b>
          </div>
        ))}
        {due === 0 && potential === 0 && <div className="py-1 text-[13.5px] text-mut">Nothing committed right now.</div>}
        <div className="mt-2.5 flex justify-between rounded-lg bg-surface2/60 px-3 py-2 text-[13.5px]">
          <span>
            Recommended cash buffer <span className="text-mut">— committed fees + a worst-case event (grows with your user count)</span>
          </span>
          <b className={`tnum ${game.cash < recommended ? 'text-bad' : 'text-good'}`}>{money(recommended)}</b>
        </div>
        {game.cash < recommended && (
          <div className="mt-1.5 text-xs text-bad">
            Your {money(game.cash)} is below the buffer — one bad week could zero the account.
          </div>
        )}
      </Panel>
    </div>
  )
}

export function Finance() {
  const game = useStore((s) => s.game)!
  const runway = runwayWeeks(game)
  const rows = [...game.history].slice(-12).reverse()
  const startWeek = game.history[0]?.week ?? 1

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Finance</div>
      <div className="mb-4 text-[13px] text-mut">Cash is oxygen. Everything else is commentary.</div>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <StatCard label="Cash" numeric={game.cash} format={money} />
        <StatCard
          label="Weekly burn"
          numeric={weeklyBurn(game)}
          format={money}
          delta={`payroll ${money(weeklyPayroll(game))} · infra ${money(weeklyInfra(game))} · office ${money(weeklyOffice(game))} · mktg ${money(game.marketingSpend)}`}
        />
        <StatCard label="Weekly revenue" numeric={game.lastRevenue} format={money} />
        <StatCard
          label="Runway"
          value={runway === Infinity ? 'Profitable' : `${Math.max(0, Math.floor(runway))} weeks`}
          tone={runway !== Infinity && runway < 12 ? 'down' : 'up'}
        />
      </div>

      <UpcomingPayments />

      <div className="mt-3.5">
        <Panel title="Cash over time">
          <LineChart data={game.history.map((h) => h.cash)} color="var(--color-good)" formatY={money} startWeek={startWeek} />
        </Panel>
      </div>

      <div className="mt-3.5">
        <Panel title="Last 12 weeks">
          {rows.length === 0 ? (
            <div className="text-mut">No history yet — advance the week.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <Th>Week</Th>
                    <Th right>Revenue</Th>
                    <Th right>Payroll</Th>
                    <Th right>Infra</Th>
                    <Th right>Marketing</Th>
                    <Th right>Office</Th>
                    <Th right>Net</Th>
                    <Th right>Cash</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const net = h.revenue - h.expenses
                    return (
                      <tr key={h.week}>
                        <Td>{h.week}</Td>
                        <Td right>{money(h.revenue)}</Td>
                        <Td right>{money(h.payroll)}</Td>
                        <Td right>{money(h.infra ?? 0)}</Td>
                        <Td right>{money(h.marketing)}</Td>
                        <Td right>{money(h.office)}</Td>
                        <Td right className={net >= 0 ? 'text-good' : 'text-bad'}>
                          {money(net)}
                        </Td>
                        <Td right>{money(h.cash)}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
