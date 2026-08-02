import { Bar, Btn, Panel, SkillDots, Td, Th, TraitChip } from '../components'
import { money } from '../format'
import { weeklyPayroll } from '../game/engine'
import { useStore } from '../store'

const ROLE_LABEL: Record<string, string> = {
  engineer: 'Engineer',
  designer: 'Designer',
  marketer: 'Marketer',
  sales: 'Sales',
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
