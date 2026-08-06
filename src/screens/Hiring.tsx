import { Btn, Panel, SkillDots, Td, Th, TraitChip } from '../components'
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
      <h1 className="text-[20px] font-extrabold tracking-tight">Hiring</h1>
      <div className="mb-4 text-[13px] leading-relaxed text-mut">
        Burn {money(weeklyBurn(game))}/wk · revenue {money(game.lastRevenue)}/wk · runway{' '}
        {runway === Infinity ? '∞' : `${Math.floor(runway)} wk`}. The <b className="text-ink">runway after</b> column shows what hiring
        that person does to it — under ~20 weeks is living dangerously, and candidates start declining offers below ~10.
      </div>

      {(game.offersOut.length > 0 || game.pendingHires.length > 0) && (
        <div className="mb-3.5 grid gap-3.5 md:grid-cols-2">
          {game.offersOut.length > 0 && (
            <Panel title="Offers out — they answer next week">
              {game.offersOut.map((c) => (
                <div key={c.id} className="flex justify-between py-1.5 text-[13px]">
                  <span>
                    <b>{c.name}</b> <span className="text-mut">· {c.role}</span>
                  </span>
                  <span className="text-mut tnum">{money(c.salary)}/yr · deciding…</span>
                </div>
              ))}
            </Panel>
          )}
          {game.pendingHires.length > 0 && (
            <Panel title="Signed — serving notice">
              {game.pendingHires.map((p) => (
                <div key={p.candidate.id} className="flex justify-between py-1.5 text-[13px]">
                  <span>
                    <b>{p.candidate.name}</b> <span className="text-mut">· {p.candidate.role}</span>
                  </span>
                  <span className="text-good">
                    starts in {p.weeksUntilStart} wk{p.weeksUntilStart === 1 ? '' : 's'}
                    <span className="text-mut"> · {money(recruiterFee(p.candidate))} fee due then</span>
                  </span>
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Skill</Th>
                <Th right>Salary</Th>
                <Th right>Fee</Th>
                <Th right>Runway after</Th>
                <Th right>In pool</Th>
                <Th right></Th>
              </tr>
            </thead>
            <tbody>
              {game.candidates.map((c) => {
                const after = runwayAfterHire(game, c)
                const afterLabel = after === Infinity ? '∞' : `${Math.max(0, Math.floor(after))} wk`
                const cls = after === Infinity ? 'text-good' : after < 12 ? 'text-bad font-bold' : after < 20 ? 'text-warn' : 'text-good'
                return (
                  <tr key={c.id}>
                    <Td>
                      <b>{c.name}</b>
                      <TraitChip trait={c.trait} />
                    </Td>
                    <Td>
                      {c.role}
                      <div className="text-[11px] text-mut">{ROLE_HELP[c.role]}</div>
                    </Td>
                    <Td>
                      <SkillDots skill={c.skill} />
                    </Td>
                    <Td right>{money(c.salary)}/yr</Td>
                    <Td right className="text-mut">
                      {money(recruiterFee(c))}
                    </Td>
                    <Td right className={cls}>
                      {afterLabel}
                      {after !== Infinity && after < 12 && <div className="text-[10px]">overhiring!</div>}
                    </Td>
                    <Td right className="text-mut">
                      {c.weeksLeft} wk
                    </Td>
                    <Td right>
                      <Btn variant="primary" onClick={() => sendOffer(c.id)}>
                        Send offer
                      </Btn>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
