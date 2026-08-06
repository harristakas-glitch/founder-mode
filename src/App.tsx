import { useEffect, useRef, useState } from 'react'
import {
  Check,
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
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react'
import { useStore, type ScreenId } from './store'
import { avgMorale, hasPendingDecision, runwayWeeks, totalUsers, valuation, weekDate, weeklyBurn } from './game/engine'
import { money, num } from './format'
import { myId } from './net/online'
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
import { Inbox } from './screens/Inbox'
import { Career } from './screens/Career'
import { Confetti, Monogram, Ticker, TimelineChart, TrendBadge } from './components'
import { runMarkers, shareResultImage } from './shareImage'
import { Coach } from './Coach'
import { ChatWidget } from './ChatWidget'
import { DailyLeaderboard } from './screens/DailyLeaderboard'

// Each market gets its own accent identity — the whole UI subtly rethemes per run.
const SECTOR_ACCENTS: Record<string, [string, string]> = {
  saas: ['#7c9aff', '#a78bfa'],
  social: ['#f472b6', '#fb7185'],
  fintech: ['#34d399', '#2dd4bf'],
  devtools: ['#a78bfa', '#818cf8'],
  ecommerce: ['#fbbf24', '#fb923c'],
}

const NAV: { id: ScreenId; label: string; icon: typeof Mail }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: Mail },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'hiring', label: 'Hiring', icon: UserPlus },
  { id: 'product', label: 'Product', icon: Package },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'market', label: 'Market', icon: Swords },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'fundraising', label: 'Fundraising', icon: HandCoins },
  { id: 'career', label: 'Career', icon: Trophy },
]

const GAME_URL = 'https://harristakas-glitch.github.io/founder-mode/'
const ENDING_EMOJI: Record<string, string> = { unicorn: '🦄', acquired: '🤝', bankrupt: '💸', fired: '🪑', timeup: '⏱', ipo: '🔔' }

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
  const emotes = useStore((s) => s.emotes)
  const [navOpen, setNavOpen] = useState(false)

  // rejoin the online room this device was in before a refresh; pick up any signed-in session
  useEffect(() => {
    void useStore.getState().resumeOnline()
    void useStore.getState().initAuth()
  }, [])
  const [weekFlash, setWeekFlash] = useState<number | null>(null)
  const [resultsClosed, setResultsClosed] = useState(false) // results overlay dismissed for a last look around
  const [, setClock] = useState(0) // re-render for the round countdown
  const prevWeek = useRef<number | null>(null)

  useEffect(() => {
    if (!game) {
      prevWeek.current = null
      return
    }
    if (prevWeek.current !== null && game.week > prevWeek.current) {
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
    const [a, a2] = SECTOR_ACCENTS[game?.sector ?? 'saas'] ?? SECTOR_ACCENTS.saas
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
  const matchOver = !!online && online.phase === 'playing' && online.players.length > 1 && online.players.every((p) => p.over)

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
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse rounded-2xl border border-line bg-surface px-8 py-5 text-[15px] font-semibold">
          Reconnecting to your room…
        </div>
      </div>
    )
  if (!game) return online?.phase === 'lobby' ? <Lobby /> : <NewGame />

  const pending = hasPendingDecision(game)
  const unread = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length
  const val = valuation(game)
  const burn = weeklyBurn(game)
  const runway = runwayWeeks(game)
  const morale = avgMorale(game)
  const secondsLeft = online?.deadline ? Math.max(0, Math.ceil((online.deadline - Date.now()) / 1000)) : null
  const h = game.history
  const usersTrend = h.length >= 5 && h[h.length - 5].users > 0 ? (h[h.length - 1].users - h[h.length - 5].users) / h[h.length - 5].users / 4 : 0
  const cashDelta = h.length >= 2 ? h[h.length - 1].cash - h[h.length - 2].cash : 0
  const celebrate =
    (game.flash?.includes('🏆') || game.flash?.startsWith('🏁') || game.flash?.startsWith('🚀') || false) ||
    (!!game.gameOver && ['unicorn', 'ipo', 'acquired'].includes(game.gameOver.type))

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {NAV.map((n) => {
        const Icon = n.icon
        const active = screen === n.id
        return (
          <button
            key={n.id}
            onClick={() => {
              setScreen(n.id)
              setNavOpen(false)
            }}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-[44px] w-full items-center gap-2.5 rounded-xl py-2 pr-3 pl-4 text-left text-[14px] transition-colors duration-[120ms] md:min-h-[36px] ${
              active ? 'bg-accent/12 font-semibold text-ink' : 'text-mut hover:bg-surface2/70 hover:text-ink'
            }`}
          >
            {/* a quiet accent rail marks the place; the accent itself stays reserved for actions */}
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" />}
            <Icon size={16} strokeWidth={2.2} className={active ? 'text-accent' : ''} />
            {n.label}
            {n.id === 'inbox' && unread > 0 && (
              <span className="ml-auto rounded-full bg-bad px-1.5 py-px text-[10px] font-bold text-bg tnum">{unread}</span>
            )}
          </button>
        )
      })}
    </nav>
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
  ) : (
    <button
      disabled={advanceDisabled}
      onClick={advance}
      title={pending ? 'Resolve the decision in your inbox first' : undefined}
      className={`flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-bold transition-[filter,transform,background-color] duration-[120ms] ${
        advanceDisabled
          ? 'cursor-not-allowed bg-surface2 text-mut'
          : 'bg-good text-bg shadow-[var(--elev-2)] hover:brightness-110 active:scale-[0.98]'
      }`}
    >
      {pending ? (
        <>
          <Hourglass size={16} /> Decision required
        </>
      ) : online ? (
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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* sidebar — desktop */}
      <aside className="hidden w-[230px] shrink-0 flex-col border-r border-line/60 bg-gradient-to-b from-bg2 to-bg md:flex">
        <div className="border-b border-line/60 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Monogram name={game.companyName} />
            <div className="min-w-0">
              <div className="truncate text-[16px] font-extrabold tracking-tight">{game.companyName}</div>
              <div className="text-xs text-mut">
                {game.stage} · Week {game.week}
              </div>
            </div>
          </div>
          {game.challenge && <div className="mt-1 text-[11px] text-mut">{game.challenge.label} · ends wk {game.challenge.cap}</div>}
          {game.rules?.energy !== false && (
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
                    {p.over ? '☠️ ' : ''}
                    {p.company}
                  </span>
                  {p.over ? (
                    <span className="text-mut">out</span>
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
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-line bg-bg2 shadow-[var(--elev-3)] rise-in">
            <div className="flex items-center justify-between border-b border-line/60 px-4 py-4">
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
            {nav}
          </aside>
        </div>
      )}

      {/* right side */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-line/60 bg-bg2/70 px-2 backdrop-blur-md md:gap-4 md:px-5">
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink md:hidden"
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          {/* the metric rail scrolls on narrow screens; the soft right edge is the
              affordance, so a value is never chopped off mid-word */}
          <div className="fade-r flex flex-1 items-center gap-4 overflow-x-auto pr-6 md:gap-6 [&::-webkit-scrollbar]:hidden">
            <Stat k="Cash" tone={game.cash < Math.max(burn * 8, 40_000) ? 'bad' : undefined}>
              <Ticker value={game.cash} format={money} />
              <TrendBadge value={cashDelta} format={money} />
            </Stat>
            <Stat k="Runway" tone={runway < 10 ? 'bad' : runway < 20 ? 'warn' : 'good'}>
              {runway === Infinity ? '∞' : `${Math.max(0, Math.floor(runway))} wk`}
            </Stat>
            <Stat k="Rev /wk">
              <Ticker value={game.lastRevenue} format={money} />
            </Stat>
            <Stat k="Burn /wk">
              <Ticker value={burn} format={money} />
            </Stat>
            <Stat k="Net /wk" tone={game.lastRevenue - burn >= 0 ? 'good' : 'bad'}>
              <Ticker value={game.lastRevenue - burn} format={(n) => `${n >= 0 ? '+' : ''}${money(n)}`} />
            </Stat>
            <Stat k="Users">
              <Ticker value={totalUsers(game)} format={num} />
              <TrendBadge value={usersTrend} />
            </Stat>
            <Stat k="PMF" tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'warn' : undefined}>
              <Ticker value={game.pmf} format={(n) => `${Math.round(n)}`} />
            </Stat>
            <Stat k="Valuation">
              <Ticker value={val} format={money} />
            </Stat>
            <Stat k="Morale" tone={morale < 45 ? 'bad' : undefined}>
              {Math.round(morale)}
            </Stat>
            {online && secondsLeft !== null && !matchOver && (
              <Stat k="Round ends" tone={secondsLeft < 30 ? 'bad' : undefined}>
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </Stat>
            )}
          </div>
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
        </header>

        {/* main */}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-24 md:px-6 md:pt-5 md:pb-8">
          <Coach />
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
          <div key={screen} className="rise-in">
            {screen === 'dashboard' && <Dashboard />}
            {screen === 'inbox' && <Inbox />}
            {screen === 'team' && <Team />}
            {screen === 'hiring' && <Hiring />}
            {screen === 'product' && <Product />}
            {screen === 'growth' && <Growth />}
            {screen === 'market' && <Market />}
            {screen === 'finance' && <Finance />}
            {screen === 'fundraising' && <Fundraising />}
            {screen === 'career' && <Career />}
          </div>
        </main>

        {/* mobile advance */}
        <div className="fixed inset-x-4 bottom-4 z-30 md:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          {advanceBtn}
        </div>
      </div>

      {/* week transition */}
      {weekFlash && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="week-sweep rounded-2xl border border-line/60 bg-bg2/90 px-10 py-6 text-center shadow-[var(--elev-3)] backdrop-blur">
            <div className="text-3xl font-extrabold tracking-tight">Week {weekFlash}</div>
            <div className="mt-1 text-sm text-mut">{weekDate(weekFlash)}</div>
          </div>
        </div>
      )}

      {/* emote toasts */}
      {emotes.length > 0 && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-[75] flex -translate-x-1/2 flex-col items-center gap-1.5">
          {emotes.map((e) => (
            <div key={e.id} className="flash-in rounded-full border border-line bg-bg2/95 px-4 py-1.5 text-[14px] shadow-[var(--elev-3)]">
              <b>{e.from}</b> <span className="text-[18px]">{e.emoji}</span>
            </div>
          ))}
        </div>
      )}

      <ChatWidget />
      {celebrate && <Confetti key={`${game.week}-${game.gameOver?.type ?? 'w'}`} />}
      {matchOver && !resultsClosed && <MatchOver onClose={() => setResultsClosed(true)} />}
      {!online && game.gameOver && !resultsClosed && <GameOver onClose={() => setResultsClosed(true)} />}
    </div>
  )
}

function Stat({ k, tone, children }: { k: string; tone?: 'good' | 'bad' | 'warn'; children: React.ReactNode }) {
  const cls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''
  return (
    <div className="shrink-0 leading-tight">
      <div className="text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.08em] text-mut">{k}</div>
      <div className={`mt-0.5 flex items-baseline whitespace-nowrap text-[15px] font-bold tnum ${cls}`}>{children}</div>
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
          className="rounded-lg border border-line bg-surface2/70 px-3.5 py-1.5 text-[13px] font-semibold text-mut transition-all hover:border-accent hover:text-ink active:scale-[0.97]"
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
          const r = await shareResultImage(game, text)
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
  const ranked = [...online.players].sort((a, b) => b.payout - a.payout)
  const shareText =
    `Founder Mode — online match result:\n` +
    ranked.map((p, i) => `${i + 1}. ${p.company} ${ENDING_EMOJI[p.overType ?? 'timeup']} ${money(p.payout)}`).join('\n') +
    `\nPlay: ${GAME_URL}`
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Match over" className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain bg-black/75 p-4 backdrop-blur-[2px]">
      <div className="rise-in relative w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 text-center shadow-[var(--elev-3)]">
        <button className="absolute top-3 right-3 rounded-lg p-1.5 text-mut transition-colors hover:bg-surface2 hover:text-ink" title="Close and look around" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="text-3xl font-extrabold">🏆 Match over</h2>
        <p className="mt-2 text-mut">
          <b className="text-ink">{ranked[0]?.company}</b> takes the market. Final founder payouts:
        </p>
        <div className="mt-5 space-y-2 text-left">
          {ranked.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
                i === 0 ? 'border-warn/60 bg-warn/10' : 'border-line bg-surface2/50'
              }`}
            >
              <span>
                <b>
                  {i === 0 ? '👑 ' : `${i + 1}. `}
                  {p.company}
                </b>{' '}
                <span className="text-mut">
                  {ENDING_EMOJI[p.overType ?? 'timeup']} {p.overType ?? 'timeup'}
                  {p.id === myId() && ' · you'}
                </span>
              </span>
              <b className={`tnum ${p.payout > 0 ? 'text-good' : 'text-mut'}`}>{money(p.payout)}</b>
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

function GameOver({ onClose }: { onClose: () => void }) {
  const { game, abandonGame } = useStore()
  const dialogRef = useDialog(onClose)
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
              <p className="mt-3 rounded-xl border border-line bg-surface2/60 px-4 py-3 text-left text-[13px] leading-relaxed text-mut">
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

        {game.challenge?.label.startsWith('Daily') && (
          <div className="mt-5 text-left">
            <DailyLeaderboard day={Number(game.challenge.label.match(/#(\d+)/)?.[1] ?? 0)} highlightPlayerId={myId()} />
          </div>
        )}

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
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ShareImageButton
            game={game}
            text={`Founder Mode${game.challenge ? ` ${game.challenge.label}` : ''} — ${game.companyName}: ${money(go.payout ?? 0)} ${ENDING_EMOJI[go.type]}. Play: ${GAME_URL}`}
          />
          <ShareButton
            text={`Founder Mode${game.challenge ? ` ${game.challenge.label}` : ''}\n${game.companyName}: ${money(go.payout ?? 0)} ${ENDING_EMOJI[go.type]} · ${go.week} wks · ${game.pivots} pivot${game.pivots === 1 ? '' : 's'}\nPlay${game.challenge ? ' the same world' : ''}: ${GAME_URL}`}
          />
          <button
            className="rounded-xl bg-accent px-6 py-3 font-bold text-bg shadow-[var(--elev-2)] transition-all hover:brightness-110 active:scale-[0.98]"
            onClick={abandonGame}
          >
            New company
          </button>
        </div>
        <SocialShareRow
          text={`Founder Mode${game.challenge ? ` ${game.challenge.label}` : ''} — ${game.companyName}: ${money(go.payout ?? 0)} ${ENDING_EMOJI[go.type]} in ${go.week} weeks. Beat that: ${GAME_URL}`}
        />
      </div>
    </div>
  )
}
