import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronsRight,
  Globe,
  HandCoins,
  Hourglass,
  DoorOpen,
  LayoutDashboard,
  Mail,
  Menu,
  Package,
  Swords,
  Users,
  Volume2,
  VolumeX,
  X,
  Wallet,
  Activity,
  Target,
  TrendingUp,
  Rocket,
} from 'lucide-react'
import { useStore, type ScreenId } from './store'
import { hasPendingDecision, runwayWeeks, valuation, weekDate, weeklyBurn, growthRate } from './game/engine'
import { money, num } from './format'
import { hasForfeited, isContesting, myId, type NetPlayer } from './net/online'
import { MODE_META, hasCapability } from './game/modes'
import { verifyRun, type VerifyResult } from './game/replay'
import { isMuted, setMuted } from './sound'
import { NewGame } from './screens/NewGame'
import { Lobby } from './screens/Lobby'
import { Dashboard } from './screens/Dashboard'
import { Team } from './screens/Team'
import { Hiring } from './screens/Hiring'
import { Product } from './screens/Product'
import { Growth } from './screens/Growth'
import { Market } from './screens/Market'
import { Finance } from './screens/Finance'
import { Fundraising } from './screens/Fundraising'
import { Discovery } from './screens/Discovery'
import { CohortAnalytics } from './screens/CohortAnalytics'
import { Story } from './screens/Story'
import { Confetti, Monogram, Ticker, TimelineChart, TrendBadge, RadialGauge, Sparkline } from './components'
import { runMarkers } from './runMarkers'
import { FieldGuideButton, FounderNotes } from './onboarding/FounderNotes'
import { FitPeek } from './FitPeek'
import { ChatWidget } from './ChatWidget'
import { DailyLeaderboard } from './screens/DailyLeaderboard'
import { GAME_URL, endingEmoji, sectorAccent } from './theme'
import { TOKEN_ENDING_FACES } from './game/token/endings'
import { standingBreakdown, networkExitPremium } from './game/token/scoring'
import { organicShare } from './game/token/users'
import type { GameState } from './game/types'

/**
 * The five destinations that ARE the game on a phone.
 *
 * The rail carries thirteen, which is a reasonable desktop sidebar and far too many for a thumb.
 * Native convention is about five, so the question is not "which five fit" but "which five is the
 * player actually in every week": read what the world did (dashboard), clear what is blocking the
 * turn (inbox), then the two dials they turn most (product, growth). Everything else — team,
 * hiring, market, finance, fundraising, story, career, and the two career-only screens — lives one
 * tap away behind More, which is a real destination and not a junk drawer: it carries its own
 * badge when anything inside it is waiting.
 *
 * Kept as ids rather than a second copy of the entries, so NAV stays the single source of labels,
 * icons and badges and these two lists cannot drift apart.
 */
/**
 * SIX AREAS, not thirteen rows (docs/ux-audit-2026-08.md §5; brief §11-§12).
 *
 * The old sidebar filed screens by NOUN — anything involving other companies went to Market,
 * anything involving money went to Fundraising — and the audit's diagnosis was that areas named
 * after nouns always accumulate until no screen can state a purpose. These are named after the
 * DECISION the player is there to take, and each existing ScreenId keeps working (brief §56: no
 * routing rewrite; a save that says `screen: 'cohorts'` lands exactly where it used to).
 *
 * An area with more than one screen renders its siblings as a small tab row above the content —
 * primary area → screen → contextual disclosure, never deeper (brief §13).
 *
 * Deliberately absent, per the audit's flags: WORLD would be empty (its whole candidate content is
 * one unlabelled sparkline plus a climate line derived from the same inputs — folded into Capital),
 * and CAREER (the trophy screen) is deleted outright: zero controls, reachable only mid-run, and
 * its headline stats were wrong by construction. Company is the record area: it must never carry a
 * badge and must never be the landing screen.
 */
const AREAS: {
  id: string
  label: string
  icon: typeof Mail
  screens: { id: ScreenId; label: string; careerOnly?: boolean }[]
}[] = [
  // One screen: the stream merged into the HQ (owner call, after FM26's Portal — messages are a
  // third of the overview, not a separate page). The 'inbox' ScreenId survives as an alias.
  { id: 'hq', label: 'HQ', icon: LayoutDashboard, screens: [{ id: 'dashboard', label: 'This week' }] },
  // Screen order within an area is PRIORITY: the first entry is where the area lands, so it must
  // be the screen with the weekly lever, never the report. Growth (the budget slider you touch
  // most weeks) outranks Rivals (reading); Hiring (send an offer) outranks Team (upkeep); Raise
  // (term sheets, board, votes — the decisions) outranks Finance (~90% report by the audit's own
  // measure). Owner call, 2026-08-20.
  { id: 'market', label: 'Market', icon: Swords, screens: [
    { id: 'growth', label: 'Growth' },
    { id: 'market', label: 'Rivals' },
  ] },
  { id: 'product', label: 'Product', icon: Package, screens: [
    { id: 'product', label: 'Build' },
    { id: 'discovery', label: 'Discovery', careerOnly: true },
    { id: 'cohorts', label: 'Cohorts', careerOnly: true },
  ] },
  { id: 'people', label: 'People', icon: Users, screens: [
    { id: 'hiring', label: 'Hiring' },
    { id: 'team', label: 'Team' },
  ] },
  { id: 'capital', label: 'Capital', icon: HandCoins, screens: [
    { id: 'fundraising', label: 'Raise' },
    { id: 'finance', label: 'Finance' },
  ] },
  { id: 'company', label: 'Company', icon: BookOpen, screens: [
    { id: 'story', label: 'Story' },
  ] },
]

const areaOf = (screen: ScreenId) => AREAS.find((a) => a.screens.some((sc) => sc.id === screen))

/** Five areas fit the tab bar; Company — the record, never urgent — rides behind More. */
const MOBILE_TABS: string[] = ['hq', 'market', 'product', 'people', 'capital']


interface RevealRow {
  id: string
  company: string
  me: boolean
  over: boolean
  users: number
  share: number
  delta: number
}

/**
 * Arena §43 — the round resolution, made visually important. Auto-dismisses in 3.4s and closes on
 * any click; it never gates anything (the ready flag is already on the wire before this renders),
 * so a player who taps through instantly loses nothing but the theatre.
 */
function RoundReveal({ week, rows, onClose }: { week: number; rows: RevealRow[]; onClose: () => void }) {
  const biggest = [...rows].filter((r) => !r.over).sort((a, b) => b.delta - a.delta)[0]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="rise-in relative w-full max-w-[440px] rounded-[14px] border border-line2 bg-surface3 p-5 shadow-[var(--elev-3)]">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-mut">Round {week}</div>
        {biggest && biggest.delta > 0 && (
          <div className="mt-1.5 text-[19px] font-bold tracking-[-0.01em]">
            {biggest.me ? 'You are' : `${biggest.company} is`} moving fastest
            <span className="ml-2 text-[14px] font-bold text-good tnum">+{num(biggest.delta)} users</span>
          </div>
        )}
        <div className="mt-3 space-y-1">
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-baseline gap-3 rounded-[8px] px-2.5 py-1.5 text-[13.5px] ${r.me ? 'bg-accent/12 font-bold' : ''}`}
            >
              <span className="w-4 shrink-0 text-right text-[11px] text-mut tnum">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {r.over ? '☠️ ' : ''}
                {r.company}
                {r.me ? ' (you)' : ''}
              </span>
              <span className="text-[12px] text-mut tnum">{Math.round(r.share * 100)}%</span>
              <span className="w-16 shrink-0 text-right tnum">{num(r.users)}</span>
              <span className={`w-14 shrink-0 text-right text-[11.5px] tnum ${r.delta > 0 ? 'text-good' : r.delta < 0 ? 'text-bad' : 'text-mut'}`}>
                {r.delta === 0 ? '—' : `${r.delta > 0 ? '▲' : '▼'}${num(Math.abs(r.delta))}`}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center text-[11px] text-mut">tap anywhere to continue</div>
      </div>
    </div>
  )
}

function MuteButton() {
  const [muted, setM] = useState(isMuted())
  const Icon = muted ? VolumeX : Volume2
  return (
    <button
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink md:h-9 md:w-9"
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      title={muted ? 'Unmute sounds' : 'Mute sounds'}
      onClick={() => {
        setMuted(!muted)
        setM(!muted)
      }}
    >
      <Icon size={17} />
    </button>
  )
}

const EMOTES = ['👍', '😂', '😱', '🔥', '🐌', '🦄']

// Escape closes any overlay, and Tab stays inside it — without the trap, keyboard focus
// wanders into the dead game behind the dialog and the player cannot find their way back.
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((el) => el.offsetParent !== null)
    focusable()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.() // hand focus back where the player left it
    }
  }, [onClose])
  return ref
}

export default function App() {
  const { game, online, screen, setScreen, advance, abandonGame, resolveChoice, cancelReady, sendEmote } = useStore()
  const reconnecting = useStore((s) => s.reconnecting)
  const link = useStore((s) => s.link)
  const emotes = useStore((s) => s.emotes)
  const [navOpen, setNavOpen] = useState(false)
  const [fitOpen, setFitOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false) // mobile: the full metric sheet

  // rejoin the online room this device was in before a refresh; pick up any signed-in session
  useEffect(() => {
    void useStore.getState().resumeOnline()
    void useStore.getState().initAuth()
  }, [])
  const [weekFlash, setWeekFlash] = useState<number | null>(null)
  // Arena §43: the round reveal. Rows are computed ONCE when the round resolves and frozen in
  // state, so the overlay does not reshuffle under the player's eyes as presence updates drift in.
  const [reveal, setReveal] = useState<{ week: number; rows: RevealRow[] } | null>(null)
  const prevStandings = useRef<Record<string, number>>({})
  const [resultsClosed, setResultsClosed] = useState(false) // results overlay dismissed for a last look around
  const [, setClock] = useState(0) // re-render for the round countdown
  const prevWeek = useRef<number | null>(null)

  useEffect(() => {
    if (!game) {
      prevWeek.current = null
      return
    }
    if (prevWeek.current !== null && game.week > prevWeek.current && online) {
      // Arena: the round resolution is the game's heartbeat and deserves more than a sweep (§43).
      // Standings by users, with the delta since last round from a client-local snapshot — no new
      // wire traffic, this is arithmetic on presence data every client already holds.
      const everyone = online.players.filter((p) => p.playing !== false)
      const total = Math.max(1, everyone.reduce((n, p) => n + Math.max(0, p.users), 0))
      const rows: RevealRow[] = everyone
        .map((p) => ({
          id: p.id,
          company: p.company,
          me: p.id === myId(),
          over: p.over,
          users: Math.max(0, p.users),
          share: Math.max(0, p.users) / total,
          delta: prevStandings.current[p.id] !== undefined ? p.users - prevStandings.current[p.id] : 0,
        }))
        .sort((a, b) => b.users - a.users)
      prevStandings.current = Object.fromEntries(everyone.map((p) => [p.id, Math.max(0, p.users)]))
      setReveal({ week: game.week, rows })
      const t = setTimeout(() => setReveal(null), 3400)
      prevWeek.current = game.week
      return () => clearTimeout(t)
    }
    if (prevWeek.current !== null && game.week > prevWeek.current) {
      // Every mode gets the 950ms sweep and nothing more. A briefing MODAL shipped here first —
      // one story, the deltas, the next step, one Continue — and the owner's verdict after
      // actually playing it was that a forced click every single week is intrusive, which is the
      // brief's own rule 37 ("do not constantly block advancement") violated by the feature built
      // to serve it. It was also redundant by construction: the HQ the player lands on already
      // leads with the briefing strip, the named top decision and the next best step, so the
      // modal was narrating a screen the player was about to see anyway. The briefing IS the HQ.
      setWeekFlash(game.week)
      const t = setTimeout(() => setWeekFlash(null), 950)
      prevWeek.current = game.week
      return () => clearTimeout(t)
    }
    prevWeek.current = game.week
    // week only — depending on the whole game object would let any action during the
    // 950ms window cancel the timer and strand the overlay on screen
  }, [game?.week])

  // tick once a second while an online round clock is running
  useEffect(() => {
    if (!online || online.phase !== 'playing') return
    const t = setInterval(() => setClock((c) => c + 1), 1000)
    return () => clearInterval(t)
  }, [online])

  // retheme accents by sector
  useEffect(() => {
    const [a, a2] = sectorAccent(game?.sector)
    document.documentElement.style.setProperty('--color-accent', a)
    document.documentElement.style.setProperty('--color-accent2', a2)
  }, [game?.sector])

  // a fresh run gets a fresh results overlay
  useEffect(() => {
    if (!game?.gameOver) setResultsClosed(false)
  }, [game?.gameOver])

  const me = online?.players.find((p) => p.id === myId())
  const myReady = !!me?.ready
  // a lone entry is usually just a pre-sync view of ourselves after a reconnect — not a finished match
  // The match is decided once at most one founder is still contesting it — everyone else has either
  // finished or walked away. Requiring `every(p => p.over)` stranded a lone survivor forever when
  // their rival simply closed the tab: nobody left to play, and no ending either.
  // Finishing and walking away are NOT the same thing. A rival who exited or died leaves a NUMBER
  // ON THE BOARD, and the right move is to keep playing and try to beat it — ending the match there
  // took the game away from the survivor at the most interesting moment. A rival who closed the tab
  // leaves nothing to play against, so that founder wins now.
  const contesting = online?.players.filter((p) => isContesting(p)) ?? []
  const finished = online?.players.filter((p) => p.over) ?? []
  const matchOver =
    !!online &&
    online.phase === 'playing' &&
    online.players.length > 1 &&
    (contesting.length === 0 || (contesting.length === 1 && finished.length === 0))
  /** The best figure a founder has already banked — what a survivor is now playing against. */
  const targetToBeat = finished.reduce((best, p) => Math.max(best, p.payout), 0)

  // when the round clock runs out, decisions resolve conservatively and the week is forced
  useEffect(() => {
    if (!game || !online || online.phase !== 'playing' || myReady || game.gameOver || matchOver) return
    if (online.deadline === null || Date.now() < online.deadline) return
    for (const m of game.inbox) {
      if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoice(m.id, m.choices.length - 1)
    }
    advance()
  })

  if (reconnecting)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="animate-pulse rounded-2xl border border-line bg-surface px-8 py-5 text-[15px] font-semibold">
          Reconnecting to your room…
        </div>
      </div>
    )
  if (!game) return online?.phase === 'lobby' ? <Lobby /> : <NewGame />

  const pending = hasPendingDecision(game)
  const unread = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length
  const burn = weeklyBurn(game)
  const runway = runwayWeeks(game)
  const growthTrend = growthRate(game)
  const secondsLeft = online?.deadline ? Math.max(0, Math.ceil((online.deadline - Date.now()) / 1000)) : null
  const h = game.history
  const cashDelta = h.length >= 2 ? h[h.length - 1].cash - h[h.length - 2].cash : 0
  const celebrate =
    (game.flash?.includes('🏆') || game.flash?.startsWith('🏁') || game.flash?.startsWith('🚀') || false) ||
    (!!game.gameOver && ['unicorn', 'ipo', 'acquired'].includes(game.gameOver.type))

  // One renderer, two callers. The desktop rail shows everything; the phone's More sheet shows
  // everything that is NOT already a tab, because repeating the four tabs inside the sheet they
  // sit under is how a "More" menu becomes a list of everything and stops meaning anything.
  // Which screens inside an area actually exist for this run (Career-only ones gate out).
  const eligible = (a: (typeof AREAS)[number]) => a.screens.filter((sc) => !sc.careerOnly || hasCapability(game, 'hypothesisBoard'))

  const navList = (omit: readonly string[] = []) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {AREAS.filter((a) => !omit.includes(a.id) && eligible(a).length > 0).map((a) => {
        const Icon = a.icon
        const active = areaOf(screen)?.id === a.id
        return (
          <button
            key={a.id}
            onClick={() => {
              // Entering an area lands on its first screen unless you are already inside it —
              // re-clicking the area you are in is a "take me to the front of it" gesture.
              setScreen(eligible(a)[0].id)
              setNavOpen(false)
            }}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-[44px] w-full items-center gap-3 rounded-xl py-2 pr-3 pl-4 text-left text-[14px] transition-colors duration-[120ms] md:min-h-[42px] ${
              active ? 'bg-accent/12 font-semibold text-ink shadow-[var(--glow-accent)]' : 'text-mut hover:bg-surface2 hover:text-ink'
            }`}
          >
            {/* a quiet accent rail marks the place; the accent itself stays reserved for actions */}
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" />}
            <Icon size={18} strokeWidth={2} className={active ? 'text-accent' : ''} />
            {a.label}
            {/* ONE badge in the whole nav: the blocking-decision count on HQ. The audit killed the
                other two — the candidates badge read a constant 5 forever (the engine refills the
                pool weekly), a notification affordance carrying zero bits that trains the player
                to ignore badges; and term sheets duplicate a list the register now surfaces by
                name. Company never badges: it is the record, nothing in it is ever urgent. */}
            {a.id === 'hq' && unread > 0 && (
              <span className="ml-auto rounded-full bg-bad px-1.5 py-px text-[10px] font-bold text-bg tnum">{unread}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
  const nav = navList()

  // The sibling row: primary area -> screen, and never deeper. Only rendered when the area has
  // more than one screen this run, so Quick Play's Product area (one screen) shows no chrome.
  const activeArea = areaOf(screen)
  const siblings = activeArea ? eligible(activeArea) : []
  // Every tab is visibly a CONTROL: a bordered pill on plane 1, with the active one raised to
  // plane 3 — the plane rule's own grammar for "selected". The first cut rendered inactive tabs as
  // bare muted text, and the owner's verdict was that players could not see them at all. A tab you
  // cannot see is a destination that does not exist.
  const siblingTabs = siblings.length > 1 && (
    <div className="mb-4 flex flex-wrap gap-2">
      {siblings.map((sc) => (
        <button
          key={sc.id}
          onClick={() => setScreen(sc.id)}
          aria-current={screen === sc.id ? 'page' : undefined}
          className={`min-h-[38px] rounded-[10px] border px-4 text-[13px] font-semibold transition-colors duration-[120ms] ${
            screen === sc.id
              ? 'border-line2 bg-surface3 text-ink shadow-[var(--elev-1)]'
              : 'border-line bg-surface text-mut hover:border-line2 hover:text-ink'
          }`}
        >
          {sc.label}
          {sc.id === 'inbox' && unread > 0 && (
            <span className="ml-1.5 rounded-full bg-bad px-1.5 text-[10px] font-bold leading-[15px] text-bg tnum">{unread}</span>
          )}
        </button>
      ))}
    </div>
  )

  // One source for the metric strip: the desktop rail and the mobile sheet render the same
  // entries, so a stat can never exist in one and not the other.
  // FOUR entries, down from nine (audit §2.1: the rail's nine numbers were re-rendered 42 more
  // times across nine screens, and nine equal metrics meant Cash — the number that ends the run —
  // was typographically identical to Valuation, which the player cannot act on this week).
  //
  // What stays is what a player needs on EVERY screen: the money clock (cash, runway, net — net
  // was the rail's one unique number) and the match timer online. Users, PMF, revenue, burn,
  // valuation and morale each now have exactly one home — the HQ or their owning area — which is
  // the audit's actual fix: a number with one home can be loud there.
  const statRail = (
    <>
      <Stat k="Cash" icon={<Wallet size={12} />} tone={game.cash < Math.max(burn * 8, 40_000) ? 'bad' : undefined}>
        <Ticker value={game.cash} format={money} />
        <TrendBadge value={cashDelta} format={money} />
      </Stat>
      <Stat k="Runway" icon={<Hourglass size={12} />} tone={runway < 10 ? 'bad' : runway < 20 ? 'warn' : 'good'}>
        {runway === Infinity ? '∞' : `${Math.max(0, Math.floor(runway))} wk`}
        {/* the runway series is DERIVED per history point — cash over that week's own net — so the
            line is honest rather than a relabelled cash chart */}
        <span className="ml-2 hidden w-16 md:inline-block">
          <Sparkline data={game.history.map((h) => (h.expenses > h.revenue ? h.cash / (h.expenses - h.revenue) : 104))} tone={runway < 10 ? 'bad' : 'good'} />
        </span>
      </Stat>
      <Stat k="Net /wk" icon={<Activity size={12} />} tone={game.lastRevenue - burn >= 0 ? 'good' : 'bad'}>
        <Ticker value={game.lastRevenue - burn} format={(n) => `${n >= 0 ? '+' : ''}${money(n)}`} />
        <span className="ml-2 hidden w-16 md:inline-block">
          <Sparkline data={game.history.map((h) => h.revenue - h.expenses)} tone={game.lastRevenue - burn >= 0 ? 'good' : 'bad'} />
        </span>
      </Stat>
      {/* The two DRIVERS join the money clock — owner call, from the causal review: PMF is in
          every compounding formula (word-of-mouth at ^1.5, acquisition, churn's dominant term)
          and the growth rate is what the board fires you over. Five entries, the audit's ceiling.
          The rail shows the number; the HQ owns its meter, sparkline and drawer. */}
      <Stat k="PMF" icon={<Target size={12} />} tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'warn' : undefined}>
        <Ticker value={game.pmf} format={(n) => `${Math.round(n)}`} />
        <span className="ml-0.5 text-[11px] text-mut">/100</span>
        <span className="ml-2 hidden md:inline-block">
          <RadialGauge value={game.pmf} size={26} tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'warn' : 'accent'} />
        </span>
      </Stat>
      <Stat k="Growth" icon={<TrendingUp size={12} />} tone={growthTrend > 0 ? 'good' : growthTrend < 0 ? 'bad' : undefined}>
        <Ticker value={growthTrend * 100} format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`} />
        <span className="ml-2 hidden w-16 md:inline-block">
          <Sparkline data={game.history.map((h) => h.users)} tone={growthTrend > 0 ? 'good' : 'mut'} />
        </span>
      </Stat>
      {online && secondsLeft !== null && !matchOver && (
        <Stat k="Round ends" tone={secondsLeft < 30 ? 'bad' : undefined}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </Stat>
      )}
    </>
  )

  const advanceDisabled = online ? pending || myReady || !!game.gameOver || matchOver : pending || !!game.gameOver
  // once the run is over, the big button IS the exit — no hunting for a way out
  const runDone = !!game.gameOver && (!online || matchOver)
  const advanceBtn = runDone ? (
    <button
      onClick={abandonGame}
      className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-[15px] font-bold text-bg shadow-[var(--elev-2)] transition-[filter,transform] duration-[120ms] hover:brightness-110 active:scale-[0.98]"
    >
      <DoorOpen size={16} /> {online ? 'Leave match' : 'New company'}
    </button>
  ) : pending ? (
    // The week is blocked by a decision — so the button takes you to it. Greying out the
    // most prominent control at the exact moment the player is stuck is a dead end.
    <button
      onClick={() => {
        setScreen('inbox')
        setNavOpen(false)
      }}
      className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-warn px-4 text-[15px] font-bold text-bg shadow-[var(--elev-2)] transition-[filter,transform] duration-[120ms] hover:brightness-110 active:scale-[0.98]"
    >
      <Hourglass size={16} /> Decide {unread > 1 ? `${unread} items` : 'to continue'} <ChevronsRight size={18} />
    </button>
  ) : (
    <button
      disabled={advanceDisabled}
      onClick={(e) => {
        // The mock's "Hold Shift to fast forward": a shift-click advances up to five weeks, and it
        // is AUTOMATION OF THE EXISTING ACTION, not a new mechanic — each week runs through the
        // same journaled advance() a plain click runs, and the loop stops the moment a decision
        // blocks the week, the run ends, or the mode is online (a rival's round clock is not ours
        // to fast-forward). Five keeps a slip of the finger from eating a quarter of the game.
        if (e.shiftKey && !online) {
          let hops = 0
          const step = () => {
            const g = useStore.getState().game
            if (!g || g.gameOver || hasPendingDecision(g) || hops >= 5) return
            hops++
            advance()
            setTimeout(step, 90)
          }
          step()
          return
        }
        advance()
      }}
      className={`flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-bold transition-[filter,transform,background-color] duration-[120ms] ${
        advanceDisabled
          ? 'cursor-not-allowed bg-surface2 text-mut'
          : 'bg-good text-bg shadow-[var(--glow-good)] hover:brightness-110 active:scale-[0.98]'
      }`}
    >
      {online ? (
        myReady ? (
          <>
            <Hourglass size={16} /> Waiting for rivals…
          </>
        ) : (
          <>
            Ready — end my week <ChevronsRight size={18} />
          </>
        )
      ) : (
        <>
          Advance Week <ChevronsRight size={18} />
        </>
      )}
    </button>
  )

  /**
   * THE RUNWAY IS THE TOP EDGE.
   *
   * The defining fact of this game is that the money runs out, and that fact used to be a number
   * in a rail sharing weight with eight others. Here it is the app's own top edge: two pixels
   * spanning the full width, lit for the runway remaining.
   *
   * At 150 weeks you never notice it, which is correct — nothing is wrong. At nine it is a short
   * stub across a dark screen and the loudest thing in the product, and NO card, badge or
   * notification was added to make that happen. It costs two pixels and it replaces a tile.
   *
   * Stateless on purpose. The honest reference would be "the longest runway you have ever held",
   * but that is new persisted state, and per the brief UI changes must not invalidate saves. A
   * fixed two-year reference needs nothing stored and reads the same on a save from last week.
   *
   * Length is the primary channel and it is not a colour, so the signal survives for a player who
   * cannot separate amber from red; the colour is the secondary encoding, not the message.
   */
  const RUNWAY_FULL_WEEKS = 104
  const runwayFrac = runway === Infinity ? 1 : Math.max(0.015, Math.min(1, runway / RUNWAY_FULL_WEEKS))
  const runwayCritical = runway !== Infinity && runway < 10
  const runwayLow = runway !== Infinity && runway < 26
  const runwayTone = runwayCritical ? 'bg-bad' : runwayLow ? 'bg-warn' : 'bg-line2'
  // THE TRACK ESCALATES, NOT JUST THE FILL — and this is a correction to the original idea.
  //
  // Encoding runway purely as the LIT LENGTH inverts the signal: the worse things get, the shorter
  // the lit bar, so the most urgent state puts the LEAST ink on the screen. Measured at 1280px, a
  // five-week runway was a 61px sliver — quieter than a healthy 100% line, which is exactly
  // backwards.
  //
  // So the spent portion carries the alarm and the lit portion carries the measurement. As runway
  // falls the WHOLE top edge takes on colour (more ink, not less) while the bright segment keeps
  // shrinking to say how much is actually left. Urgency and precision stop fighting each other.
  const runwayTrack = runwayCritical ? 'bg-bad/35' : runwayLow ? 'bg-warn/20' : 'bg-surface'
  const runwayRule = (
    <div className="pad-top-safe w-full shrink-0 bg-bg">
      <div
        className={`relative h-[2px] w-full transition-colors duration-[240ms] ${runwayTrack}`}
        role="img"
        aria-label={runway === Infinity ? 'Runway: profitable' : `Runway: ${Math.max(0, Math.floor(runway))} weeks`}
      >
        <span
          className={`absolute inset-y-0 left-0 block transition-[width] duration-[240ms] ${runwayTone}`}
          style={{ width: `${runwayFrac * 100}%` }}
        />
      </div>
    </div>
  )

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {runwayRule}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* sidebar — desktop */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-line/60 bg-bg md:flex">
        {/* The wordmark row — the mock's brand header, above the player's own company. */}
        <div className="flex items-center gap-2 border-b border-line/60 px-4 py-3">
          <Rocket size={18} className="text-accent" />
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-extrabold uppercase tracking-[0.08em]">Founder Mode</div>
            <div className="text-[10.5px] text-mut">The startup game.</div>
          </div>
        </div>
        <div className="border-b border-line/60 px-4 pb-4 pt-4">
          {/* The mock's company card: monogram centred with a soft brand ring, identity beneath.
              The sidebar is the one place the game says "this is YOUR company" — it earns the
              screen's second decorative element (the hero's glow being the first). */}
          <div className="flex items-center gap-3">
            <div className="rounded-2xl p-1" style={{ boxShadow: '0 0 0 1px rgb(139 92 246 / 0.35), 0 0 24px rgb(139 92 246 / 0.18)' }}>
              <Monogram name={game.companyName} size={44} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-extrabold tracking-tight">{game.companyName}</div>
              <div className="text-xs text-mut">
                {game.stage} · Week {game.week}
              </div>
            </div>
          </div>
          {/* Brief §38: a quiet mode indicator — same brand, different experience. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-mut">
            <span className="rounded-full border border-line2 px-1.5 py-px font-semibold">
              {MODE_META[game.config?.mode ?? 'quick'].icon} {MODE_META[game.config?.mode ?? 'quick'].name}
            </span>
            {game.challenge && (
              <span>
                {game.challenge.label} · ends wk {game.challenge.cap}
              </span>
            )}
          </div>
          {hasCapability(game, 'founderEnergy') && (
          <div className="mt-2 flex items-center gap-1.5" title="Founder energy — big moves drain it, low energy weakens your weekly contribution. Recharge on the Team screen.">
            <span className="text-[10px] font-bold uppercase tracking-wider text-mut">Energy</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${game.energy}%`,
                  background: game.energy < 25 ? 'var(--color-bad)' : game.energy < 50 ? 'var(--color-warn)' : 'var(--color-good)',
                }}
              />
            </div>
            <span className="text-[10px] font-bold tnum">{Math.round(game.energy)}</span>
          </div>
          )}
          {online && (
            <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent">
              <Globe size={11} /> Room {online.code}
              {secondsLeft !== null && !matchOver && (
                <span className={`ml-auto tnum ${secondsLeft < 30 ? 'text-bad' : ''}`}>
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          )}
        </div>
        {nav}
        <div className="border-t border-line/60 p-3">
          {online && (
            <div className="mb-2 space-y-1">
              {online.players.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-[12px]">
                  <span className={`truncate ${p.id === myId() ? 'font-bold' : 'text-mut'}`}>
                    {p.over ? '☠️ ' : hasForfeited(p) ? '🚪 ' : ''}
                    {p.company}
                  </span>
                  {p.over ? (
                    <span className="text-mut tnum" title="They have finished. This is the figure you are playing against.">
                      {p.payout > 0 ? money(p.payout) : 'out'}
                    </span>
                  ) : hasForfeited(p) ? (
                    <span className="text-mut">left</span>
                  ) : p.absent ? (
                    <span className="text-warn" title="Lost their connection — they have a little while to come back.">
                      ⟳
                    </span>
                  ) : p.ready ? (
                    <Check size={13} className="text-good" />
                  ) : (
                    <span className="text-mut">…</span>
                  )}
                </div>
              ))}
              <div className="flex justify-between pt-1">
                {EMOTES.map((e) => (
                  <button key={e} className="rounded p-0.5 text-[15px] transition-transform hover:scale-125" onClick={() => sendEmote(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mb-2 text-center text-[11px] text-mut">{weekDate(game.week)}</div>
          {advanceBtn}
          {!online && !game.gameOver && (
            <div className="mt-1.5 text-center text-[10.5px] text-mut">
              Hold <kbd className="rounded border border-line2 bg-surface2 px-1 py-px font-semibold">Shift</kbd> to fast forward
            </div>
          )}
          {online && myReady && !matchOver && !game.gameOver && (
            <button className="mt-1.5 w-full text-center text-[12px] text-mut hover:text-ink" onClick={cancelReady}>
              Cancel ready
            </button>
          )}
        </div>
      </aside>

      {/* sidebar — mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
          {/* A bottom sheet, not a left drawer: it opens from the bar the player just touched, and
              its contents land under the thumb instead of at the far top-left of the screen. */}
          <aside className="home-in pad-bottom-safe absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-[18px] border-t border-line2 bg-surface shadow-[var(--elev-3)]">
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line2" />
            <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
              <div>
                <div className="text-[16px] font-extrabold tracking-tight">{game.companyName}</div>
                <div className="text-xs text-mut">
                  {game.stage} · Week {game.week}
                  {online && ` · Room ${online.code}`}
                </div>
              </div>
              <button
                onClick={() => setNavOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            {navList(MOBILE_TABS)}
          </aside>
        </div>
      )}

      {/* right side */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        {/* `h-[60px]` is the BAR's height; the notch pad is added on top of it rather than eaten
            out of it, or the controls sit half under the Dynamic Island on a modern iPhone. */}
        <header className="inset-x-safe flex shrink-0 items-center gap-2 border-b border-line/60 bg-bg px-2 md:gap-4 md:px-5">
          <div className="flex h-[56px] min-w-0 flex-1 items-center gap-2 md:gap-4">
          {/* the metric rail scrolls if it must; the soft right edge is the
              affordance, so a value is never chopped off mid-word — desktop only,
              phones get the two vitals plus the tap-to-expand sheet below */}
          <div className="fade-r hidden flex-1 items-center gap-4 overflow-x-auto pr-6 md:flex md:gap-6 [&::-webkit-scrollbar]:hidden">
            {statRail}
          </div>
          {/* mobile: cash + runway always visible, everything else one tap away */}
          <button
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-4 overflow-hidden rounded-xl px-1.5 text-left transition-colors hover:bg-surface2 md:hidden"
            aria-label="Show all stats"
            aria-expanded={statsOpen}
            onClick={() => setStatsOpen(true)}
          >
            <Stat k="Cash" tone={game.cash < Math.max(burn * 8, 40_000) ? 'bad' : undefined}>
              <Ticker value={game.cash} format={money} />
            </Stat>
            <Stat k="Runway" tone={runway < 10 ? 'bad' : runway < 20 ? 'warn' : 'good'}>
              {runway === Infinity ? '∞' : `${Math.max(0, Math.floor(runway))} wk`}
            </Stat>
            {online && secondsLeft !== null && !matchOver && (
              <Stat k="Ends" tone={secondsLeft < 30 ? 'bad' : undefined}>
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </Stat>
            )}
            <ChevronDown size={16} className="ml-auto shrink-0 text-mut" />
          </button>
          {/* Spec §5: the PMF breakdown, one click from any screen. Target icon — the same
              symbol the rail and the HQ card already use for fit. */}
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink md:h-9 md:w-9"
            aria-label="Product-market fit breakdown"
            title="Fit — the breakdown, from any screen"
            onClick={() => setFitOpen(true)}
          >
            <Target size={17} />
          </button>
          <FieldGuideButton />
          <MuteButton />
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-bad md:h-9 md:w-9"
            aria-label={online ? 'Leave match' : 'Abandon run & start over'}
            title={online ? 'Leave match' : 'Abandon run & start over'}
            onClick={() => {
              if (game.gameOver || confirm(online ? 'Leave the match and abandon your company?' : 'Abandon this company and start over?'))
                abandonGame()
            }}
          >
            <DoorOpen size={18} />
          </button>
          </div>
        </header>

        {/* main */}
        <main id="app-scroll" className="inset-x-safe min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[calc(132px+env(safe-area-inset-bottom))] md:px-6 md:pt-5 md:pb-8">
          <FounderNotes />
          {online && game.gameOver && !matchOver && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/50 bg-bad/10 px-4 py-3 text-[14px]">
              <span>
                <b>{game.companyName} is out of the running</b> ({game.gameOver.type}, week {game.gameOver.week}). Watch the Market
                screen while your rivals finish the match — or head out now.
              </span>
              <button
                className="shrink-0 rounded-lg border border-bad/50 px-3 py-1.5 text-[13px] font-bold text-bad transition-all hover:bg-bad hover:text-bg"
                onClick={abandonGame}
              >
                Leave match
              </button>
            </div>
          )}
          {game.gameOver && (!online || matchOver) && resultsClosed && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/50 bg-accent/10 px-4 py-3 text-[14px]">
              <span>
                <b>This run is finished</b> — you&apos;re free to look around one last time.
              </span>
              <span className="flex shrink-0 gap-2">
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold transition-all hover:border-accent"
                  onClick={() => setScreen('story')}
                >
                  Read the story
                </button>
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold transition-all hover:border-accent"
                  onClick={() => setResultsClosed(false)}
                >
                  View results
                </button>
                <button
                  className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-bold text-bg transition-all hover:brightness-110"
                  onClick={abandonGame}
                >
                  {online ? 'Leave match' : 'New company'}
                </button>
              </span>
            </div>
          )}
          {game.flash && (
            <div
              role="status"
              className={`flash-in mb-4 rounded-xl border px-4 py-3 text-[14px] leading-relaxed ${
                game.flash.startsWith('🏁')
                  ? 'celebrate border-good/45 bg-good/10 text-good'
                  : 'border-accent/40 bg-accent/[0.08]'
              }`}
            >
              {game.flash}
            </div>
          )}
          {siblingTabs}
          <div key={screen} className="rise-in">
            {screen === 'dashboard' && <Dashboard />}
            {/* 'inbox' aliases to the HQ — the stream lives there now */}
            {screen === 'inbox' && <Dashboard />}
            {screen === 'team' && <Team />}
            {screen === 'hiring' && <Hiring />}
            {screen === 'product' && <Product />}
            {screen === 'growth' && <Growth />}
            {screen === 'market' && <Market />}
            {screen === 'finance' && <Finance />}
            {screen === 'fundraising' && <Fundraising />}
            {/* 'career' aliases to the HQ: the trophy screen is deleted (audit §3.A.1) and a
                save written mid-run with it open must still land somewhere sensible. */}
            {screen === 'career' && <Dashboard />}
            {screen === 'discovery' && <Discovery />}
            {screen === 'cohorts' && <CohortAnalytics />}
            {screen === 'story' && <Story />}
          </div>
        </main>

        {/* ---------- mobile: the action, then the tab bar ----------------------------------
            Two stacked bars, in that order, because this game has one dominant verb and hiding it
            behind an icon would be a worse trade than the ~56px the second bar costs. `advanceBtn`
            is already contextual — it turns amber and routes to the Inbox when a decision is
            blocking the week — so the action bar is never a dead control the player has to reason
            about. Both sit above the home indicator via the safe-area pad on the tab bar. */}
        <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
          <div className="inset-x-safe bg-gradient-to-t from-bg via-bg/95 to-transparent px-4 pt-6 pb-2">{advanceBtn}</div>
          <nav
            aria-label="Sections"
            className="inset-x-safe pad-bottom-safe flex items-stretch border-t border-line/60 bg-bg"
          >
            {MOBILE_TABS.map((id) => {
              const item = AREAS.find((a) => a.id === id)!
              const Icon = item.icon
              const active = areaOf(screen)?.id === id
              const badge = id === 'hq' ? unread : 0
              return (
                <button
                  key={id}
                  onClick={() => setScreen(eligible(item)[0].id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 pt-1.5 pb-1 text-[10px] font-semibold transition-colors duration-[120ms] ${
                    active ? 'text-accent' : 'text-mut'
                  }`}
                >
                  <span className="relative">
                    <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                    {badge > 0 && (
                      <span className="absolute -top-1 -right-2 min-w-[15px] rounded-full bg-bad px-1 text-[9px] font-bold leading-[15px] text-bg tnum">
                        {badge}
                      </span>
                    )}
                  </span>
                  {item.label}
                </button>
              )
            })}
            <button
              onClick={() => setNavOpen(true)}
              aria-label="More sections"
              aria-expanded={navOpen}
              className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 pt-1.5 pb-1 text-[10px] font-semibold transition-colors duration-[120ms] ${
                navOpen || !MOBILE_TABS.includes(areaOf(screen)?.id ?? 'hq') ? 'text-accent' : 'text-mut'
              }`}
            >
              <span className="relative">
                <Menu size={20} strokeWidth={2} />
                {/* No dot. Only Company lives back here now, and Company is the record — nothing
                    in it is ever urgent. The old dot counted term sheets and candidates, which the
                    attention register now surfaces BY NAME on the HQ instead. */}
              </span>
              More
            </button>
          </nav>
        </div>
      </div>

      </div>

      {/* mobile: the full metric sheet, same entries as the desktop rail */}
      {statsOpen && <MobileStatsSheet onClose={() => setStatsOpen(false)}>{statRail}</MobileStatsSheet>}

      {/* Spec §5: the fit breakdown, globally accessible */}
      {fitOpen && <FitPeek onClose={() => setFitOpen(false)} />}

      {/* Arena: the round reveal (§43) */}
      {reveal && <RoundReveal week={reveal.week} rows={reveal.rows} onClose={() => setReveal(null)} />}

      {/* week transition */}
      {weekFlash && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="week-sweep rounded-[14px] border border-line2 bg-surface3 px-10 py-6 text-center shadow-[var(--elev-3)]">
            <div className="text-3xl font-extrabold tracking-tight">Week {weekFlash}</div>
            <div className="mt-1 text-sm text-mut">{weekDate(weekFlash)}</div>
          </div>
        </div>
      )}

      {/* emote toasts */}
      {emotes.length > 0 && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-[75] flex -translate-x-1/2 flex-col items-center gap-1.5">
          {emotes.map((e) => (
            <div key={e.id} className="flash-in rounded-full border border-line2 bg-surface2 px-4 py-1.5 text-[14px] shadow-[var(--elev-3)]">
              <b>{e.from}</b> <span className="text-[18px]">{e.emoji}</span>
            </div>
          ))}
        </div>
      )}

      <ChatWidget />
      {celebrate && <Confetti key={`${game.week}-${game.gameOver?.type ?? 'w'}`} />}
      {/* The socket climbs back on its own — this just stops the silence being mistaken for a freeze. */}
      {online && link === 'reconnecting' && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-warn/50 bg-surface2 px-4 py-2 text-[13px] font-semibold text-warn shadow-[var(--elev-2)]"
        >
          <span className="mr-2 inline-block animate-pulse">⟳</span>
          Reconnecting to the room… your match is still running
        </div>
      )}
      {online && !matchOver && targetToBeat > 0 && !game.gameOver && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[65] -translate-x-1/2 rounded-full border border-warn/50 bg-surface2 px-4 py-2 text-[13px] font-semibold shadow-[var(--elev-2)]"
        >
          <span className="text-mut">Best exit so far</span> <b className="text-warn tnum">{money(targetToBeat)}</b>{' '}
          <span className="text-mut">— beat it or finish second</span>
        </div>
      )}
      {matchOver && !resultsClosed && <MatchOver onClose={() => setResultsClosed(true)} />}
      {!online && game.gameOver && !resultsClosed && <GameOver onClose={() => setResultsClosed(true)} />}
    </div>
  )
}

// The tap-to-expand counterpart of the desktop metric rail: a sheet under the topbar with the
// same Stat entries laid out as a grid. Own component so useDialog (Escape + focus trap) applies.
function MobileStatsSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useDialog(onClose)
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="All stats" className="fixed inset-0 z-40 md:hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="rise-in absolute inset-x-0 top-0 border-b border-line2 bg-surface px-4 pt-3 pb-4 shadow-[var(--elev-3)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-mut">This week&apos;s numbers</h3>
          <button
            onClick={onClose}
            aria-label="Close stats"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">{children}</div>
      </div>
    </div>
  )
}

function Stat({ k, tone, title, icon, children }: { k: string; tone?: 'good' | 'bad' | 'warn'; title?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''
  return (
    <div className="shrink-0 leading-tight" title={title}>
      <div className="flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.08em] text-mut">{icon && <span className="text-accent/80">{icon}</span>}{k}</div>
      <div className={`mt-0.5 flex items-baseline whitespace-nowrap text-[17px] font-bold tnum ${cls}`}>{children}</div>
    </div>
  )
}

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="rounded-xl border border-line bg-surface2 px-5 py-3 font-bold transition-all hover:border-accent active:scale-[0.98]"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        })
      }}
    >
      {copied ? 'Copied! 📋' : 'Copy text'}
    </button>
  )
}

// One-tap posts to the big networks, prefilled with the run's story.
function SocialShareRow({ text }: { text: string }) {
  const enc = encodeURIComponent(text)
  const encUrl = encodeURIComponent(GAME_URL)
  const targets: { label: string; href: string }[] = [
    { label: '𝕏', href: `https://twitter.com/intent/tweet?text=${enc}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encUrl}&text=${enc}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${enc}` },
  ]
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      {targets.map((t) => (
        <button
          key={t.label}
          className="rounded-lg border border-line bg-surface2 px-3.5 py-1.5 text-[13px] font-semibold text-mut transition-all hover:border-accent hover:text-ink active:scale-[0.97]"
          onClick={() => window.open(t.href, '_blank', 'noopener,width=640,height=560')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ShareImageButton({ game, text }: { game: NonNullable<ReturnType<typeof useStore.getState>['game']>; text: string }) {
  const [state, setState] = useState<'idle' | 'shared' | 'downloaded' | 'failed'>('idle')
  const [busy, setBusy] = useState(false)
  return (
    <button
      disabled={busy}
      className="rounded-xl bg-gradient-to-br from-accent to-accent2 px-5 py-3 font-bold text-bg shadow-[var(--elev-2)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      onClick={async () => {
        if (busy) return // a second tap mid-share sheet would fire a stray download
        setBusy(true)
        try {
          // lazy: the canvas renderer only loads the first time someone actually shares
          const r = await import('./shareImage')
            .then((m) => m.shareResultImage(game, text))
            .catch(() => 'failed' as const)
          setState(r)
          setTimeout(() => setState('idle'), 2200)
        } finally {
          setBusy(false)
        }
      }}
    >
      {state === 'idle' ? '📸 Share image' : state === 'shared' ? 'Shared!' : state === 'downloaded' ? 'Image saved!' : 'Could not render'}
    </button>
  )
}

function MatchOver({ onClose }: { onClose: () => void }) {
  const { online, game, abandonGame } = useStore()
  const dialogRef = useDialog(onClose)
  if (!online) return null
  // A founder still standing when everyone else quit or died has no payout yet — they are the
  // winner, not a $0 last place. Rank the living above the finished, and value them on the company
  // they still own rather than a payout they never had to take.
  const figure = (p: NetPlayer) => (isContesting(p) ? (p.id === myId() && game ? valuation(game) : p.val) : p.payout)
  const label = (p: NetPlayer) =>
    hasForfeited(p) ? 'left the match' : isContesting(p) ? 'last one standing' : (p.overType ?? 'timeup')
  // Rank purely on the figure. There used to be an alive-first tier here, which was both
  // redundant and wrong: `figure` already values a still-trading founder at their VALUATION rather
  // than a payout they have not taken, so nobody is stranded at $0 — and the tier meant a
  // successful exit lost to anyone still breathing. A player acquired for $13.2M was ranked below
  // a rival trading at $2.12M and told they came second.
  const ranked = [...online.players].sort((a, b) => figure(b) - figure(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const shareText =
    `Founder Mode — online match result:\n` +
    ranked.map((p, i) => `${i + 1}. ${p.company} ${endingEmoji(p.overType)} ${money(figure(p))}`).join('\n') +
    `\nPlay: ${GAME_URL}`
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Match over" className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain bg-black/75 p-4 backdrop-blur-[2px]">
      <div className="rise-in relative w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 text-center shadow-[var(--elev-3)]">
        <button className="absolute top-3 right-3 rounded-lg p-1.5 text-mut transition-colors hover:bg-surface2 hover:text-ink" title="Close and look around" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="text-3xl font-extrabold">🏆 Match over</h2>
        <p className="mt-2 text-mut">
          <b className="text-ink">{ranked[0]?.company}</b>{' '}
          {ranked[0] && isContesting(ranked[0]) ? 'takes the market' : 'wins on the exit'}. Final founder payouts:
        </p>
        <div className="mt-5 space-y-2 text-left">
          {ranked.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
                i === 0 ? 'border-warn/60 bg-warn/10' : 'border-line bg-surface2'
              }`}
            >
              <span>
                <b>
                  {i === 0 ? '👑 ' : `${i + 1}. `}
                  {p.company}
                </b>{' '}
                <span className="text-mut">
                  {hasForfeited(p) ? '🚪' : isContesting(p) ? '🏁' : endingEmoji(p.overType)} {label(p)}
                  {p.id === myId() && ' · you'}
                </span>
              </span>
              <b className={`tnum ${figure(p) > 0 ? 'text-good' : 'text-mut'}`}>{money(figure(p))}</b>
            </div>
          ))}
        </div>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {game && <ShareImageButton game={game} text={shareText} />}
          <ShareButton text={shareText} />
          <button
            className="rounded-xl bg-accent px-5 py-3 font-bold text-bg shadow-[var(--elev-2)] transition-all hover:brightness-110 active:scale-[0.98]"
            onClick={abandonGame}
          >
            <DoorOpen size={16} className="mr-1.5 inline" />
            Leave — new game
          </button>
        </div>
        <SocialShareRow text={shareText} />
      </div>
    </div>
  )
}

// Every result CTA lands on the experience picker — the one place a new run is chosen.
function ResultCta({ label }: { label: string }) {
  const abandonGame = useStore((s) => s.abandonGame)
  return (
    <button
      onClick={abandonGame}
      className="rounded-lg border border-line2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors hover:border-accent hover:text-ink"
    >
      {label} →
    </button>
  )
}

/**
 * ICO Slice 7. A tokenised run's ending has to read differently from an equity run's, because it IS
 * different: the score is two disjoint legs rather than one, most of the company is owned by people
 * who never signed anything, and the token did something over a hundred weeks that a single closing
 * number cannot show.
 *
 * Everything here is a pure read of the finished save — `standingBreakdown` is the same function the
 * live dashboard uses, so the postmortem and the run cannot disagree about what the founder is worth.
 * Renders nothing at all on an institutional run, which is what keeps this invisible to every
 * traditional ending.
 */
function TokenPostmortem() {
  const game = useStore((s) => s.game)
  const t = game?.token
  if (!game || !t) return null
  const b = standingBreakdown(game)
  const network = go2Premium(game)
  const launch = t.market.launchPrice > 0 ? t.market.price / t.market.launchPrice : 0
  const communityShare = t.supply.total > 0 ? t.supply.circulating / t.supply.total : 0
  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="mt-6 rounded-2xl border border-line bg-surface2 p-4 text-left">
      <div className="text-[11px] font-semibold tracking-wide text-mut uppercase">The token run</div>

      <div className="mt-2.5 text-[13px] leading-relaxed text-mut">
        Your score is two things that were never the same thing. The equity leg is what you still own of the{' '}
        <b className="text-ink">company</b>; the token leg is what your position in the <b className="text-ink">network</b> could
        actually be sold for. They are never added to each other before this line.
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <div className="text-lg font-extrabold tnum">{money(b.equityLeg)}</div>
          <div className="text-[11px] text-mut">Equity leg · {pct(game.founderEquity)} of the company</div>
        </div>
        <div>
          <div className="text-lg font-extrabold tnum">{money(b.tokenLeg * network)}</div>
          <div className="text-[11px] text-mut">
            Token leg · {Math.round(b.vestedTokens).toLocaleString()} vested at {pct(b.liquidityDiscount * network)} realisable
          </div>
        </div>
        <div>
          <div className="text-lg font-extrabold tnum">{money(b.banked)}</div>
          <div className="text-[11px] text-mut">Banked · already yours, whatever happened</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="text-lg font-extrabold tnum">{money(b.networkValue)}</div>
          <div className="text-[11px] text-mut">Network value · price × float, never your money</div>
        </div>
        <div>
          <div className="text-lg font-extrabold tnum">{launch > 0 ? `${launch.toFixed(2)}×` : '—'}</div>
          <div className="text-[11px] text-mut">The token, against its launch price</div>
        </div>
        <div>
          <div className="text-lg font-extrabold tnum">{t.community.holders.toLocaleString()}</div>
          <div className="text-[11px] text-mut">Holders · {pct(communityShare)} of supply in the float</div>
        </div>
      </div>

      <div className="mt-3.5 text-xs leading-relaxed text-mut">
        The community ended holding <b className="text-ink">{pct(communityShare)}</b> of everything ever minted, at{' '}
        <b className="text-ink tnum">{Math.round(t.community.trust)}</b> trust and{' '}
        <b className="text-ink tnum">{Math.round(t.community.decentralisation)}</b> decentralisation — you kept{' '}
        <b className="text-ink tnum">{Math.round(t.community.founderInfluence)}</b> of the influence.{' '}
        <b className="text-ink">{pct(organicShare(game))}</b> of your users arrived on their own rather than being paid to;{' '}
        real utility closed at <b className="text-ink tnum">{Math.round(t.market.utility)}</b> against speculation of{' '}
        <b className="text-ink tnum">{Math.round(t.market.speculation)}</b>.
        {t.founder.sold > 0 && (
          <>
            {' '}
            You sold <b className="text-ink tnum">{Math.round(t.founder.sold).toLocaleString()}</b> of your own tokens along the way,
            for <b className="text-ink">{money(t.founder.realisedProceeds)}</b> — that money is in the banked column and nothing that
            happened afterwards could take it back.
          </>
        )}
        {network > 1.001 && (
          <>
            {' '}
            The network ending paid your token leg at a <b className="text-ink tnum">{network.toFixed(2)}×</b> exit premium: reaching
            it is the statement that your position clears into the market rather than being dumped into a float you dominate.
          </>
        )}
      </div>
    </div>
  )
}

/** The exit premium the ending actually applied — 1 on every ending that is not `network`. */
function go2Premium(game: GameState): number {
  return game.gameOver?.type === 'network' ? networkExitPremium(game) : 1
}

function GameOver({ onClose }: { onClose: () => void }) {
  const { game, abandonGame, setScreen } = useStore()
  const dialogRef = useDialog(onClose)
  // Replay verification: re-simulate the whole run from its decision log and compare the
  // end-state fingerprint. Memoized — the replay costs real work and `game` is stable while
  // this dialog is open. Before the early return: hooks must run unconditionally.
  const replay: VerifyResult | null = useMemo(() => (game?.gameOver ? verifyRun(game) : null), [game])
  if (!game?.gameOver) return null
  const go = game.gameOver
  const peakUsers = Math.max(...game.history.map((h) => h.users), game.users)
  const peakVal = Math.max(...game.history.map((h) => h.valuation), 0)
  const stats: [string, string][] = [
    ['Weeks survived', `${go.week}`],
    ['Pivots', `${game.pivots}`],
    ['Milestones', `${game.milestones.length}`],
    ['Peak users', num(peakUsers)],
    ['Peak valuation', money(peakVal)],
    ['Final stake', `${(game.founderEquity * 100).toFixed(1)}%`],
  ]
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Run results" className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/75 p-4 backdrop-blur-[2px]">
      <div className="rise-in relative my-auto w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 text-center shadow-[var(--elev-3)]">
        <button className="absolute top-3 right-3 rounded-lg p-1.5 text-mut transition-colors hover:bg-surface2 hover:text-ink" title="Close and look around" onClick={onClose}>
          <X size={18} />
        </button>
        {go.type === 'bankrupt' && (
          <>
            <h2 className="text-3xl font-extrabold">💸 Out of money</h2>
            <p className="mt-3 leading-relaxed text-mut">
              {game.companyName} ran out of cash in week {go.week}. The servers went dark, the office plants were divided among the
              team, and the domain now redirects to a competitor.
            </p>
            {go.detail && (
              <p className="mt-3 rounded-xl border border-line bg-surface2 px-4 py-3 text-left text-[13px] leading-relaxed text-mut">
                <b className="text-ink">Autopsy:</b> {go.detail}
              </p>
            )}
          </>
        )}
        {go.type === 'unicorn' && (
          <>
            <h2 className="text-3xl font-extrabold">🦄 Unicorn!</h2>
            <p className="mt-3 leading-relaxed text-mut">
              In week {go.week}, {game.companyName} crossed a $1B valuation. Your stake is worth
            </p>
            <div className="my-3 text-4xl font-extrabold text-good tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">Magazine covers, conference keynotes, and a very confused bank teller await.</p>
          </>
        )}
        {go.type === 'acquired' && (
          <>
            <h2 className="text-3xl font-extrabold">🤝 Acquired</h2>
            <p className="mt-3 leading-relaxed text-mut">
              You sold {game.companyName} in week {go.week}. Your personal payout:
            </p>
            <div className="my-3 text-4xl font-extrabold text-good tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">Time for a sabbatical... or the next company.</p>
          </>
        )}
        {go.type === 'fired' && (
          <>
            <h2 className="text-3xl font-extrabold">🪑 Fired by your own board</h2>
            <p className="mt-3 leading-relaxed text-mut">
              In week {go.week}, the board of {game.companyName} voted to replace you as CEO. You built it, you raised for it — and the
              people you raised from showed you the door. Your discounted stake:
            </p>
            <div className="my-3 text-4xl font-extrabold tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">Somewhere, a founder support group has a chair waiting.</p>
          </>
        )}
        {go.type === 'ipo' && (
          <>
            <h2 className="text-3xl font-extrabold">🔔 You rang the bell</h2>
            <p className="mt-3 leading-relaxed text-mut">
              Week {go.week}: {game.companyName} is a public company. Confetti falls on the trading floor, your phone melts with
              messages, and your stake is worth
            </p>
            <div className="my-3 text-4xl font-extrabold text-good tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">From $200k and an empty office to a ticker symbol. Founder Mode: completed.</p>
          </>
        )}
        {go.type === 'network' && (
          <>
            <h2 className="text-3xl font-extrabold">
              🕸 {TOKEN_ENDING_FACES[go.tokenEnding ?? 'self_sustaining_protocol'].name}
            </h2>
            <p className="mt-3 leading-relaxed text-mut">
              Week {go.week}: the network {game.companyName} started stopped needing it. Nobody rang a bell and nobody wired you a
              number — it cleared its own bar and held it for six straight weeks. Your standing:
            </p>
            <div className="my-3 text-4xl font-extrabold text-good tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">{go.detail ?? TOKEN_ENDING_FACES[go.tokenEnding ?? 'self_sustaining_protocol'].line}</p>
          </>
        )}
        {go.type === 'timeup' && (
          <>
            <h2 className="text-3xl font-extrabold">⏱ Time's up — challenge complete</h2>
            <p className="mt-3 leading-relaxed text-mut">
              {game.challenge?.label ?? 'The challenge'} ran its {go.week} weeks. {game.companyName}'s final score — your stake, at the
              closing bell:
            </p>
            <div className="my-3 text-4xl font-extrabold text-good tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">Same world, same starting hand — think a friend can beat that?</p>
          </>
        )}
        <div className="mt-6 grid grid-cols-3 gap-3">
          {stats.map(([k, v]) => (
            <div key={k}>
              <div className="text-lg font-extrabold tnum">{v}</div>
              <div className="text-[11px] text-mut">{k}</div>
            </div>
          ))}
        </div>

        <TokenPostmortem />

        {replay && (
          <div
            className={`mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${
              replay.state === 'verified'
                ? 'border-good/40 text-good'
                : replay.state === 'unverifiable_desync'
                  ? 'border-bad/40 text-bad'
                  : 'border-line text-mut'
            }`}
            title={
              replay.state === 'verified'
                ? 'This run was re-simulated from its decision log and reproduced this exact result.'
                : replay.state === 'unverifiable_desync'
                  ? 'The decision log does not reproduce this result — the save was modified outside the game.'
                  : 'This run has no decision log (older save or online match), so it cannot be re-checked.'
            }
          >
            {replay.state === 'verified' && (
              <>
                ✓ Verified replay
                {game.challenge?.label.startsWith('Daily') ? <span className="text-mut"> · proof stored on this device</span> : null}
              </>
            )}
            {replay.state === 'unverifiable_desync' && <>⚠ Unverified — replay desync</>}
            {replay.state === 'legacy_no_journal' && <>No decision log — unverifiable run</>}
          </div>
        )}

        {hasCapability(game, 'leaderboard') && game.challenge?.label.startsWith('Daily') && (
          <div className="mt-5 text-left">
            <DailyLeaderboard day={Number(game.challenge.label.match(/#(\d+)/)?.[1] ?? 0)} highlightPlayerId={myId()} />
          </div>
        )}

        {/* Brief §35: what you just played decides what you're offered next. */}
        <div className="mt-5 rounded-xl border border-line/60 bg-surface2 px-4 py-3 text-left text-[13px] text-mut">
          {game.config?.format === 'daily_challenge' ? (
            <>Same world for everyone today — your score is on the board above. A new one lands tomorrow.</>
          ) : game.config?.format === 'scenario' ? (
            <>
              That was the <b className="text-ink">{game.config.scenario}</b> scenario. Different starts, different problems.
            </>
          ) : game.config?.mode === 'career' ? (
            <>Career is still growing: deeper product, people and board systems are on the way.</>
          ) : (
            <>Ready for something else? Career goes deeper; Arena puts you against other founders.</>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {game.config?.format === 'scenario' && <ResultCta label="Try another scenario" />}
            {game.config?.format === 'standard' && game.config?.mode === 'quick' && (
              <>
                <ResultCta label="Try Career" />
                <ResultCta label="Challenge friends in Arena" />
              </>
            )}
            {game.config?.mode === 'career' && <ResultCta label="Play a Quick run" />}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-line/60 bg-black/20 p-3 text-left">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-mut">The story of {game.companyName}</div>
          <TimelineChart history={game.history} markers={runMarkers(game)} />
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-mut">
            {runMarkers(game).map((m, i) => (
              <span key={i}>
                {m.emoji} wk{m.week} {m.label}
              </span>
            ))}
          </div>
          {/* the full biography: every recorded beat, chaptered — the chart above is its sketch */}
          <button
            className="mt-2.5 w-full rounded-lg border border-line2 px-3 py-2 text-[13px] font-semibold transition-colors hover:border-accent hover:text-ink"
            onClick={() => {
              setScreen('story')
              onClose()
            }}
          >
            📖 Read the story of this company →
          </button>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ShareImageButton
            game={game}
            text={`Founder Mode${game.challenge ? ` ${game.challenge.label}` : ''} — ${game.companyName}: ${money(go.payout ?? 0)} ${endingEmoji(go.type)}. Play: ${GAME_URL}`}
          />
          <ShareButton
            text={`Founder Mode${game.challenge ? ` ${game.challenge.label}` : ''}\n${game.companyName}: ${money(go.payout ?? 0)} ${endingEmoji(go.type)} · ${go.week} wks · ${game.pivots} pivot${game.pivots === 1 ? '' : 's'}\nPlay${game.challenge ? ' the same world' : ''}: ${GAME_URL}`}
          />
          <button
            className="rounded-xl bg-accent px-6 py-3 font-bold text-bg shadow-[var(--elev-2)] transition-all hover:brightness-110 active:scale-[0.98]"
            onClick={abandonGame}
          >
            New company
          </button>
        </div>
        <SocialShareRow
          text={`Founder Mode${game.challenge ? ` ${game.challenge.label}` : ''} — ${game.companyName}: ${money(go.payout ?? 0)} ${endingEmoji(go.type)} in ${go.week} weeks. Beat that: ${GAME_URL}`}
        />
      </div>
    </div>
  )
}
