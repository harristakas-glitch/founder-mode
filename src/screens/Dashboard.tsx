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
import { StatCard } from '../components'
import { money, num, pct } from '../format'
import { attentionRegister, type AttentionItem } from '../attention'
import { growthRate, pmfLabel, runwayWeeks, totalUsers, weeklyBurn } from '../game/engine'
import { BoardMeeting, Commitments, FounderBriefing, PmfExplainer, TeamOpinions, careerActive } from '../CareerUI'
import { useStore } from '../store'

// ---------------------------------------------------------------------------------------------
// The hero. Bespoke rather than a StatCard on purpose: the whole Cockpit direction hangs on ONE
// figure per screen being brighter and bigger than everything else, and this is that figure. The
// only pure white on the page is here.
function Hero() {
  const game = useStore((s) => s.game)!
  const runway = runwayWeeks(game)
  const net = game.lastRevenue - weeklyBurn(game)
  const profitable = runway === Infinity
  const critical = !profitable && runway < 10

  return (
    <div className="mb-4">
      <div className={`text-[10.5px] font-bold uppercase tracking-[0.13em] ${critical ? 'text-bad' : profitable ? 'text-good' : 'text-mut'}`}>
        Runway
      </div>
      <div className="mt-1 text-[44px] leading-[0.98] font-bold tracking-[-0.04em] text-[var(--color-focus)] tnum md:text-[56px]">
        {profitable ? 'Profitable' : `${Math.max(0, Math.floor(runway))} weeks`}
      </div>
      <div className="mt-2 max-w-[52ch] text-[13.5px] leading-snug text-mut">
        {profitable
          ? `Revenue covers burn with ${money(net)}/wk to spare. ${money(game.cash)} in the bank.`
          : net < 0
            ? `${money(game.cash)} in the bank, net ${money(net)} a week. Three ways out: raise, cut burn, or get revenue above burn.`
            : `${money(game.cash)} in the bank and net is positive — the clock only moves if that changes.`}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The attention list. The register decides what exists and in what order; this only decides how
// much of it is visible at once — one at full weight, two as rows, the rest one interaction away.
function AttentionList() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const items = attentionRegister(game)

  if (items.length === 0) {
    return (
      <div className="mb-4 rounded-[10px] border border-good/30 bg-surface px-4 py-2.5 text-[13px] text-mut">
        ✓ Nothing needs you. Good week to make a bet.
      </div>
    )
  }

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
        onClick={() => setScreen(it.action!.screen)}
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
export function Dashboard() {
  const game = useStore((s) => s.game)!
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

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Founder HQ</h1>
      <div className="mb-4 text-[13px] text-mut">
        Week {game.week} · {game.stage} · you own {pct(game.founderEquity, 1)}
      </div>

      {/* Career: what just happened and why, in prose — before what needs doing about it. */}
      <FounderBriefing />

      <Hero />
      <AttentionList />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Revenue"
          numeric={game.lastRevenue}
          format={(n) => `${money(n)}/wk`}
          trend={revDelta !== 0 ? revDelta : undefined}
          trendFormat={money}
          tone={game.lastRevenue >= weeklyBurn(game) ? 'up' : undefined}
        />
        <StatCard
          label={game.ventures.some((v) => v.launched) ? 'Users (all lines)' : 'Users'}
          numeric={totalUsers(game)}
          format={num}
          trend={growth !== 0 ? growth : undefined}
          delta="/wk avg"
          tone={growth > 0 ? 'up' : growth < 0 ? 'down' : undefined}
        />
        {career ? (
          <StatCard
            label="4-week retention"
            value={retention > 0 ? pct(retention, 0) : '—'}
            delta={retention > 0 ? 'of your target segment still here' : 'nothing has retained long enough to measure'}
            tone={retention >= 0.7 ? 'up' : retention > 0 && retention < 0.4 ? 'down' : undefined}
          />
        ) : (
          <StatCard
            label="Product-market fit"
            numeric={game.pmf}
            format={(n) => `${Math.round(n)}/100`}
            delta={pmfLabel(game.pmf)}
            tone={game.pmf >= 60 ? 'up' : game.pmf < 30 ? 'down' : undefined}
          />
        )}
        <StatCard
          label="People"
          value={game.employees.length === 0 ? 'Just you' : `${game.employees.length}`}
          delta={
            game.employees.length === 0
              ? `energy ${Math.round(game.energy)}`
              : `lowest morale ${Math.round(lowest!)} · energy ${Math.round(game.energy)}`
          }
          tone={anyAtRisk || game.energy <= 12 ? 'down' : undefined}
        />
      </div>

      {/* Career: the PMF/retention number above is an output — say what it is made of. */}
      <PmfExplainer />

      {/* Career: the same week read by named people with different weights; the promises ledger;
          the board sitting down. Each renders null without its capability. */}
      <TeamOpinions />
      <Commitments />
      <BoardMeeting />

      {/* Deliberately absent, and where it went: cash + valuation StatCards (hero subtext /
          Capital), both history charts (history is not a decision), milestones (the run record),
          "Latest news" (the Inbox), the Benchmarks panel (register items in src/attention.ts). */}
    </div>
  )
}
