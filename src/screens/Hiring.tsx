import { Panel, SkillDots, TraitChip } from '../components'
import { money } from '../format'
import { recruiterFee, runwayAfterHire, runwayWeeks, weeklyBurn } from '../game/engine'
import { useStore } from '../store'

const ROLE_HELP: Record<string, string> = {
  engineer: 'Builds features, improves quality, fixes bugs, does research',
  designer: 'Boosts product quality and user research',
  marketer: 'Amplifies marketing spend into hype',
  sales: 'Increases revenue per user',
}

export function Hiring() {
  const game = useStore((s) => s.game)!
  const sendOffer = useStore((s) => s.sendOffer)
  const runway = runwayWeeks(game)

  return (
    <div>
      <div className="screen-title">Hiring</div>
      <div className="screen-sub">
        Burn {money(weeklyBurn(game))}/wk · revenue {money(game.lastRevenue)}/wk · runway{' '}
        {runway === Infinity ? '∞' : `${Math.floor(runway)} wk`}. The <b>runway after</b> column shows what hiring that
        person does to it — under ~20 weeks is living dangerously, and candidates start declining offers below ~10.
      </div>

      {(game.offersOut.length > 0 || game.pendingHires.length > 0) && (
        <div className="grid cols-2" style={{ marginBottom: 14 }}>
          {game.offersOut.length > 0 && (
            <Panel title="Offers out — they answer next week">
              {game.offersOut.map((c) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>
                    <b>{c.name}</b> <span className="muted">· {c.role}</span>
                  </span>
                  <span className="muted">{money(c.salary)}/yr · deciding…</span>
                </div>
              ))}
            </Panel>
          )}
          {game.pendingHires.length > 0 && (
            <Panel title="Signed — serving notice">
              {game.pendingHires.map((p) => (
                <div key={p.candidate.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>
                    <b>{p.candidate.name}</b> <span className="muted">· {p.candidate.role}</span>
                  </span>
                  <span className="good-text">
                    starts in {p.weeksUntilStart} wk{p.weeksUntilStart === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}

      <Panel>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Skill</th>
              <th className="r">Salary</th>
              <th className="r">Fee</th>
              <th className="r">Runway after</th>
              <th className="r">In pool</th>
              <th className="r"></th>
            </tr>
          </thead>
          <tbody>
            {game.candidates.map((c) => {
              const after = runwayAfterHire(game, c)
              const afterLabel = after === Infinity ? '∞' : `${Math.max(0, Math.floor(after))} wk`
              const cls = after === Infinity ? 'good-text' : after < 12 ? 'bad-text' : after < 20 ? '' : 'good-text'
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <TraitChip trait={c.trait} />
                  </td>
                  <td>
                    {c.role}
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      {ROLE_HELP[c.role]}
                    </div>
                  </td>
                  <td>
                    <SkillDots skill={c.skill} />
                  </td>
                  <td className="r">{money(c.salary)}/yr</td>
                  <td className="r muted">{money(recruiterFee(c))}</td>
                  <td className={`r ${cls}`} style={after !== Infinity && after < 12 ? { fontWeight: 700 } : undefined}>
                    {afterLabel}
                    {after !== Infinity && after < 12 && <div style={{ fontSize: '0.7rem' }}>overhiring!</div>}
                  </td>
                  <td className="r muted">{c.weeksLeft} wk</td>
                  <td className="r">
                    <button className="btn primary" onClick={() => sendOffer(c.id)}>
                      Send offer
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
