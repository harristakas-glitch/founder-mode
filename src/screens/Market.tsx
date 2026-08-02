import { Bar, Panel, StatCard } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import { effectiveTam, marketSaturation, rivalValuation, valuation } from '../game/engine'
import { STAGES } from '../game/data'
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
      <div className="screen-title">Market</div>
      <div className="screen-sub">
        {sector.name} · addressable market ≈ {num(effectiveTam(game))} users (and growing) · winners take most
      </div>

      <div className="grid cols-2">
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

      <div className="mt">
        <Panel title="Leaderboard">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Stage</th>
                <th className="r">Users</th>
                <th className="r">Est. valuation</th>
                <th style={{ width: 140 }}>Momentum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={r.you ? { background: 'rgba(91,140,255,0.08)' } : !r.alive ? { opacity: 0.4 } : undefined}>
                  <td>{r.alive ? i + 1 : '—'}</td>
                  <td>
                    <b>{r.name}</b>
                    {!r.alive && <span className="muted"> · shut down</span>}
                  </td>
                  <td>{r.alive ? r.stage : '☠️'}</td>
                  <td className="r">{num(r.users)}</td>
                  <td className="r">{r.alive ? money(r.val) : '—'}</td>
                  <td>{r.alive && <Bar value={r.product ?? Math.min(100, 40 + game.pmf / 2)} color={r.you ? 'var(--accent)' : 'var(--muted)'} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted mt" style={{ fontSize: '0.8rem' }}>
            Rival intel is approximate — the momentum bar reflects their product strength as far as your team can tell.
            Rivals raise rounds, ship launches, poach your users, and sometimes die. Their obituaries are good for you.
          </div>
        </Panel>
      </div>
    </div>
  )
}
