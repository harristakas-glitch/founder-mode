import { useState } from 'react'
import { CalendarDays, Globe, LogIn, LogOut, Rocket } from 'lucide-react'
import { SECTORS, sectorById } from '../game/data'
import { ACHIEVEMENTS, earnedAchievements } from '../game/achievements'
import { SCENARIOS } from '../game/engine'
import { money } from '../format'
import { onlineConfigured } from '../net/config'
import type { FounderKind, SectorId } from '../game/types'
import { MATCH_CAP, dailyInfo, readHall, useStore } from '../store'
import { DailyLeaderboard } from './DailyLeaderboard'

const ENDING_ICON: Record<string, string> = { unicorn: '🦄', acquired: '🤝', bankrupt: '💸', fired: '🪑', timeup: '⏱', ipo: '🔔' }

function Pick({ selected, onClick, title, blurb, disabled }: { selected: boolean; onClick: () => void; title: string; blurb: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-3 text-left transition-all disabled:opacity-40 ${
        selected ? 'border-accent bg-accent/15 shadow-lg shadow-accent/10' : 'border-line bg-surface hover:border-accent/60'
      }`}
    >
      <div className="text-[14px] font-bold">{title}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-mut">{blurb}</div>
    </button>
  )
}

const label = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mut'
const inputCls =
  'w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-mut/50 focus:border-accent'

type Mode = 'free' | 'daily' | 'online'

function AchievementGallery() {
  const earned = earnedAchievements()
  if (earned.size === 0) return null // nothing to brag about yet — keep the first screen clean
  return (
    <div className="mt-8">
      <label className={label}>
        Achievements — {earned.size}/{ACHIEVEMENTS.length}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {ACHIEVEMENTS.map((a) => {
          const has = earned.has(a.id)
          return (
            <span
              key={a.id}
              title={`${a.name} — ${has ? a.desc : '???'}`}
              className={`cursor-help rounded-lg border px-2 py-1 text-[12px] font-semibold ${
                has ? 'border-accent2/50 bg-accent2/10 text-ink' : 'border-line bg-surface opacity-35 grayscale'
              }`}
            >
              {a.emoji} {has ? a.name : '·····'}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function AuthCorner() {
  const authUser = useStore((s) => s.authUser)
  const signIn = useStore((s) => s.signIn)
  const signOutUser = useStore((s) => s.signOutUser)
  const [err, setErr] = useState<string | null>(null)
  if (!onlineConfigured || location.protocol === 'file:') return null

  if (authUser) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-1.5 py-1">
        {authUser.avatar ? (
          <img src={authUser.avatar} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
            {authUser.name[0]?.toUpperCase()}
          </span>
        )}
        <span className="text-[12.5px] font-semibold">{authUser.name}</span>
        <button className="rounded-full p-1 text-mut hover:text-bad" title="Sign out" onClick={() => void signOutUser()}>
          <LogOut size={13} />
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {(['google', 'twitter'] as const).map((p) => (
          <button
            key={p}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-mut transition-colors hover:border-accent hover:text-ink"
            onClick={async () => setErr(await signIn(p))}
          >
            <LogIn size={12} /> {p === 'google' ? 'Google' : '𝕏'}
          </button>
        ))}
      </div>
      {err && <span className="max-w-[260px] text-right text-[10.5px] text-bad">{err}</span>}
    </div>
  )
}

export function NewGame() {
  const startGame = useStore((s) => s.startGame)
  const hostRoom = useStore((s) => s.hostRoom)
  const joinRoom = useStore((s) => s.joinRoom)
  const connecting = useStore((s) => s.connecting)
  const daily = dailyInfo()
  const [mode, setMode] = useState<Mode>('free')
  const [sector, setSector] = useState<SectorId>('saas')
  const [name, setName] = useState('')
  const [founder, setFounder] = useState<FounderKind>('technical')
  const [joinCode, setJoinCode] = useState('')
  const [scenario, setScenario] = useState('standard')
  const [netError, setNetError] = useState<string | null>(null)
  const hall = readHall()

  const netAction = async (fn: () => Promise<void>) => {
    setNetError(null)
    try {
      await fn()
    } catch (e) {
      setNetError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6 md:p-8">
      <div className="rise-in w-[780px] max-w-full">
        <div className="flex items-start justify-between gap-3">
          <h1 className="bg-gradient-to-r from-ink to-accent bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
            Founder Mode
          </h1>
          <AuthCorner />
        </div>
        <p className="mt-1.5 mb-7 text-mut">You have $200,000, an empty office, and a dream. Build a unicorn — or die trying.</p>

        <label className={label}>Game mode</label>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Pick
            selected={mode === 'free'}
            onClick={() => setMode('free')}
            title="Free play"
            blurb="Solo vs AI rivals. Pick your market, no time limit."
          />
          <Pick
            selected={mode === 'daily'}
            onClick={() => setMode('daily')}
            title={`Daily Challenge #${daily.id}`}
            blurb={`Today's market: ${sectorById(daily.sector).name}. Same world for everyone, ${MATCH_CAP} weeks, highest payout wins.`}
          />
          <Pick
            selected={mode === 'online'}
            onClick={() => setMode('online')}
            title="Online with friends"
            blurb="2-4 founders, different devices, one market. Rounds advance when everyone is ready — or when the clock runs out."
          />
        </div>

        <label className={`${label} mt-6`}>Your company</label>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" placeholder="e.g. Hyperloop for Cats, Inc." value={name} maxLength={24} onChange={(e) => setName(e.target.value)} className={`${inputCls} min-w-0 flex-1`} />
          <div className="flex overflow-hidden rounded-lg border border-line text-[12px] font-semibold">
            {(['technical', 'business'] as FounderKind[]).map((f) => (
              <button
                key={f}
                onClick={() => setFounder(f)}
                className={`px-3 py-2.5 transition-colors ${founder === f ? 'bg-accent text-white' : 'bg-surface text-mut hover:text-ink'}`}
              >
                {f === 'technical' ? 'Technical founder' : 'Business founder'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'daily' && (
          <div className="mt-4">
            <DailyLeaderboard day={daily.id} />
          </div>
        )}

        {mode !== 'online' && (
          <>
            <label className={`${label} mt-6`}>
              Pick your market {mode === 'daily' && <span className="normal-case tracking-normal">— locked by today's challenge</span>}
            </label>
            <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {SECTORS.map((s) => (
                <Pick
                  key={s.id}
                  disabled={mode === 'daily'}
                  selected={(mode === 'daily' ? daily.sector : sector) === s.id}
                  onClick={() => setSector(s.id)}
                  title={s.name}
                  blurb={s.blurb}
                />
              ))}
            </div>

            {mode === 'free' && (
              <>
                <label className={`${label} mt-6`}>Scenario</label>
                <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {SCENARIOS.map((sc) => (
                    <Pick key={sc.id} selected={scenario === sc.id} onClick={() => setScenario(sc.id)} title={sc.name} blurb={sc.blurb} />
                  ))}
                </div>
              </>
            )}

            <button
              className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[16px] font-bold text-white shadow-xl shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.99]"
              onClick={() => startGame({ mode, sector, name: name.trim(), founder, scenario })}
            >
              {mode === 'daily' ? <CalendarDays size={18} /> : <Rocket size={18} />}
              {mode === 'daily' ? `Play Daily #${daily.id}` : 'Found the company'}
            </button>
          </>
        )}

        {mode === 'online' && (
          <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
            {!onlineConfigured ? (
              <div className="text-[13.5px] leading-relaxed text-mut">
                <b className="text-warn">Online play isn't configured yet.</b> It needs a free Supabase project: create one at
                supabase.com, then paste its URL and anon key into <code className="text-ink">src/net/config.ts</code> and redeploy.
                No database or SQL required — the game only uses realtime channels.
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    disabled={connecting}
                    className="flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                    onClick={() => netAction(() => hostRoom(name.trim(), founder))}
                  >
                    <Globe size={17} /> {connecting ? 'Connecting…' : 'Create a room'}
                  </button>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Room code"
                      value={joinCode}
                      maxLength={5}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      className={`${inputCls} flex-1 text-center font-mono text-lg tracking-[0.3em] uppercase`}
                    />
                    <button
                      disabled={connecting || joinCode.length < 5}
                      className="rounded-xl border border-line bg-surface2 px-5 font-bold transition-all hover:border-accent disabled:opacity-40"
                      onClick={() => netAction(() => joinRoom(joinCode, name.trim(), founder))}
                    >
                      Join
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-xs leading-relaxed text-mut">
                  Create a room and send the code to 1–3 friends — they open this same site anywhere in the world and join. Everyone
                  competes in one market with the same starting hand. Each round is a week: play your moves, hit Ready, and the world
                  advances when everyone is ready or the 2½-minute clock runs out. After {MATCH_CAP} weeks, highest founder payout wins.
                </div>
              </>
            )}
            {netError && <div className="mt-3 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-[13px] text-bad">{netError}</div>}
          </div>
        )}

        <AchievementGallery />

        {hall.length > 0 && (
          <div className="mt-8">
            <label className={label}>Hall of fame — your past runs</label>
            <div className="rounded-xl border border-line bg-surface px-4 py-2">
              {hall.slice(0, 5).map((r, i) => (
                <div key={i} className="flex items-center justify-between border-b border-line/40 py-2 text-[13.5px] last:border-b-0">
                  <span>
                    {ENDING_ICON[r.ending] ?? ''} <b>{r.company}</b>{' '}
                    <span className="text-mut">
                      · {r.sector} · {r.weeks} wks
                    </span>
                  </span>
                  <b className={`tnum ${r.score > 0 ? 'text-good' : 'text-mut'}`}>{r.score > 0 ? money(r.score) : '—'}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
