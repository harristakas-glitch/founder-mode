// Team — "Manage your team and keep them at their best." (owner brief + mockups, 2026-08-24).
//
// Team management is OPERATIONAL, so the desktop core is a compact roster LIST — Football
// Manager grammar, not a card showcase: scan everyone, spot risk, act. Mobile is tighter rows
// with a Team Health card on top. The right rail reads the org (Team Health gauge + drivers,
// Role Coverage). Rows are sorted by distance to each person's own quit floor, so whoever is
// closest to resigning is the first row you see. Everything the old page DID survives: the
// founder card with energy and the recharge week, the all-hands speech, career's employee
// conversations, raise and fire, the full profile dialog.

import { Megaphone, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, Btn, NESTED, Panel } from '../components'
import { PersonProfile } from '../People'
import { Portrait } from '../Portrait'
import { SectionLabel } from '../People'
import { money, pct } from '../format'
import { pitchOptions, weeklyPayroll } from '../game/engine'
import { hasCapability } from '../game/modes'
import { ROLE_LABEL, burnRisk, fitTone, outputPoints, teamFit, title, type TeamContext } from '../game/people'
import type { Employee } from '../game/types'
import { EmployeeConversations } from '../CareerUI'
import { useStore } from '../store'
import {
  CoverageRow,
  DriverRow,
  HealthGauge,
  KpiStrip,
  quitFloor,
  roleNeeds,
  statusFor,
  teamHealth,
  teamNudge,
  teamRunwayImpact,
  weeklyMoney,
  StatusBadge,
} from './people-shared'

// §38: one line unless opened. The part that changes week to week (rallied, or how long until
// they will sit through another one) reads without opening anything; the speeches are a toggle.
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

/** The founder's own row-card: energy, recharge, and the honest line about what you contribute. */
function FounderCard() {
  const game = useStore((s) => s.game)!
  const recharge = useStore((s) => s.recharge)
  return (
    <Panel className="mt-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/50 bg-accent/15 text-[13px] font-bold text-accent">
            You
          </span>
          <div>
            <b>Founder & CEO</b> <span className="text-mut">({game.founderKind})</span>
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
  )
}

/** Right rail: the health gauge with its drivers, then role coverage (brief §9E/§9F). */
function TeamRail() {
  const game = useStore((s) => s.game)!
  const h = teamHealth(game)
  const nudge = teamNudge(game)
  if (!h) return null
  return (
    <div className="sticky top-4">
      <Panel>
        <SectionLabel>Team health</SectionLabel>
        <div className="mt-2">
          <HealthGauge score={h.score} word={h.word} tone={h.tone} />
        </div>
        <div className="mt-3 border-t border-line/60 pt-2">
          <div className="text-[10.5px] font-bold tracking-[0.08em] text-mut uppercase">What's driving this</div>
          <div className="mt-1 divide-y divide-line/40">
            <DriverRow label="High performers" value={h.highPerformers} tone={h.highPerformers > 0 ? 'text-good' : ''} />
            <DriverRow label="At risk" value={h.atRisk} tone={h.atRisk > 0 ? 'text-bad' : ''} />
            <DriverRow label="Burnout risk" value={h.burnout} tone={h.burnout > 0 ? 'text-warn' : ''} />
            <DriverRow label="New this month" value={h.newThisMonth} tone={h.newThisMonth > 0 ? 'text-info' : ''} />
          </div>
        </div>
        {nudge && <div className="mt-2 text-[11.5px] leading-snug text-warn">{nudge}</div>}
      </Panel>
      <Panel className="mt-3.5">
        <SectionLabel>Role coverage</SectionLabel>
        <div className="mt-1.5">
          {roleNeeds(game).map((n) => (
            <CoverageRow key={n.role} need={n} />
          ))}
        </div>
        <div className="mt-1.5 text-[10.5px] leading-snug text-mut">
          What the {game.stage} output mix rewards at this headcount — engineers build, a designer counts triple on research, sales lifts
          revenue per customer.
        </div>
      </Panel>
    </div>
  )
}

/** A very light org chart: you on top, the four functions as columns of people. */
function OrgChart() {
  const game = useStore((s) => s.game)!
  const roles = ['engineer', 'designer', 'marketer', 'sales'] as const
  return (
    <Panel className="mt-3.5">
      <div className="flex justify-center">
        <div className="rounded-xl border border-accent/50 bg-accent/10 px-4 py-2 text-center">
          <div className="text-[13px] font-bold">You</div>
          <div className="text-[10.5px] text-mut">Founder & CEO</div>
        </div>
      </div>
      <div className="mx-auto mt-2 h-4 w-px bg-line2" aria-hidden />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map((r) => {
          const members = game.employees.filter((e) => e.role === r)
          return (
            <div key={r} className={`${NESTED} p-2.5`}>
              <div className="text-[10.5px] font-bold tracking-[0.08em] text-mut uppercase">{ROLE_LABEL[r]}</div>
              {members.length === 0 ? (
                <div className="mt-1.5 text-[11.5px] text-mut/70">Nobody yet</div>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  {members.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <span className="block h-6 w-6 shrink-0 overflow-hidden rounded-full border border-line2/70 bg-black/30">
                        <Portrait person={e} frame="chip" className="h-full w-full" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold leading-tight">{e.name}</span>
                        <span className="block truncate text-[10px] text-mut">{title(e)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

export function Team() {
  const game = useStore((s) => s.game)!
  const fire = useStore((s) => s.fire)
  const giveRaise = useStore((s) => s.giveRaise)
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [tab, setTab] = useState<'team' | 'org'>('team')

  /**
   * SCORED WITHOUT THE PERSON IN IT — fit here answers "what does this roster want given everyone
   * ELSE on it". Same counterfactual the old page used; see its comment history for the measured
   * flip that motivated it.
   */
  const ctxWithout = useMemo(() => {
    const roles = game.employees.map((e) => ({ id: e.id, role: e.role }))
    return (id: string): TeamContext => ({
      stage: game.stage,
      roles: roles.filter((r) => r.id !== id).map((r) => r.role),
    })
  }, [game.stage, game.employees])

  // Quit-distance order: whoever is closest to handing in their notice is the first row.
  const roster = [...game.employees].sort((a, b) => a.morale - quitFloor(a) - (b.morale - quitFloor(b)))
  const openEmployee = game.employees.find((e) => e.id === open) ?? null
  const h = teamHealth(game)

  const confirmFire = (e: Employee, after?: () => void) => {
    if (confirm(`Let ${e.name} go? One month severance, team morale takes a hit.`)) {
      fire(e.id)
      after?.()
    }
  }

  const moraleTone = (e: Employee) => {
    const floor = quitFloor(e)
    return e.morale < floor ? 'var(--color-bad)' : e.morale < floor + 18 ? 'var(--color-warn)' : 'var(--color-good)'
  }

  const kpis = [
    { label: 'Team size', value: String(game.employees.length + 1), sub: 'incl. you' },
    { label: 'Payroll / wk', value: money(weeklyPayroll(game)) },
    {
      label: 'Avg morale',
      value: h ? String(h.score) : '—',
      sub: h?.word,
      tone: h ? (h.tone === 'good' ? 'text-good' : h.tone === 'warn' ? 'text-warn' : 'text-bad') : '',
    },
    {
      label: 'Runway impact',
      value: teamRunwayImpact(game).text,
      tone: teamRunwayImpact(game).tone === 'bad' ? 'text-bad' : teamRunwayImpact(game).tone === 'warn' ? 'text-warn' : '',
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight sm:text-[28px]">Team</h1>
          <div className="mt-0.5 text-[13px] text-mut">Manage your team and keep them at their best.</div>
        </div>
      </div>

      <div className="mt-3 hidden sm:block">
        <KpiStrip items={kpis} />
      </div>

      {/* MOBILE Team Health card — explicitly requested at the top of the phone page */}
      {h && (
        <div className="mt-3 flex items-center gap-4 rounded-xl border border-line bg-surface p-3 shadow-[var(--elev-1)] sm:hidden">
          <div className="shrink-0">
            <HealthGauge score={h.score} word={h.word} tone={h.tone} />
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="text-mut">At risk</span>
              <span className={`font-bold tnum ${h.atRisk > 0 ? 'text-bad' : ''}`}>{h.atRisk}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-mut">Burnout risk</span>
              <span className={`font-bold tnum ${h.burnout > 0 ? 'text-warn' : ''}`}>{h.burnout}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-mut">Payroll</span>
              <span className="font-bold tnum">{money(weeklyPayroll(game))}/wk</span>
            </div>
          </div>
        </div>
      )}

      {/* sub-tabs: Team | Org chart (brief §9C — no more than these) */}
      {game.employees.length > 0 && (
        <div className="mt-3.5 flex gap-1.5">
          {(
            [
              ['team', 'Team'],
              ['org', 'Org chart'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`min-h-[34px] rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors ${
                tab === id ? 'border-accent bg-accent/15 text-ink' : 'border-line2 bg-surface2 text-mut hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <FounderCard />

      {/* Living World Phase 8: somebody has raised something specific, and it wants an answer.
          Above the roster on purpose — the one conversation you have been avoiding outranks a
          speech to everyone. Renders null without the capability. */}
      <EmployeeConversations />

      {tab === 'org' && game.employees.length > 0 ? (
        <OrgChart />
      ) : (
        <div className="mt-3.5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
          <div className="min-w-0">
            {roster.length === 0 ? (
              <Panel>
                <div className="text-mut">
                  No employees yet. Head to <b>Hiring</b> — you cannot build a unicorn alone.
                </div>
              </Panel>
            ) : (
              <>
                {/* DESKTOP ROSTER LIST — the mockup's central decision. Columns: employee,
                    role, fit, morale, contribution, salary, status, actions. */}
                <div className="hidden overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--elev-2)] sm:block">
                  <div className="grid grid-cols-[minmax(150px,1.5fr)_minmax(80px,0.9fr)_52px_minmax(90px,1fr)_60px_70px_minmax(110px,1fr)_72px] items-center gap-x-3 border-b border-line bg-surface2/60 px-3.5 py-2 text-[10px] font-bold tracking-[0.08em] text-mut uppercase">
                    <span>Employee</span>
                    <span>Role</span>
                    <span title="How this roster wants their shape, scored without them in it">Fit</span>
                    <span>Morale</span>
                    <span className="text-right" title="Weekly output points at this stage">
                      Contrib.
                    </span>
                    <span className="text-right">Salary</span>
                    <span>Status</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {roster.map((e) => {
                    const fit = teamFit(e, ctxWithout(e.id))
                    const ft = fitTone(fit)
                    const st = statusFor(e, game.stage)
                    return (
                      <div
                        key={e.id}
                        className="grid grid-cols-[minmax(150px,1.5fr)_minmax(80px,0.9fr)_52px_minmax(90px,1fr)_60px_70px_minmax(110px,1fr)_72px] items-center gap-x-3 border-b border-line/50 px-3.5 py-2 text-[12.5px] transition-colors last:border-b-0 hover:bg-surface2/40"
                      >
                        <button onClick={() => setOpen(e.id)} className="flex min-w-0 cursor-pointer items-center gap-2.5 text-left">
                          <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-full border border-line2/70 bg-black/30">
                            <Portrait person={e} frame="chip" className="h-full w-full" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-bold leading-tight hover:underline">{e.name}</span>
                            <span className="block truncate text-[10.5px] text-mut">{title(e)}</span>
                          </span>
                        </button>
                        <span className="truncate text-mut">{ROLE_LABEL[e.role]}</span>
                        <span className={`font-bold tnum ${ft === 'good' ? 'text-good' : ft === 'warn' ? 'text-warn' : 'text-bad'}`}>{fit}%</span>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/40">
                            <span className="block h-full rounded-full" style={{ width: `${e.morale}%`, background: moraleTone(e) }} />
                          </span>
                          <span className="w-6 shrink-0 text-right text-[11.5px] font-semibold tnum">{Math.round(e.morale)}</span>
                        </span>
                        <span className="text-right font-semibold tnum">{outputPoints(e, game.stage).toFixed(1)}</span>
                        <span className="text-right text-mut tnum">{money(e.salary / 52)}</span>
                        <span className="min-w-0 truncate">
                          <StatusBadge status={st} />
                        </span>
                        <span className="relative flex justify-end gap-1">
                          <Btn className="!min-h-[30px] !px-2.5 !text-[12px]" onClick={() => setOpen(e.id)}>
                            View
                          </Btn>
                          <button
                            aria-label={`More actions for ${e.name}`}
                            aria-expanded={menu === e.id}
                            onClick={() => setMenu(menu === e.id ? null : e.id)}
                            className="flex h-[30px] w-[26px] items-center justify-center rounded-lg border border-line2 bg-surface2 text-mut hover:text-ink"
                          >
                            <MoreHorizontal size={14} aria-hidden />
                          </button>
                          {menu === e.id && (
                            <div className="absolute top-[32px] right-0 z-20 w-40 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--elev-3)]">
                              <button
                                className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-surface2"
                                onClick={() => {
                                  giveRaise(e.id)
                                  setMenu(null)
                                }}
                              >
                                Give a raise <span className="text-mut">(+10% pay, +12 morale)</span>
                              </button>
                              <button
                                className="block w-full px-3 py-2 text-left text-[12.5px] text-bad hover:bg-surface2"
                                onClick={() => {
                                  setMenu(null)
                                  confirmFire(e)
                                }}
                              >
                                Let them go
                              </button>
                            </div>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* MOBILE roster rows — morale + status carry the row; tap for the profile */}
                <div className="space-y-2 sm:hidden">
                  {roster.map((e) => {
                    const st = statusFor(e, game.stage)
                    return (
                      <button
                        key={e.id}
                        onClick={() => setOpen(e.id)}
                        className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left shadow-[var(--elev-1)] active:bg-surface2"
                      >
                        <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-full border border-line2/70 bg-black/30">
                          <Portrait person={e} frame="chip" className="h-full w-full" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[14px] font-bold">{e.name}</span>
                            <span className="shrink-0 text-[13px] font-bold tnum">{Math.round(e.morale)}</span>
                          </span>
                          <span className="flex items-baseline justify-between gap-2 text-[11.5px] text-mut">
                            <span className="truncate">{title(e)}</span>
                            <span className="shrink-0 tnum">{weeklyMoney(e.salary)}</span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2">
                            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/40">
                              <span className="block h-full rounded-full" style={{ width: `${e.morale}%`, background: moraleTone(e) }} />
                            </span>
                            <StatusBadge status={st} compact />
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {roster.length > 0 && <PitchPanel />}
          </div>

          <div className="hidden min-w-0 xl:block">
            <TeamRail />
          </div>
        </div>
      )}

      {openEmployee && (
        <PersonProfile
          person={openEmployee}
          ctx={ctxWithout(openEmployee.id)}
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
              <Btn variant="danger" onClick={() => confirmFire(openEmployee, () => setOpen(null))}>
                Let them go
              </Btn>
            </>
          }
        />
      )}
    </div>
  )
}
