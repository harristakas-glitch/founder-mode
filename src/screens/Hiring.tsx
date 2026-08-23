import { Search, Send, SlidersHorizontal, Star, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Btn, Disclosure, Meter, NESTED, Panel } from '../components'
import { PersonCard, PersonProfile, SectionLabel, type CardBadge } from '../People'
import { money } from '../format'
import { COORDINATION_FREE_HEADS, coordinationDrag, recruiterFee, runwayAfterHire, weeklyPayroll } from '../game/engine'
import { hasCapability } from '../game/modes'
import {
  ROLE_HELP,
  ROLE_LABEL,
  TARGET_MIX,
  deskCost,
  fitLabel,
  teamFit,
  valueLabel,
  valueRatio,
  type TeamContext,
} from '../game/people'
import type { Candidate, GameState, Role } from '../game/types'
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
    // vertical rhythm belongs to the card's own CTA slot, so no top margin here
    <div className="w-full">
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

// ---------- the roster panel ----------

const ROLES: Role[] = ['engineer', 'designer', 'marketer', 'sales']

/**
 * The hiring sidebar. The owner's mock puts a meta-progression panel here — "Elite Founder Status",
 * perks, capital, network access. This game has no such reward, and shipping a progress bar toward
 * a prize that does not exist is the exact defect the repo already has a name for.
 *
 * So the SHAPE survives and the content is replaced with things the simulation genuinely does:
 * what the payroll costs, which roles this stage's output terms actually reward (TARGET_MIX in
 * game/people.ts, which is the engine's own emphasis written down), and the one threshold that
 * really is a cliff — `COORDINATION_FREE_HEADS`, past which every extra head slows the whole
 * company by 1.5%. That last one is the honest version of "next unlock": it is the next thing that
 * changes, and it is a cost rather than a prize.
 */
function TeamShape({ game }: { game: GameState }) {
  const heads = game.employees.length
  const payroll = weeklyPayroll(game)
  const target = TARGET_MIX[game.stage] ?? TARGET_MIX['Pre-seed']
  const drag = coordinationDrag(game)
  const free = Math.max(0, COORDINATION_FREE_HEADS - heads)
  const desks = game.employees.filter((e) => deskCost(e) > 0).length

  return (
    <Panel className="sticky top-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-accent" aria-hidden />
          <h3 className="text-[15px] font-semibold">Your team</h3>
        </div>
        <span className="rounded-full border border-line2 bg-surface2 px-2 py-[3px] text-[11px] font-bold tnum">
          {heads} {heads === 1 ? 'head' : 'heads'}
        </span>
      </div>

      <div className="mt-3 text-[12.5px] leading-relaxed text-mut">
        Payroll <span className="font-semibold text-ink tnum">{money(payroll)}</span>/wk
        {desks > 0 && (
          <>
            {' · '}
            <span className="tnum">{desks}</span> {desks === 1 ? 'desk' : 'desks'} in the office
          </>
        )}
      </div>

      <div className="mt-4">
        <SectionLabel>Roles this stage rewards</SectionLabel>
        <div className="mt-2 space-y-2">
          {ROLES.map((r) => {
            const have = game.employees.filter((e) => e.role === r).length
            // What the mix wants at THIS headcount, never below one engineer — a company of nobody
            // needs an engineer before it needs a target ratio.
            const want = Math.max(heads === 0 && r === 'engineer' ? 1 : 0, Math.round(target[r] * Math.max(heads, 3)))
            // Three states, not two. A green tick against "0 / ~0" reads as "done" for a role the
            // stage has not asked for yet, which is the opposite of true.
            const state = want === 0 ? 'idle' : have >= want ? 'met' : 'short'
            return (
              <div key={r} className="flex items-center gap-2.5" title={ROLE_HELP[r]}>
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                    state === 'met' ? 'border-good/60 bg-good/20 text-good' : state === 'short' ? 'border-warn/60 text-warn' : 'border-line2 text-mut'
                  }`}
                  aria-hidden
                >
                  {state === 'met' ? '✓' : state === 'short' ? '!' : '·'}
                </span>
                <span className={`flex-1 text-[12.5px] ${state === 'met' ? 'text-ink' : 'text-mut'}`}>{ROLE_LABEL[r]}</span>
                <span className="text-[11.5px] tnum text-mut">
                  {have}
                  <span className="text-mut/60">{want === 0 ? ' · not yet' : ` / ~${want}`}</span>
                </span>
              </div>
            )
          })}
        </div>
        <div className="mt-2 text-[11px] leading-snug text-mut/80">
          The mix each stage rewards, taken from the engine&apos;s own output terms — engineers build, a designer counts triple on customer
          research, sales lifts revenue per customer.
        </div>
      </div>

      <div className="mt-4">
        <SectionLabel>The next thing that changes</SectionLabel>
        <div className={`mt-2 ${NESTED} p-3`}>
          {free > 0 ? (
            <>
              <div className="text-[13px] font-semibold">
                <span className="tnum">{free}</span> more {free === 1 ? 'hire' : 'hires'} before coordination overhead
              </div>
              <div className="mt-1.5">
                <Meter value={(heads / COORDINATION_FREE_HEADS) * 100} tone="good" />
              </div>
              <div className="mt-1.5 text-[11.5px] leading-snug text-mut">
                Past {COORDINATION_FREE_HEADS} people every extra head costs the whole company 1.5% of its output. Headcount is not free, and
                this is where it stops being cheap.
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-warn">
                Coordination drag ×<span className="tnum">{drag.toFixed(3)}</span>
              </div>
              <div className="mt-1.5">
                <Meter value={(1 - drag) * 250} tone="warn" />
              </div>
              <div className="mt-1.5 text-[11.5px] leading-snug text-mut">
                Everyone in the company is {Math.round((1 - drag) * 100)}% slower than they would be at {COORDINATION_FREE_HEADS} heads. The
                next hire has to beat that, not just pay for themselves.
              </div>
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ---------- sorting & filtering ----------

type SortKey = 'fit' | 'skill' | 'salary' | 'expiry'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'fit', label: 'Best match' },
  { id: 'expiry', label: 'Leaving soonest' },
  { id: 'skill', label: 'Most skilled' },
  { id: 'salary', label: 'Cheapest' },
]

export function Hiring() {
  const game = useStore((s) => s.game)!
  const sendOffer = useStore((s) => s.sendOffer)
  // must match sendOffer's own branch exactly — gating the UI on the capability alone let the
  // sealed-bid controls render in a session that would silently take the single-player path
  const online = useStore((st) => st.online)
  const shared = hasCapability(game, 'sharedHiringPool') && !!online

  const [sort, setSort] = useState<SortKey>('fit')
  const [role, setRole] = useState<Role | 'all'>('all')
  const [query, setQuery] = useState('')
  // Shortlisting is pure local UI: a way to mark people while you compare them. It deliberately
  // starts no new hiring round and touches no engine state — the sealed-bid auction and the shared
  // pool stay exactly as `test/hiring-market.test.ts` pins them.
  const [shortlist, setShortlist] = useState<string[]>([])
  const [onlyShortlist, setOnlyShortlist] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const ctx: TeamContext = useMemo(
    () => ({ stage: game.stage, roles: game.employees.map((e) => e.role) }),
    [game.stage, game.employees],
  )

  const pool = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = game.candidates.filter((c) => {
      if (role !== 'all' && c.role !== role) return false
      if (onlyShortlist && !shortlist.includes(c.id)) return false
      if (!q) return true
      return `${c.name} ${c.role} ${ROLE_LABEL[c.role]}`.toLowerCase().includes(q)
    })
    const by: Record<SortKey, (a: Candidate, b: Candidate) => number> = {
      // Deadline first inside every ordering, so a candidate on their last week is never buried:
      // sort is stable, so the pool's own order survives inside each tie.
      fit: (a, b) => teamFit(b, ctx) - teamFit(a, ctx),
      expiry: (a, b) => a.weeksLeft - b.weeksLeft,
      skill: (a, b) => b.skill - a.skill,
      salary: (a, b) => a.salary - b.salary,
    }
    return [...filtered].sort(by[sort])
  }, [game.candidates, role, query, sort, onlyShortlist, shortlist, ctx])

  const openCandidate = game.candidates.find((c) => c.id === open) ?? null

  const badgesFor = (c: Candidate): CardBadge[] => {
    const out: CardBadge[] = []
    if (teamFit(c, ctx) >= 70) out.push({ text: 'Top candidate', tone: 'accent' })
    // Arena refreshes the whole pool every week, so expiry urgency would sit on every card and
    // mean nothing; the shared-market line above says it once instead.
    if (!shared && c.weeksLeft <= 1) out.push({ text: 'Last week', tone: 'warn' })
    const v = valueRatio(c, game.stage)
    if (v >= 1.18) out.push({ text: 'Bargain', tone: 'good' })
    else if (v <= 0.82) out.push({ text: 'Overpriced', tone: 'bad' })
    return out.slice(0, 2)
  }

  const moneyRows = (c: Candidate) => {
    const after = runwayAfterHire(game, c)
    const afterLabel = after === Infinity ? '∞' : `${Math.max(0, Math.floor(after))} wk`
    // Amber is the mock's "tight" band, from 26 weeks down. Red keeps the engine's own cliff:
    // under ~12 weeks candidates start declining, and the card says so in words ("overhiring!"),
    // never in colour alone. Comfortable numbers stay plain — the value is the message.
    const cls = after === Infinity ? '' : after < 12 ? 'font-bold text-bad' : after < 26 ? 'text-warn' : ''
    return (
      <>
        <span className="text-mut">Salary</span>
        <span className="text-right tnum">{money(c.salary)}/yr</span>
        <span className="text-mut">Recruiter fee</span>
        <span className="text-right tnum">{money(recruiterFee(c))}</span>
        <span className="text-mut">Runway after</span>
        <span className={`text-right tnum ${cls}`}>
          {afterLabel}
          {after !== Infinity && after < 12 && ' · overhiring!'}
        </span>
        {!shared && (
          <>
            <span className="text-mut">Leaves the pool in</span>
            <span className={`text-right tnum ${c.weeksLeft <= 2 ? 'font-semibold text-warn' : ''}`}>
              {c.weeksLeft <= 1 && <span aria-hidden>⏳ </span>}
              {c.weeksLeft} wk
            </span>
          </>
        )}
      </>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Build your founding team</h1>
          <div className="mt-0.5 text-[13.5px] text-mut">Every hire shapes what this company can become — and what it costs to run.</div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-mut">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="min-h-[36px] rounded-lg border border-line2 bg-surface2 px-2.5 text-[12.5px] font-semibold text-ink"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Burn, revenue and runway are in the topbar rail on every screen; repeating them here only
          gave the player a second place they could disagree. The one number this screen owes is
          what a given hire does to the runway. */}
      <div className="mt-3 mb-4 text-[13px] leading-relaxed text-mut">
        <b className="text-ink">Team fit</b> weighs how this person&apos;s shape suits <b className="text-ink">{game.stage}</b>, what your
        roster is missing, and how much they lift the people around them. <b className="text-ink">Runway after</b> is what hiring them does to
        your runway — under ~20 weeks is living dangerously, and candidates start declining offers below ~10.
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* Filter row. Role tabs are the game's four real roles, one each — the mock's fifth
              ("Operations") has no role behind it and would filter to an empty grid forever. */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {([['all', 'All candidates'], ...ROLES.map((r) => [r, ROLE_LABEL[r]] as const)] as [Role | 'all', string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setRole(id)}
                  className={`min-h-[36px] rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                    role === id ? 'border-accent bg-accent/15 text-ink' : 'border-line2 bg-surface2 text-mut hover:border-accent hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mut" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or role…"
                aria-label="Search candidates"
                className="min-h-[36px] w-full rounded-full border border-line2 bg-surface2 pr-3 pl-8 text-[12.5px] text-ink placeholder:text-mut/70"
              />
            </div>
            <button
              onClick={() => setOnlyShortlist((v) => !v)}
              aria-pressed={onlyShortlist}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                onlyShortlist ? 'border-warn/60 bg-warn/15 text-warn' : 'border-line2 bg-surface2 text-mut hover:text-ink'
              }`}
            >
              {onlyShortlist ? <Star size={13} fill="currentColor" aria-hidden /> : <SlidersHorizontal size={13} aria-hidden />}
              Shortlist
              {shortlist.length > 0 && <span className="tnum">({shortlist.length})</span>}
            </button>
          </div>

          {pool.length === 0 ? (
            <Panel>
              <div className="text-[13px] text-mut">
                Nobody in the pool matches that. {onlyShortlist ? 'Nothing is shortlisted yet — tap the star on a card.' : 'Try another role or clear the search.'}
              </div>
            </Panel>
          ) : (
            // One list at every width. The desktop table this replaced spent 40 cells on 5 people
            // and put the only number that decides anything — runway after — sixth of eight
            // columns, with "Send offer" off the right edge of a horizontal scroller on a phone.
            <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
              {pool.map((c) => (
                <PersonCard
                  key={c.id}
                  person={c}
                  ctx={ctx}
                  badges={badgesFor(c)}
                  rows={moneyRows(c)}
                  onOpen={() => setOpen(c.id)}
                  shortlisted={shortlist.includes(c.id)}
                  onShortlist={() => setShortlist((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                  actions={
                    shared ? (
                      <BidControl candidateId={c.id} />
                    ) : (
                      <>
                        <Btn className="flex-1" onClick={() => setOpen(c.id)}>
                          Profile
                        </Btn>
                        <Btn variant="primary" className="flex-1" onClick={() => sendOffer(c.id)}>
                          <Send size={15} aria-hidden />
                          Send offer
                        </Btn>
                      </>
                    )
                  }
                />
              ))}
            </div>
          )}

          <div className="mt-4 text-center text-[12px] text-mut">
            Showing <span className="tnum">{pool.length}</span> of <span className="tnum">{game.candidates.length}</span>{' '}
            {game.candidates.length === 1 ? 'candidate' : 'candidates'} in the pool
            {shortlist.length > 0 && <> · {shortlist.length} shortlisted</>}
          </div>
          <div className="mt-1 text-center text-[11.5px] text-mut/70">
            Tip: shortlist people to hold them side by side. The pool turns over — everyone leaves eventually.
          </div>
        </div>

        <div className="min-w-0">
          <TeamShape game={game} />
        </div>
      </div>

      {openCandidate && (
        <PersonProfile
          person={openCandidate}
          ctx={ctx}
          onClose={() => setOpen(null)}
          status={
            <>
              <b className="text-ink">{fitLabel(teamFit(openCandidate, ctx))}.</b> Asking {money(openCandidate.salary)}/yr —{' '}
              {valueLabel(valueRatio(openCandidate, game.stage)).toLowerCase()} for the output. A {money(recruiterFee(openCandidate))}{' '}
              recruiter fee lands the week they start, and they serve {openCandidate.notice} week
              {openCandidate.notice === 1 ? '' : 's'} of notice first.
            </>
          }
          actions={
            shared ? (
              <div className="w-full max-w-[280px]">
                <BidControl candidateId={openCandidate.id} />
              </div>
            ) : (
              <Btn
                variant="primary"
                onClick={() => {
                  sendOffer(openCandidate.id)
                  setOpen(null)
                }}
              >
                <Send size={15} aria-hidden />
                Send offer
              </Btn>
            )
          }
        />
      )}
    </div>
  )
}
