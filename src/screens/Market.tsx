import { Bar, Panel, StatCard, Td, Th } from '../components'
import { money, num, pct } from '../format'
import { STAGES, sectorById } from '../game/data'
import { effectiveTam, marketSaturation, rivalValuation, valuation } from '../game/engine'
import { useStore } from '../store'

export function Market() {
  const game = useStore((s) => s.game)!
  const sector = sectorById(game.sector)
  const saturation = marketSaturation(game)

  const rows = [
    {
      id: 'you',
      name: `${game.companyName} (you)`,
      users: game.users,
      stage: game.stage as string,
      product: undefined as number | undefined,
      val: valuation(game),
      alive: true,
      you: true,
    },
    ...game.rivals.map((r) => ({
      id: r.id,
      name: r.name,
      users: r.users,
      stage: STAGES[r.stage] as string,
      product: r.product,
      val: rivalValuation(r, game),
      alive: r.alive,
      you: false,
    })),
  ].sort((a, b) => Number(b.alive) - Number(a.alive) || b.users - a.users)

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Market</div>
      <div className="mb-4 text-[13px] text-mut">
        {sector.name} · addressable market ≈ {num(effectiveTam(game))} users (and growing) · winners take most
      </div>

      <div className="grid gap-3.5 md:grid-cols-2">
        <StatCard
          label="Market saturation"
          value={pct(saturation, 1)}
          delta={saturation > 0.5 ? 'Growth gets harder as the market fills up' : 'Plenty of greenfield left'}
          tone={saturation > 0.5 ? 'down' : 'up'}
        />
        <StatCard
          label="Your market share"
          value={pct(game.users / Math.max(1, game.users + game.rivals.filter((r) => r.alive).reduce((a, r) => a + r.users, 0)), 1)}
          delta="share of captured users, vs living rivals"
        />
      </div>

      <div className="mt-3.5">
        <Panel title="Leaderboard">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Company</Th>
                  <Th>Stage</Th>
                  <Th right>Users</Th>
                  <Th right>Est. valuation</Th>
                  <Th>Momentum</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={r.you ? 'bg-accent/10' : !r.alive ? 'opacity-40' : ''}>
                    <Td>{r.alive ? i + 1 : '—'}</Td>
                    <Td>
                      <b>{r.name}</b>
                      {!r.alive && <span className="text-mut"> · shut down</span>}
                    </Td>
                    <Td>{r.alive ? r.stage : '☠️'}</Td>
                    <Td right>{num(r.users)}</Td>
                    <Td right>{r.alive ? money(r.val) : '—'}</Td>
                    <Td className="w-[140px]">
                      {r.alive && (
                        <Bar
                          value={r.product ?? Math.min(100, 40 + game.pmf / 2)}
                          color={r.you ? 'var(--color-accent)' : 'var(--color-mut)'}
                        />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs leading-relaxed text-mut">
            Rival intel is approximate — the momentum bar reflects their product strength as far as your team can tell. Rivals raise
            rounds, ship launches, poach your users, and sometimes die. Their obituaries are good for you.
          </div>
        </Panel>
      </div>
    </div>
  )
}
