// Hiring — "Find the right people to build your future." (owner brief + mockups, 2026-08-24).
//
// Desktop is a browsing experience: compact candidate CARDS under a KPI strip, with a right rail
// that reads the recruiting picture (Hiring Insights, Talent Pool Health) and ties it back to the
// org (Team Health). Mobile is a LIST — scanability over personality — with a small insights card
// up top. The game does the ranking (fit-sorted by default); secondary controls live behind one
// Filters button. Every number is an engine read: fit from the people model, costs from the
// salary ledger, runway impact from runwayAfterHire, acceptance odds from the same function the
// weekly tick rolls. Arena's sealed-bid market keeps its exact controls and copy.

import { ChevronRight, Search, Send, SlidersHorizontal, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Btn, Disclosure, Meter, Panel } from '../components'
import { PersonCard, PersonProfile, SectionLabel, type CardBadge } from '../People'
import { Portrait } from '../Portrait'
import { money } from '../format'
import {
  COORDINATION_FREE_HEADS,
  coordinationDrag,
  offerAcceptChance,
  recruiterFee,
  runwayAfterHire,
  runwayWeeks,
  weeklyPayroll,
} from '../game/engine'
import { hasCapability } from '../game/modes'
import { ROLE_LABEL, fitTone, impactSummary, teamFit, title, type TeamContext } from '../game/people'
import type { Candidate, GameState, Role } from '../game/types'
import { myId } from '../net/online'
import { useStore } from '../store'
import { KpiStrip, fitTier, openRoles, roleNeeds, teamHealth, teamNudge, teamRunwayImpact, weeklyMoney } from './people-shared'

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

// ---------- right rail ----------

const ROLES: Role[] = ['engineer', 'designer', 'marketer', 'sales']

/** HIRING INSIGHTS — the recruiting picture, read like a smart people advisor (brief §6E). */
function HiringInsights({ game, ctx }: { game: GameState; ctx: TeamContext }) {
  const needs = roleNeeds(game).filter((n) => n.want - n.have > 0)
  const priority = [...needs].sort((a, b) => b.want - b.have - (a.want - a.have))[0]
  const best = [...game.candidates].sort((a, b) => teamFit(b, ctx) - teamFit(a, ctx))[0]
  const runwayNow = Math.min(999, runwayWeeks(game))
  const accept =
    game.candidates.length > 0
      ? game.candidates.reduce((a, c) => a + offerAcceptChance(game, c, runwayNow), 0) / game.candidates.length
      : 0
  const heads = game.employees.length
  const free = Math.max(0, COORDINATION_FREE_HEADS - heads)
  const drag = coordinationDrag(game)

  return (
    <Panel>
      <SectionLabel>Hiring insights</SectionLabel>
      <div className="mt-2 space-y-2.5">
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="text-mut">Top priority role</span>
          <span className="font-bold">{priority ? `${ROLE_LABEL[priority.role]}` : 'Covered'}</span>
        </div>
        {priority && (
          <div className="-mt-1.5 text-right text-[10.5px] text-mut">
            {priority.want - priority.have} open — the {game.stage} output mix wants more
          </div>
        )}
        {best && (
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="text-mut">Best fit this week</span>
            <span className="truncate font-bold">
              {best.name.split(' ')[0]} <span className={`tnum ${fitTone(teamFit(best, ctx)) === 'good' ? 'text-good' : 'text-warn'}`}>{teamFit(best, ctx)}%</span>
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="text-mut">Offer acceptance</span>
          <span className={`font-bold tnum ${accept >= 0.7 ? 'text-good' : accept >= 0.45 ? 'text-warn' : 'text-bad'}`}>
            ~{Math.round(accept * 100)}%
          </span>
        </div>
        <div className="-mt-1.5 text-right text-[10.5px] text-mut">
          {runwayNow < 12 ? 'a thin runway scares candidates off' : 'odds the pool says yes at asking'}
        </div>
        <div className="border-t border-line/60 pt-2.5">
          {free > 0 ? (
            <>
              <div className="text-[12.5px] font-semibold">
                <span className="tnum">{free}</span> more {free === 1 ? 'hire' : 'hires'} before coordination overhead
              </div>
              <div className="mt-1.5">
                <Meter value={(heads / COORDINATION_FREE_HEADS) * 100} tone="good" />
              </div>
            </>
          ) : (
            <>
              <div className="text-[12.5px] font-semibold text-warn">
                Coordination drag ×<span className="tnum">{drag.toFixed(3)}</span>
              </div>
              <div className="mt-1 text-[10.5px] leading-snug text-mut">
                Everyone is {Math.round((1 - drag) * 100)}% slower past {COORDINATION_FREE_HEADS} heads — the next hire has to beat that.
              </div>
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}

/** TALENT POOL HEALTH — the mockup's tier histogram, over the real pool. */
function TalentPoolHealth({ game, ctx }: { game: GameState; ctx: TeamContext }) {
  const tiers = [
    { label: 'Strong fit', dot: 'bg-good', n: game.candidates.filter((c) => teamFit(c, ctx) >= 62).length },
    { label: 'Good fit', dot: 'bg-accent', n: game.candidates.filter((c) => { const f = teamFit(c, ctx); return f >= 46 && f < 62 }).length },
    { label: 'Risky', dot: 'bg-warn', n: game.candidates.filter((c) => teamFit(c, ctx) < 46).length },
  ]
  return (
    <Panel className="mt-3.5">
      <SectionLabel>Talent pool health</SectionLabel>
      <div className="mt-2 space-y-1.5">
        {tiers.map((t) => (
          <div key={t.label} className="flex items-center justify-between text-[12.5px]">
            <span className="inline-flex items-center gap-2 text-mut">
              <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden /> {t.label}
            </span>
            <span className="font-bold tnum">{t.n}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10.5px] leading-snug text-mut">
        {hasCapability(game, 'sharedHiringPool') ? 'One pool for the whole room — replaced every week.' : 'The pool turns over; everyone leaves eventually.'}
      </div>
    </Panel>
  )
}

/** TEAM HEALTH — the org the hiring is for (brief §6F). Same derivations as the Team page. */
function TeamHealthMini({ game }: { game: GameState }) {
  const setScreen = useStore((s) => s.setScreen)
  const h = teamHealth(game)
  const nudge = teamNudge(game)
  if (!h) return null
  const tone = h.tone === 'good' ? 'text-good' : h.tone === 'warn' ? 'text-warn' : 'text-bad'
  return (
    <Panel className="mt-3.5">
      <SectionLabel>Team health</SectionLabel>
      <div className="mt-2 flex items-center justify-between text-[13px]">
        <span className="text-mut">Overall</span>
        <span className={`font-bold tnum ${tone}`}>
          {h.score} <span className="text-[11px]">{h.word}</span>
        </span>
      </div>
      {h.atRisk > 0 && (
        <div className="mt-1 flex items-center justify-between text-[12.5px]">
          <span className="text-mut">At risk</span>
          <span className="font-bold text-bad tnum">{h.atRisk}</span>
        </div>
      )}
      {nudge && <div className="mt-2 text-[11.5px] leading-snug text-warn">{nudge}</div>}
      <button onClick={() => setScreen('team')} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent hover:underline">
        Manage the team <ChevronRight size={12} aria-hidden />
      </button>
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
  const [filtersOpen, setFiltersOpen] = useState(false)
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
      fit: (a, b) => teamFit(b, ctx) - teamFit(a, ctx),
      expiry: (a, b) => a.weeksLeft - b.weeksLeft,
      skill: (a, b) => b.skill - a.skill,
      salary: (a, b) => a.salary - b.salary,
    }
    return [...filtered].sort(by[sort])
  }, [game.candidates, role, query, sort, onlyShortlist, shortlist, ctx])

  const openCandidate = game.candidates.find((c) => c.id === open) ?? null
  const runwayNow = runwayWeeks(game)

  /** ONE state label, priority-ordered — scarcity outranks quality (a candidate about to leave is
   *  a decision you make THIS week). Arena's pool refreshes whole, so expiry says nothing there. */
  const badgesFor = (c: Candidate): CardBadge[] => {
    if (!shared && c.weeksLeft <= 2) return [{ text: `Leaves in ${c.weeksLeft}w`, tone: 'warn' }]
    return []
  }

  /** The runway cost of this hire — the mockup's "-2.9 wks". When the delta is bigger than a
   *  year (a first hire against a small bank moves runway by 100+ weeks), the RESULTING runway
   *  is the number a founder can actually reason about, so the display switches to "→ N wk". */
  const runwayImpact = (c: Candidate): { text: string; cls: string } => {
    const after = runwayAfterHire(game, c)
    if (after === Infinity) return { text: 'covered', cls: 'text-good' }
    const cls = after < 12 ? 'font-bold text-bad' : after < 26 ? 'text-warn' : 'text-mut'
    if (runwayNow === Infinity) return { text: `→ ${Math.floor(after)} wk`, cls }
    const delta = after - runwayNow
    if (Math.abs(delta) >= 52) return { text: `→ ${Math.floor(after)} wk`, cls }
    return { text: `${delta > 0 ? '+' : ''}${delta.toFixed(1)} wks`, cls }
  }

  /** The mockup's three-stat row: Fit / Available / Runway impact. */
  const statRow = (c: Candidate) => {
    const fit = teamFit(c, ctx)
    const ft = fitTone(fit)
    const ri = runwayImpact(c)
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[9.5px] font-bold tracking-[0.08em] text-mut uppercase">Fit</div>
          <div className={`text-[14px] font-bold tnum ${ft === 'good' ? 'text-good' : ft === 'warn' ? 'text-warn' : 'text-bad'}`}>{fit}%</div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold tracking-[0.08em] text-mut uppercase">Available</div>
          <div className="text-[14px] font-bold tnum">
            {c.notice} wk{c.notice === 1 ? '' : 's'}
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold tracking-[0.08em] text-mut uppercase">Runway</div>
          <div className={`text-[14px] font-bold tnum ${ri.cls}`}>{ri.text}</div>
        </div>
      </div>
    )
  }

  const kpis = [
    { label: 'Open roles', value: String(openRoles(game)) },
    {
      label: 'In motion',
      value: `${game.offersOut.length + game.pendingHires.length}`,
      sub: game.pendingHires.length > 0 ? `${game.pendingHires.length} signed` : game.offersOut.length > 0 ? 'deciding…' : undefined,
    },
    { label: 'Team size', value: String(game.employees.length + 1) },
    { label: 'Payroll / wk', value: money(weeklyPayroll(game)) },
    { label: 'Runway impact', value: teamRunwayImpact(game).text, tone: teamRunwayImpact(game).tone === 'bad' ? 'text-bad' : teamRunwayImpact(game).tone === 'warn' ? 'text-warn' : '' },
  ]

  return (
    <div>
      {/* header — title + one line of intent, per the mockup */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight sm:text-[28px]">Hiring</h1>
          <div className="mt-0.5 text-[13px] text-mut">Find the right people to build your future.</div>
        </div>
      </div>

      {/* KPI strip (desktop and tablet; the phone gets the insights card instead) */}
      <div className="mt-3 hidden sm:block">
        <KpiStrip items={kpis} />
      </div>

      {/* MOBILE insights card — the brief asks for it explicitly at the top of the phone page */}
      <div className="mt-3 rounded-xl border border-line bg-surface p-3 shadow-[var(--elev-1)] sm:hidden">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <div className="flex items-baseline justify-between">
            <span className="text-mut">Open roles</span>
            <span className="font-bold tnum">{openRoles(game)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-mut">Payroll</span>
            <span className="font-bold tnum">{money(weeklyPayroll(game))}/wk</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-mut">Acceptance</span>
            <span className="font-bold tnum text-good">
              ~
              {Math.round(
                (game.candidates.length
                  ? game.candidates.reduce((a, c) => a + offerAcceptChance(game, c, Math.min(999, runwayNow)), 0) / game.candidates.length
                  : 0) * 100,
              )}
              %
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-mut">Runway impact</span>
            <span className={`font-bold tnum ${teamRunwayImpact(game).tone === 'bad' ? 'text-bad' : 'text-warn'}`}>{teamRunwayImpact(game).text}</span>
          </div>
        </div>
      </div>

      {shared && (
        <Disclosure
          label="One market, every founder — sealed offers, one candidate per round"
          className="mt-3.5 rounded-2xl border border-accent/30 bg-accent/[0.05] px-4 py-3 text-[13px] leading-relaxed"
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
        <div className="mt-3.5 grid gap-5 md:grid-cols-2">
          {game.offersOut.length > 0 && (
            <Panel title="Offers out — they answer next week">
              {game.offersOut.map((c) => (
                <div key={c.id} className="flex justify-between py-1.5 text-[13px]">
                  <span>
                    <b>{c.name}</b> <span className="text-mut">· {c.role}</span>
                  </span>
                  <span className="text-mut tnum">{weeklyMoney(c.salary)} · deciding…</span>
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

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <div className="min-w-0">
          {/* Function chips + ONE Filters button (brief §6C: the game ranks; controls stay light).
              The chips are the game's four real roles — a fifth "Ops" would filter to an empty
              grid forever, because no such role exists in the simulation. */}
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {([['all', 'All'], ...ROLES.map((r) => [r, ROLE_LABEL[r]] as const)] as [Role | 'all', string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setRole(id)}
                  className={`min-h-[34px] rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                    role === id ? 'border-accent bg-accent/15 text-ink' : 'border-line2 bg-surface2 text-mut hover:border-accent hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className={`ml-auto inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                filtersOpen || query || sort !== 'fit' || onlyShortlist
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-line2 bg-surface2 text-mut hover:text-ink'
              }`}
            >
              <SlidersHorizontal size={13} aria-hidden />
              Filters
            </button>
          </div>

          {filtersOpen && (
            <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
              <div className="relative min-w-[170px] flex-1">
                <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mut" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or role…"
                  aria-label="Search candidates"
                  className="min-h-[34px] w-full rounded-full border border-line2 bg-surface2 pr-3 pl-8 text-[12.5px] text-ink placeholder:text-mut/70"
                />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-mut">
                Sort
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="min-h-[34px] rounded-lg border border-line2 bg-surface2 px-2 text-[12.5px] font-semibold text-ink"
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setOnlyShortlist((v) => !v)}
                aria-pressed={onlyShortlist}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                  onlyShortlist ? 'border-warn/60 bg-warn/15 text-warn' : 'border-line2 bg-surface2 text-mut hover:text-ink'
                }`}
              >
                <Star size={13} fill={onlyShortlist ? 'currentColor' : 'none'} aria-hidden />
                Shortlist
                {shortlist.length > 0 && <span className="tnum">({shortlist.length})</span>}
              </button>
            </div>
          )}

          {pool.length === 0 ? (
            <Panel>
              <div className="text-[13px] text-mut">
                Nobody in the pool matches that.{' '}
                {onlyShortlist ? 'Nothing is shortlisted yet — tap the star on a card.' : 'Try another role or clear the search.'}
              </div>
            </Panel>
          ) : (
            <>
              {/* DESKTOP: the mockup's compact cards — verdict banner, cost top-right, the
                  three-stat row, one founder-style line, two CTAs. */}
              <div className="hidden gap-4 sm:grid sm:grid-cols-2 2xl:grid-cols-2">
                {pool.map((c) => (
                  <PersonCard
                    key={c.id}
                    person={c}
                    ctx={ctx}
                    banner={fitTier(teamFit(c, ctx))}
                    topRight={
                      <div className="shrink-0 text-right">
                        <div className="text-[15px] font-bold leading-none tnum">{money(c.salary / 52)}</div>
                        <div className="mt-0.5 text-[10px] text-mut">/ week</div>
                      </div>
                    }
                    badges={badgesFor(c)}
                    showAttributes={false}
                    rows={statRow(c)}
                    note={impactSummary(c, game.stage)}
                    onOpen={() => setOpen(c.id)}
                    shortlisted={shortlist.includes(c.id)}
                    onShortlist={() => setShortlist((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                    actions={
                      shared ? (
                        <BidControl candidateId={c.id} />
                      ) : (
                        <>
                          <Btn className="flex-1" onClick={() => setOpen(c.id)}>
                            View profile
                          </Btn>
                          <Btn variant="primary" className="flex-1" onClick={() => sendOffer(c.id)}>
                            <Send size={14} aria-hidden />
                            Make offer
                          </Btn>
                        </>
                      )
                    }
                  />
                ))}
              </div>

              {/* MOBILE: compact list rows (brief §7D) — tap opens the full profile, where the
                  offer/bid actions live. */}
              <div className="space-y-2 sm:hidden">
                {pool.map((c) => {
                  const fit = teamFit(c, ctx)
                  const ft = fitTone(fit)
                  const ri = runwayImpact(c)
                  return (
                    <button
                      key={c.id}
                      onClick={() => setOpen(c.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left shadow-[var(--elev-1)] active:bg-surface2"
                    >
                      <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-full border border-line2/70 bg-black/30">
                        <Portrait person={c} frame="chip" className="h-full w-full" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[14px] font-bold">{c.name}</span>
                          <span className={`shrink-0 text-[14px] font-bold tnum ${ft === 'good' ? 'text-good' : ft === 'warn' ? 'text-warn' : 'text-bad'}`}>
                            {fit}%
                          </span>
                        </span>
                        <span className="flex items-baseline justify-between gap-2 text-[11.5px] text-mut">
                          <span className="truncate">{title(c)}</span>
                          <span className="shrink-0 tnum">{weeklyMoney(c.salary)}</span>
                        </span>
                        <span className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className={!shared && c.weeksLeft <= 2 ? 'font-semibold text-warn' : 'text-mut'}>
                            {shared ? 'shared pool' : `leaves in ${c.weeksLeft}w`}
                          </span>
                          <span className={`shrink-0 tnum ${ri.cls}`}>{ri.text}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="mt-4 text-center text-[12px] text-mut">
            Showing <span className="tnum">{pool.length}</span> of <span className="tnum">{game.candidates.length}</span>{' '}
            {game.candidates.length === 1 ? 'candidate' : 'candidates'} in the pool
            {shortlist.length > 0 && <> · {shortlist.length} shortlisted</>}
          </div>
        </div>

        {/* the right rail: insights → pool health → team health (desktop only; the phone got the
            compact insights card at the top instead) */}
        <div className="hidden min-w-0 xl:block">
          <div className="sticky top-4">
            <HiringInsights game={game} ctx={ctx} />
            <TalentPoolHealth game={game} ctx={ctx} />
            <TeamHealthMini game={game} />
          </div>
        </div>
      </div>

      {openCandidate && (
        <PersonProfile
          person={openCandidate}
          ctx={ctx}
          onClose={() => setOpen(null)}
          status={
            <>
              <b className="text-ink">{fitTier(teamFit(openCandidate, ctx)).label}.</b> Asking {money(openCandidate.salary)}/yr (
              {weeklyMoney(openCandidate.salary)}) — a {money(recruiterFee(openCandidate))} recruiter fee lands the week they start, and
              they serve {openCandidate.notice} week{openCandidate.notice === 1 ? '' : 's'} of notice first.
            </>
          }
          actions={
            shared ? (
              <div className="w-full max-w-[280px]">
                <BidControl candidateId={openCandidate.id} />
              </div>
            ) : hasCapability(game, 'detailedPMF') ? (
              // NEGOTIATION (engagement §6): three real packages, each with live acceptance odds
              // read from the engine's own roll — a lowball can genuinely lose them.
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  [-10, 'Lowball −10%'],
                  [0, 'Asking'],
                  [15, 'Sweeten +15%'],
                ] as const).map(([pm, label]) => {
                  const adj = { ...openCandidate, salary: Math.round((openCandidate.salary * (100 + pm)) / 100) }
                  const p = offerAcceptChance(game, adj, Math.min(999, runwayNow))
                  const word = p >= 0.75 ? 'likely' : p >= 0.55 ? 'probable' : p >= 0.35 ? 'uncertain' : 'long shot'
                  const tone = p >= 0.75 ? 'text-good' : p >= 0.55 ? 'text-warn' : 'text-bad'
                  return (
                    <Btn
                      key={pm}
                      variant={pm === 0 ? 'primary' : undefined}
                      onClick={() => {
                        sendOffer(openCandidate.id, pm)
                        setOpen(null)
                      }}
                    >
                      {label} <span className={`ml-1 text-[10.5px] font-bold ${tone}`}>{word}</span>
                    </Btn>
                  )
                })}
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
                Make offer
              </Btn>
            )
          }
        />
      )}
    </div>
  )
}
