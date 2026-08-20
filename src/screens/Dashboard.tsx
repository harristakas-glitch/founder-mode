// Founder HQ — the landing screen, rebuilt to the brief's five questions, in order:
// how is the company doing / what changed / what needs me / why / what happens next.
//
// WHAT THIS USED TO BE, and why almost none of it survived (docs/ux-audit-2026-08.md §1, row 2):
// a week digest, a vitals board of 7 StatCards, two history charts, a benchmark report, a
// milestones shelf and a "Latest news" list — 16 boxes at equal weight (22 in Career), with the
// screen's only real answer to "what do I do this week?" rendered at 13.5px against 34px data.
// The audit's verdict was that the Dashboard could not state a purpose. This one can:
//
//   ONE question — what should I do this week? — answered by exactly three things:
//     1. the HERO: runway, the number that ends the run, with net/wk as its sentence;
//     2. four supporting metrics, each the single home of its number;
//     3. the attention list from src/attention.ts — top item at full weight, two beneath,
//        the rest behind a disclosure. Severity is a TYPE and the word is printed, so the
//        signal never rides on colour alone.
//
// What left, and where it lives now: cash → the hero's subtext (it was rendered 8 times across
// the build); valuation → Capital (no in-week action); both charts → history is not a decision;
// milestones → the run record; "Latest news" → the Inbox owns that list; the Benchmarks panel →
// its verdicts are now register items (see attention.ts), because two functions evaluating the
// same health into two UI regions is how they drift.
import { Meter, RadialGauge, RAISED, Sparkline, StatCard } from '../components'
import { money, num, pct } from '../format'
import { attentionRegister, type AttentionItem } from '../attention'
import { boardEffectiveTarget, growthRate, pmfLabel, runwayWeeks, totalUsers, unitEconomics, weeklyBurn } from '../game/engine'
import { useState } from 'react'
import { DollarSign, Target as TargetIcon, TrendingUp as TrendIcon, Users as UsersIcon } from 'lucide-react'
import { BoardMeeting, Commitments, FounderBriefing, PMF_CAUSAL_CHAIN, TeamOpinions, careerActive } from '../CareerUI'
import { openGuide } from '../onboarding/guide'
import { myId as myOnlineId } from '../net/online'
import { PMF_LABEL, segmentSnapshots } from '../game/career/pmf'
import { sectorById } from '../game/data'
import { InboxStream } from './Inbox'
import { useStore } from '../store'

// ---------------------------------------------------------------------------------------------
// The hero. Bespoke rather than a StatCard on purpose: the whole Cockpit direction hangs on ONE
// figure per screen being brighter and bigger than everything else, and this is that figure. The
// only pure white on the page is here.
// THE HERO IS THE BINDING CONSTRAINT — the engine decides, not the layout.
//
// The first cut put runway here permanently, and the owner's metrics review convicted it: runway
// is a scoreboard, and at 150 weeks the loudest number on the screen was answering a question
// nobody had asked, while the actual early game — find fit before the money or the board's
// patience runs out — sat in a 34px cell. The engine already knows which constraint binds; this
// asks it, in strict precedence order:
//
//   1. the money clock, when it is actually ticking (death)
//   2. the board's growth bar, when you are under it (fired)
//   3. the fit clock, while the market has not said yes (the slow death every run starts in)
//   4. runway as the calm default — when nothing binds, the truthful headline is "nothing binds"
//
// The label names the constraint, so the hero also TEACHES what the game currently is. This is
// the Cockpit spec's own line — "the hero is whatever is closest to killing the run this week" —
// finally implemented rather than approximated.
function Hero() {
  const game = useStore((s) => s.game)!
  const runway = runwayWeeks(game)
  const net = game.lastRevenue - weeklyBurn(game)
  const profitable = runway === Infinity
  const career = careerActive(game) ? game.career! : null

  let label: string, figure: string, sentence: string, tone: 'bad' | 'warn' | 'good' | 'mut'

  const growth = growthRate(game)
  const target = game.board ? boardEffectiveTarget(game) : 0
  const pmfPace = Math.min(85, game.week * 1.6)
  const retention = career ? (career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) : 0

  if (!profitable && runway < 26) {
    label = 'Runway'
    figure = `${Math.max(0, Math.floor(runway))} weeks`
    sentence =
      net < 0
        ? `${money(game.cash)} in the bank, net ${money(net)} a week. Three ways out: raise, cut burn, or get revenue above burn.`
        : `${money(game.cash)} in the bank and net is positive — the clock only moves if that changes.`
    tone = runway < 10 ? 'bad' : 'warn'
  } else if (game.board && growth < target) {
    label = 'The board’s bar'
    figure = `${(growth * 100).toFixed(1)}% /wk`
    sentence = `They expect ${(target * 100).toFixed(1)}%. Review in week ${game.board.nextReview} — miss it and it becomes a strike${game.board.strikes > 0 ? `, and you already have ${game.board.strikes}` : ''}.`
    tone = game.board.strikes > 0 ? 'bad' : 'warn'
  } else if (game.week > 4 && (career ? retention < 0.55 : game.pmf < Math.max(30, pmfPace))) {
    label = career ? 'The fit clock' : 'The fit clock'
    figure = career
      ? retention > 0
        ? `${Math.round(retention * 100)}% stay`
        : 'No signal yet'
      : `PMF ${Math.round(game.pmf)}`
    sentence = career
      ? retention > 0
        ? `${Math.round(retention * 100)}% of your target segment is still here after four weeks. Fit is read off the ones who stay.`
        : 'Nothing has retained long enough to measure. Only paying customers who stay move the number.'
      : `Winners find fit by ~week 40 and it is week ${game.week}. The runway is long; the question is whether the market says yes.`
    tone = 'mut'
  } else {
    label = 'Runway'
    figure = profitable ? 'Profitable' : `${Math.max(0, Math.floor(runway))} weeks`
    sentence = profitable
      ? `Revenue covers burn with ${money(net)}/wk to spare. ${money(game.cash)} in the bank.`
      : `${money(game.cash)} in the bank. Nothing is binding this week — a good week to make a bet.`
    tone = profitable ? 'good' : 'mut'
  }

  const labelTone = { bad: 'text-bad', warn: 'text-warn', good: 'text-good', mut: 'text-mut' }[tone]
  // The mock colours the FIGURE by its tone — green when the constraint is calm, amber and red as
  // it binds — so the hero's own hue is a reading, not a brand mark. The light-purple focus token
  // stays for the mut state, where no tone applies.
  const figureTone = { bad: 'text-bad', warn: 'text-warn', good: 'text-good', mut: 'text-[var(--color-focus)]' }[tone]
  const calm = attentionRegister(game).filter((i) => !i.id.startsWith('decision:')).length === 0
  return (
    <div className="relative mb-4 overflow-hidden rounded-xl border border-line bg-surface p-6 shadow-[var(--elev-2)]">
      {/* The mock decorates the hero with a rocket over a starfield. We ship no raster art and the
          spec bans illustrations, so the sky is rendered as CSS alone: a nebula wash and a handful
          of box-shadow stars. Squint and it is the same sky. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 md:block"
        style={{ background: 'radial-gradient(ellipse at 80% 40%, rgb(139 92 246 / 0.18), rgb(59 130 246 / 0.07) 45%, transparent 72%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-24 top-8 hidden h-px w-px rounded-full md:block"
        style={{ boxShadow: '0 0 2px 1px rgb(241 243 247 / .8), 40px 22px 1px 0 rgb(241 243 247 / .5), 90px -4px 1.5px 0 rgb(241 243 247 / .6), 140px 30px 1px 0 rgb(241 243 247 / .4), 60px 60px 1px 0 rgb(241 243 247 / .35), 170px 8px 1px 0 rgb(241 243 247 / .45)' }}
      />
      <div className={`text-[11px] font-bold uppercase tracking-[0.13em] ${labelTone}`}>{label}</div>
      <div className={`mt-1.5 text-[42px] leading-[0.98] font-bold tracking-[-0.04em] tnum md:text-[58px] ${figureTone}`}>
        {figure}
      </div>
      <div className="mt-2 line-clamp-2 max-w-[52ch] text-[13px] leading-relaxed text-mut md:line-clamp-none md:text-[13.5px]">{sentence}</div>
      {/* the mock folds the all-clear INSIDE the hero card */}
      {calm && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-good/35 bg-surface2 px-3.5 py-2 text-[13px] text-mut">
          <span className="text-good">✓</span> Nothing needs you. Good week to make a bet.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The attention list. The register decides what exists and in what order; this only decides how
// much of it is visible at once — one at full weight, two as rows, the rest one interaction away.
function AttentionList() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  // THE ATTENTION AREA IS NON-INBOX ONLY (owner rule, 2026-08-20): anything that lives in the
  // inbox renders in the inbox column and nowhere else — the stream carries the decisions with
  // their choices, unresolved-first, and this list carries the facts no message owns: runway, the
  // covenant, the board, the person about to quit, the market acting on you. One fact, one home.
  // The register still emits decision items for other consumers; this renderer skips them.
  const items = attentionRegister(game).filter((i) => !i.id.startsWith('decision:'))

  // the calm state renders inside the hero card (the mock's layout); an empty list here is silence
  if (items.length === 0) return null

  const [top, ...rest] = items
  const shown = rest.slice(0, 2)
  const folded = rest.slice(2)

  // The severity WORD is printed on every item — brief §8: "do not rely solely on colour".
  const chip: Record<AttentionItem['type'], string> = {
    urgent: 'bg-bad text-bg',
    decision: 'bg-warn text-bg',
    opportunity: 'border border-line2 text-ink',
    insight: 'border border-line2 text-mut',
    information: 'border border-line/60 text-mut',
  }
  const Go = ({ it, prominent }: { it: AttentionItem; prominent?: boolean }) =>
    it.action ? (
      <button
        className={`shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold transition-[filter] hover:brightness-110 ${
          prominent ? 'bg-warn text-bg' : 'border border-line2 text-ink'
        }`}
        onClick={() => {
          setScreen(it.action!.screen)
          // An anchored action targets a region; when that region is on the current screen the
          // navigation is a no-op, and the scroll is the whole gesture.
          if (it.action!.anchor) setTimeout(() => document.getElementById(it.action!.anchor!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
        }}
      >
        {it.action.label} →
      </button>
    ) : null

  return (
    <div className="mb-4">
      {/* The top item is the screen's second-loudest element after the hero — a full plane step
          above the rows below it, the same raised-vs-receded grammar the Inbox uses. */}
      <div
        className={`rounded-[10px] border p-4 shadow-[var(--elev-2)] ${
          top.type === 'urgent'
            ? 'border-bad/45 bg-[color-mix(in_srgb,var(--color-bad)_9%,var(--color-surface3))]'
            : 'border-warn/40 bg-[color-mix(in_srgb,var(--color-warn)_8%,var(--color-surface3))]'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${chip[top.type]}`}>{top.type}</span>
          {top.deadline !== undefined && (
            <span className="text-[11px] font-semibold text-mut">
              {top.deadline === 0 ? 'this week' : `${top.deadline} wk${top.deadline === 1 ? '' : 's'} left`}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold leading-snug">{top.title}</div>
            {top.detail && <div className="mt-1 text-[13px] leading-snug text-mut">{top.detail}</div>}
          </div>
          <Go it={top} prominent />
        </div>
      </div>

      {shown.map((it) => (
        <div key={it.id} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line/60 bg-surface2 px-3.5 py-2">
          <span className={`rounded-md px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider ${chip[it.type]}`}>{it.type}</span>
          <span className="min-w-0 flex-1 text-[13px] leading-snug">{it.title}</span>
          <Go it={it} />
        </div>
      ))}

      {folded.length > 0 && (
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none rounded-[10px] px-3.5 py-1.5 text-[12px] font-semibold text-mut transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{folded.length} more…</span>
            <span className="hidden group-open:inline">show less</span>
          </summary>
          {folded.map((it) => (
            <div key={it.id} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line/60 bg-surface2 px-3.5 py-2">
              <span className={`rounded-md px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider ${chip[it.type]}`}>{it.type}</span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug">{it.title}</span>
              <Go it={it} />
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Glance -> Understand -> Analyse (brief §19). The StatCard is the glance; clicking it opens this
// — one small card of "why", on plane 3, with a single link deeper. Only the ANALYSE step leaves
// the screen, which is the whole point: medium-depth answers stop costing a navigation.
type MetricKey = 'revenue' | 'users' | 'fit' | 'people'

function MetricDrawer({ metric, onClose }: { metric: MetricKey; onClose: () => void }) {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const h = game.history
  const wk = (n: number) => (h.length > n ? h[h.length - 1 - n] : null)
  const career = careerActive(game) ? game.career! : null

  const Fact = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-mut">{k}</span>
      <span className="tnum text-right font-semibold">{children}</span>
    </div>
  )
  const Analyse = ({ label, screen }: { label: string; screen: Parameters<typeof setScreen>[0] }) => (
    <button
      onClick={() => setScreen(screen)}
      className="mt-2 rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-bold text-ink transition-colors hover:border-accent"
    >
      {label} →
    </button>
  )

  const four = wk(4) ?? wk(h.length - 1)
  const body =
    metric === 'revenue' ? (
      (() => {
        // Owner direction: the sim teaches unit economics. The revenue drawer is the natural
        // classroom — the glance is the figure, this is what the figure is made of.
        const econ = unitEconomics(game)
        return (
          <>
            <Fact k="This week">{money(game.lastRevenue)}</Fact>
            {four && <Fact k="Four weeks ago">{money(four.revenue)}</Fact>}
            <Fact k="Net vs burn">{money(game.lastRevenue - weeklyBurn(game))}/wk</Fact>
            <Fact k="CAC">{money(econ.cac)}</Fact>
            <Fact k="LTV">
              {money(econ.ltv)}{' '}
              <span className={econ.ratio >= 3 ? 'text-good' : econ.ratio < 1 ? 'text-bad' : 'text-warn'}>
                ({econ.ratio >= 100 ? '99x+' : `${econ.ratio.toFixed(1)}x`} CAC)
              </span>
            </Fact>
            <Fact k="Payback">{Number.isFinite(econ.paybackWeeks) ? `${Math.ceil(econ.paybackWeeks)} wk` : 'no revenue yet'}</Fact>
            <Analyse label="Growth" screen="growth" />
          </>
        )
      })()
    ) : metric === 'users' ? (
      <>
        <Fact k="Now">{num(totalUsers(game))}</Fact>
        {four && <Fact k="Four weeks ago">{num(four.users)}</Fact>}
        <Fact k="Growth">{pct(growthRate(game), 1)}/wk average</Fact>
        <Analyse label="Market" screen="market" />
      </>
    ) : metric === 'fit' ? (
      career ? (
        <>
          <Fact k="4-week retention">{(career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) > 0 ? pct(career.retentionBySegment[career.primaryTargetSegmentId] ?? 0, 0) : '—'}</Fact>
          <div className="py-1 text-[12.5px] leading-snug text-mut">
            PMF here is derived from customers who stay. Research moves your beliefs; only retained customers move the number.
          </div>
          <Analyse label="Discovery" screen="discovery" />
        </>
      ) : (
        <>
          <Fact k="PMF">{Math.round(game.pmf)}/100</Fact>
          {four && <Fact k="Four weeks ago">{Math.round(four.pmf)}/100</Fact>}
          <div className="py-1 text-[12.5px] leading-snug text-mut">
            Driven by research, product quality and whether the market wants the idea at all.
          </div>
          <Analyse label="Product" screen="product" />
        </>
      )
    ) : (
      <>
        {game.employees.length === 0 ? (
          <div className="py-1 text-[12.5px] leading-snug text-mut">No employees yet — everything ships at the speed of your own energy.</div>
        ) : (
          [...game.employees]
            .sort((a, b) => a.morale - b.morale)
            .slice(0, 3)
            .map((e) => (
              <Fact key={e.id} k={e.name}>
                <span className={e.morale < (e.trait === 'mercenary' ? 55 : 32) ? 'text-bad' : e.morale < 50 ? 'text-warn' : ''}>
                  morale {Math.round(e.morale)}
                </span>
              </Fact>
            ))
        )}
        <Fact k="Your energy">
          <span className={game.energy <= 12 ? 'text-bad' : ''}>{Math.round(game.energy)}/100</span>
        </Fact>
        <Analyse label="People" screen="team" />
      </>
    )

  return (
    <div className={`${RAISED} mt-2 px-4 py-2.5`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-mut">
          {metric === 'fit' ? (career ? 'Retention' : 'PMF') : metric}
        </span>
        <button onClick={onClose} aria-label="Close" className="-mr-1 rounded-md px-1.5 text-[12px] text-mut hover:text-ink">
          ✕
        </button>
      </div>
      {body}
    </div>
  )
}

// Arena §42 — the standings, ON the HQ, because in a match your position IS the game. Owner
// call (2026-08-20): Arena only — in single player the market table on Rivals is enough, and a
// standings card there would be one more box on the screen that least needs one. Renders null
// outside a live match.
function ArenaStandings() {
  const online = useStore((s) => s.online)
  const game = useStore((s) => s.game)!
  if (!online || online.phase !== 'playing') return null
  const everyone = online.players.filter((p) => p.playing !== false)
  if (everyone.length < 2) return null
  const total = Math.max(1, everyone.reduce((n, p) => n + Math.max(0, p.users), 0))
  const rows = [...everyone].sort((a, b) => b.users - a.users)
  const myRank = rows.findIndex((p) => p.id === myOnlineId()) + 1
  return (
    <div className="mb-4 rounded-[14px] border border-line bg-surface p-4 shadow-[var(--elev-2)]">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[20px] font-semibold">Standings</h2>
        <span className="text-[11.5px] text-mut tnum">
          you are #{myRank} of {rows.length} · week {game.week}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((p, i) => {
          const me = p.id === myOnlineId()
          return (
            <div key={p.id} className={`flex items-baseline gap-3 rounded-[8px] px-2.5 py-1.5 text-[13px] ${me ? 'border border-line2 bg-surface3 font-bold' : ''}`}>
              <span className="w-4 shrink-0 text-right text-[11px] text-mut tnum">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.over ? '☠️ ' : ''}
                {p.company}
                {me ? ' (you)' : ''}
              </span>
              <span className="text-[11.5px] text-mut tnum">{Math.round((Math.max(0, p.users) / total) * 100)}% share</span>
              <span className="w-16 shrink-0 text-right tnum">{num(Math.max(0, p.users))}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The mobile stream peek — see the FEED comment at the call site.
function StreamPeek() {
  const game = useStore((s) => s.game)!
  // Unresolved decisions first — they are inbox content and the inbox column sits below the fold
  // on a phone, so these two lines are what keep a blocking decision visible. Then the news.
  const unresolved = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved)
  const latest = unresolved.concat(game.inbox.filter((m) => !(m.kind === 'choice' && !m.resolved))).slice(0, 2)
  if (latest.length === 0) return null
  const more = game.inbox.length - latest.length
  return (
    <div className="order-5 mb-4 rounded-[10px] border border-line/60 bg-surface px-3.5 py-2 lg:hidden">
      {latest.map((m) => (
        <button
          key={m.id}
          onClick={() => document.getElementById('week-stream')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="flex w-full items-baseline gap-2.5 py-1 text-left"
        >
          <span className="shrink-0 text-[10.5px] text-mut tnum">wk {m.week}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{m.title}</span>
        </button>
      ))}
      {more > 0 && (
        <button
          onClick={() => document.getElementById('week-stream')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="pt-0.5 text-[11.5px] font-semibold text-mut transition-colors hover:text-ink"
        >
          {more} more this run ↓
        </button>
      )}
    </div>
  )
}

// The horizon — FM26's Portal lesson, and the brief's own §3 UPCOMING section, finally built.
// The HQ had alarms (the register) but no TIME: nothing said the board sits in three weeks or
// that an offer dies on Friday. Deadlines the state already knows, nearest first, each a link to
// where it is acted on. Read-only, at most four, silent when the horizon is clear.
function Upcoming() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const items: { weeks: number; label: string; screen: Parameters<typeof setScreen>[0] }[] = []

  if (game.board) items.push({ weeks: Math.max(0, game.board.nextReview - game.week), label: 'Board review', screen: 'fundraising' })
  const sheet = [...game.termSheets].sort((a, b) => a.weeksLeft - b.weeksLeft)[0]
  if (sheet) items.push({ weeks: sheet.weeksLeft, label: `${sheet.investor} offer expires`, screen: 'fundraising' })
  const cand = [...game.candidates].sort((a, b) => a.weeksLeft - b.weeksLeft)[0]
  if (cand) items.push({ weeks: cand.weeksLeft, label: `${cand.name} leaves the pool`, screen: 'hiring' })
  if ((game.flags.priceWar ?? 0) > 0) items.push({ weeks: game.flags.priceWar, label: 'Price war ends', screen: 'market' })
  if (game.rally) items.push({ weeks: game.rally.weeksLeft, label: 'Rally fades', screen: 'team' })
  if (game.challenge) items.push({ weeks: Math.max(0, game.challenge.cap - game.week), label: 'The run ends', screen: 'dashboard' })

  const top = items.sort((a, b) => a.weeks - b.weeks).slice(0, 3)
  if (top.length === 0) return null
  // The mock's grammar: each horizon entry is its own chevron pill row. Full-width buttons stack
  // on every viewport, which also retires the mobile scroll-lane this block briefly wore.
  return (
    <div className="mb-4 space-y-1.5">
      {top.map((i) => (
        <button
          key={i.label}
          onClick={() => setScreen(i.screen)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-line/60 bg-surface px-3.5 py-2 text-left transition-colors hover:border-line2"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-mut">Upcoming</span>
          <span className={`tnum text-[12.5px] font-bold ${i.weeks <= 1 ? 'text-warn' : 'text-ink'}`}>
            {i.weeks === 0 ? 'this wk' : `${i.weeks} wk`}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-mut">{i.label}</span>
          <span className="text-mut">›</span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
export function Dashboard() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null)
  const toggle = (m: MetricKey) => setOpenMetric((cur) => (cur === m ? null : m))
  const growth = growthRate(game)
  const career = careerActive(game) ? game.career! : null
  const retention = career ? (career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) : 0

  // Trend deltas come from history — the WeekDigest strip died and these carry its information at
  // a fifth of the footprint (and it removes the Career case where two delta strips rendered two
  // lines apart).
  const h = game.history
  const revDelta = h.length >= 2 ? h[h.length - 1].revenue - h[h.length - 2].revenue : 0

  // People: headcount, LOWEST morale, founder energy. Lowest, not average, because an average
  // mathematically hides the person about to quit — one at 20 among seven at 75 averages 68.
  const lowest = game.employees.length > 0 ? game.employees.reduce((m, e) => Math.min(m, e.morale), 100) : null
  const anyAtRisk = game.employees.some((e) => e.morale < (e.trait === 'mercenary' ? 55 : 32))

  // THE ZONES — owner call after playing the single-column HQ against FM26's Portal: it needs
  // columns. Desktop (xl+) splits FM-style — the FEED (the horizon and the week's stream) as a
  // 380px left column, the NOW (hero, alarms, metrics, the career reads) as the main zone —
  // while the phone keeps the exact single-column priority order it already had.
  //
  // One DOM serves both: the two zone wrappers are `display: contents` below xl, so their
  // children flatten into the outer flex column and take the mobile order from their `order-N`
  // classes; at xl the wrappers become real blocks, the order classes go inert, and the columns
  // are just the wrappers side by side. No duplicated markup, no JS.
  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Weekly Briefing</h1>
      <div className="mb-4 text-[13px] text-mut">
        Week {game.week} · {game.stage} · you own {pct(game.founderEquity, 1)}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6 xl:gap-8">
        {/* the FEED — left on desktop, interleaved by order on the phone */}
        <div className="contents lg:order-first lg:block lg:w-[320px] lg:shrink-0 xl:w-[380px]">
          {/* Mobile peek (owner call): the stream must exist above the fold WITHOUT taking the
              screen over. Two one-line rows of the latest news — decisions are excluded because
              the attention list directly above already carries them at full weight — and a jump
              to the full stream below. Desktop hides it: the feed column is already visible. */}
          <StreamPeek />
          <div className="order-6"><Upcoming /></div>
          <div id="week-stream" className="order-9 lg:mt-0">
            <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-mut">This week timeline</h2>
            <InboxStream />
          </div>
        </div>

        {/* the NOW */}
        <div className="contents lg:block lg:min-w-0 lg:flex-1">
          {/* Career: what just happened and why, in prose. On DESKTOP it leads the now-zone —
              the story before the state. On a PHONE it measured 251px of narration sitting on
              top of the fold while the alarms and the stream waited below it, so there it yields:
              hero and alarms first, the story after the horizon. Same DOM, order classes only. */}
          <div className="order-6"><FounderBriefing /></div>
          <div className="order-2"><Hero /></div>
          <div className="order-3"><ArenaStandings /></div>
          <div className="order-4"><AttentionList /></div>

      {/* Slot order is causal rank, not convention (owner's metrics review, 2026-08-20): fit is
          the number in every compounding formula, the growth RATE is what the board judges — the
          user COUNT is its delta line, demoted from a 34px figure to the small print, because the
          level moves the ego and the rate moves the outcome. Revenue and People close the row. */}
      <div className="order-7 -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0 2xl:grid-cols-4">
        <button type="button" className="h-full w-[76%] min-w-[230px] shrink-0 snap-start text-left lg:w-auto lg:min-w-0" aria-expanded={openMetric === 'fit'} onClick={() => toggle('fit')}>
        {career ? (
          <StatCard
            className="h-full"
            icon={<UsersIcon size={13} />}
            label="4-week retention"
            value={retention > 0 ? pct(retention, 0) : '—'}
            delta={retention > 0 ? 'of your target segment still here — fit is read off the ones who stay' : 'No customers retained long enough to measure yet. Talk to users; keep the ones you win.'}
            tone={retention >= 0.7 ? 'up' : retention > 0 && retention < 0.4 ? 'down' : undefined}
          >
            <Meter value={retention * 100} tone={retention >= 0.7 ? 'good' : retention > 0 && retention < 0.4 ? 'bad' : 'accent'} />
            <span className="mt-3 block w-full rounded-lg border border-line2 py-1.5 text-center text-[12px] font-bold text-ink">View Retention</span>
          </StatCard>
        ) : (
          <StatCard
            className="h-full"
            icon={<TargetIcon size={13} />}
            label="Product-market fit"
            numeric={game.pmf}
            format={(n) => `${Math.round(n)}/100`}
            delta={game.pmf < 30 ? `${pmfLabel(game.pmf)} — research moves your odds, quality moves the number` : game.pmf < 60 ? `${pmfLabel(game.pmf)} — real interest, not yet a must-have` : `${pmfLabel(game.pmf)} — protect quality while you scale`}
            tone={game.pmf >= 60 ? 'up' : game.pmf < 30 ? 'down' : undefined}
          >
            <Meter value={game.pmf} tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'bad' : 'accent'} />
            <span className="mt-3 block w-full rounded-lg border border-line2 py-1.5 text-center text-[12px] font-bold text-ink">View Fit</span>
          </StatCard>
        )}
        </button>
        <button type="button" className="h-full w-[76%] min-w-[230px] shrink-0 snap-start text-left lg:w-auto lg:min-w-0" aria-expanded={openMetric === 'users'} onClick={() => toggle('users')}>
        <StatCard
          className="h-full"
          icon={<TrendIcon size={13} />}
          label="Growth"
          value={`${growth >= 0 ? '+' : ''}${pct(growth, 1)}/wk`}
          delta={`${num(totalUsers(game))} user${totalUsers(game) === 1 ? '' : 's'}${game.ventures.some((v) => v.launched) ? ' across lines' : ''}${game.board ? ` · board expects ${pct(boardEffectiveTarget(game), 1)}` : ''}`}
          tone={game.board ? (growth >= boardEffectiveTarget(game) ? 'up' : 'down') : growth > 0 ? 'up' : growth < 0 ? 'down' : undefined}
        >
          <Sparkline data={game.history.map((x) => x.users)} tone={growth > 0 ? 'good' : growth < 0 ? 'bad' : 'mut'} />
            <span className="mt-3 block w-full rounded-lg border border-line2 py-1.5 text-center text-[12px] font-bold text-ink">View Growth</span>
        </StatCard>
        </button>
        <button type="button" className="h-full w-[76%] min-w-[230px] shrink-0 snap-start text-left lg:w-auto lg:min-w-0" aria-expanded={openMetric === 'revenue'} onClick={() => toggle('revenue')}>
        <StatCard
          className="h-full"
          icon={<DollarSign size={13} />}
          label="Revenue"
          numeric={game.lastRevenue}
          format={(n) => `${money(n)}/wk`}
          trend={revDelta !== 0 ? revDelta : undefined}
          trendFormat={money}
          tone={game.lastRevenue >= weeklyBurn(game) ? 'up' : undefined}
        >
          <Sparkline data={game.history.map((x) => x.revenue)} tone={game.lastRevenue >= weeklyBurn(game) ? 'good' : 'mut'} />
            <span className="mt-3 block w-full rounded-lg border border-line2 py-1.5 text-center text-[12px] font-bold text-ink">View Revenue</span>
        </StatCard>
        </button>
        <button type="button" className="h-full w-[76%] min-w-[230px] shrink-0 snap-start text-left lg:w-auto lg:min-w-0" aria-expanded={openMetric === 'people'} onClick={() => toggle('people')}>
        <StatCard
          className="h-full"
          icon={<UsersIcon size={13} />}
          label="People"
          value={game.employees.length === 0 ? 'Just you' : `${game.employees.length}`}
          delta={
            game.employees.length === 0
              ? `energy ${Math.round(game.energy)}`
              : `lowest morale ${Math.round(lowest!)} · energy ${Math.round(game.energy)}`
          }
          tone={anyAtRisk || game.energy <= 12 ? 'down' : undefined}
        >
          <Meter value={game.energy} tone={game.energy <= 12 ? 'bad' : game.energy <= 35 ? 'warn' : 'good'} />
            <span className="mt-3 block w-full rounded-lg border border-line2 py-1.5 text-center text-[12px] font-bold text-ink">View People</span>
        </StatCard>
        </button>
      </div>

      {/* the Understand step — under the row, one at a time */}
      <div className="order-8">{openMetric && <MetricDrawer metric={openMetric} onClose={() => setOpenMetric(null)} />}</div>

      {/* Career: the PMF/retention number above is an output — say what it is made of; then the
          named reads of the same week. Each renders null without its capability. */}
      <div className="order-10">
        {/* The mock's WHY-PMF panel: the gauge on the left, the causal chain and the company's own
            reading on the right, and the two lever chips. Replaces both the old quick-play strip
            and the separate Career explainer — one panel, both modes, the same truth. */}
        <div className="mt-4 flex flex-wrap items-start gap-4 rounded-xl border border-line bg-surface p-5 shadow-[var(--elev-2)] md:flex-nowrap">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent">Why PMF is {Math.round(game.pmf)}</div>
            <RadialGauge value={game.pmf} size={64} tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'bad' : 'accent'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-relaxed text-mut">{PMF_CAUSAL_CHAIN}</div>
            {career && (() => {
              const rows = segmentSnapshots({ career: game.career!, sector: game.sector, quality: game.quality, sectorTam: sectorById(game.sector).tam })
              const best = [...rows].sort((a, b) => b.score - a.score)[0]
              const targeting = rows.find((r) => r.segmentId === game.career!.primaryTargetSegmentId)
              if (!best) return null
              return (
                <div className="mt-2 text-[13px] leading-relaxed text-mut">
                  The company scores as its best proven segment: <b className="text-ink">{best.name}</b>{' '}
                  <span className="tnum">({Math.round(best.score)})</span>
                  {targeting && targeting.segmentId !== best.segmentId && (
                    <> — you are targeting <b className="text-ink">{targeting.name}</b> ({PMF_LABEL[targeting.status]})</>
                  )}
                  .
                </div>
              )
            })()}
            <div className="mt-3 flex flex-wrap gap-2">
              {career ? (
                <>
                  <button onClick={() => setScreen('discovery')} className="rounded-lg border border-line2 px-3 py-1.5 text-[12px] font-bold text-ink transition-colors hover:border-accent">
                    Discovery — segments & experiments →
                  </button>
                  <button onClick={() => setScreen('product')} className="rounded-lg border border-line2 px-3 py-1.5 text-[12px] font-bold text-ink transition-colors hover:border-accent">
                    Product — quality & bugs →
                  </button>
                </>
              ) : (
                <button onClick={() => openGuide('pmf')} className="rounded-lg border border-line2 px-3 py-1.5 text-[12px] font-bold text-ink transition-colors hover:border-accent">
                  How PMF works →
                </button>
              )}
            </div>
          </div>
        </div>
        <TeamOpinions />
        <Commitments />
        <div id="board-meeting"><BoardMeeting /></div>
      </div>
        </div>
      </div>

      {/* Deliberately absent, and where it went: cash + valuation StatCards (hero subtext /
          Capital), both history charts (history is not a decision), milestones (the run record),
          "Latest news" (the Inbox), the Benchmarks panel (register items in src/attention.ts). */}
    </div>
  )
}
