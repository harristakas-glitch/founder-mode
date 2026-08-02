import { useEffect, useRef, useState } from 'react'
import {
  ChevronsRight,
  HandCoins,
  Hourglass,
  LayoutDashboard,
  Mail,
  Menu,
  Package,
  Swords,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useStore, type ScreenId } from './store'
import { avgMorale, hasPendingDecision, runwayWeeks, valuation, weekDate, weeklyBurn } from './game/engine'
import { money, num } from './format'
import { NewGame } from './screens/NewGame'
import { Dashboard } from './screens/Dashboard'
import { Team } from './screens/Team'
import { Hiring } from './screens/Hiring'
import { Product } from './screens/Product'
import { Growth } from './screens/Growth'
import { Market } from './screens/Market'
import { Finance } from './screens/Finance'
import { Fundraising } from './screens/Fundraising'
import { Inbox } from './screens/Inbox'
import { Ticker } from './components'

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
]

export default function App() {
  const { game, screen, setScreen, advance, abandonGame } = useStore()
  const [navOpen, setNavOpen] = useState(false)
  const [weekFlash, setWeekFlash] = useState<number | null>(null)
  const prevWeek = useRef<number | null>(null)

  useEffect(() => {
    if (!game) {
      prevWeek.current = null
      return
    }
    if (prevWeek.current !== null && game.week > prevWeek.current) {
      setWeekFlash(game.week)
      const t = setTimeout(() => setWeekFlash(null), 950)
      return () => clearTimeout(t)
    }
    prevWeek.current = game.week
  }, [game?.week, game])

  useEffect(() => {
    if (game) prevWeek.current = game.week
  }, [game?.week, game])

  if (!game) return <NewGame />

  const pending = hasPendingDecision(game)
  const unread = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length
  const val = valuation(game)
  const burn = weeklyBurn(game)
  const runway = runwayWeeks(game)
  const morale = avgMorale(game)

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

  const advanceBtn = (
    <button
      disabled={pending || !!game.gameOver}
      onClick={advance}
      title={pending ? 'Resolve the decision in your inbox first' : undefined}
      className={`flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-[15px] font-bold transition-all ${
        pending || game.gameOver
          ? 'cursor-not-allowed bg-surface2 text-mut'
          : 'bg-gradient-to-br from-good to-emerald-600 text-white shadow-lg shadow-good/25 hover:brightness-110 active:scale-[0.98]'
      }`}
    >
      {pending ? (
        <>
          <Hourglass size={16} /> Decision required
        </>
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
          <div className="text-[17px] font-extrabold tracking-tight">{game.companyName}</div>
          <div className="mt-0.5 text-xs text-mut">
            {game.stage} · Week {game.week}
          </div>
        </div>
        {nav}
        <div className="border-t border-line/60 p-3">
          <div className="mb-2 text-center text-[11px] text-mut">{weekDate(game.week)}</div>
          {advanceBtn}
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
            <Stat k="Cash" tone={game.cash < burn * 8 ? 'bad' : undefined}>
              <Ticker value={game.cash} format={money} />
            </Stat>
            <Stat k="Runway" tone={runway < 10 ? 'bad' : runway < 20 ? 'warn' : 'good'}>
              {runway === Infinity ? '∞' : `${Math.max(0, Math.floor(runway))} wk`}
            </Stat>
            <Stat k="Rev /wk">
              <Ticker value={game.lastRevenue} format={money} />
            </Stat>
            <Stat k="Users">
              <Ticker value={game.users} format={num} />
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
          </div>
        </header>

        {/* main */}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-24 md:px-6 md:pt-5 md:pb-8">
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

      {game.gameOver && <GameOver />}

      <button
        className="fixed right-3 bottom-3 z-20 hidden rounded-lg border border-line/60 px-2.5 py-1 text-[11px] text-mut opacity-40 transition-opacity hover:opacity-100 hover:text-bad md:block"
        onClick={() => {
          if (confirm('Abandon this company and start over?')) abandonGame()
        }}
      >
        New run
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
              {game.companyName} ran out of cash in week {go.week}. The servers went dark, the office plants were divided
              among the team, and the domain now redirects to a competitor.
            </p>
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
              In week {go.week}, the board of {game.companyName} voted to replace you as CEO. You built it, you raised for
              it — and the people you raised from showed you the door. Your discounted stake:
            </p>
            <div className="my-3 text-4xl font-extrabold tnum">{money(go.payout ?? 0)}</div>
            <p className="text-mut">Somewhere, a founder support group has a chair waiting.</p>
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
        <button
          className="mt-7 rounded-xl bg-accent px-6 py-3 font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.98]"
          onClick={abandonGame}
        >
          Start a new company
        </button>
      </div>
    </div>
  )
}
