import { Bar, Btn, Panel, StatCard, Td, Th } from '../components'
import { money, num, pct } from '../format'
import { STAGES, sectorById } from '../game/data'
import {
  ATTACKS,
  SHIELD_WEEKS,
  acquisitionPrice,
  attackCost,
  canAcquire,
  canAttack,
  canBuyShield,
  effectiveTam,
  marketSaturation,
  canConcedePriceWar,
  rivalValuation,
  shieldCost,
  valuation,
} from '../game/engine'
import { CONCEDE_USER_SHARE } from '../game/pvp'
import { hasCapability } from '../game/modes'
import { SegmentHealth } from '../CareerUI'
import { hasForfeited, myId } from '../net/online'
import { useStore } from '../store'

export function Market() {
  const game = useStore((s) => s.game)!
  const online = useStore((s) => s.online)
  const sector = sectorById(game.sector)
  const netPlayers = online?.players ?? []
  const otherPlayersUsers = netPlayers.reduce((a, p) => (p.id === myId() || p.over ? a : a + p.users), 0)
  const saturation = marketSaturation(game, otherPlayersUsers)

  const playerRows = online
    ? netPlayers.map((p) => {
        const isMe = p.id === myId()
        return {
          id: p.id,
          name: isMe ? `${p.company} (you)` : p.company,
          users: isMe ? game.users : p.users,
          stage: (isMe ? game.stage : `wk ${p.week}`) as string,
          product: undefined as number | undefined,
          val: isMe ? valuation(game) : p.over ? p.payout : p.val,
          alive: isMe ? !game.gameOver : !p.over,
          you: isMe,
          cash: isMe ? game.cash : p.cash,
          rev: isMe ? game.lastRevenue : p.rev,
          pmf: isMe ? game.pmf : p.pmf,
          // still in the match, just not visible on the wire this instant
          absent: !isMe && !!p.absent && !hasForfeited(p),
          gone: !isMe && hasForfeited(p),
        }
      })
    : [
        {
          id: 'you',
          name: `${game.companyName} (you)`,
          users: game.users,
          stage: game.stage as string,
          product: undefined as number | undefined,
          val: valuation(game),
          alive: true,
          you: true,
          cash: undefined as number | undefined,
          rev: undefined as number | undefined,
          pmf: undefined as number | undefined,
          absent: false,
          gone: false,
        },
      ]

  const rows = [
    ...playerRows,
    ...game.rivals.map((r) => ({
      id: r.id,
      name: r.name,
      users: r.users,
      stage: STAGES[r.stage] as string,
      product: r.product,
      val: rivalValuation(r, game),
      alive: r.alive,
      you: false,
      cash: undefined as number | undefined,
      rev: undefined as number | undefined,
      pmf: undefined as number | undefined,
      absent: false,
      gone: false,
    })),
  ].sort((a, b) => Number(b.alive) - Number(a.alive) || b.users - a.users)

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Market</h1>
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
          value={pct(
            game.users /
              Math.max(1, game.users + otherPlayersUsers + game.rivals.filter((r) => r.alive).reduce((a, r) => a + r.users, 0)),
            1,
          )}
          delta={online ? 'share of captured users, vs the other founders' : 'share of captured users, vs living rivals'}
        />
      </div>

      {/* Career: the market is three different customer segments, not one pool of users. */}
      {hasCapability(game, 'detailedPMF') && (
        <div className="mt-3.5">
          <SegmentHealth title="Your segments — customers, retention, PMF" />
        </div>
      )}

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
                  {online && (
                    <>
                      <Th right>Cash</Th>
                      <Th right>Rev /wk</Th>
                      <Th right>PMF</Th>
                    </>
                  )}
                  <Th right>Est. valuation</Th>
                  {!online && <Th>Momentum</Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={r.you ? 'bg-accent/10' : !r.alive ? 'opacity-40' : ''}>
                    <Td>{r.alive ? i + 1 : '—'}</Td>
                    <Td>
                      <b>{r.name}</b>
                      {!r.alive && <span className="text-mut"> · shut down</span>}
                      {r.alive && r.gone && <span className="text-mut"> · left the match</span>}
                      {r.alive && r.absent && (
                        <span className="text-warn" title="We've lost their connection. They're still in the match and still hold their users.">
                          {' '}
                          · reconnecting
                        </span>
                      )}
                    </Td>
                    <Td>{r.alive ? r.stage : '☠️'}</Td>
                    <Td right>{num(r.users)}</Td>
                    {online && (
                      <>
                        <Td right>{r.alive && r.cash != null ? money(r.cash) : '—'}</Td>
                        <Td right>{r.alive && r.rev != null ? money(r.rev) : '—'}</Td>
                        <Td right>{r.alive && r.pmf != null ? Math.round(r.pmf) : '—'}</Td>
                      </>
                    )}
                    <Td right>{r.alive ? money(r.val) : '—'}</Td>
                    {!online && (
                      <Td className="w-[140px]">
                        {r.alive && (
                          <Bar
                            value={r.product ?? Math.min(100, 40 + game.pmf / 2)}
                            color={r.you ? 'var(--color-accent)' : 'var(--color-mut)'}
                          />
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs leading-relaxed text-mut">
            {online
              ? 'Open books: every founder sees everyone’s cash, revenue, and PMF — this is a knife fight under stadium lights, not a mystery novel. Fallen players show their final payout.'
              : 'Rival intel is approximate — the momentum bar reflects their product strength as far as your team can tell. Rivals raise rounds, ship launches, poach your users, and sometimes die. Their obituaries are good for you.'}
          </div>
        </Panel>
      </div>

      {online && hasCapability(game, 'pvpActions') && <PriceWarBanner />}
      {online && hasCapability(game, 'pvpActions') && <PvpOps />}
      {!online && <Acquisitions />}
    </div>
  )
}

/** Only rendered while a war you did not start is running — otherwise there is nothing to decide. */
function PriceWarBanner() {
  const game = useStore((s) => s.game)!
  const concede = useStore((s) => s.concedePriceWar)
  const gate = canConcedePriceWar(game)
  const weeks = game.flags.priceWar ?? 0
  if (weeks <= 0) return null
  const mine = (game.flags.priceWarInitiator ?? 0) === 1
  return (
    <div className="mt-3.5 rounded-2xl border border-warn/40 bg-warn/[0.06] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] leading-snug">
          <b>📉 Price war — {weeks} wk left.</b>{' '}
          {mine ? (
            <span className="text-mut">You started it. Your revenue is cut too, until it runs out.</span>
          ) : (
            <span className="text-mut">
              Your revenue is cut while it runs. Step out and prices go back up — but{' '}
              {Math.round(CONCEDE_USER_SHARE * 100)}% of your customers follow the cheaper option to them.
            </span>
          )}
        </span>
        {gate.ok && (
          <Btn className="shrink-0" onClick={concede}>
            Concede — raise prices back
          </Btn>
        )}
      </div>
    </div>
  )
}

function PvpOps() {
  const game = useStore((s) => s.game)!
  const online = useStore((s) => s.online)!
  const attackPlayer = useStore((s) => s.attackPlayer)
  const buyShield = useStore((s) => s.buyShield)
  const targets = online.players.filter((p) => p.id !== myId() && !p.over)
  if (targets.length === 0) return null
  const gate = canAttack(game)
  const shieldGate = canBuyShield(game)
  const sCost = shieldCost(game)
  const shielded = (game.flags.shield ?? 0) > 0

  return (
    <div className="mt-3.5">
      <Panel title="⚔️ Dirty tricks — hit the other founders">
        <div className="mb-2 text-xs leading-relaxed text-mut">
          This market has one pot of users and no referee. Each operation costs cash, drains your energy, and puts your ops team on a
          5-week cooldown — and everyone in the room will know it was you. Costs rise with your stage: a bigger company swings a bigger,
          pricier bat.
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface2/50 px-3 py-2.5">
          <span className="text-[13px]">
            🛡 <b>Crisis retainer</b>{' '}
            <span className="text-mut">
              — silently deflects the next attack on you. Lasts {SHIELD_WEEKS} weeks; your rivals can&apos;t see it.
            </span>
          </span>
          {shielded ? (
            <span className="rounded-full border border-good/40 bg-good/10 px-3 py-1 text-xs font-bold text-good">
              Active — {game.flags.shield} wk left
            </span>
          ) : (
            <Btn disabled={!shieldGate.ok || game.cash < sCost} title={shieldGate.reason} onClick={buyShield}>
              Retain · {money(sCost)}
            </Btn>
          )}
        </div>
        {!gate.ok && <div className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{gate.reason}</div>}
        {targets.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 py-2.5 last:border-b-0">
            <span className="text-[13px]">
              <b>{p.company}</b> <span className="text-mut">· {num(p.users)} users · wk {p.week}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              {ATTACKS.map((a) => {
                const cost = attackCost(game, a.id)
                return (
                  <Btn
                    key={a.id}
                    disabled={!gate.ok || game.cash < cost}
                    title={`${a.blurb} Costs ${money(cost)}.`}
                    onClick={() => attackPlayer(p.id, a.id)}
                  >
                    {a.emoji} {a.name} · {money(cost)}
                  </Btn>
                )
              })}
            </span>
          </div>
        ))}
      </Panel>
    </div>
  )
}

function Acquisitions() {
  const game = useStore((s) => s.game)!
  const buyRival = useStore((s) => s.buyRival)
  const targets = game.rivals.filter((r) => r.alive)
  if (targets.length === 0) return null
  const val = valuation(game)

  return (
    <div className="mt-3.5">
      <Panel title="Corp dev — buy your rivals">
        <div className="mb-2 text-xs leading-relaxed text-mut">
          Consolidate the market: acquire a living rival and ~70% of their users migrate to you, along with their best features — and
          their bugs. Pay in cash, or in stock (dilution). Weak rivals sell; confident ones leak your offer and gloat. Each deal takes
          ~15 weeks to integrate before the next.
        </div>
        {targets.map((r) => {
          const gate = canAcquire(game, r)
          const price = acquisitionPrice(game, r)
          const stockPct = (price / (val + price)) * 100
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 py-2.5 last:border-b-0">
              <span className="text-[13px]">
                <b>{r.name}</b>{' '}
                <span className="text-mut">
                  · {num(r.users)} users · asking <b className="text-ink tnum">{money(price)}</b>
                </span>
              </span>
              {gate.ok ? (
                <span className="flex gap-2">
                  <Btn variant="primary" disabled={game.cash < price} onClick={() => buyRival(r.id, 'cash')}>
                    Cash {game.cash < price ? '(can’t afford)' : ''}
                  </Btn>
                  <Btn onClick={() => buyRival(r.id, 'stock')}>Stock ({stockPct.toFixed(1)}% dilution)</Btn>
                </span>
              ) : (
                <span className="text-xs text-mut">{gate.reason}</span>
              )}
            </div>
          )
        })}
      </Panel>
    </div>
  )
}
