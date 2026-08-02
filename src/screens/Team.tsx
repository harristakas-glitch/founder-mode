import { Bar, Panel, SkillDots, TraitChip } from '../components'
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
      <div className="screen-title">Team</div>
      <div className="screen-sub">
        {game.employees.length} employees · payroll {money(weeklyPayroll(game))}/wk · a raise is +10% salary, +12 morale
      </div>

      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <b>You</b> <span className="muted">· Founder & CEO ({game.founderKind})</span>
          </div>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {game.founderKind === 'technical' ? 'Contributes engineering output every week' : 'Generates hype and boosts revenue'}
          </span>
        </div>
      </Panel>

      <div className="mt">
        <Panel>
          {game.employees.length === 0 ? (
            <div className="muted">
              No employees yet. Head to <b>Hiring</b> — you cannot build a unicorn alone.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Skill</th>
                  <th>Morale</th>
                  <th className="r">Salary</th>
                  <th className="r">Tenure</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {game.employees.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <b>{e.name}</b>
                      <TraitChip trait={e.trait} />
                    </td>
                    <td>{ROLE_LABEL[e.role]}</td>
                    <td>
                      <SkillDots skill={e.skill} />
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <Bar value={e.morale} color={e.morale < 40 ? 'var(--bad)' : e.morale < 60 ? 'var(--warn)' : 'var(--good)'} />
                    </td>
                    <td className="r">{money(e.salary)}/yr</td>
                    <td className="r">{e.weeks} wk</td>
                    <td className="r">
                      <button className="btn" style={{ marginRight: 6 }} onClick={() => giveRaise(e.id)}>
                        Raise
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => {
                          if (confirm(`Let ${e.name} go? One month severance, team morale takes a hit.`)) fire(e.id)
                        }}
                      >
                        Fire
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  )
}
