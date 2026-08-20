import { useState } from 'react'
import { Btn, Disclosure, Panel, SkillDots, TraitChip } from '../components'
import { money } from '../format'
import { recruiterFee, runwayAfterHire } from '../game/engine'
import { hasCapability } from '../game/modes'
import { myId } from '../net/online'
import { useStore } from '../store'

const PREMIUMS = [0, 10, 25, 50]

/**
 * Arena's contested hire. The pool is the whole room's, so an offer is a sealed bid: you pick a
 * premium over asking without seeing anyone else's number, and the candidate chooses at the end of
 * the round on money, reputation and runway. Deliberately not a click race — that would reward
 * reflexes and latency instead of judgement.
 */
function BidControl({ candidateId }: { candidateId: string }) {
  const sendOffer = useStore((s) => s.sendOffer)
  const online = useStore((s) => s.online)
  const [premium, setPremium] = useState(0)
  const commits = online?.commits ?? []
  const here = commits.filter((c) => c.candidateId === candidateId)
  const mine = here.find((c) => c.playerId === myId())
  const rivals = here.filter((c) => c.playerId !== myId())
  // one target per round: a commitment on someone else locks out the rest of the market
  const elsewhere = commits.find((c) => c.playerId === myId() && c.candidateId !== candidateId)
  const locked = !!mine || !!elsewhere

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {PREMIUMS.map((p) => (
          <button
            key={p}
            disabled={locked}
            onClick={() => setPremium(p)}
            className={`rounded-lg border px-2 py-1 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
              premium === p ? 'border-accent bg-accent/15 text-ink' : 'border-line2 text-mut hover:border-accent hover:text-ink'
            }`}
          >
            {p === 0 ? 'Asking' : `+${p}%`}
          </button>
        ))}
      </div>
      <Btn variant="primary" className="mt-2 w-full" disabled={locked} onClick={() => sendOffer(candidateId, premium)}>
        {mine ? 'Offer sealed' : elsewhere ? 'Courting someone else' : 'Seal offer'}
      </Btn>
      <div className="mt-1 text-[11.5px] leading-snug text-mut">
        {rivals.length > 0 ? (
          <span className="text-warn">
            ⚔ {rivals.map((r) => r.company).join(', ')} also bidding — {rivals.length === 1 ? 'their number is' : 'their numbers are'} sealed
          </span>
        ) : mine ? (
          'Sealed. Opens when you lock in your week.'
        ) : elsewhere ? (
          'One target per round — you have already committed elsewhere.'
        ) : (
          'Bid blind. They weigh money against your reputation and runway.'
        )}
      </div>
    </div>
  )
}

const ROLE_HELP: Record<string, string> = {
  engineer: 'Builds features, improves quality, fixes bugs, does research',
  designer: 'Boosts product quality and user research',
  marketer: 'Amplifies marketing spend into hype',
  sales: 'Increases revenue per user',
}

export function Hiring() {
  const game = useStore((s) => s.game)!
  const sendOffer = useStore((s) => s.sendOffer)
  // must match sendOffer's own branch exactly — gating the UI on the capability alone let the
  // sealed-bid controls render in a session that would silently take the single-player path
  const online = useStore((st) => st.online)
  const shared = hasCapability(game, 'sharedHiringPool') && !!online

  // Deadline first. A candidate on their last week is a decision that expires, and until now the
  // only sign of it was an unsorted grey column at the right-hand end of a wide table. Sort is
  // stable, so the pool's own order survives inside each expiry group.
  const pool = [...game.candidates].sort((a, b) => a.weeksLeft - b.weeksLeft)

  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-[28px] font-normal leading-none tracking-normal">Hiring</h1>
      {/* Burn, revenue and runway are in the topbar rail on every screen; repeating them here only
          gave the player a second place they could disagree. The one number this screen owes is
          what a given hire does to the runway. */}
      <div className="mb-4 text-[13px] leading-relaxed text-mut">
        <b className="text-ink">Runway after</b> is what hiring that person does to your runway — under ~20 weeks is living
        dangerously, and candidates start declining offers below ~10.
      </div>

      {shared && (
        // The rules of the shared market are worth one sentence up front and a paragraph on
        // demand. What is gone entirely is how the bid is transported: whether a number travels
        // as a hash is not a decision the player makes on a hiring screen.
        <Disclosure
          label="One market, every founder — sealed offers, one candidate per round"
          className="mb-3.5 rounded-2xl border border-accent/30 bg-accent/[0.05] px-4 py-3 text-[13px] leading-relaxed"
        >
          <div className="mt-2 text-mut">
            These five people are the same five your rivals are looking at, and the whole pool is replaced next week. Choose a premium
            over asking without seeing anyone else&apos;s number, and at the end of the round the candidate picks — weighing the money
            against your reputation and how safe your runway looks. Winning a contested hire means paying over the odds, or being
            somewhere worth joining.
          </div>
        </Disclosure>
      )}

      {(game.offersOut.length > 0 || game.pendingHires.length > 0) && (
        <div className="mb-3.5 grid gap-5 md:grid-cols-2">
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

      {/* One list at every width. The desktop table this replaces spent 40 cells on 5 people and
          put the only number that decides anything — runway after — sixth of eight columns, with
          "Send offer" off the right edge of a horizontal scroller on a phone. Two implementations
          of one decision rule had already begun copying each other. */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {pool.map((c) => {
          const after = runwayAfterHire(game, c)
          const afterLabel = after === Infinity ? '∞' : `${Math.max(0, Math.floor(after))} wk`
          const cls = after === Infinity ? 'text-good' : after < 12 ? 'text-bad font-bold' : after < 20 ? 'text-warn' : 'text-good'
          // Arena refreshes the whole pool every week, so every card would carry this badge and it
          // would mean nothing; the shared-market line above says it once instead.
          const lastWeek = !shared && c.weeksLeft <= 1
          return (
            <Panel key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">
                    {c.name}
                    <TraitChip trait={c.trait} />
                  </div>
                  <div className="text-[12px] text-mut">
                    {c.role} · {ROLE_HELP[c.role]}
                  </div>
                </div>
                <SkillDots skill={c.skill} />
              </div>
              {lastWeek && (
                <div className="mt-2.5 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px] font-semibold text-warn">
                  ⏳ Last week in the pool — gone when you end the week
                </div>
              )}
              <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <span className="text-mut">Salary</span>
                <span className="text-right tnum">{money(c.salary)}/yr</span>
                <span className="text-mut">Recruiter fee</span>
                <span className="text-right tnum">{money(recruiterFee(c))}</span>
                <span className="text-mut">Runway after</span>
                <span className={`text-right tnum ${cls}`}>
                  {afterLabel}
                  {after !== Infinity && after < 12 && ' · overhiring!'}
                </span>
                {!lastWeek && (
                  <>
                    <span className="text-mut">Leaves the pool in</span>
                    <span className="text-right tnum">{c.weeksLeft} wk</span>
                  </>
                )}
              </div>
              {shared ? (
                <BidControl candidateId={c.id} />
              ) : (
                <Btn variant="primary" className="mt-3 w-full" onClick={() => sendOffer(c.id)}>
                  Send offer
                </Btn>
              )}
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
