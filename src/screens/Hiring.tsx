import { useState } from 'react'
import { Btn, Panel, SkillDots, Td, Th, TraitChip } from '../components'
import { money } from '../format'
import { recruiterFee, runwayAfterHire, runwayWeeks, weeklyBurn } from '../game/engine'
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
  const bids = online?.bids.filter((b) => b.candidateId === candidateId) ?? []
  const mine = bids.find((b) => b.playerId === myId())
  const rivals = bids.filter((b) => b.playerId !== myId()).length

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {PREMIUMS.map((p) => (
          <button
            key={p}
            disabled={!!mine}
            onClick={() => setPremium(p)}
            className={`rounded-lg border px-2 py-1 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
              premium === p ? 'border-accent bg-accent/15 text-ink' : 'border-line2 text-mut hover:border-accent hover:text-ink'
            }`}
          >
            {p === 0 ? 'Asking' : `+${p}%`}
          </button>
        ))}
      </div>
      <Btn variant="primary" className="mt-2 w-full" disabled={!!mine} onClick={() => sendOffer(candidateId, premium)}>
        {mine ? `Offer in at ${mine.premiumPct === 0 ? 'asking' : `+${mine.premiumPct}%`}` : 'Make sealed offer'}
      </Btn>
      <div className="mt-1 text-[11.5px] leading-snug text-mut">
        {rivals > 0 ? (
          <span className="text-warn">
            ⚔ {rivals} rival{rivals === 1 ? '' : 's'} also bidding — amount hidden
          </span>
        ) : mine ? (
          'No rivals on them yet. They answer when the round ends.'
        ) : (
          'Bid blind. They weigh the money against your reputation and runway.'
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
  const runway = runwayWeeks(game)
  // must match sendOffer's own branch exactly — gating the UI on the capability alone let the
  // sealed-bid controls render in a session that would silently take the single-player path
  const online = useStore((st) => st.online)
  const shared = hasCapability(game, 'sharedHiringPool') && !!online

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Hiring</h1>
      <div className="mb-4 text-[13px] leading-relaxed text-mut">
        Burn {money(weeklyBurn(game))}/wk · revenue {money(game.lastRevenue)}/wk · runway{' '}
        {runway === Infinity ? '∞' : `${Math.floor(runway)} wk`}. The <b className="text-ink">runway after</b> column shows what hiring
        that person does to it — under ~20 weeks is living dangerously, and candidates start declining offers below ~10.
      </div>

      {shared && (
        <div className="mb-3.5 rounded-2xl border border-accent/30 bg-accent/[0.05] px-4 py-3 text-[13px] leading-relaxed">
          <b>One market, every founder.</b> These five people are the same five your rivals are looking at, and the whole pool is
          replaced next week. Offers are <b>sealed</b>: choose a premium over asking without seeing anyone else&apos;s number, and at
          the end of the round the candidate picks — weighing the money against your reputation and how safe your runway looks. Winning
          a contested hire means paying over the odds, or being somewhere worth joining.
        </div>
      )}

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

      {/* Phones get cards: in a horizontally scrolling table the "Send offer" button sits
          off-screen, so the primary action of the screen is unreachable without noticing
          you can swipe sideways. */}
      <div className="space-y-2.5 md:hidden">
        {game.candidates.map((c) => {
          const after = runwayAfterHire(game, c)
          const afterLabel = after === Infinity ? '∞' : `${Math.max(0, Math.floor(after))} wk`
          const cls = after === Infinity ? 'text-good' : after < 12 ? 'text-bad font-bold' : after < 20 ? 'text-warn' : 'text-good'
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
                <span className="text-mut">Leaves the pool in</span>
                <span className="text-right tnum">{c.weeksLeft} wk</span>
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

      <Panel className="hidden md:block">
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
                      {shared ? (
                        <div className="min-w-[210px]">
                          <BidControl candidateId={c.id} />
                        </div>
                      ) : (
                        <Btn variant="primary" onClick={() => sendOffer(c.id)}>
                          Send offer
                        </Btn>
                      )}
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
