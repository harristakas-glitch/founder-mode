import { useState } from 'react'
import { Btn, LineChart, Panel, StatCard, Td, Th } from '../components'
import { money } from '../format'
import {
  committedCosts,
  debtApr,
  debtCapacity,
  recruiterFee,
  runwayWeeks,
  weeklyBurn,
  weeklyInfra,
  weeklyInterest,
  weeklyOffice,
  weeklyPayroll,
} from '../game/engine'
import { useStore } from '../store'

function MacroPanel() {
  const game = useStore((s) => s.game)!
  const m = game.macro
  const idxHistory = game.history.map((h) => h.macroIndex ?? 100)
  const startIdx = idxHistory[0] ?? 100
  const trend = m.index >= startIdx ? 'up' : 'down'
  return (
    <div className="mt-3.5">
      <Panel title="The economy — nobody asked your permission">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] text-mut">Market index</div>
            <b className={`tnum ${trend === 'up' ? 'text-good' : 'text-bad'}`}>{m.index.toFixed(0)}</b>
          </div>
          <div>
            <div className="text-[11px] text-mut">Central-bank rate</div>
            <b className="tnum">{m.rate.toFixed(1)}%</b>
          </div>
          <div>
            <div className="text-[11px] text-mut">Inflation</div>
            <b className={`tnum ${m.inflation > 5 ? 'text-bad' : ''}`}>{m.inflation.toFixed(1)}%</b>
          </div>
          <div className="min-w-[160px] flex-1">
            {idxHistory.length > 1 && <LineChart data={idxHistory} height={54} formatY={(n) => n.toFixed(0)} startWeek={game.history[0]?.week ?? 1} />}
          </div>
        </div>
        <div className="mt-2 text-xs leading-relaxed text-mut">
          The market's mood drives the funding climate, the bank rate prices your debt, and inflation quietly raises every salary on
          your payroll each week. Rate cuts and rallies open funding windows; shocks slam them shut.
        </div>
      </Panel>
    </div>
  )
}

function DebtPanel() {
  const game = useStore((s) => s.game)!
  const takeDebt = useStore((s) => s.takeDebt)
  const payDebt = useStore((s) => s.payDebt)
  const [amount, setAmount] = useState(100_000)
  const cap = debtCapacity(game)
  const available = cap - (game.debt?.principal ?? 0)
  const apr = debtApr(game)
  // the slider's ceiling moves with revenue and debt — keep the label honest about what the buttons will do
  const sliderMax = Math.max(10_000, Math.max(available, game.debt?.principal ?? 0))
  const shownAmount = Math.min(amount, sliderMax)

  return (
    <div className="mt-3.5">
      <Panel title="Bank credit line — leverage with conditions">
        {game.debt ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-warn/40 bg-warn/5 px-3 py-2.5">
            <span>
              <span className="text-[11px] text-mut">Principal</span>
              <br />
              <b className="tnum">{money(game.debt.principal)}</b> <span className="text-mut">at {game.debt.apr}%</span>
            </span>
            <span>
              <span className="text-[11px] text-mut">Interest / wk</span>
              <br />
              <b className="tnum">{money(weeklyInterest(game))}</b>
            </span>
            <span>
              <span className="text-[11px] text-mut">Covenant: revenue must stay above</span>
              <br />
              <b className={`tnum ${game.lastRevenue < game.debt.covenantRevenue * 1.2 ? 'text-bad' : 'text-good'}`}>
                {money(game.debt.covenantRevenue)}/wk
              </b>{' '}
              <span className="text-mut">(now {money(game.lastRevenue)})</span>
            </span>
          </div>
        ) : (
          <div className="mb-3 text-[13px] text-mut">
            {cap === 0
              ? 'Banks lend against revenue — come back with $250k+/yr and they\'ll answer the phone.'
              : `The bank will lend up to ${money(cap)} (half your annual revenue) at ${apr}% APR — the central-bank rate plus a spread for your risk.`}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="range"
            min={10_000}
            max={sliderMax}
            step={10_000}
            value={shownAmount}
            style={{ ['--fill' as string]: `${(shownAmount / sliderMax) * 100}%`, maxWidth: 260 }}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <b className="w-20 tnum">{money(shownAmount)}</b>
          <Btn variant="primary" disabled={available <= 0 || shownAmount <= 0} onClick={() => takeDebt(Math.min(shownAmount, available))}>
            Draw
          </Btn>
          <Btn disabled={!game.debt || game.cash <= 0} onClick={() => payDebt(shownAmount)}>
            Repay
          </Btn>
        </div>
        <div className="mt-2 text-xs leading-relaxed text-mut">
          Non-dilutive cash: no equity lost, interest hits your weekly burn. The condition, stated up front: the covenant locks at 60%
          of your revenue when you draw — fall below it and the bank calls the loan, seizing cash first and{' '}
          <b className="text-ink">15% of the company</b> for anything it can't collect. Debt is rocket fuel for a working machine and
          poison for a broken one.
        </div>
      </Panel>
    </div>
  )
}

function UpcomingPayments() {
  const game = useStore((s) => s.game)!
  const { due, potential, recommended } = committedCosts(game)
  if (due === 0 && potential === 0 && game.cash > recommended) return null
  return (
    <div className="mt-3.5">
      <Panel title="Upcoming one-off payments — no hidden bills">
        {game.pendingHires.map((p) => (
          <div key={p.candidate.id} className="flex justify-between border-b border-line/40 py-1.5 text-[13px] last:border-b-0">
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
          <div key={c.id} className="flex justify-between border-b border-line/40 py-1.5 text-[13px] last:border-b-0">
            <span>
              Recruiter fee — <b>{c.name}</b> <span className="text-mut">only if they accept your offer</span>
            </span>
            <b className="tnum text-mut">{money(recruiterFee(c))}</b>
          </div>
        ))}
        {due === 0 && potential === 0 && <div className="py-1 text-[13px] text-mut">Nothing committed right now.</div>}
        <div className="mt-2.5 flex justify-between rounded-lg bg-surface2/60 px-3 py-2 text-[13px]">
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

      {game.rules?.debt !== false && <DebtPanel />}
      <MacroPanel />
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
