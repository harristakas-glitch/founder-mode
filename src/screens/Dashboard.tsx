// Founder HQ — the weekly command center (owner brief "HQ / Weekly Briefing Final", 2026-08-23).
//
// The model, verbatim from the brief:
//
//   INBOX          = what is happening
//   CEO BRIEF      = what it means
//   COMPANY PULSE  = where the company stands
//   ON YOUR RADAR  = what is coming next
//
// Desktop is two columns — the Inbox dominating (~60%), the interpretation stack beside it.
// Mobile is one column: Inbox first (owner call 2026-08-23 — what's happening leads the phone),
// then Brief, Attention, Pulse, Radar,
// with the shell's sticky CTA underneath. HQ is NOT a dashboard: the shell owns raw metrics,
// the Brief interprets without recommending, and every number here is paired with meaning.
//
// What the previous HQ had, and where it went:
//   the HERO (binding constraint)     → its logic IS the CEO Brief now (ceoBrief below)
//   the attention register list       → Inbox rows — alarms are "what is happening"
//   the 4 StatCards + MetricDrawer    → Company Pulse rows (KPI + one interpretation)
//   the Why-PMF lecture panel         → cut (game-feel audit #1: a permanent lecture)
//   Upcoming                          → On Your Radar
//   StreamPeek                        → cut (mobile order puts the Inbox near the top)
// Career's named panels (FounderBriefing, TeamOpinions, Commitments, BoardMeeting) keep their
// depth below the columns — same HQ system, more to read in Simulation (brief §47).
import { useState } from 'react'
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Gavel,
  Landmark,
  Mail,
  Newspaper,
  Swords,
  TrendingUp,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Btn, EmptyState } from '../components'
import { money, num, pct } from '../format'
import { attentionRegister } from '../attention'
import { boardEffectiveTarget, growthRate, pmfLabel, runwayWeeks, totalUsers } from '../game/engine'
import { MODE_META, hasCapability, systemDepth } from '../game/modes'
import { ATTENTION_AREAS, ATTENTION_BUDGET, ATTENTION_META, attentionNeeds, attentionSignals, delegationCover } from '../game/strategic/attention'
import { bigBetDef } from '../game/strategic/bigbets'
import { BoardMeeting, Commitments, FounderBriefing, TeamOpinions, careerActive } from '../CareerUI'
import { MarketLeaderboard } from './Market'
import { DecisionLens } from '../onboarding/DecisionLens'
import { useStore, type ScreenId } from '../store'
import type { Message } from '../game/types'

// ---------------------------------------------------------------------------------------------
// Categories (brief §9): derived from REAL message fields — kind, meta, and the engine's own
// title conventions. Nothing is invented to fill a category.

type InboxCategory = 'decision' | 'people' | 'opportunity' | 'milestone' | 'info' | 'warning' | 'investor' | 'competitor'

const CATEGORY: Record<InboxCategory, { label: string; icon: LucideIcon; stripe: string; chip: string }> = {
  decision: { label: 'Decision', icon: Gavel, stripe: 'bg-warn', chip: 'border-warn/50 bg-warn/10 text-warn' },
  people: { label: 'People', icon: User, stripe: 'bg-accent', chip: 'border-accent/50 bg-accent/10 text-accent' },
  opportunity: { label: 'Opportunity', icon: Mail, stripe: 'bg-good', chip: 'border-good/50 bg-good/10 text-good' },
  milestone: { label: 'Milestone', icon: TrendingUp, stripe: 'bg-[var(--color-focus)]', chip: 'border-line2 bg-surface2 text-[var(--color-focus)]' },
  info: { label: 'Info', icon: Building2, stripe: 'bg-line2', chip: 'border-line2 bg-surface2 text-mut' },
  warning: { label: 'Warning', icon: AlertTriangle, stripe: 'bg-bad', chip: 'border-bad/50 bg-bad/10 text-bad' },
  investor: { label: 'Investor', icon: Landmark, stripe: 'bg-good', chip: 'border-line2 bg-surface2 text-ink' },
  competitor: { label: 'Competitor', icon: Swords, stripe: 'bg-line2', chip: 'border-line2 bg-surface2 text-mut' },
}

function categorize(m: Message): InboxCategory {
  if (m.kind === 'choice') return 'decision'
  if (m.meta?.rivalAttack || m.meta?.rivalName) return 'competitor'
  if (m.meta?.employeeId) return 'people'
  if (/🏁|🏆|🎉/.test(m.title)) return 'milestone'
  if (/⚠️|☠️/.test(m.title) || (m.kind === 'system' && /bridge|covenant|zero/i.test(m.title))) return 'warning'
  if (/term sheet|investor|raised|round|seed|series/i.test(m.title)) return 'investor'
  if (/📰|press|journalist|story/i.test(m.title)) return 'info'
  return 'info'
}

/** One row of the feed — either a real inbox message or an attention-register alarm. */
interface Row {
  id: string
  category: InboxCategory
  title: string
  description: string
  week?: number
  needsYou: boolean
  message?: Message // real inbox item — expandable, decisions resolvable in place
  action?: { label: string; screen: ScreenId; anchor?: string } // register alarm — navigates
  deadline?: number
}

// ---------------------------------------------------------------------------------------------
// The CEO Brief (brief §15–§16, §51): deterministic interpretation, no recommendations, no raw
// KPI dumps. The chapter title and the constraint line come from the same binding-constraint
// precedence the old hero used — money clock, board bar, fit clock, calm — so the Brief SAYS
// what the hero used to show.

function ceoBrief(game: NonNullable<ReturnType<typeof useStore.getState>['game']>): { chapter: string; lines: string[] } {
  const runway = runwayWeeks(game)
  const profitable = runway === Infinity
  const growth = growthRate(game)
  const target = game.board ? boardEffectiveTarget(game) : 0
  const career = careerActive(game) ? game.career! : null
  const retention = career ? (career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) : 0
  const fitFound = career ? retention >= 0.55 : game.pmf >= 60

  // one growth read
  const growthLine = game.board
    ? growth >= target
      ? `Growth clears the board's bar — ${pct(growth, 1)} a week against ${pct(target, 1)} expected.`
      : `Growth is under the board's bar: ${pct(growth, 1)} against ${pct(target, 1)} expected, review week ${game.board.nextReview}.`
    : growth > 0.02
      ? `Growth is strong. You're gaining traction week over week.`
      : growth > 0
        ? `Growth is positive but slow — ${pct(growth, 1)} a week.`
        : `Growth has stalled. Nothing new is arriving on its own.`

  // one fit read
  const fitLine = career
    ? retention <= 0
      ? 'No retention signal yet. Fit is read off customers who stay — win some first.'
      : retention < 0.55
        ? `Retention is the constraint — ${Math.round(retention * 100)}% of your target segment stays. Fit moves when that does.`
        : `Retention holds at ${Math.round(retention * 100)}%. The segment is answering.`
    : game.pmf < 30
      ? `${pmfLabel(game.pmf)} — the market hasn't said yes yet.`
      : game.pmf < 60
        ? `Fit is forming (${Math.round(game.pmf)}/100). Real interest, not yet a must-have.`
        : `Fit is real (${Math.round(game.pmf)}/100). Protect quality while you scale.`

  // one runway read
  const runwayLine = profitable
    ? 'Revenue covers burn. The clock is off.'
    : runway < 10
      ? `Runway is the emergency: ${Math.max(0, Math.floor(runway))} weeks. Raise, cut, or earn — this quarter.`
      : runway < 26
        ? `Runway is the clock: ${Math.max(0, Math.floor(runway))} weeks left.`
        : 'Runway is healthy. You have time to build.'

  const chapter =
    !profitable && runway < 26
      ? 'Runway pressure'
      : game.board && growth < target
        ? "Under the board's bar"
        : !fitFound
          ? 'Searching for fit'
          : 'Scaling what works'

  return { chapter, lines: [growthLine, fitLine, runwayLine] }
}

// ---------------------------------------------------------------------------------------------

const PANEL = 'rounded-[14px] border border-line bg-surface shadow-[var(--elev-2)]'

function CEOBriefCard() {
  const game = useStore((s) => s.game)!
  const brief = ceoBrief(game)
  return (
    <section className={`${PANEL} p-4 md:p-5`}>
      <div className="flex items-center gap-2">
        <Newspaper size={15} className="text-accent" aria-hidden />
        <h2 className="text-[15px] font-extrabold tracking-tight">CEO Brief</h2>
      </div>
      <div className="mt-2 text-[15px] font-bold text-accent">{brief.chapter}</div>
      <div className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-mut">
        {brief.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Company Pulse (brief §18–§21): four rows, KPI + one contextual interpretation, fixed columns.

function CompanyPulseCard() {
  const game = useStore((s) => s.game)!
  const runway = runwayWeeks(game)
  const growth = growthRate(game)
  const career = careerActive(game) ? game.career! : null
  const retention = career ? (career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) : 0
  const h = game.history
  const userDelta = h.length >= 2 ? totalUsers(game) - h[h.length - 2].users : totalUsers(game)
  const lowest = game.employees.length > 0 ? game.employees.reduce((m, e) => Math.min(m, e.morale), 100) : null

  const rows: { icon: LucideIcon; label: string; value: string; valueTone: string; context: string }[] = [
    {
      icon: TrendingUp,
      label: 'Market Fit',
      value: career && retention > 0 ? `${Math.round(retention * 100)}% stay` : `${Math.round(game.pmf)} / 100`,
      valueTone: 'text-accent',
      context: career
        ? retention <= 0
          ? 'no retention signal yet'
          : retention < 0.55
            ? 'retention is the constraint'
            : 'the segment is answering'
        : pmfLabel(game.pmf).toLowerCase(),
    },
    {
      icon: TrendingUp,
      label: 'Momentum',
      value: `${growth >= 0 ? '+' : ''}${pct(growth, 1)} / wk`,
      valueTone: growth > 0 ? 'text-good' : growth < 0 ? 'text-bad' : 'text-mut',
      context: `${userDelta >= 0 ? '+' : ''}${num(userDelta)} users`,
    },
    {
      icon: CalendarDays,
      label: 'Survival',
      value: runway === Infinity ? 'Profitable' : `${Math.max(0, Math.floor(runway))} wk runway`,
      valueTone: runway === Infinity ? 'text-good' : runway < 10 ? 'text-bad' : runway < 26 ? 'text-warn' : 'text-[var(--color-focus)]',
      context: `${money(game.cash)} cash`,
    },
    {
      icon: Users,
      label: 'Team',
      value: game.employees.length === 0 ? 'Just you' : `${game.employees.length + 1} people`,
      valueTone: 'text-warn',
      context:
        lowest !== null && lowest < 40 ? `lowest morale ${Math.round(lowest)}` : `Energy ${Math.round(game.energy)}`,
    },
  ]

  return (
    <section className={`${PANEL} p-4 md:p-5`}>
      <h2 className="text-[15px] font-extrabold tracking-tight">Company Pulse</h2>
      <div className="mt-2 divide-y divide-line/50">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[26px_92px_minmax(0,1fr)] items-center gap-x-2 py-2 sm:grid-cols-[26px_100px_minmax(0,1fr)_minmax(0,1fr)]">
            <r.icon size={15} className="text-accent/80" aria-hidden />
            <span className="text-[12.5px] font-semibold text-ink">{r.label}</span>
            <span className={`text-[14px] font-bold tnum ${r.valueTone}`}>{r.value}</span>
            <span className="col-span-full pl-[34px] text-[11.5px] leading-snug text-mut sm:col-span-1 sm:pl-0 sm:text-right">{r.context}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Your Attention (Strategic Systems phase 4, brief §9): where the founder personally spends
// the week. Light modes: ONE Focus chip — a single bounded boost, tap to move it. Simulation:
// the 8-point allocator with needs, crisis forcing and dependency read as words, never numbers
// (§8.9: no formulas). Arena: attention is off — turn actions already price it — so no card.

function AttentionCard() {
  const game = useStore((s) => s.game)!
  const setFocus = useStore((s) => s.setAttentionFocus)
  const setAlloc = useStore((s) => s.setAttentionAllocation)
  const depth = systemDepth(game, 'founderAttention')
  if (depth === 'off') return null

  const attn = game.attention ?? { focus: null, dependency: {} }
  const deepOn = depth === 'deep' && !!attn.allocated
  const bet = game.bigBet?.status === 'active' ? bigBetDef(game.bigBet.type) : null
  const affinity = new Set(bet?.attentionAffinity ?? [])

  // --- light (and deep before first allocation): one Focus chip-row ---
  if (!deepOn) {
    return (
      <section className={`${PANEL} p-4 md:p-5`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-extrabold tracking-tight">Your Focus</h2>
          <span className="text-[11px] text-mut">where you personally spend the week</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ATTENTION_AREAS.map((area) => {
            const meta = ATTENTION_META[area]
            const active = attn.focus === area
            return (
              <button
                key={area}
                onClick={() => setFocus(active ? null : area)}
                title={meta.moves + (affinity.has(area) ? ' · supports your Big Bet' : '')}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-bold transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-accent'
                    : 'border-line2 bg-surface2 text-mut hover:text-ink'
                }`}
              >
                {meta.icon} {meta.label}
                {affinity.has(area) && <span className="ml-1 text-[10px] text-good">🎯</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-2 text-[11.5px] leading-snug text-mut">
          {attn.focus
            ? `${ATTENTION_META[attn.focus].moves} get your personal push this week.`
            : 'Pick one. Founder time is leverage — a focused week moves that area more than money does.'}
        </div>
        {depth === 'deep' && (
          <button
            onClick={() => setAlloc({ product: 2 })}
            className="mt-2 text-[11.5px] font-semibold text-accent hover:underline"
          >
            Switch to the full weekly allocator →
          </button>
        )}
      </section>
    )
  }

  // --- deep: the 8-point weekly allocator ---
  const alloc = attn.allocated!
  const spent = ATTENTION_AREAS.reduce((a, k) => a + (alloc[k] ?? 0), 0)
  const forced = attn.forcedWeek === game.week ? (attn.forced ?? {}) : {}
  const forcedSum = Object.values(forced).reduce((a: number, b) => a + (b ?? 0), 0)
  const budget = ATTENTION_BUDGET - forcedSum
  const needs = attentionNeeds(game)
  const cover = delegationCover(game)
  const signals = attentionSignals(game)
  const step = (area: (typeof ATTENTION_AREAS)[number], d: number) => {
    const cur = alloc[area] ?? 0
    const next = Math.max(0, Math.min(6, cur + d))
    if (next === cur) return
    if (d > 0 && spent >= budget) return
    setAlloc({ ...alloc, [area]: next })
  }

  return (
    <section className={`${PANEL} p-4 md:p-5`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold tracking-tight">Your Week</h2>
        <span className={`text-[12px] font-bold tnum ${spent >= budget ? 'text-warn' : 'text-accent'}`}>
          {budget - spent} of {budget} left
        </span>
      </div>
      {forcedSum > 0 && (
        <div className="mt-1.5 rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-bad">
          🔥 Operations demanded {forcedSum} points this week — the fire eats your plan first.
        </div>
      )}
      <div className="mt-2 divide-y divide-line/50">
        {ATTENTION_AREAS.map((area) => {
          const meta = ATTENTION_META[area]
          const pts = alloc[area] ?? 0
          const need = needs[area] ?? 0
          const covered = (cover[area] ?? 0) > 0
          const short = need - pts - (cover[area] ?? 0) > 0
          return (
            <div key={area} className="flex items-center gap-2 py-1.5">
              <span className="w-[118px] shrink-0 text-[12.5px] font-semibold text-ink">
                {meta.icon} {meta.label}
                {affinity.has(area) && (
                  <span className="ml-1 text-[10px] text-good" title="supports your Big Bet">🎯</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-[3px]">
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    className={`h-2 w-2 rounded-full ${i < pts ? 'bg-accent' : i < need ? 'border border-warn/60' : 'border border-line2'}`}
                  />
                ))}
              </span>
              <span className="text-[10.5px] text-mut">
                {covered ? 'delegated' : short ? <span className="text-warn">needs you</span> : ''}
              </span>
              <span className="flex shrink-0 gap-1">
                <button onClick={() => step(area, -1)} disabled={pts === 0} className="h-6 w-6 rounded-md border border-line2 bg-surface2 text-[13px] font-bold text-mut disabled:opacity-30">−</button>
                <button onClick={() => step(area, 1)} disabled={pts >= 6 || spent >= budget} className="h-6 w-6 rounded-md border border-line2 bg-surface2 text-[13px] font-bold text-mut disabled:opacity-30">+</button>
              </span>
            </div>
          )
        })}
      </div>
      {signals.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {signals.map((line) => (
            <div key={line} className="text-[11.5px] leading-snug text-warn">· {line}</div>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[11px] leading-snug text-mut">
        Hollow rings are where the company needs you. Spreading thin is weak; senior hires can carry areas for you.
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// On Your Radar (brief §22): the top three dated things, each a link to where it is acted on.

function OnYourRadarCard() {
  const game = useStore((s) => s.game)!
  const setScreen = useStore((s) => s.setScreen)
  const items: { weeks: number; label: string; screen: ScreenId; icon: LucideIcon }[] = []
  if (game.board) items.push({ weeks: Math.max(0, game.board.nextReview - game.week), label: 'Board review', screen: 'fundraising', icon: Landmark })
  const sheet = [...game.termSheets].sort((a, b) => a.weeksLeft - b.weeksLeft)[0]
  if (sheet) items.push({ weeks: sheet.weeksLeft, label: `${sheet.investor} offer expires`, screen: 'fundraising', icon: Landmark })
  const cand = [...game.candidates].sort((a, b) => a.weeksLeft - b.weeksLeft)[0]
  if (cand) items.push({ weeks: cand.weeksLeft, label: `${cand.name} leaves the pool`, screen: 'hiring', icon: User })
  if ((game.flags.priceWar ?? 0) > 0) items.push({ weeks: game.flags.priceWar, label: 'Price war ends', screen: 'market', icon: Swords })
  if (game.rally) items.push({ weeks: game.rally.weeksLeft, label: 'Rally fades', screen: 'team', icon: Users })
  if (game.challenge) items.push({ weeks: Math.max(0, game.challenge.cap - game.week), label: 'The run ends', screen: 'dashboard', icon: CalendarDays })
  const top = items.sort((a, b) => a.weeks - b.weeks).slice(0, 3)

  return (
    <section className={`${PANEL} p-4 md:p-5`}>
      <h2 className="text-[15px] font-extrabold tracking-tight">On Your Radar</h2>
      {top.length === 0 ? (
        <div className="mt-2 text-[12.5px] text-mut">Nothing on your radar.</div>
      ) : (
        <div className="mt-1 divide-y divide-line/50">
          {top.map((i) => (
            <button
              key={i.label}
              onClick={() => setScreen(i.screen)}
              className="grid w-full grid-cols-[26px_minmax(0,1fr)_44px] items-center gap-x-2 py-2 text-left transition-colors hover:text-ink"
            >
              <i.icon size={15} className="text-accent/80" aria-hidden />
              <span className="truncate text-[12.5px] text-ink">{i.label}</span>
              <span className={`text-right text-[12px] font-bold tnum ${i.weeks <= 1 ? 'text-warn' : 'text-mut'}`}>
                {i.weeks === 0 ? 'now' : `${i.weeks}w`}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// The Inbox — the heart of HQ (brief §6–§14). One structured feed on ONE internal grid: every
// title starts at the same x, every tag column is fixed, every time value right-aligns. Rows are
// real inbox messages (decisions resolvable in place — the week's gating lives here) plus the
// attention register's alarms, which are "what is happening" as much as any message.

function InboxRow({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  const resolveChoice = useStore((s) => s.resolveChoice)
  const setScreen = useStore((s) => s.setScreen)
  const game = useStore((s) => s.game)!
  const cat = CATEGORY[row.category]
  const Icon = cat.icon
  const time = row.week === undefined ? (row.deadline !== undefined ? (row.deadline === 0 ? 'now' : `${row.deadline}w`) : '') : row.week >= game.week ? 'now' : `${game.week - row.week}w`

  const interactive = !!row.message || !!row.action
  const onClick = row.action
    ? () => {
        setScreen(row.action!.screen)
        if (row.action!.anchor) setTimeout(() => document.getElementById(row.action!.anchor!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      }
    : row.message
      ? onToggle
      : undefined

  return (
    <div className={`relative ${row.needsYou ? 'bg-surface2/60' : ''}`}>
      <span aria-hidden className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full ${cat.stripe}`} />
      <button
        type="button"
        onClick={onClick}
        disabled={!interactive}
        aria-expanded={row.message ? open : undefined}
        className={`w-full text-left ${interactive ? 'transition-colors duration-[120ms] hover:bg-surface2' : ''}`}
      >
        {/* desktop grid: | stripe | icon | tag | title+description | status | time | */}
        <div className="hidden items-center gap-x-3 py-2.5 pr-3 pl-4 md:grid md:grid-cols-[36px_106px_minmax(0,1fr)_86px_40px]">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line/70 bg-surface2" aria-hidden>
            <Icon size={16} className="text-mut" />
          </span>
          <span>
            <span className={`inline-block rounded-md border px-1.5 py-px text-[9.5px] font-bold tracking-[0.08em] uppercase ${cat.chip}`}>{cat.label}</span>
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-[14px] leading-snug font-bold ${row.needsYou ? 'text-ink' : 'text-ink/85'}`}>{row.title}</span>
            {row.description && <span className="block truncate text-[12px] leading-snug text-mut">{row.description}</span>}
          </span>
          <span className={`text-[10px] font-bold tracking-[0.08em] uppercase ${row.needsYou ? 'text-warn' : 'text-transparent'}`}>
            {row.needsYou ? 'Needs you' : ''}
          </span>
          <span className="text-right text-[11px] text-mut tnum">{time}</span>
        </div>
        {/* mobile grid: | stripe | icon | tag-over-title | right meta | — one shared title edge */}
        <div className="grid grid-cols-[34px_minmax(0,1fr)_52px] items-start gap-x-2.5 py-2.5 pr-2.5 pl-3.5 md:hidden">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[9px] border border-line/70 bg-surface2" aria-hidden>
            <Icon size={15} className="text-mut" />
          </span>
          <span className="min-w-0">
            <span className={`inline-block rounded-md border px-1.5 py-px text-[9px] font-bold tracking-[0.08em] uppercase ${cat.chip}`}>{cat.label}</span>
            <span className={`mt-0.5 block text-[13.5px] leading-snug font-bold ${row.needsYou ? 'text-ink' : 'text-ink/85'}`}>{row.title}</span>
            {row.description && <span className="line-clamp-1 block text-[11.5px] leading-snug text-mut">{row.description}</span>}
          </span>
          <span className="text-right">
            {row.needsYou && <span className="block text-[9px] font-bold tracking-[0.06em] text-warn uppercase">Needs you</span>}
            <span className="block text-[10.5px] text-mut tnum">{time}</span>
          </span>
        </div>
      </button>

      {/* the detail, only when requested (brief §38) — decisions resolve right here, because the
          week is gated on them and the amber Decide button lands the player on this list */}
      {row.message && open && (
        <div className="border-t border-line/40 py-3 pr-3 pl-4 md:pl-[64px]">
          <div className="max-w-[70ch] text-[13px] leading-relaxed text-mut">{row.message.body}</div>
          {row.needsYou && <DecisionLens message={row.message} />}
          {row.needsYou && row.message.choices && (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.message.choices.map((c, i) => (
                <Btn key={i} className="h-auto max-w-full !whitespace-normal py-2 text-left" onClick={() => resolveChoice(row.message!.id, i)}>
                  {c.label}
                </Btn>
              ))}
            </div>
          )}
          {row.message.resolved && row.message.resultText && <div className="mt-2 text-[13px] italic text-good">→ {row.message.resultText}</div>}
          {row.message.resolved && <DecisionLens message={row.message} />}
        </div>
      )}
    </div>
  )
}

function InboxPanel() {
  const game = useStore((s) => s.game)!
  const [needsOnly, setNeedsOnly] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // real messages
  const msgRow = (m: Message): Row => ({
    id: m.id,
    category: categorize(m),
    title: m.title,
    description: m.resolved && m.resultText ? m.resultText : m.body,
    week: m.week,
    needsYou: m.kind === 'choice' && !m.resolved,
    message: m,
  })
  const unresolved = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).map(msgRow)
  const settled = game.inbox.filter((m) => !(m.kind === 'choice' && !m.resolved)).map(msgRow)

  // the register's alarms — facts no message owns (covenant, the person about to quit, the
  // market acting on you). Decisions are skipped: they are already rows above.
  const alarms: Row[] = attentionRegister(game)
    .filter((i) => !i.id.startsWith('decision:'))
    .map((i) => ({
      id: i.id,
      category: i.type === 'urgent' ? 'warning' : i.type === 'decision' ? 'warning' : i.type === 'opportunity' ? 'opportunity' : 'info',
      title: i.title,
      description: i.detail ?? '',
      needsYou: i.type === 'urgent' || i.type === 'decision',
      action: i.action ? { label: i.action.label, screen: i.action.screen as ScreenId, anchor: i.action.anchor } : undefined,
      deadline: i.deadline,
    }))

  const all = [...unresolved, ...alarms, ...settled]
  const needsCount = all.filter((r) => r.needsYou).length
  const filtered = needsOnly ? all.filter((r) => r.needsYou) : all
  const visible = showAll ? filtered : filtered.slice(0, Math.max(6, unresolved.length + alarms.length))
  const hidden = filtered.length - visible.length

  // the week's blocker opens itself — the play loop must never hide behind a collapsed row
  const effectiveOpen = openId ?? unresolved[0]?.id ?? null

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/60 px-4 py-3 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-extrabold tracking-tight">Inbox</h2>
          <div className="text-[11.5px] text-mut">
            {all.length} item{all.length === 1 ? '' : 's'}
            {needsCount > 0 && (
              <>
                {' · '}
                <span className="font-bold text-warn">
                  {needsCount} need{needsCount === 1 ? 's' : ''} you
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => setNeedsOnly((v) => !v)}
          aria-pressed={needsOnly}
          className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-[120ms] ${
            needsOnly ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line2 text-mut hover:text-ink'
          }`}
        >
          Needs you
        </button>
      </div>

      {all.length === 0 ? (
        <div className="px-5 py-8">
          <EmptyState icon={<Mail size={22} />} title="You're caught up." hint="Nothing needs your attention this week." />
        </div>
      ) : (
        <div className="divide-y divide-line/40">
          {visible.map((r) => (
            <InboxRow key={r.id} row={r} open={effectiveOpen === r.id} onToggle={() => setOpenId(effectiveOpen === r.id ? '' : r.id)} />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full border-t border-line/60 py-2.5 text-center text-[12.5px] font-bold text-accent transition-colors hover:text-ink"
        >
          View all messages ({hidden} more) →
        </button>
      )}
      {showAll && filtered.length > 8 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full border-t border-line/60 py-2.5 text-center text-[12.5px] font-semibold text-mut transition-colors hover:text-ink"
        >
          Show less
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------



function ArenaHqBoard() {
  const online = useStore((s) => s.online)
  if (!online || online.phase !== 'playing') return null
  return (
    <div className="mb-4">
      <MarketLeaderboard />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
export function Dashboard() {
  const game = useStore((s) => s.game)!

  return (
    <div>
      {/* header — page identity, mode chip and energy (the shell owns the raw metrics) */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight md:text-[32px]">Weekly Briefing</h1>
          <div className="text-[13px] text-mut">
            Week {game.week} · <span className="text-accent">{game.stage}</span> · you own{' '}
            <span className="text-accent">{pct(game.founderEquity, 1)}</span>
            {game.challenge && ` · ${game.challenge.label}, ends wk ${game.challenge.cap}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-[12px] font-bold text-accent">
            {MODE_META[game.config?.mode ?? 'quick'].icon} {MODE_META[game.config?.mode ?? 'quick'].name}
          </span>
          {hasCapability(game, 'founderEnergy') && (
            <span
              className="flex items-center gap-1.5"
              title="Founder energy — big moves drain it, low energy weakens your weekly contribution. Recharge on the Team screen."
            >
              <span className="text-[10px] font-bold tracking-wider text-mut uppercase">Energy</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-black/40">
                <span
                  className="block h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${game.energy}%`,
                    background: game.energy < 25 ? 'var(--color-bad)' : game.energy < 50 ? 'var(--color-warn)' : 'var(--color-good)',
                  }}
                />
              </span>
              <span className="text-[10px] font-bold tnum">{Math.round(game.energy)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Arena: the FULL leaderboard on the HQ (owner call) — the same open-book board the
          Market screen carries, not a share-only summary. One component, two homes. */}
      <ArenaHqBoard />

      {/* the two-column core — Inbox dominant (~60%), the interpretation stack beside it.
          Mobile flattens to one column, CEO Brief first (brief §25/§27): the wrappers are
          display:contents below lg, so the order classes decide the phone sequence. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <div className="contents lg:block lg:min-w-0 lg:flex-[3]">
          {/* keyed by week: a new week's blocking decision must auto-expand even if the player
              collapsed last week's rows — stale open/filter state dies with the old week.
              Owner call 2026-08-23: the INBOX leads the phone — what's happening comes first,
              interpretation second. */}
          <div className="order-1"><InboxPanel key={game.week} /></div>
        </div>
        <div className="contents lg:block lg:min-w-0 lg:flex-[2] lg:space-y-4">
          <div className="order-2"><CEOBriefCard /></div>
          {/* attention sits right under the Brief: it's the one INPUT on this screen — the
              decision the briefing is meant to inform (phase 4; arena renders nothing) */}
          <div className="order-3"><AttentionCard /></div>
          <div className="order-4"><CompanyPulseCard /></div>
          <div className="order-5"><OnYourRadarCard /></div>
        </div>
      </div>

      {/* Career's named depth — the same HQ, more to read in Simulation (brief §47) */}
      <div className="mt-4">
        <FounderBriefing />
        <TeamOpinions />
        <Commitments />
        <div id="board-meeting"><BoardMeeting /></div>
      </div>
    </div>
  )
}
