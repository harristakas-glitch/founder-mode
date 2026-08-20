import { AlertTriangle, Building2, Clock, DollarSign, Gauge, Shield, Users as UsersIcon } from 'lucide-react'
import { Btn, Disclosure, NESTED, Panel, RAISED, StatCard } from '../components'
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
  hostileRivals,
  raidMagnitude,
  rivalMarketShare,
  rivalRaidLeverage,
  rivalStance,
  rivalValuation,
  shieldCost,
  valuation,
  type RivalStance,
} from '../game/engine'
import { CONCEDE_USER_SHARE } from '../game/pvp'
import { hasCapability } from '../game/modes'
import { hasForfeited, myId } from '../net/online'
import { useStore } from '../store'

// Context that is one interaction away rather than deleted goes behind the shared <Disclosure>
// (components.tsx) — the one toggle the platform already makes keyboard-reachable and already
// announces as expanded/collapsed.

// Duration / cost / count read as small bordered chips, not prose — the same fact-chip constant
// Discovery's experiment catalogue established.
const CHIP = 'inline-flex items-center gap-1 rounded-md border border-line/70 bg-surface2 px-2 py-0.5 text-[11.5px] font-semibold text-mut tnum'

// The cost tag INSIDE an attack button: same bordered-pill shape, no background of its own —
// it sits on the button's surface2 and a plane never repeats.
const BTN_CHIP = 'rounded-md border border-line/70 px-1.5 py-px text-[11px] font-semibold text-mut tnum'

/**
 * What a rival's posture looks like on the board.
 *
 * The whole fairness case for AI rivals using the attack layer rests on this being visible BEFORE
 * the attack: `rivalAggressionStep` also gives one week of public notice in the inbox, but a
 * message scrolls away and a badge does not. `title` carries `stance.why` — the same sentence the
 * attack itself will lead with, so the warning and the blow give one account of one decision.
 * There is no hover on a touch screen, so the sentence is also printed under the row itself.
 */
const STANCE_STYLE: Record<string, string> = {
  calm: 'border-line/60 text-mut',
  watching: 'border-line text-mut',
  hostile: 'border-bad/50 bg-bad/10 text-bad',
  cornered: 'border-warn/50 bg-warn/10 text-warn',
}

function StanceBadge({ stance }: { stance: RivalStance }) {
  return (
    <span
      title={stance.why}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${STANCE_STYLE[stance.id] ?? STANCE_STYLE.calm}`}
    >
      {stance.attack ? '⚠ ' : ''}
      {stance.label}
    </span>
  )
}

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
          val: isMe ? valuation(game) : p.over ? p.payout : p.val,
          alive: isMe ? !game.gameOver : !p.over,
          you: isMe,
          cash: isMe ? game.cash : p.cash,
          rev: isMe ? game.lastRevenue : p.rev,
          pmf: isMe ? game.pmf : p.pmf,
          // still in the match, just not visible on the wire this instant
          absent: !isMe && !!p.absent && !hasForfeited(p),
          gone: !isMe && hasForfeited(p),
          stance: null as RivalStance | null, // human founders announce themselves by attacking
        }
      })
    : [
        {
          id: 'you',
          name: `${game.companyName} (you)`,
          users: game.users,
          stage: game.stage as string,
          val: valuation(game),
          alive: true,
          you: true,
          cash: undefined as number | undefined,
          rev: undefined as number | undefined,
          pmf: undefined as number | undefined,
          absent: false,
          gone: false,
          stance: null as RivalStance | null,
        },
      ]

  const rows = [
    ...playerRows,
    ...game.rivals.map((r) => ({
      id: r.id,
      name: r.name,
      users: r.users,
      stage: STAGES[r.stage] as string,
      val: rivalValuation(r, game),
      alive: r.alive,
      you: false,
      cash: undefined as number | undefined,
      rev: undefined as number | undefined,
      pmf: undefined as number | undefined,
      absent: false,
      gone: false,
      // The same function the simulation acts on, not a second reading of it. If the table says
      // Hostile, a strike is what the engine is about to roll for; if it says Watching, it is not.
      stance: r.alive ? rivalStance(game, r) : null,
    })),
  ].sort((a, b) => Number(b.alive) - Number(a.alive) || b.users - a.users)

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Market</h1>
      <div className="mb-4 text-[13px] text-mut">
        {sector.name} · addressable market ≈ {num(effectiveTam(game))} users (and growing) · winners take most
      </div>

      {/* A running price war takes a cut of revenue every single week and has a deadline attached,
          so it opens the screen. It used to sit under the leaderboard, three panels down, which is
          below the fold on every phone — the one thing here with a clock was the last thing seen. */}
      {hasCapability(game, 'pvpActions') || hasCapability(game, 'rivalAggression') ? <PriceWarBanner /> : null}

      <div className="mt-3.5 grid gap-3.5 md:grid-cols-2">
        <StatCard
          label="Market saturation"
          icon={<Gauge size={13} />}
          value={pct(saturation, 1)}
          delta={saturation > 0.5 ? 'Growth gets harder as the market fills up' : 'Plenty of greenfield left'}
          tone={saturation > 0.5 ? 'down' : 'up'}
        />
        <StatCard
          label="Your market share"
          icon={<UsersIcon size={13} />}
          value={pct(
            game.users /
              Math.max(1, game.users + otherPlayersUsers + game.rivals.filter((r) => r.alive).reduce((a, r) => a + r.users, 0)),
            1,
          )}
          delta={online ? 'share of captured users, vs the other founders' : 'share of captured users, vs living rivals'}
        />
      </div>

      {/* The segment table used to be rendered here too, under a second title. Discovery owns it —
          it is the scoreboard that screen is built around, and one table cannot be two screens'. */}

      <div className="mt-3.5">
        <Panel title="Leaderboard">
          {/* One list at every width — the same trade Hiring made. The desktop table kept valuation
              and posture in the far-right columns, which is exactly where a phone's horizontal
              scroller hides them, so phones grew a second card implementation of the same rows.
              One row grammar now serves both: rank in a nested tile, name with its stage and
              posture chips, then the two numbers the board exists to compare. */}
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={`rounded-lg border px-3 py-2.5 ${
                  // your own row rides on plane 3, the grammar the Arena standings card already uses
                  r.you ? 'border-line2 bg-surface3' : !r.alive ? 'border-transparent opacity-40' : 'border-transparent'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className={`${NESTED} flex h-9 w-9 shrink-0 items-center justify-center text-[13px] font-bold tnum ${r.you ? '' : 'text-mut'}`}>
                    {r.alive ? i + 1 : '☠️'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                      <b>{r.name}</b>
                      {r.alive && <span className={CHIP}>{r.stage}</span>}
                      {r.stance && r.stance.id !== 'calm' && <StanceBadge stance={r.stance} />}
                      {!r.alive && <span className="text-[12px] text-mut">shut down</span>}
                      {r.alive && r.gone && <span className="text-[12px] text-mut">left the match</span>}
                      {r.alive && r.absent && (
                        <span
                          className="text-[12px] text-warn"
                          title="We've lost their connection. They're still in the match and still hold their users."
                        >
                          reconnecting
                        </span>
                      )}
                    </div>
                    {online && r.alive && r.cash != null && (
                      <div className="mt-0.5 text-[12px] text-mut tnum">
                        cash {money(r.cash)} · rev {r.rev != null ? money(r.rev) : '—'}/wk · PMF {r.pmf != null ? Math.round(r.pmf) : '—'}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-4 text-right">
                    <div className="min-w-[56px]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-mut">Users</div>
                      <div className="text-[13px] font-semibold tnum">{num(r.users)}</div>
                    </div>
                    <div className="min-w-[76px]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-mut">Est. valuation</div>
                      <div className="text-[13px] font-bold tnum">{r.alive || r.val > 0 ? money(r.val) : '—'}</div>
                    </div>
                  </div>
                </div>
                {/* the warning in words, at every width — hover carries nothing on a phone */}
                {r.stance && r.stance.id !== 'calm' && (
                  <div className="mt-1 pl-12 text-[12px] leading-snug text-mut">{r.stance.why}</div>
                )}
              </div>
            ))}
          </div>
          <Disclosure label="How to read the board">
            {online
              ? 'Open books: every founder sees everyone’s cash, revenue, and PMF — this is a knife fight under stadium lights, not a mystery novel. Fallen players show their final payout.'
              : hasCapability(game, 'rivalAggression')
                ? 'Posture is read off the same market position, growth and funding gap the rivals themselves act on, so Hostile means a move is coming and Watching means it is not. Rivals raise rounds, ship launches, come for your users and your people, and sometimes die. Their obituaries are good for you.'
                : 'Rivals raise rounds, ship launches, poach your users, and sometimes die. Their obituaries are good for you.'}
          </Disclosure>
        </Panel>
      </div>

      {online && hasCapability(game, 'pvpActions') && <PvpOps />}
      {!online && hasCapability(game, 'rivalAggression') && <RivalOps />}
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
    // The iconed-banner grammar Growth's churn banner set: nested icon tile, small-caps label,
    // the one big tnum figure — here the countdown, because the clock is what makes this a banner.
    <div className="mt-3.5">
      <Panel className="border-warn/60">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div className={`${NESTED} flex h-11 w-11 shrink-0 items-center justify-center`}>
              <AlertTriangle size={20} className="text-warn" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mut">Price war</div>
              <div className="mt-1 text-[34px] leading-[1.05] font-bold tracking-[-0.02em] text-warn tnum">{weeks} wk</div>
              <div className="mt-1.5 text-[13px] leading-snug text-mut">
                {mine
                  ? 'left to run. You started it — your revenue is cut too, until it runs out.'
                  : `left to run. Your revenue is cut every week it lasts. Step out and prices go back up — but ${Math.round(CONCEDE_USER_SHARE * 100)}% of your customers follow the cheaper option to them.`}
              </div>
            </div>
          </div>
          {/* Primary, not default: this is a decision with a countdown on it, and it was previously
              styled identically to the twenty-odd attack buttons further down the page. */}
          {gate.ok && (
            <Btn variant="primary" className="shrink-0" onClick={concede}>
              Concede — raise prices back
            </Btn>
          )}
        </div>
      </Panel>
    </div>
  )
}

/**
 * The defensive control, given its own block at the top of whichever ops panel is showing.
 *
 * It has to be bought BEFORE the week an attack lands, which makes it the only thing in the panel
 * with a deadline — and it used to be a default-styled button under a paragraph, below five rows
 * of offensive buttons. Its unavailability reason was in a `title`, which is to say nowhere at all
 * on a phone; it is printed now.
 */
function CrisisRetainer({ blurb }: { blurb: string }) {
  const game = useStore((s) => s.game)!
  const buyShield = useStore((s) => s.buyShield)
  const gate = canBuyShield(game)
  const cost = shieldCost(game)
  const shielded = (game.flags.shield ?? 0) > 0
  const broke = game.cash < cost

  return (
    <div className={`mb-3 ${NESTED} px-3.5 py-3`}>
      <div className="flex flex-wrap items-center gap-3">
        {/* The strip itself is plane 2, so its icon tile steps up to plane 3 — adjacent planes only. */}
        <div className={`${RAISED} flex h-10 w-10 shrink-0 items-center justify-center`}>
          <Shield size={20} className="text-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">Crisis retainer</div>
          <div className="mt-0.5 text-[12px] leading-snug text-mut">{blurb}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={CHIP}>
              <Clock size={16} aria-hidden="true" /> {SHIELD_WEEKS} wk
            </span>
            <span className={CHIP}>
              {/* money() already prints the $, the icon replaces it */}
              <DollarSign size={16} aria-hidden="true" /> {money(cost).replace('$', '')}
            </span>
          </div>
        </div>
        {shielded ? (
          <span className="shrink-0 rounded-full border border-good/40 bg-good/10 px-3 py-1 text-xs font-bold text-good">
            Active — {game.flags.shield} wk left
          </span>
        ) : (
          <Btn variant="primary" className="shrink-0" disabled={!gate.ok || broke} onClick={buyShield}>
            Retain
          </Btn>
        )}
      </div>
      {!shielded && (!gate.ok || broke) && (
        <div className="mt-2 text-[12px] leading-snug text-warn">
          {gate.reason ?? `You have ${money(game.cash)} — the retainer costs ${money(cost)}.`}
        </div>
      )}
    </div>
  )
}

/**
 * What the five operations actually do, printed once on the face of the panel.
 *
 * This text used to live in a `title` on every attack button — five operations against every
 * target, ten hidden copies of a sentence a touch device cannot reach at all. The blurb describes
 * the OPERATION and never the target, so one rendering says everything ten tooltips said.
 */
function AttackLegend() {
  return (
    <div className={`mb-2.5 grid gap-1.5 ${NESTED} px-3.5 py-3`}>
      {ATTACKS.map((a) => (
        <div key={a.id} className="text-[12px] leading-snug text-mut">
          <b className="text-ink">
            {a.emoji} {a.name}
          </b>{' '}
          — {a.blurb}
        </div>
      ))}
    </div>
  )
}

function PvpOps() {
  const game = useStore((s) => s.game)!
  const online = useStore((s) => s.online)!
  const attackPlayer = useStore((s) => s.attackPlayer)
  const targets = online.players.filter((p) => p.id !== myId() && !p.over)
  if (targets.length === 0) return null
  const gate = canAttack(game)

  return (
    <div className="mt-3.5">
      <Panel title="Dirty tricks — hit the other founders">
        <CrisisRetainer blurb="silently deflects the next attack on you — your rivals can’t see it." />
        <div className="mb-2.5 text-xs leading-relaxed text-mut">
          This market has one pot of users and no referee. Each operation costs cash, drains your energy, and puts your ops team on a
          5-week cooldown — and everyone in the room will know it was you. Costs rise with your stage: a bigger company swings a bigger,
          pricier bat.
        </div>
        {!gate.ok && <div className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{gate.reason}</div>}
        <AttackLegend />
        {targets.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 py-2.5 last:border-b-0">
            <span className="text-[13px]">
              <b>{p.company}</b> <span className="text-mut">· {num(p.users)} users · wk {p.week}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              {ATTACKS.map((a) => {
                const cost = attackCost(game, a.id)
                return (
                  <Btn key={a.id} disabled={!gate.ok || game.cash < cost} onClick={() => attackPlayer(p.id, a.id)}>
                    {a.emoji} {a.name}
                    <span className={BTN_CHIP}>{money(cost)}</span>
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

/**
 * The single-player answer to rivals who attack: the same retainer and the same five operations
 * Arena has, pointed at AI companies. It exists because the alternative is an attack the player
 * can watch coming and do nothing about, which is noise rather than difficulty.
 *
 * The threat line is quantified deliberately. `raidMagnitude × rivalRaidLeverage` is the exact
 * expression `rivalAggressionStep` will evaluate, so the number shown is the number that lands —
 * "they could take ~340 of your users" is a decision, "they are hostile" is a mood.
 */
function RivalOps() {
  const game = useStore((s) => s.game)!
  const attackRival = useStore((s) => s.attackRival)
  const targets = game.rivals.filter((r) => r.alive)
  if (targets.length === 0) return null
  const gate = canAttack(game)
  const threats = hostileRivals(game)

  return (
    <div className="mt-3.5">
      <Panel title="Competitive response">
        {/* Threat, then the one control that answers it, then everything else. */}
        {threats.length > 0 && (
          <div className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
            <b>{threats.map((r) => r.name).join(', ')}</b> {threats.length === 1 ? 'is' : 'are'} coming for you.{' '}
            {threats
              .filter((r) => rivalStance(game, r).attack === 'raid')
              .map((r) => `${r.name} could take ~${num(Math.round(raidMagnitude(game.users) * rivalRaidLeverage(rivalMarketShare(game, r))))} of your users in one campaign.`)
              .join(' ')}
          </div>
        )}
        <CrisisRetainer blurb="silently deflects EVERY attack on you while it runs — your rivals can’t see it." />
        <div className="mb-2.5 text-xs leading-relaxed text-mut">
          Rivals in this market act on what they can see: how much of the market they hold, how fast you are growing, who out-raised
          whom. A rival that turns on you is flagged <b>Hostile</b> or <b>Cornered</b> in the table above a full week before their first
          move — that week is the one to spend the retainer in. Every operation here costs cash, drains your energy, and puts your ops
          team on a 5-week cooldown.
        </div>
        {!gate.ok && <div className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{gate.reason}</div>}
        <AttackLegend />
        {targets.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 py-2.5 last:border-b-0">
            <span className="text-[13px]">
              <b>{r.name}</b> <span className="text-mut">· {num(r.users)} users · {pct(rivalMarketShare(game, r), 1)} of the market</span>
            </span>
            <span className="flex flex-wrap gap-2">
              {ATTACKS.map((a) => {
                const cost = attackCost(game, a.id)
                return (
                  <Btn key={a.id} disabled={!gate.ok || game.cash < cost} onClick={() => attackRival(r.id, a.id)}>
                    {a.emoji} {a.name}
                    <span className={BTN_CHIP}>{money(cost)}</span>
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
        {targets.map((r) => {
          const gate = canAcquire(game, r)
          const price = acquisitionPrice(game, r)
          const stockPct = (price / (val + price)) * 100
          return (
            // The icon-tile row grammar from Discovery's catalogue: tile, name over its fact
            // chips, then the actions — the cash offer is the primary one per row.
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line/40 py-3 last:border-b-0">
              <div className={`${NESTED} flex h-10 w-10 shrink-0 items-center justify-center`}>
                <Building2 size={20} className="text-accent" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 text-[13px]">
                <b>{r.name}</b>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={CHIP}>
                    <UsersIcon size={16} aria-hidden="true" /> {num(r.users)}
                  </span>
                  <span className={CHIP}>
                    {/* money() already prints the $, the icon replaces it */}
                    <DollarSign size={16} aria-hidden="true" /> {money(price).replace('$', '')} ask
                  </span>
                </div>
              </div>
              {gate.ok ? (
                <span className="flex flex-wrap gap-2">
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
        <Disclosure label="What an acquisition actually does">
          Acquire a living rival and ~70% of their users migrate to you, along with their best features — and their bugs. Pay in cash,
          or in stock (dilution). Weak rivals sell; confident ones leak your offer and gloat. Each deal takes ~15 weeks to integrate
          before the next.
        </Disclosure>
      </Panel>
    </div>
  )
}
