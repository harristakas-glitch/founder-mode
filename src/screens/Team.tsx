import { Megaphone } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, Btn, Meter, NESTED, Panel, RoleAvatar } from '../components'
import { PersonCard, PersonProfile, type CardBadge } from '../People'
import { money, pct } from '../format'
import { pitchOptions, weeklyPayroll } from '../game/engine'
import { hasCapability } from '../game/modes'
import { burnRisk, deskCost, isRemote, outputPoints, stageOutputMultiplier, type TeamContext } from '../game/people'
import type { Employee } from '../game/types'
import { EmployeeConversations } from '../CareerUI'
import { useStore } from '../store'

// The engine's weekly quit roll: `morale < 32`, or `< 55` for a mercenary, because walking early is
// the trade you make for their output (src/game/engine.ts, the `quitters` filter). Every morale
// reading on this screen is measured against THIS number rather than a round one, so the bar's
// colour and the roster's order mean what the simulation actually does.
const quitFloor = (e: Employee) => (e.trait === 'mercenary' ? 55 : 32)

// §38: this used to be a full card of three speech cards, rendered above the roster every single
// week — for an action that is on cooldown most of them. It is one line now. The part that changes
// week to week (rallied, or how long until they will sit through another one) reads without opening
// anything; the speeches themselves are one toggle away. Native <details>, so the control is
// focusable, keyboard-operable and announced as expanded/collapsed for free.
function PitchPanel() {
  const game = useStore((s) => s.game)!
  const rallyTeam = useStore((s) => s.rallyTeam)
  const onCooldown = game.pitchCooldown > 0
  const options = pitchOptions(game)

  const status = game.rally
    ? {
        tone: 'text-good',
        text: `rallied — output ×${game.rally.mult.toFixed(2)} for ${game.rally.weeksLeft} more week${game.rally.weeksLeft === 1 ? '' : 's'}`,
      }
    : onCooldown
      ? { tone: 'text-warn', text: `next speech in ${game.pitchCooldown} wk — even great ones wear thin` }
      : { tone: 'text-mut', text: `${options.length} speeches ready` }

  return (
    <div className="mt-3.5">
      <Panel>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-[10px] text-mut transition-all duration-150 group-hover:text-ink group-open:rotate-90">▶</span>
            <Megaphone size={14} className="shrink-0 text-mut" aria-hidden />
            <span className="font-semibold text-ink">All-hands</span>
            <span className={`min-w-0 truncate ${status.tone}`}>· {status.text}</span>
          </summary>

          <div className="mt-3 text-xs leading-relaxed text-mut">
            Investors aren't the only ones you pitch. Gather the company and pick your speech — the odds are computed from what the team
            can already see (metrics, momentum, their own energy), so a speech the facts don't back is a gamble.
          </div>
          <div className="mt-2.5 grid gap-2.5 md:grid-cols-3">
            {options.map((o) => (
              <div key={o.id} className={`flex flex-col ${NESTED} p-3`}>
                <div className="flex items-center justify-between">
                  <b className="text-[14px]">{o.name}</b>
                  <span className={`text-[13px] font-bold tnum ${o.p >= 0.6 ? 'text-good' : o.p >= 0.4 ? 'text-warn' : 'text-bad'}`}>
                    {pct(o.p)} lands
                  </span>
                </div>
                <div className="mt-1 flex-1 text-xs leading-relaxed text-mut">{o.blurb}</div>
                <div className="mt-2 text-[12px] leading-relaxed">
                  <div className="text-good">✓ {o.winText}</div>
                  <div className="text-bad">✗ {o.loseText}</div>
                </div>
                <Btn variant="primary" className="mt-2.5" disabled={onCooldown} onClick={() => rallyTeam(o.id)}>
                  <Megaphone size={13} className="mr-1 inline" />
                  {onCooldown ? `In ${game.pitchCooldown} wk` : 'Give this speech'}
                </Btn>
              </div>
            ))}
          </div>
        </details>
      </Panel>
    </div>
  )
}

export function Team() {
  const game = useStore((s) => s.game)!
  const fire = useStore((s) => s.fire)
  const giveRaise = useStore((s) => s.giveRaise)
  const recharge = useStore((s) => s.recharge)
  const [open, setOpen] = useState<string | null>(null)

  const ctx: TeamContext = useMemo(
    () => ({ stage: game.stage, roles: game.employees.map((e) => e.role) }),
    [game.stage, game.employees],
  )

  // Sorted by distance to the person's own quit floor, so whoever is closest to handing in their
  // notice is the first card you see rather than whoever you happened to hire first. A copy —
  // `game.employees` is store state and its order is the engine's, not ours.
  const roster = [...game.employees].sort((a, b) => a.morale - quitFloor(a) - (b.morale - quitFloor(b)))
  const openEmployee = game.employees.find((e) => e.id === open) ?? null
  const desks = game.employees.filter((e) => deskCost(e) > 0).length

  const badgesFor = (e: Employee): CardBadge[] => {
    const out: CardBadge[] = []
    if (e.morale < quitFloor(e)) out.push({ text: 'May quit', tone: 'bad' })
    else if (e.morale < quitFloor(e) + 18) out.push({ text: 'Unsettled', tone: 'warn' })
    if (out.length === 0 && stageOutputMultiplier(e, game.stage) >= 1.08) out.push({ text: 'Thriving here', tone: 'good' })
    if (out.length < 2 && e.weeks <= 2) out.push({ text: 'New', tone: 'info' })
    return out
  }

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Team</h1>
      <div className="mb-4 text-[13px] text-mut">
        {game.employees.length} {game.employees.length === 1 ? 'employee' : 'employees'} · payroll {money(weeklyPayroll(game))}/wk ·{' '}
        {desks} {desks === 1 ? 'desk' : 'desks'} in the office · a raise is +10% salary, +12 morale
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <RoleAvatar name="You" role={game.founderKind === 'technical' ? 'engineer' : 'sales'} />
            <div>
              <b>You</b> <span className="text-mut">· Founder & CEO ({game.founderKind})</span>
              <div className="text-xs text-mut">
                {game.founderKind === 'technical' ? 'Contributes engineering output every week' : 'Generates hype and boosts revenue'}
                {hasCapability(game, 'founderEnergy') && <> — scaled by your energy ({Math.round(game.energy)}/100)</>}
              </div>
            </div>
          </div>
          {hasCapability(game, 'founderEnergy') && (
            <div className="flex items-center gap-3">
              <div className="w-28">
                <Bar
                  value={game.energy}
                  color={game.energy < 25 ? 'var(--color-bad)' : game.energy < 50 ? 'var(--color-warn)' : 'var(--color-good)'}
                />
              </div>
              <Btn disabled={game.vacationCooldown > 0} onClick={recharge} title="A real week off: +30 energy, the roadmap slips slightly">
                🏝 {game.vacationCooldown > 0 ? `Recharge in ${game.vacationCooldown} wk` : 'Recharge week'}
              </Btn>
            </div>
          )}
        </div>
        {hasCapability(game, 'founderEnergy') && game.energy < 30 && (
          <div className="mt-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-1.5 text-[13px] text-bad">
            You're running on fumes — your weekly contribution is badly weakened, and hitting empty forces a burnout. Take the week.
          </div>
        )}
      </Panel>

      {/* Living World Phase 8 (§38-§39): somebody has raised something specific, and it wants an
          answer. Above the all-hands and the roster on purpose — a pitch to the whole company is
          worth less than the one conversation you have been avoiding. Renders null without the
          capability, so Quick Play and Arena never see it. */}
      <EmployeeConversations />

      <div className="mt-3.5">
        {roster.length === 0 ? (
          <Panel>
            <div className="text-mut">
              No employees yet. Head to <b>Hiring</b> — you cannot build a unicorn alone.
            </div>
          </Panel>
        ) : (
          // THE SAME CARD AS HIRING. Not a lookalike — the same component, from src/People.tsx,
          // reading the same person through the same functions. What differs is the two rows in
          // the middle (morale and pay instead of asking price and runway) and the actions.
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {roster.map((e) => {
              const floor = quitFloor(e)
              const atRisk = e.morale < floor
              return (
                <PersonCard
                  key={e.id}
                  person={e}
                  ctx={ctx}
                  badges={badgesFor(e)}
                  onOpen={() => setOpen(e.id)}
                  rows={
                    <>
                      <span className={`${atRisk ? 'font-semibold text-bad' : 'text-mut'}`}>{atRisk ? 'May quit' : 'Morale'}</span>
                      <span className="flex items-center gap-2">
                        <span className="flex-1">
                          {/* Tone bands measured against the engine's own quit roll (quitFloor
                              above): bad below the floor, warn inside 18 points of it — 32 / 50
                              for most people, higher for a mercenary, exactly as the simulation
                              treats them. The word, not just the hue, carries it on the left. */}
                          <Meter value={e.morale} tone={atRisk ? 'bad' : e.morale < floor + 18 ? 'warn' : 'good'} />
                        </span>
                        <span className="w-7 shrink-0 text-right text-[12px] font-semibold tnum">{Math.round(e.morale)}</span>
                      </span>
                      <span className="text-mut">Salary</span>
                      <span className="text-right tnum">{money(e.salary)}/yr</span>
                      <span className="text-mut">Contributing</span>
                      <span className="text-right tnum">{outputPoints(e, game.stage).toFixed(1)} pts/wk</span>
                      <span className="text-mut">Here</span>
                      <span className="text-right tnum">
                        {e.weeks} wk{isRemote(e) ? <span className="text-mut"> · remote</span> : ''}
                      </span>
                    </>
                  }
                  actions={
                    <>
                      <Btn className="flex-1" onClick={() => setOpen(e.id)}>
                        Profile
                      </Btn>
                      <Btn className="flex-1" onClick={() => giveRaise(e.id)}>
                        Raise
                      </Btn>
                      <Btn
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Let ${e.name} go? One month severance, team morale takes a hit.`)) fire(e.id)
                        }}
                      >
                        Fire
                      </Btn>
                    </>
                  }
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Below the roster now: the roster is the screen's job, and a speech to everyone is worth
          less than the person at the top of it who is about to leave. */}
      {roster.length > 0 && <PitchPanel />}

      {openEmployee && (
        <PersonProfile
          person={openEmployee}
          ctx={ctx}
          onClose={() => setOpen(null)}
          status={
            <>
              <b className="text-ink">{openEmployee.weeks} weeks here.</b> Morale {Math.round(openEmployee.morale)} against a quit floor of{' '}
              {quitFloor(openEmployee)} — {openEmployee.morale < quitFloor(openEmployee) ? 'they can resign on any tick from here' : 'settled for now'}
              . Burn risk {burnRisk(openEmployee)} decides how hard a cash crunch hits THIS person.
            </>
          }
          actions={
            <>
              <Btn onClick={() => giveRaise(openEmployee.id)}>Give a raise</Btn>
              <Btn
                variant="danger"
                onClick={() => {
                  if (confirm(`Let ${openEmployee.name} go? One month severance, team morale takes a hit.`)) {
                    fire(openEmployee.id)
                    setOpen(null)
                  }
                }}
              >
                Let them go
              </Btn>
            </>
          }
        />
      )}
    </div>
  )
}
