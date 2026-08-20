import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Btn, LineChart, Panel, Td, Th } from '../components'
import { money } from '../format'
import {
  committedCosts,
  debtApr,
  debtCapacity,
  recruiterFee,
  weeklyInfra,
  weeklyInterest,
  weeklyOffice,
  weeklyPayroll,
} from '../game/engine'
import { hasCapability } from '../game/modes'
import { useStore } from '../store'

/**
 * The rules are not optional reading, but they are not every-week reading either — a disclosure
 * keeps them one keypress away instead of permanently occupying the screen. Native <details>, so
 * the toggle is a real button to a screen reader and needs no JavaScript of ours.
 *
 * What never goes in here: the player's current position, and any rule they could lose the company
 * to. That is why the covenant consequence stays on the face of the debt panel.
 */
function Explainer({ label = 'What this means', children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-mut transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} strokeWidth={2.4} className="transition-transform duration-150 group-open:rotate-90" />
        {label}
      </summary>
      <div className="mt-1.5 text-xs leading-relaxed text-mut">{children}</div>
    </details>
  )
}

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
        <Explainer label="Why these three numbers matter">
          The market's mood drives the funding climate, the bank rate prices your debt, and inflation quietly raises every salary on
          your payroll each week. Rate cuts and rallies open funding windows; shocks slam them shut.
        </Explainer>
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
          // The offer itself is state, not prose, so it stays visible; only the arithmetic behind
          // the cap and the rate moved into the disclosure below.
          <div className="mb-3 text-[13px] text-mut">
            {cap === 0
              ? 'Banks lend against revenue — come back with $250k+/yr and they\'ll answer the phone.'
              : `The bank will lend up to ${money(cap)} at ${apr}% APR.`}
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
        {/* Never behind the disclosure. This is the only place in the game a player is told that
            15% of the company is on the table, and a rule you can lose the company to is not an
            explainer — it is the price on the button directly above it. */}
        <div className="mt-2 text-xs leading-relaxed text-mut">
          The condition, stated up front: the covenant locks at 60% of your revenue when you draw — fall below it and the bank calls
          the loan, seizing cash first and <b className="text-ink">15% of the company</b> for anything it can't collect.
        </div>
        <Explainer label="How the cap, the rate and the trade-off work">
          The cap is half your annual revenue; the rate is the central-bank rate plus a spread for your risk. In exchange you get
          non-dilutive cash — no equity lost, with the interest landing on your weekly burn instead. Debt is rocket fuel for a
          working machine and poison for a broken one.
        </Explainer>
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
        <div className="mt-2.5 flex justify-between rounded-lg bg-surface2 px-3 py-2 text-[13px]">
          <span>Recommended cash buffer</span>
          <b className={`tnum ${game.cash < recommended ? 'text-bad' : 'text-good'}`}>{money(recommended)}</b>
        </div>
        {game.cash < recommended && (
          <div className="mt-1.5 text-xs text-bad">
            Your {money(game.cash)} is below the buffer — one bad week could zero the account.
          </div>
        )}
        <Explainer label="How the buffer is set">
          Committed recruiter fees plus one worst-case event. It grows with your user count, because a bigger product has bigger
          accidents.
        </Explainer>
      </Panel>
    </div>
  )
}

export function Finance() {
  const game = useStore((s) => s.game)!
  const rows = [...game.history].slice(-12).reverse()

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Finance</h1>
      <div className="text-[13px] text-mut">Cash is oxygen. Everything else is commentary.</div>
      {/* Cash, runway, revenue and burn were four StatCards here; all four are on the topbar rail
          of every screen, so the rail wins. The one thing the rail cannot carry is what the burn is
          made OF — infra and office appear nowhere else — so that survives as a line, not boxes. */}
      <div className="mt-1.5 mb-4 text-[13px] text-mut">
        Burn goes to payroll <span className="tnum text-ink">{money(weeklyPayroll(game))}</span> · infra{' '}
        <span className="tnum text-ink">{money(weeklyInfra(game))}</span> · office{' '}
        <span className="tnum text-ink">{money(weeklyOffice(game))}</span> · marketing{' '}
        <span className="tnum text-ink">{money(game.marketingSpend)}</span> a week.
      </div>

      {hasCapability(game, 'bankDebt') && <DebtPanel />}
      <MacroPanel />
      <UpcomingPayments />

      {/* The cash line chart that used to sit here was the same series, the same panel title and
          the same component as the Dashboard's. One home per number. */}
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
