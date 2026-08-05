import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronsRight,
  Globe,
  HandCoins,
  Hourglass,
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
      className="rounded-lg p-2 text-mut transition-colors hover:bg-surface2 hover:text-ink"
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
  }, [game?.week, game])

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

  const me = online?.players.find((p) => p.id === myId())
  const myReady = !!me?.ready
  const matchOver = !!online && online.phase === 'playing' && online.players.length > 0 && online.players.every((p) => p.over)

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
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] transition-colors ${
              active ? 'bg-accent font-semibold text-white shadow-lg shadow-accent/25' : 'text-mut hover:bg-surface2 hover:text-ink'
            }`}
          >
            <Icon size={16} strokeWidth={2.2} />
            {n.label}
            {n.id === 'inbox' && unread > 0 && (
              <span className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-bad text-white'}`}>
                {unread}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )

  const advanceDisabled = online ? pending || myReady || !!game.gameOver || matchOver : pending || !!game.gameOver
  const advanceBtn = (
    <button
      disabled={advanceDisabled}
      onClick={advance}
      title={pending ? 'Resolve the decision in your inbox first' : undefined}
      className={`flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-[15px] font-bold transition-all ${
        advanceDisabled
          ? 'cursor-not-allowed bg-surface2 text-mut'
          : 'bg-gradient-to-br from-good to-emerald-600 text-white shadow-lg shadow-good/25 hover:brightness-110 active:scale-[0.98]'
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
                <div key={p.id} className="flex items-center justify-between text-[11.5px]">
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
            <button className="mt-1.5 w-full text-center text-[11.5px] text-mut hover:text-ink" onClick={cancelReady}>
              Cancel ready
            </button>
          )}
        </div>
      </aside>

      {/* sidebar — mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-line bg-bg2 shadow-2xl rise-in">
            <div className="flex items-center justify-between border-b border-line/60 px-4 py-4">
              <div>
                <div className="text-[17px] font-extrabold">{game.companyName}</div>
                <div className="text-xs text-mut">
                  {game.stage} · Week {game.week}
                  {online && ` · Room ${online.code}`}
                </div>
              </div>
              <button onClick={() => setNavOpen(false)} className="rounded-lg p-1.5 text-mut hover:bg-surface2">
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
        <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line/60 bg-surface/60 px-3 backdrop-blur md:gap-6 md:px-5">
          <button className="rounded-lg p-2 text-mut hover:bg-surface2 md:hidden" onClick={() => setNavOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="flex flex-1 items-center gap-4 overflow-x-auto md:gap-6 [&::-webkit-scrollbar]:hidden">
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
        </header>

        {/* main */}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-24 md:px-6 md:pt-5 md:pb-8">
          <Coach />
          {online && game.gameOver && !matchOver && (
            <div className="mb-4 rounded-xl border border-bad/50 bg-bad/10 px-4 py-3 text-[14px]">
              <b>{game.companyName} is out of the running</b> ({game.gameOver.type}, week {game.gameOver.week}). Watch the Market screen
              while your rivals finish the match.
            </div>
          )}
          {game.flash && (
            <div
              className={`flash-in mb-4 rounded-xl border px-4 py-3 text-[14px] leading-relaxed ${
                game.flash.startsWith('🏁')
                  ? 'celebrate border-good/50 bg-gradient-to-r from-good/20 to-good/5 text-good'
                  : 'border-accent/50 bg-gradient-to-r from-accent/15 to-accent/5'
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
        <div className="fixed inset-x-4 bottom-4 z-30 md:hidden">{advanceBtn}</div>
      </div>

      {/* week transition */}
      {weekFlash && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="week-sweep rounded-2xl border border-line/60 bg-bg2/90 px-10 py-6 text-center shadow-2xl backdrop-blur">
            <div className="text-3xl font-extrabold tracking-tight">Week {weekFlash}</div>
            <div className="mt-1 text-sm text-mut">{weekDate(weekFlash)}</div>
          </div>
        </div>
      )}

      {/* emote toasts */}
      {emotes.length > 0 && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-[75] flex -translate-x-1/2 flex-col items-center gap-1.5">
          {emotes.map((e) => (
            <div key={e.id} className="flash-in rounded-full border border-line bg-bg2/95 px-4 py-1.5 text-[14px] shadow-xl">
              <b>{e.from}</b> <span className="text-[18px]">{e.emoji}</span>
            </div>
          ))}
        </div>
      )}

      <ChatWidget />
      {celebrate && <Confetti key={`${game.week}-${game.gameOver?.type ?? 'w'}`} />}
      {matchOver && <MatchOver />}
      {!online && game.gameOver && <GameOver />}

      <button
        className="fixed right-3 bottom-3 z-20 hidden rounded-lg border border-line/60 px-2.5 py-1 text-[11px] text-mut opacity-40 transition-opacity hover:opacity-100 hover:text-bad md:block"
        onClick={() => {
          if (confirm(online ? 'Leave the match and abandon your company?' : 'Abandon this company and start over?')) abandonGame()
        }}
      >
        {online ? 'Leave match' : 'New run'}
      </button>
    </div>
  )
}

function Stat({ k, tone, children }: { k: string; tone?: 'good' | 'bad' | 'warn'; children: React.ReactNode }) {
  const cls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''
  return (
    <div className="shrink-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mut">{k}</div>
      <div className={`text-[15px] font-bold tnum ${cls}`}>{children}</div>
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
  return (
    <button
      className="rounded-xl bg-gradient-to-br from-accent to-accent2 px-5 py-3 font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.98]"
      onClick={async () => {
        const r = await shareResultImage(game, text)
        setState(r)
        setTimeout(() => setState('idle'), 2200)
      }}
    >
      {state === 'idle' ? '📸 Share image' : state === 'shared' ? 'Shared!' : state === 'downloaded' ? 'Image saved!' : 'Could not render'}
    </button>
  )
}

function MatchOver() {
  const { online, game, abandonGame } = useStore()
  if (!online) return null
  const ranked = [...online.players].sort((a, b) => b.payout - a.payout)
  const shareText =
    `Founder Mode — online match result:\n` +
    ranked.map((p, i) => `${i + 1}. ${p.company} ${ENDING_EMOJI[p.overType ?? 'timeup']} ${money(p.payout)}`).join('\n') +
    `\nPlay: ${GAME_URL}`
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="rise-in w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 text-center shadow-2xl">
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
            className="rounded-xl bg-accent px-5 py-3 font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.98]"
            onClick={abandonGame}
          >
            New game
          </button>
        </div>
        <SocialShareRow text={shareText} />
      </div>
    </div>
  )
}

function GameOver() {
  const { game, abandonGame } = useStore()
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="rise-in w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 text-center shadow-2xl">
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
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-mut">The story of {game.companyName}</div>
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
            className="rounded-xl bg-accent px-6 py-3 font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.98]"
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
