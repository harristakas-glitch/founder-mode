import { BenchRow, EmptyState, LineChart, Panel, StatCard, TrendBadge } from '../components'
import { money, num, pct } from '../format'
import { STAGE_THRESHOLDS, sectorById } from '../game/data'
import {
  demandSignal,
  MILESTONES,
  avgMorale,
  boardEffectiveTarget,
  committedCosts,
  growthRate,
  hasPendingDecision,
  nextStage,
  pmfLabel,
  productScore,
  runwayWeeks,
  totalUsers,
  valuation,
  weeklyBurn,
} from '../game/engine'
import { BoardMeeting, Commitments, FounderBriefing, PmfExplainer, TeamOpinions, careerActive } from '../CareerUI'
import { openInteractions } from '../game/world/interactions'
import { PMF_LABEL, segmentSnapshots } from '../game/career/pmf'
import { useStore } from '../store'

// This week vs last: the one-glance digest of what just happened.
function WeekDigest() {
  const game = useStore((s) => s.game)!
  const h = game.history
  if (h.length < 2) return null
  const now = h[h.length - 1]
  const prev = h[h.length - 2]
  const items: { label: string; delta: number; format?: (n: number) => string; invert?: boolean }[] = [
    { label: 'Users', delta: now.users - prev.users, format: num },
    { label: 'Cash', delta: now.cash - prev.cash, format: money },
    { label: 'Revenue', delta: now.revenue - prev.revenue, format: money },
    { label: 'PMF', delta: now.pmf - prev.pmf, format: (n: number) => n.toFixed(1) },
    { label: 'Valuation', delta: now.valuation - prev.valuation, format: money },
  ].filter((i) => i.delta !== 0)
  if (items.length === 0) return null
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-line/60 bg-surface/60 px-4 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-mut">This week</span>
      {items.map((i) => (
        <span key={i.label} className="whitespace-nowrap text-[13px]">
          <span className="text-mut">{i.label}</span>
          <TrendBadge value={i.delta} format={i.format} invert={i.invert} />
        </span>
      ))}
    </div>
  )
}

function Benchmarks() {
  const game = useStore((s) => s.game)!
  const sector = sectorById(game.sector)
  const growth = growthRate(game)
  const growthTarget = game.board ? boardEffectiveTarget(game) : 0.04
  const churn = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))
  const churnBench = sector.churn
  const pmfPace = Math.min(85, game.week * 1.6)
  const runway = runwayWeeks(game)
  const bestRival = [...game.rivals.filter((r) => r.alive)].sort((a, b) => b.product - a.product)[0]
  const pScore = productScore(game)
  const tone = (ok: boolean, mid: boolean): 'good' | 'warn' | 'bad' => (ok ? 'good' : mid ? 'warn' : 'bad')

  return (
    <Panel title="How you compare — benchmarks">
      <BenchRow metric="User growth" tone={tone(growth >= growthTarget, growth >= growthTarget * 0.6)}>
        <b className="tnum">{pct(growth, 1)}/wk</b>{' '}
        <span className="text-mut">vs {pct(growthTarget, 1)} {game.board ? 'board target' : 'healthy pre-seed pace'}</span>
      </BenchRow>
      <BenchRow metric="Churn" tone={tone(churn <= churnBench, churn <= churnBench * 1.5)}>
        <b className="tnum">{pct(churn, 1)}/wk</b>{' '}
        <span className="text-mut">vs {pct(churnBench, 1)} market average — driven by PMF, quality, bugs</span>
      </BenchRow>
      <BenchRow metric="PMF pace" tone={tone(game.pmf >= pmfPace, game.pmf >= pmfPace * 0.6)}>
        <b className="tnum">{Math.round(game.pmf)}</b>{' '}
        <span className="text-mut">vs ~{Math.round(pmfPace)} expected by week {game.week} — winners find fit by ~week 40</span>
      </BenchRow>
      <BenchRow metric="Runway" tone={tone(runway === Infinity || runway >= 30, runway >= 15)}>
        <b className="tnum">{runway === Infinity ? 'profitable' : `${Math.floor(runway)} wk`}</b>{' '}
        <span className="text-mut">vs 30+ wk healthy — under 10 and candidates refuse offers</span>
      </BenchRow>
      <BenchRow
        metric="Cash buffer"
        tone={tone(game.cash >= committedCosts(game).recommended, game.cash >= committedCosts(game).recommended * 0.5)}
      >
        <b className="tnum">{money(game.cash)}</b>{' '}
        <span className="text-mut">
          vs {money(committedCosts(game).recommended)} recommended — covers committed fees + a worst-case bill (see Finance)
        </span>
      </BenchRow>
      {bestRival && (
        <BenchRow metric="Product vs rivals" tone={tone(pScore >= bestRival.product, pScore >= bestRival.product - 15)}>
          <b className="tnum">{Math.round(pScore)}</b>{' '}
          <span className="text-mut">vs {Math.round(bestRival.product)} for {bestRival.name} — fall 15+ behind and they steal users</span>
        </BenchRow>
      )}
    </Panel>
  )
}

// The briefing: the benchmarks panel already knows what is wrong, but it sits at the bottom
// in muted grey. This lifts the single most urgent thing to the top, with the button that
// acts on it — so the Dashboard answers "what should I do this week?", not just "what am I?".
interface Attention {
  tone: 'bad' | 'warn' | 'good'
  text: string
  action?: { label: string; screen: Parameters<ReturnType<typeof useStore.getState>['setScreen']>[0] }
}

function attentionItems(game: ReturnType<typeof useStore.getState>['game']): Attention[] {
  if (!game) return []
  const out: Attention[] = []
  const runway = runwayWeeks(game)
  const pmfPace = Math.min(85, game.week * 1.6)

  if (hasPendingDecision(game))
    out.push({ tone: 'bad', text: 'A decision is blocking the week.', action: { label: 'Open Inbox', screen: 'inbox' } })
  // Living World Phase 8. The rooms live on three different screens (§74's progressive
  // disclosure), so the strip is what stops an unanswered one going unnoticed — and it names the
  // ONE that is closest to going cold, because a queue of nudges is not a nudge.
  for (const room of openInteractions(game.world)) {
    if (room.kind === 'conversation')
      out.push({ tone: 'warn', text: `${room.title}.`, action: { label: 'Team', screen: 'team' } })
    else if (room.kind === 'board_meeting')
      out.push({ tone: 'warn', text: 'The board is waiting on a decision from you.', action: { label: 'Read the room', screen: 'dashboard' } })
    else
      out.push({
        tone: 'good',
        text: `${room.movesLeft} interview question${room.movesLeft === 1 ? '' : 's'} left — the calls are still running.`,
        action: { label: 'Discovery', screen: 'discovery' },
      })
    break
  }
  if (runway !== Infinity && runway < 12)
    out.push({
      tone: 'bad',
      text: `Only ${Math.max(0, Math.floor(runway))} weeks of runway left — raise, or cut burn now.`,
      action: { label: 'Fundraising', screen: 'fundraising' },
    })
  if (game.termSheets.length > 0)
    out.push({
      tone: 'good',
      text: `${game.termSheets.length} term sheet${game.termSheets.length === 1 ? '' : 's'} on the table — they expire.`,
      action: { label: 'Review', screen: 'fundraising' },
    })
  // The one warning that names the SEED, not the play. `demandSignal` only reads 'weak' once
  // researchSignal >= 14 — i.e. the player has done the research and the research came back
  // negative. Before this line the verdict lived only on the Product screen, while the player
  // watching PMF stall was here, on the Dashboard, being told to work harder at an idea the
  // engine had already priced as unwinnable-at-reasonable-effort. A weak-resonance company now
  // settles at a low PMF equilibrium instead of decaying to zero (the P2 proportional decay), so
  // "pivot" is honest advice rather than a eulogy: research carries over and tilts the next roll.
  if (!careerActive(game) && demandSignal(game) === 'weak')
    out.push({
      tone: 'bad',
      text: 'Your research came back: demand for this idea is WEAK. More effort will not fix the idea — a pivot might, and your research carries over.',
      action: { label: 'Product — pivot', screen: 'product' },
    })
  // Career derives PMF from retained customers, so "research harder" is actively wrong advice
  // there — the fix is retention, and the screen that shows it is Discovery.
  if (game.week > 6 && game.pmf < pmfPace * 0.6) {
    const career = careerActive(game) ? game.career! : null
    const retention = career ? (career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) : 0
    out.push(
      career
        ? {
            tone: 'warn',
            text:
              retention > 0
                ? `PMF ${Math.round(game.pmf)} — it is read off customers who stay, and only ${Math.round(retention * 100)}% of your target segment is still here after four weeks.`
                : `PMF ${Math.round(game.pmf)} — nothing has retained long enough to measure yet. Research moves your beliefs; only paying customers who stay move PMF.`,
            action: { label: 'Discovery', screen: 'discovery' },
          }
        : {
            tone: 'warn',
            text: `PMF ${Math.round(game.pmf)} against ~${Math.round(pmfPace)} expected by week ${game.week}. The market isn't biting — research harder, or pivot.`,
            action: { label: 'Product', screen: 'product' },
          },
    )
  }
  if (game.bugs > 55)
    out.push({
      tone: 'warn',
      text: `Bugs at ${Math.round(game.bugs)} are driving churn and scaring off the press.`,
      action: { label: 'Shift focus', screen: 'product' },
    })
  if (avgMorale(game) < 45 && game.employees.length > 0)
    out.push({ tone: 'warn', text: 'Team morale is low — output suffers and people start leaving.', action: { label: 'Team', screen: 'team' } })
  if (game.board && game.board.strikes > 0)
    out.push({
      tone: 'bad',
      text: `The board has issued ${game.board.strikes} strike${game.board.strikes === 1 ? '' : 's'}. Miss the next review and you can be replaced.`,
      action: { label: 'Fundraising', screen: 'fundraising' },
    })
  return out.slice(0, 3)
}

function AttentionStrip() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const items = attentionItems(game)
  if (items.length === 0) {
    return (
      <div className="mb-3.5 rounded-2xl border border-good/30 bg-good/5 px-4 py-2.5 text-[13px] text-mut">
        ✓ Nothing on fire. Good week to make a bet.
      </div>
    )
  }
  const ring = { bad: 'border-bad/40 bg-bad/8', warn: 'border-warn/40 bg-warn/8', good: 'border-good/40 bg-good/8' }
  const dot = { bad: 'bg-bad', warn: 'bg-warn', good: 'bg-good' }
  return (
    <div className="mb-3.5 space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border px-4 py-2.5 ${ring[it.tone]}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[it.tone]}`} />
          <span className="flex-1 text-[13.5px] leading-snug">{it.text}</span>
          {it.action && (
            <button
              className="shrink-0 rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-semibold transition-colors hover:border-accent hover:text-ink"
              onClick={() => setScreen(it.action!.screen)}
            >
              {it.action.label} →
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// In Career the number is derived, so the label under it should name the status the
// simulation actually assigned rather than Quick Play's generic band.
function careerPmfLabel(game: ReturnType<typeof useStore.getState>['game']): string | null {
  if (!careerActive(game) || !game) return null
  const rows = segmentSnapshots({
    career: game.career!,
    sector: game.sector,
    quality: game.quality,
    sectorTam: sectorById(game.sector).tam,
  })
  const best = [...rows].sort((a, b) => b.score - a.score)[0]
  if (!best) return null
  return `${PMF_LABEL[best.status]} in ${best.name} — derived from customers who stayed`
}

export function Dashboard() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const val = valuation(game)
  const runway = runwayWeeks(game)
  const growth = growthRate(game)
  const recent = game.inbox.slice(0, 4)
  const startWeek = game.history[0]?.week ?? 1

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Dashboard</h1>
      <div className="mb-4 text-[13px] text-mut">
        Week {game.week} · {game.stage} · You own {pct(game.founderEquity, 1)} of the company
      </div>

      {/* Career: what just happened and why, before what needs doing about it. */}
      <FounderBriefing />
      <AttentionStrip />
      <WeekDigest />


      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <StatCard
          label="Cash"
          numeric={game.cash}
          format={money}
          delta={
            game.cash < 40_000 && game.week > 6
              ? 'Buffer is thin — one bad event (cloud bill, recruiter fee) could end you'
              : `burn ${money(weeklyBurn(game))}/wk`
          }
          tone={game.cash < 40_000 && game.week > 6 ? 'down' : game.lastRevenue >= weeklyBurn(game) ? 'up' : undefined}
        />
        <StatCard
          label="Runway"
          value={runway === Infinity ? 'Profitable 🎉' : `${Math.max(0, Math.floor(runway))} weeks`}
          tone={runway !== Infinity && runway < 12 ? 'down' : undefined}
          delta={runway !== Infinity && runway < 12 ? 'Danger zone — raise or cut costs' : undefined}
        />
        <StatCard
          label={game.ventures.some((v) => v.launched) ? 'Users (all product lines)' : 'Users'}
          numeric={totalUsers(game)}
          format={num}
          delta={`${growth >= 0 ? '+' : ''}${pct(growth, 1)} /wk avg`}
          tone={growth >= 0 ? 'up' : 'down'}
        />
        {/* The next rung, not the summit: "0.1% of $1B" at week 13 tells a founder nothing
            they can act on, while "62% of the way to a Seed" is this month's actual job. */}
        <StatCard
          label="Valuation"
          numeric={val}
          format={money}
          delta={
            nextStage(game)
              ? `${pct(Math.min(1, val / STAGE_THRESHOLDS[game.stage]), 0)} of the way to ${nextStage(game)} (${money(STAGE_THRESHOLDS[game.stage])})`
              : `Goal: $1B — ${pct(val / 1e9, 1)} there`
          }
          tone={nextStage(game) && val >= STAGE_THRESHOLDS[game.stage] ? 'up' : undefined}
        />
      </div>

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
        <Panel title="Users over time">
          <LineChart data={game.history.map((h) => h.users)} formatY={num} startWeek={startWeek} />
        </Panel>
        <Panel title="Cash over time">
          <LineChart data={game.history.map((h) => h.cash)} color={game.cash > 0 ? 'var(--color-good)' : 'var(--color-bad)'} formatY={money} startWeek={startWeek} />
        </Panel>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <StatCard label="Product-market fit" numeric={game.pmf} format={(n) => `${Math.round(n)}/100`} delta={careerPmfLabel(game) ?? pmfLabel(game.pmf)} tone={game.pmf >= 60 ? 'up' : game.pmf < 30 ? 'down' : undefined} />
        <StatCard label="Hype" numeric={game.hype} format={(n) => `${Math.round(n)}/100`} delta={game.hype < 15 ? 'Nobody is talking about you' : undefined} />
        <StatCard label="Team morale" numeric={avgMorale(game)} format={(n) => `${Math.round(n)}/100`} tone={avgMorale(game) < 45 ? 'down' : undefined} delta={avgMorale(game) < 45 ? 'People are looking at the exits' : undefined} />
      </div>

      {/* Career: the PMF number above is an output. Say what it is made of, where it is read. */}
      <PmfExplainer />

      <div className="mt-3.5">
        <Benchmarks />
      </div>

      {/* Career: the same week, read by named people with different weights (§76). The benchmarks
          above say what the numbers are; this says what your team would DO about them — and they
          are allowed to disagree with each other. Carries its own margin so Quick Play (where it
          renders null) gets no stray spacing. */}
      <TeamOpinions />

      {/* Career: the promises ledger (§77) — what you committed to, who heard it, when it lands,
          and whether the numbers say you are on track. Renders null without the capability. */}
      <Commitments />

      {/* Career: the board sits down (§46-§47). Directly under the commitments, because the
          decision taken here becomes one of them. Renders null without the capability. */}
      <BoardMeeting />

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-2">
        <Panel title={`Milestones (${game.milestones.length}/${MILESTONES.length})`}>
          {MILESTONES.filter((m) => !game.milestones.includes(m.id))
            .slice(0, 4)
            .map((m) => (
              <div key={m.id} className="flex gap-2 py-1 text-[13px]">
                <span className="text-mut">◻</span>
                <span>
                  <b>{m.title}</b> <span className="text-mut">— {m.goal}</span>
                </span>
              </div>
            ))}
          {game.milestones.length === MILESTONES.length && <div className="text-good">All milestones achieved. There is only the unicorn left.</div>}
          {game.milestones.length > 0 && (
            <div className="mt-2 text-xs text-mut">
              Done: {game.milestones.map((id) => MILESTONES.find((m) => m.id === id)?.title).join(' · ')}
            </div>
          )}
        </Panel>
        <Panel title="Latest news">
          {recent.length === 0 && <EmptyState title="Nothing yet" hint="Advance the week to get things moving." />}
          {recent.map((m) => (
            <button
              key={m.id}
              className="-mx-2 block w-[calc(100%+1rem)] rounded-lg border-b border-line/40 px-2 py-2 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-surface2/60"
              onClick={() => setScreen('inbox')}
            >
              <div className="text-[11px] text-mut tnum">Week {m.week}</div>
              <div className="text-[13px] font-semibold">{m.title}</div>
            </button>
          ))}
        </Panel>
      </div>
    </div>
  )
}
