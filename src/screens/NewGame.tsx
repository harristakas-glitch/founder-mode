// The gate. Everything before the first week of the first company happens here.
//
// Two screens, one route:
//   1. THE GATE     — identity, then the single most important choice: which world.
//   2. THE BRIEFING — numbered setup steps for the world you picked, and the way in.
//
// The whole surface reads its accent from --ha / --ha2, rebound as the player commits:
// mode colour on the gate, then the chosen market's colour on the briefing — the same
// per-sector retheming the game itself does once a run starts, previewed a step early.

import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Globe,
  Landmark,
  Lock,
  LogIn,
  LogOut,
  Rocket,
  Swords,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Btn, NESTED } from '../components'
import { SECTORS, sectorById } from '../game/data'
import { ACHIEVEMENTS, earnedAchievements } from '../game/achievements'
import { SCENARIOS } from '../game/engine'
import { MODE_META, QUICK_FORMAT_META, type GameFormat, type GameMode } from '../game/modes'
import { money } from '../format'
import { onlineConfigured } from '../net/config'
import type { FounderKind, SectorId } from '../game/types'
import { dailyInfo, readHall, useStore } from '../store'
import { DailyLeaderboard } from './DailyLeaderboard'
import { FirstRunBriefingNote, recommendedMode, useFirstTimer } from '../onboarding/FirstRun'
import { MODE_ACCENTS, endingEmoji, sectorAccent } from '../theme'

const vars = (o: Record<string, string>) => o as CSSProperties

// The fact-chip grammar shared with Discovery/Hiring: a small bordered pill for a count,
// a duration, a name — metadata, never prose.
const CHIP = 'inline-flex items-center gap-1 rounded-md border border-line/70 bg-surface2 px-2 py-0.5 text-[11.5px] font-semibold text-mut tnum'

// The icon-tile grammar's lucide face for each experience — the honest glyph equivalent of the
// emoji identity MODE_META carries (⚡ / 🏛 / ⚔️), which the top-bar pill still wears verbatim.
const MODE_ICON: Record<GameMode, LucideIcon> = { quick: Zap, career: Landmark, arena: Swords }

// A market's character, read straight off its simulation numbers rather than invented:
// revenue per user (log — the spread is three orders of magnitude), word of mouth, and
// loyalty (the inverse of churn). Ranked 1–5 across the markets.
const scale = (values: number[]) => {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return values.map((v) => Math.round(1 + 4 * ((v - lo) / (hi - lo || 1))))
}
const REV = scale(SECTORS.map((s) => Math.log10(s.arpuPerCustomer)))
const VIRAL = scale(SECTORS.map((s) => s.viral))
const LOYAL = scale(SECTORS.map((s) => -s.churn))
// One list names the three traits, and both the cards and the legend above them read it, so the
// key cannot drift from the pips it explains.
const TRAITS = [
  { k: 'Rev', label: 'Revenue per user' },
  { k: 'Viral', label: 'Word of mouth' },
  { k: 'Loyal', label: 'Customer loyalty' },
] as const
const SECTOR_TRAITS: Record<string, { k: string; label: string; v: number }[]> = Object.fromEntries(
  SECTORS.map((s, i) => [s.id, [REV[i], VIRAL[i], LOYAL[i]].map((v, t) => ({ ...TRAITS[t], v }))]),
)

const FOUNDER_META: Record<FounderKind, { name: string; blurb: string }> = {
  // Both lines are what the engine actually does with founderKind.
  technical: { name: 'Technical founder', blurb: 'You build. Your own hands add real engineering output every week.' },
  business: { name: 'Business founder', blurb: 'You sell. Your pitching drives the sales engine and closes harder.' },
}

const eyebrow = 'text-[10.5px] font-bold uppercase tracking-[0.16em] text-mut'

/**
 * A selectable card. One shape for formats, markets, scenarios and founder types.
 *
 * Built from the plane ramp rather than the old `.opt` translucency: unselected is a plain
 * plane-1 card, selected is the accent border plus a raise to PLANE 3 — unambiguous at a
 * glance, and opaque, so the aurora behind the gate can never re-order the depth.
 */
function Opt({
  on,
  onClick,
  title,
  blurb,
  accent,
  disabled,
  children,
}: {
  on: boolean
  onClick: () => void
  title: ReactNode
  blurb: string
  accent?: string
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`relative flex min-h-[44px] flex-col rounded-xl border p-5 pr-10 text-left transition-[border-color,background-color,transform] duration-[120ms] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40 ${
        on
          ? 'border-[var(--oc,var(--ha))] bg-surface3 shadow-[var(--elev-2)]'
          : 'border-line bg-surface hover:border-line2 hover:bg-surface2'
      }`}
      style={accent ? vars({ '--oc': accent }) : undefined}
    >
      {/* a tick, not just a tint — the chosen option is unmistakable at a glance */}
      <span
        className={`absolute top-3 right-3 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[var(--oc,var(--ha))] text-bg transition-[opacity,transform] duration-[120ms] ${
          on ? '' : 'scale-75 opacity-0'
        }`}
        aria-hidden="true"
      >
        <Check size={11} strokeWidth={3.5} />
      </span>
      <span className="text-[14px] font-bold">{title}</span>
      <span className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{blurb}</span>
      {children}
    </button>
  )
}

/** Numbered setup step — the briefing reads as a sequence, not a wall of controls. */
function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--ha)]/40 bg-[var(--ha)]/10 text-[11px] font-bold tnum text-[var(--ha)]">
          {n}
        </span>
        <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>
        {hint && <span className="text-[12px] text-mut">{hint}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const inputCls =
  'w-full min-w-0 rounded-xl border border-line bg-surface px-4 py-3 text-[15px] transition-colors placeholder:text-mut/50 focus:border-[var(--ha)]'

/**
 * The other half of the Lobby's copy button: a link the host pasted into a chat opens straight
 * on the Arena step with the code already typed. Sanitised to the room-code alphabet — this is a
 * URL a stranger controls, and it goes nowhere near the network until the player presses Join.
 */
const ROOM_PARAM =
  typeof location === 'undefined'
    ? ''
    : (new URLSearchParams(location.search).get('room') ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 5)

function AchievementGallery() {
  const earned = earnedAchievements()
  if (earned.size === 0) return null // nothing to brag about yet — keep the first screen clean
  return (
    <div>
      <div className={`${eyebrow} mb-2 flex items-center gap-2`}>
        Achievements
        {/* the tally is metadata, so it reads as a chip rather than part of the heading */}
        <span className={CHIP}>
          {earned.size}/{ACHIEVEMENTS.length}
        </span>
      </div>
      {/* Earned only. The locked chips were 25 identical "·····" placeholders that carried no
          information the count chip above does not already carry, and they buried the
          handful the player actually won. */}
      <div className="flex flex-wrap gap-1.5">
        {ACHIEVEMENTS.filter((a) => earned.has(a.id)).map((a) => (
          <span
            key={a.id}
            title={`${a.name} — ${a.desc}`}
            className="cursor-help rounded-lg border border-[var(--ha2)]/50 bg-[var(--ha2)]/10 px-2 py-1 text-[12px] font-semibold text-ink"
          >
            {a.emoji} {a.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function HallOfFame() {
  const hall = readHall()
  if (hall.length === 0) return null
  return (
    <div>
      <div className={`${eyebrow} mb-2 flex items-center gap-1.5`}>
        <Trophy size={12} /> Hall of fame — your best runs
      </div>
      {/* The leaderboard grammar: rank tile, name, the run's facts as chips, score tnum right. */}
      <div className="rounded-xl border border-line/70 bg-surface p-5 shadow-[var(--elev-2)]">
        {hall.slice(0, 5).map((r, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line/40 py-2 text-[13px] first:pt-0 last:border-b-0 last:pb-0">
            <span className={`${NESTED} flex h-8 w-8 shrink-0 items-center justify-center text-[12px] font-bold tnum ${i === 0 ? 'text-ink' : 'text-mut'}`}>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {endingEmoji(r.ending)} <b>{r.company}</b>
            </span>
            <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <span className={CHIP}>{r.sector}</span>
              <span className={CHIP}>{r.weeks} wk</span>
            </span>
            <b className={`shrink-0 tnum ${r.score > 0 ? 'text-good' : 'text-mut'}`}>{r.score > 0 ? money(r.score) : '—'}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function AuthCorner() {
  const authUser = useStore((s) => s.authUser)
  const authError = useStore((s) => s.authError)
  const signIn = useStore((s) => s.signIn)
  const signOutUser = useStore((s) => s.signOutUser)
  const [err, setErr] = useState<string | null>(null)
  if (!onlineConfigured || location.protocol === 'file:') return null

  if (authUser) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-1.5 py-1 backdrop-blur">
        {authUser.avatar ? (
          <img src={authUser.avatar} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ha)] text-[11px] font-bold text-bg">
            {authUser.name[0]?.toUpperCase()}
          </span>
        )}
        <span className="text-[13px] font-semibold">{authUser.name}</span>
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
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-mut backdrop-blur transition-colors hover:border-[var(--ha)] hover:text-ink"
            onClick={async () => setErr(await signIn(p))}
          >
            <LogIn size={12} /> {p === 'google' ? 'Google' : '𝕏'}
          </button>
        ))}
      </div>
      {(err ?? authError) && <span className="max-w-[260px] text-right text-[11px] text-bad">{err ?? authError}</span>}
    </div>
  )
}

export function NewGame() {
  const startGame = useStore((s) => s.startGame)
  const hostRoom = useStore((s) => s.hostRoom)
  const joinRoom = useStore((s) => s.joinRoom)
  const connecting = useStore((s) => s.connecting)
  const daily = dailyInfo()
  const firstTimer = useFirstTimer()
  // The product has three top-level experiences; Daily Challenge is a FORMAT inside Quick
  // Play, not a fourth pillar. `experience === null` shows the pick-an-experience landing.
  const [experience, setExperience] = useState<GameMode | null>(ROOM_PARAM.length === 5 ? 'arena' : null)
  const [format, setFormat] = useState<GameFormat>('standard')
  const [sector, setSector] = useState<SectorId>('saas')
  const [name, setName] = useState('')
  const [founder, setFounder] = useState<FounderKind>('technical')
  const [joinCode, setJoinCode] = useState(ROOM_PARAM)
  const [scenario, setScenario] = useState('standard')
  const [netError, setNetError] = useState<string | null>(null)

  const netAction = async (fn: () => Promise<void>) => {
    setNetError(null)
    try {
      await fn()
    } catch (e) {
      setNetError(e instanceof Error ? e.message : String(e))
    }
  }

  const daily_ = experience === 'quick' && format === 'daily_challenge'
  const activeSector = daily_ ? daily.sector : sector
  // Arena keeps its own colour (no market is chosen until the room starts); the solo
  // experiences take the colour of the market being chosen.
  const [ha, ha2] = !experience ? MODE_ACCENTS.quick : experience === 'arena' ? MODE_ACCENTS.arena : sectorAccent(activeSector)

  const solo = experience === 'quick' || experience === 'career'
  const startLabel = daily_
    ? `Play Daily #${daily.id}`
    : experience === 'career'
      ? 'Start Career'
      : format === 'scenario'
        ? 'Start Scenario'
        : 'Start Run'

  return (
    <div className="home-root relative min-h-screen overflow-x-hidden" style={vars({ '--ha': ha, '--ha2': ha2 })}>
      <div className="home-bg" aria-hidden="true" />
      <div className="home-vignette" aria-hidden="true" />

      <div className="relative z-[1] mx-auto w-full max-w-[1060px] px-4 pt-5 pb-10 sm:px-6 md:px-8 md:pt-8">
        {/* ---------- top bar ---------- */}
        <div className="flex min-h-[34px] items-start justify-between gap-3">
          {experience ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                className="flex min-h-[34px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-semibold text-mut transition-colors hover:border-line2 hover:text-ink"
                onClick={() => setExperience(null)}
              >
                <ArrowLeft size={14} /> All experiences
              </button>
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--ha)]/40 bg-[var(--ha)]/10 px-3 py-1 text-[12.5px] font-bold text-[var(--ha)]">
                <span aria-hidden="true">{MODE_META[experience].icon}</span> {MODE_META[experience].name}
              </span>
              <span className="hidden text-[12.5px] text-mut sm:inline">{MODE_META[experience].promise}</span>
            </div>
          ) : (
            <span />
          )}
          <AuthCorner />
        </div>

        {/* ================= THE GATE ================= */}
        {!experience && (
          <>
            <header className="home-in mt-8 md:mt-12" style={vars({ '--d': '0ms' })}>
              <div className="flex items-center gap-3">
                <span className="home-rule w-10 shrink-0" aria-hidden="true" />
                <span className="text-[10.5px] font-bold tracking-[0.3em] text-mut uppercase">A startup simulator</span>
              </div>
              <h1 className="home-title mt-3.5">
                <span className="block">Founder</span>
                <span className="l2 block">Mode</span>
              </h1>
              <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-mut md:text-[16.5px]">
                Build companies. Make decisions. Live with the consequences.
              </p>
            </header>

            <div className="home-in mt-9 flex items-center gap-3 md:mt-12" style={vars({ '--d': '90ms' })}>
              <h2 className={eyebrow}>Choose your world</h2>
              <span className="home-rule flex-1" aria-hidden="true" />
            </div>

            <div className="mt-3.5 grid gap-3 md:grid-cols-3">
              {(['quick', 'career', 'arena'] as GameMode[]).map((m, i) => {
                const meta = MODE_META[m]
                const Icon = MODE_ICON[m]
                const [c] = MODE_ACCENTS[m]
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setExperience(m)
                      setFormat('standard')
                    }}
                    className="mode-card home-in flex flex-col"
                    style={vars({ '--mc': c, '--d': `${130 + i * 70}ms` })}
                  >
                    <span className="relative flex h-full flex-1 flex-col p-6">
                      <span className="flex items-start justify-between gap-2">
                        <span className={`${NESTED} flex h-10 w-10 shrink-0 items-center justify-center`} aria-hidden="true">
                          <Icon size={20} className="text-accent" />
                        </span>
                        {m === 'career' && (
                          <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-bold text-warn">
                            Early access
                          </span>
                        )}
                        {recommendedMode(m) && (
                          <span
                            className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                            style={{ borderColor: `${c}66`, color: c, background: `${c}14` }}
                          >
                            Start here
                          </span>
                        )}
                      </span>
                      <span className="mt-4 block text-[16px] font-bold">{meta.name}</span>
                      <span className="mt-1 block text-[13.5px] leading-relaxed text-mut">{meta.promise}</span>
                      <span className="mt-1.5 block text-[12.5px] leading-relaxed text-mut">{meta.blurb}</span>
                      <span className="mt-auto block pt-6">
                        <span className={`${eyebrow} block`}>{meta.meta}</span>
                        <span className="mt-2 flex items-center gap-1.5 text-[13.5px] font-bold" style={{ color: c }}>
                          {meta.cta} <ArrowRight size={15} />
                        </span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Daily stays one tap away without becoming a fourth pillar. */}
            <button
              type="button"
              onClick={() => {
                setExperience('quick')
                setFormat('daily_challenge')
              }}
              className="home-in mt-3 flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-[var(--ha)]/60 hover:bg-surface2"
              style={vars({ '--d': '340ms' })}
            >
              <span className="flex items-center gap-3">
                <span className={`${NESTED} flex h-10 w-10 shrink-0 items-center justify-center`} aria-hidden="true">
                  <CalendarDays size={20} className="text-[var(--ha)]" />
                </span>
                <span>
                  <span className={`${eyebrow} block`}>Today&apos;s challenge</span>
                  {/* the seed's public face (#id) and its locked market, as fact chips */}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={CHIP}>#{daily.id}</span>
                    <span className={CHIP}>{sectorById(daily.sector).name}</span>
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--ha)]">
                Same world for everyone <ArrowRight size={14} />
              </span>
            </button>

            <div className="home-in mt-10 grid gap-7 md:grid-cols-2" style={vars({ '--d': '400ms' })}>
              <HallOfFame />
              <AchievementGallery />
            </div>
          </>
        )}

        {/* ================= THE BRIEFING ================= */}
        {experience && (
          <div className="home-in mt-5" style={vars({ '--d': '0ms' })}>
            {experience === 'career' && (
              <div className="rounded-xl border border-[var(--ha)]/25 bg-[var(--ha)]/[0.06] p-5">
                {/* the "Early access" badge is on the Career card on the gate, one click behind
                    this panel — the paragraph below says the same thing in full sentences */}
                <div className="text-[15px] font-extrabold">{MODE_META.career.promise}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-mut">
                  {MODE_META.career.blurb} Career runs on the same simulation as Quick Play today — the deeper systems (customer
                  discovery, founder attention, executives, board politics) are being built and will switch on here first.
                </p>
              </div>
            )}

            {experience === 'quick' && (
              <Step n={1} title="Pick a format">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {(['standard', 'daily_challenge', 'scenario'] as GameFormat[]).map((f) => {
                    const meta = QUICK_FORMAT_META[f]
                    return (
                      <Opt
                        key={f}
                        on={format === f}
                        onClick={() => setFormat(f)}
                        title={f === 'daily_challenge' ? `${meta.name} #${daily.id}` : meta.name}
                        blurb={`${meta.promise} ${meta.blurb}`}
                      />
                    )
                  })}
                </div>
              </Step>
            )}

            <Step n={experience === 'quick' ? 2 : 1} title="Name your company" hint="and decide what kind of founder you are">
              {/* stacks on phones — a 12-character-wide name field is not a name field */}
              <input
                type="text"
                placeholder="e.g. Hyperloop for Cats, Inc."
                value={name}
                maxLength={24}
                aria-label="Company name"
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {(['technical', 'business'] as FounderKind[]).map((f) => (
                  <Opt key={f} on={founder === f} onClick={() => setFounder(f)} title={FOUNDER_META[f].name} blurb={FOUNDER_META[f].blurb} />
                ))}
              </div>
            </Step>

            {daily_ && (
              <div className="mt-6">
                <DailyLeaderboard day={daily.id} />
              </div>
            )}

            {solo && (
              <>
                <Step
                  n={experience === 'quick' ? 3 : 2}
                  title="Choose your market"
                  hint={
                    daily_ ? (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <Lock size={11} /> locked by today&apos;s challenge
                      </span>
                    ) : (
                      'it decides how you grow, what you earn and who leaves'
                    )
                  }
                >
                  {/* The key to the pips used to sit BELOW the grid it explains and vanish for
                      good once a run finished. It now sits above the grid and never leaves: a
                      returning player reading six markets against each other needs it more than a
                      first-timer does. The two forms never stack — the first-run note is the long
                      version of this same key, so the compact one takes over when it retires. */}
                  {firstTimer ? (
                    <FirstRunBriefingNote mode={experience === 'career' ? 'career' : 'quick'} />
                  ) : (
                    <div className="mb-2.5 text-[12px] leading-relaxed text-mut">
                      {TRAITS.map((t, i) => (
                        <span key={t.k}>
                          {i > 0 && ' · '}
                          <b className="text-[10px] font-bold tracking-wider text-ink uppercase">{t.k}</b> {t.label.toLowerCase()}
                        </span>
                      ))}{' '}
                      — five pips each, ranked across the {SECTORS.length} markets and read off the simulation.
                    </div>
                  )}
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {SECTORS.map((s) => {
                      const [c] = sectorAccent(s.id)
                      const traits = SECTOR_TRAITS[s.id]
                      return (
                        <Opt
                          key={s.id}
                          accent={c}
                          disabled={daily_}
                          on={activeSector === s.id}
                          onClick={() => setSector(s.id)}
                          title={
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden="true" />
                              {s.name}
                            </span>
                          }
                          blurb={s.blurb}
                        >
                          <span className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
                            {traits.map((t) => (
                              <span key={t.k} className="flex items-center gap-1.5">
                                <span className="text-[9.5px] font-bold tracking-wider text-mut uppercase">{t.k}</span>
                                <span className="flex gap-[3px]" aria-hidden="true">
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <span key={n} className="pip" data-on={n <= t.v} />
                                  ))}
                                </span>
                                <span className="sr-only">
                                  {t.label}: {t.v} of 5
                                </span>
                              </span>
                            ))}
                          </span>
                        </Opt>
                      )
                    })}
                  </div>
                </Step>

                {format === 'scenario' && experience === 'quick' && (
                  <Step n={4} title="Pick your starting hand">
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {SCENARIOS.map((sc) => (
                        <Opt key={sc.id} on={scenario === sc.id} onClick={() => setScenario(sc.id)} title={sc.name} blurb={sc.blurb} />
                      ))}
                    </div>
                  </Step>
                )}

                {/* sticky, so the way into the game stays on screen however far down
                    the option list the player has scrolled */}
                <div className="sticky bottom-3 z-20 mt-8">
                  <div className="flex items-center gap-3 rounded-xl border border-[var(--ha)]/25 bg-surface2 p-2 shadow-[var(--elev-3)] backdrop-blur-md">
                    <div className="ml-2 hidden min-w-0 flex-1 text-[12.5px] text-mut sm:block">
                      <b className="text-ink">{name.trim() || 'Untitled Inc.'}</b> · {sectorById(activeSector).name} ·{' '}
                      {founder === 'technical' ? 'Technical' : 'Business'} founder
                    </div>
                    {/* the storefront's one CTA: primary, at large size */}
                    <Btn
                      variant="primary"
                      className="h-12 flex-1 px-6 sm:flex-none"
                      onClick={() =>
                        startGame({
                          mode: experience === 'career' ? 'career' : 'quick',
                          format: experience === 'career' ? 'standard' : format,
                          sector,
                          name: name.trim(),
                          founder,
                          scenario: format === 'scenario' ? scenario : 'standard',
                        })
                      }
                    >
                      {daily_ ? <CalendarDays size={17} aria-hidden="true" /> : <Rocket size={17} aria-hidden="true" />}
                      {startLabel}
                    </Btn>
                  </div>
                </div>
              </>
            )}

            {/* ---------- Arena ---------- */}
            {experience === 'arena' && (
              <Step n={2} title="Open a room" hint="or join one with a friend's code">
                <div className="rounded-xl border border-line bg-surface p-5">
                  {!onlineConfigured ? (
                    /* the build-time setup steps that used to live here were a README addressed to
                       whoever deploys the game, printed to a player who cannot act on them */
                    <div className="text-[13px] leading-relaxed text-mut">
                      <b className="text-warn">Online play isn&apos;t available in this build.</b> Quick Play and Career run entirely on
                      this device and need nothing.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {/* this screen state's one action, same primary treatment as Start Run */}
                        <Btn
                          variant="primary"
                          disabled={connecting}
                          className="h-12 px-4"
                          onClick={() => netAction(() => hostRoom(name.trim(), founder))}
                        >
                          <Globe size={17} aria-hidden="true" /> {connecting ? 'Connecting…' : 'Create a room'}
                        </Btn>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="CODE"
                            value={joinCode}
                            maxLength={5}
                            aria-label="Room code"
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                            className={`${inputCls} text-center font-mono text-lg tracking-[0.28em] uppercase`}
                          />
                          <Btn
                            disabled={connecting || joinCode.length < 5}
                            className="h-12 shrink-0 px-5"
                            onClick={() => netAction(() => joinRoom(joinCode, name.trim(), founder))}
                          >
                            Join
                          </Btn>
                        </div>
                      </div>
                    </>
                  )}
                  {netError && (
                    <div className="mt-3 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-[13px] text-bad">{netError}</div>
                  )}
                </div>
              </Step>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
