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
import { Panel } from './components'

const NAV: { id: ScreenId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◧' },
  { id: 'inbox', label: 'Inbox', icon: '✉' },
  { id: 'team', label: 'Team', icon: '👥' },
  { id: 'hiring', label: 'Hiring', icon: '🔍' },
  { id: 'product', label: 'Product', icon: '⚙' },
  { id: 'growth', label: 'Growth', icon: '📈' },
  { id: 'market', label: 'Market', icon: '⚔️' },
  { id: 'finance', label: 'Finance', icon: '💰' },
  { id: 'fundraising', label: 'Fundraising', icon: '🤝' },
]

export default function App() {
  const { game, screen, setScreen, advance, abandonGame } = useStore()

  if (!game) return <NewGame />

  const pending = hasPendingDecision(game)
  const unread = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length
  const runway = runwayWeeks(game)
  const val = valuation(game)
  const burn = weeklyBurn(game)
  const net = game.lastRevenue - burn

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="company">{game.companyName}</div>
          <div className="tagline">{game.stage} · Week {game.week}</div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={screen === n.id ? 'active' : ''} onClick={() => setScreen(n.id)}>
              <span>{n.icon}</span> {n.label}
              {n.id === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="week-label">{weekDate(game.week)}</div>
          <button
            className="advance-btn"
            disabled={pending || !!game.gameOver}
            onClick={advance}
            title={pending ? 'Resolve the decision in your inbox first' : undefined}
          >
            {pending ? 'Decision required' : 'Advance Week ▸'}
          </button>
        </div>
      </aside>

      <header className="topbar">
        <Stat k="Cash" v={money(game.cash)} tone={game.cash < burn * 8 ? 'bad' : undefined} />
        <Stat
          k="Runway"
          v={runway === Infinity ? '∞' : `${Math.max(0, Math.floor(runway))} wk`}
          tone={runway < 10 ? 'bad' : runway < 20 ? 'warn' : 'good'}
        />
        <Stat k="Revenue /wk" v={money(game.lastRevenue)} />
        <Stat k="Net /wk" v={money(net)} tone={net >= 0 ? 'good' : undefined} />
        <Stat k="Users" v={num(game.users)} />
        <Stat k="PMF" v={`${Math.round(game.pmf)}`} tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'warn' : undefined} />
        <Stat k="Valuation" v={money(val)} />
        <Stat k="Team" v={`${game.employees.length}`} />
        <Stat k="Morale" v={`${Math.round(avgMorale(game))}`} tone={avgMorale(game) < 45 ? 'bad' : undefined} />
      </header>

      <main className="main">
        {game.flash && <div className="flash">{game.flash}</div>}
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'inbox' && <Inbox />}
        {screen === 'team' && <Team />}
        {screen === 'hiring' && <Hiring />}
        {screen === 'product' && <Product />}
        {screen === 'growth' && <Growth />}
        {screen === 'market' && <Market />}
        {screen === 'finance' && <Finance />}
        {screen === 'fundraising' && <Fundraising />}
      </main>

      {game.gameOver && <GameOver />}
      <button
        style={{ position: 'fixed', bottom: 10, right: 12, opacity: 0.35, fontSize: '0.72rem' }}
        className="btn danger"
        onClick={() => {
          if (confirm('Abandon this company and start over?')) abandonGame()
        }}
      >
        New run
      </button>
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="topstat">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ''}`}>{v}</div>
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
    <div className="overlay">
      <Panel>
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          {go.type === 'bankrupt' && (
            <>
              <h2>💸 Out of money</h2>
              <p>
                {game.companyName} ran out of cash in week {go.week}. The servers went dark, the office plants were
                divided among the team, and the domain now redirects to a competitor.
              </p>
              <p className="muted">Peak users: {num(Math.max(...game.history.map((h) => h.users), 0))}</p>
            </>
          )}
          {go.type === 'unicorn' && (
            <>
              <h2>🦄 Unicorn!</h2>
              <p>
                In week {go.week}, {game.companyName} crossed a $1B valuation. Your stake is worth
              </p>
              <div className="big good-text">{money(go.payout ?? 0)}</div>
              <p>Magazine covers, conference keynotes, and a very confused bank teller await.</p>
            </>
          )}
          {go.type === 'acquired' && (
            <>
              <h2>🤝 Acquired</h2>
              <p>
                You sold {game.companyName} in week {go.week}. Your personal payout:
              </p>
              <div className="big good-text">{money(go.payout ?? 0)}</div>
              <p>Time for a sabbatical... or the next company.</p>
            </>
          )}
          {go.type === 'fired' && (
            <>
              <h2>🪑 Fired by your own board</h2>
              <p>
                In week {go.week}, the board of {game.companyName} voted to replace you as CEO. You built it, you
                raised for it — and the people you raised from showed you the door. Your discounted stake:
              </p>
              <div className="big">{money(go.payout ?? 0)}</div>
              <p>Somewhere, a founder support group has a chair waiting.</p>
            </>
          )}
          <div
            className="mt"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}
          >
            {stats.map(([k, v]) => (
              <div key={k}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{v}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{k}</div>
              </div>
            ))}
          </div>
          <button className="btn primary mt" onClick={abandonGame}>
            Start a new company
          </button>
        </div>
      </Panel>
    </div>
  )
}
