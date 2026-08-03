import { Megaphone } from 'lucide-react'
import { Bar, Btn, Panel, SkillDots, Td, Th, TraitChip } from '../components'
import { money, pct } from '../format'
import { pitchOptions, weeklyPayroll } from '../game/engine'
import { useStore } from '../store'

const ROLE_LABEL: Record<string, string> = {
  engineer: 'Engineer',
  designer: 'Designer',
  marketer: 'Marketer',
  sales: 'Sales',
}

function PitchPanel() {
  const game = useStore((s) => s.game)!
  const rallyTeam = useStore((s) => s.rallyTeam)
  const onCooldown = game.pitchCooldown > 0
  const options = pitchOptions(game)

  return (
    <div className="mt-3.5">
      <Panel title="All-hands — pitch your own team">
        {game.rally && (
          <div className="mb-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-[13px] text-good">
            The team is rallied: output ×{game.rally.mult.toFixed(2)} for {game.rally.weeksLeft} more week
            {game.rally.weeksLeft === 1 ? '' : 's'}.
          </div>
        )}
        <div className="mb-3 text-xs leading-relaxed text-mut">
          Investors aren't the only ones you pitch. Gather the company and pick your speech — the odds are computed from what the team
          can already see (metrics, momentum, their own energy), so a speech the facts don't back is a gamble.
          {onCooldown && (
            <b className="text-warn"> They'll sit through the next one in {game.pitchCooldown} wk — even great speeches wear thin.</b>
          )}
        </div>
        <div className="grid gap-2.5 md:grid-cols-3">
          {options.map((o) => (
            <div key={o.id} className="flex flex-col rounded-xl border border-line bg-surface2/50 p-3">
              <div className="flex items-center justify-between">
                <b className="text-[14px]">{o.name}</b>
                <span className={`text-[13px] font-bold tnum ${o.p >= 0.6 ? 'text-good' : o.p >= 0.4 ? 'text-warn' : 'text-bad'}`}>
                  {pct(o.p)} lands
                </span>
              </div>
              <div className="mt-1 flex-1 text-xs leading-relaxed text-mut">{o.blurb}</div>
              <div className="mt-2 text-[11.5px] leading-relaxed">
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
      </Panel>
    </div>
  )
}

export function Team() {
  const game = useStore((s) => s.game)!
  const fire = useStore((s) => s.fire)
  const giveRaise = useStore((s) => s.giveRaise)

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Team</div>
      <div className="mb-4 text-[13px] text-mut">
        {game.employees.length} employees · payroll {money(weeklyPayroll(game))}/wk · a raise is +10% salary, +12 morale
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <b>You</b> <span className="text-mut">· Founder & CEO ({game.founderKind})</span>
          </div>
          <span className="text-[13px] text-mut">
            {game.founderKind === 'technical' ? 'Contributes engineering output every week' : 'Generates hype and boosts revenue'}
          </span>
        </div>
      </Panel>

      {game.employees.length > 0 && <PitchPanel />}

      <div className="mt-3.5">
        <Panel>
          {game.employees.length === 0 ? (
            <div className="text-mut">
              No employees yet. Head to <b>Hiring</b> — you cannot build a unicorn alone.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Skill</Th>
                    <Th>Morale</Th>
                    <Th right>Salary</Th>
                    <Th right>Tenure</Th>
                    <Th right>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {game.employees.map((e) => (
                    <tr key={e.id}>
                      <Td>
                        <b>{e.name}</b>
                        <TraitChip trait={e.trait} />
                      </Td>
                      <Td>{ROLE_LABEL[e.role]}</Td>
                      <Td>
                        <SkillDots skill={e.skill} />
                      </Td>
                      <Td className="min-w-[110px]">
                        <Bar value={e.morale} color={e.morale < 40 ? 'var(--color-bad)' : e.morale < 60 ? 'var(--color-warn)' : 'var(--color-good)'} />
                      </Td>
                      <Td right>{money(e.salary)}/yr</Td>
                      <Td right>{e.weeks} wk</Td>
                      <Td right>
                        <div className="flex justify-end gap-1.5">
                          <Btn onClick={() => giveRaise(e.id)}>Raise</Btn>
                          <Btn
                            variant="danger"
                            onClick={() => {
                              if (confirm(`Let ${e.name} go? One month severance, team morale takes a hit.`)) fire(e.id)
                            }}
                          >
                            Fire
                          </Btn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
