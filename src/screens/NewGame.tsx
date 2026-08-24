// The gate. Everything before the first week of the first company happens here.
//
// Two screens, one route:
//   1. THE GATE     — identity, then the single most important choice: which world.
//   2. THE BRIEFING — numbered setup steps for the world you picked, and the way in.
//
// The whole surface reads its accent from --ha / --ha2, rebound as the player commits:
// mode colour on the gate, then the chosen market's colour on the briefing — the same
// per-sector retheming the game itself does once a run starts, previewed a step early.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Globe,
  Landmark,
  Lock,
  LogIn,
  LogOut,
  Rocket,
  Settings,
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
import { dailyInfo, readHall, readLocalBests, useStore } from '../store'
import { V2_SCENARIOS } from '../game/sim2/scenarios'
import { DailyLeaderboard } from './DailyLeaderboard'
import { FirstRunBriefingNote, useFirstTimer } from '../onboarding/FirstRun'
import { DailyChallengeStrip, FounderHistoryStrip, HOME_MODES, HomeHero, ModeCard } from './HomeLauncher'
import { LaunchHero, LaunchSummaryBar, SetupSection } from './LaunchShell'
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
  // Both lines are what the engine actually does with founderKind — shortened to the launch
  // brief's §29 rhythm ("Build faster / Sell harder") without losing the mechanical truth.
  technical: { name: 'Technical founder', blurb: 'Build faster. Your own hands add engineering output.' },
  business: { name: 'Business founder', blurb: 'Sell harder. Your pitching drives sales and closes deals.' },
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
  compact,
  children,
}: {
  on: boolean
  onClick: () => void
  title: ReactNode
  blurb: string
  accent?: string
  disabled?: boolean
  /** phone-tight tile (launch brief §40): the blurb yields to the title below sm */
  compact?: boolean
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`relative flex min-h-[44px] flex-col rounded-xl border p-3.5 pr-8 text-left transition-[border-color,background-color,transform] duration-[120ms] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40 sm:p-4 sm:pr-10 ${
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
      <span className={`mt-0.5 text-[12.5px] leading-relaxed text-mut ${compact ? 'hidden sm:block' : ''}`}>{blurb}</span>
      {children}
    </button>
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
  // Local badges UNION the synced profile's — the same set the ProfileCard counts, and reading
  // the profile from the store means this gallery re-renders when a sync lands, so the two
  // tallies on this screen can never disagree (review finding, 2026-08-22).
  const remote = useStore((s) => s.profile?.achievements)
  const earned = new Set([...earnedAchievements(), ...(remote ?? [])])
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
  const profile = useStore((s) => s.profile)
  const signIn = useStore((s) => s.signIn)
  const signOutUser = useStore((s) => s.signOutUser)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  if (!onlineConfigured || location.protocol === 'file:') return null

  if (authUser) {
    // The chip wears the NICKNAME, not the OAuth name — the real name is never shown, not even
    // to its owner, so there is exactly one identity the game ever renders.
    const shownName = profile?.nickname ?? 'Profile'
    const avatar = profile?.avatar ?? authUser.avatar
    return (
      <div className="relative flex flex-col items-end">
        {/* 36px pill (V2 §10); on phones the pill collapses to the avatar alone (V2 §13) */}
        <button
          className="flex min-h-[36px] items-center gap-2 rounded-full border border-line2 bg-surface px-1.5 backdrop-blur transition-colors hover:border-[var(--ha)]"
          title="Your profile"
          onClick={() => setOpen((v) => !v)}
        >
          {avatar ? (
            <img src={avatar} alt="" className="h-[26px] w-[26px] rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--ha)] text-[11px] font-bold text-bg">
              {shownName[0]?.toUpperCase()}
            </span>
          )}
          <span className="hidden pr-1 text-[13px] font-semibold sm:inline">{shownName}</span>
        </button>
        {open && <ProfileCard onClose={() => setOpen(false)} onSignOut={() => void signOutUser()} />}
      </div>
    )
  }
  // Google only for now — X and LinkedIn stay wired in the auth layer but are hidden here
  // until their apps are approved, so nobody meets a login button that cannot work.
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-line2 bg-surface px-3.5 text-[12px] font-semibold text-mut backdrop-blur transition-colors hover:border-[var(--ha)] hover:text-ink"
        onClick={async () => setErr(await signIn('google'))}
      >
        <LogIn size={12} />
        <span className="hidden sm:inline">Log in with&nbsp;</span>Google
      </button>
      {(err ?? authError) && <span className="max-w-[260px] text-right text-[11px] text-bad">{err ?? authError}</span>}
    </div>
  )
}

/**
 * The profile card: nickname (editable), per-mode personal bests, the full badge wall. Every
 * fact on it is either the public profile row or this device's own records — the real name and
 * email exist only in the auth layer and are rendered nowhere.
 */
function ProfileCard({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const profile = useStore((s) => s.profile)
  const renameProfileTo = useStore((s) => s.renameProfileTo)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  // The app's overlay rule (useDialog in App.tsx): Escape closes anything. A popover adds the
  // second half — clicking anywhere outside it closes it too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (editing) setEditing(false)
      else onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [editing, onClose])

  const earned = new Set([...(profile?.achievements ?? []), ...earnedAchievements()])
  const bests = { ...readLocalBests(), ...(profile?.bests ?? {}) }
  for (const mode of ['quick', 'career', 'arena'] as const) {
    const local = readLocalBests()[mode]
    if (local && (!bests[mode] || local.score > bests[mode]!.score)) bests[mode] = local
  }
  const MODE_LABEL = { quick: 'Quick Play', career: 'Career', arena: 'Arena' } as const
  const since = profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null

  return (
    <div ref={cardRef} className="absolute top-10 right-0 z-40 w-[320px] rounded-xl border border-line bg-surface p-4 shadow-xl backdrop-blur">
      {profile ? (
        <>
          <div className="flex items-center justify-between gap-2">
            {editing ? (
              <form
                className="flex flex-1 items-center gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setSaving(true)
                  const p = await renameProfileTo(draft.trim())
                  setSaving(false)
                  setProblem(p)
                  if (!p) setEditing(false)
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={24}
                  className="w-full rounded-md border border-line bg-surface2 px-2 py-1 text-[13px] font-semibold"
                />
                <Btn disabled={saving} type="submit" className="px-2 py-1 text-[12px]">
                  Save
                </Btn>
                <button type="button" className="text-[11px] text-mut hover:text-ink" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="text-[15px] font-bold">{profile.nickname}</span>
                <button
                  className="text-[11px] text-mut hover:text-ink"
                  onClick={() => {
                    setDraft(profile.nickname)
                    setProblem(null)
                    setEditing(true)
                  }}
                >
                  Rename
                </button>
              </>
            )}
          </div>
          {problem && <div className="mt-1 text-[11px] text-bad">{problem}</div>}
          {since && <div className="mt-0.5 text-[11px] text-mut">Founder since {since}</div>}
        </>
      ) : (
        <div className="text-[12px] text-mut">Profile loading — it appears once the server answers.</div>
      )}

      <div className="mt-3 border-t border-line/60 pt-2">
        <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">Personal bests</div>
        {(['quick', 'career', 'arena'] as const).filter((m) => bests[m]).length === 0 && (
          <div className="text-[12px] text-mut">No finished runs yet — every ending records one.</div>
        )}
        {(['quick', 'career', 'arena'] as const).map((m) => {
          const b = bests[m]
          if (!b) return null
          return (
            <div key={m} className="flex items-baseline justify-between gap-2 py-0.5 text-[12.5px]">
              <span className="text-mut">{MODE_LABEL[m]}</span>
              <span className="tnum font-semibold">
                {endingEmoji(b.ending)} {b.score > 0 ? money(b.score) : '—'} <span className="text-mut">· wk {b.weeks}</span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-3 border-t border-line/60 pt-2">
        <div className="mb-1 text-[10.5px] font-bold tracking-wide text-mut uppercase">
          Badges · {earned.size}/{ACHIEVEMENTS.length}
        </div>
        <div className="flex flex-wrap gap-1">
          {ACHIEVEMENTS.map((a) => (
            <span
              key={a.id}
              title={`${a.name} — ${a.desc}`}
              className={`flex h-7 w-7 items-center justify-center rounded-md border text-[15px] ${
                earned.has(a.id) ? 'border-line bg-surface2' : 'border-line/40 opacity-25 grayscale'
              }`}
            >
              {a.emoji}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-end border-t border-line/60 pt-2">
        <button className="flex items-center gap-1 text-[11.5px] text-mut hover:text-bad" onClick={onSignOut}>
          <LogOut size={12} /> Sign out
        </button>
      </div>
    </div>
  )
}

export function NewGame() {
  const profile = useStore((s) => s.profile)
  const authUser = useStore((s) => s.authUser)
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
  const [pipHelp, setPipHelp] = useState(false)
  // Business Simulation V2 (beta) — Simulation-only opt-in while the deeper engine is built out
  const [engineV2, setEngineV2] = useState(false)
  const [v2Scenario, setV2Scenario] = useState('standard')

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
      ? 'Start Simulation'
      : format === 'scenario'
        ? 'Start Scenario'
        : 'Start Quick Run'

  return (
    <div className={`home-root relative min-h-screen overflow-x-hidden ${experience ? 'home-briefing' : ''}`} style={vars({ '--ha': ha, '--ha2': ha2 })}>
      <div className="home-bg" aria-hidden="true" />
      <div className="home-vignette" aria-hidden="true" />

      <div className={`relative z-[1] mx-auto w-full px-4 pt-5 pb-10 sm:px-6 md:px-8 md:pt-8 ${experience ? "max-w-[1140px]" : "max-w-[1440px]"}`}>
        {/* ---------- top bar — the launch shell's chrome (launch brief §13): back left, mode
            pill centred, profile right. One anatomy for all three modes; the promise line the
            old bar carried now lives in the hero, where it reads once instead of twice. ---------- */}
        {experience && (
          <div className="grid min-h-[40px] grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              className="flex min-h-[36px] items-center gap-1.5 justify-self-start rounded-full border border-line bg-surface px-3 text-[12.5px] font-semibold text-mut transition-colors hover:border-line2 hover:text-ink"
              onClick={() => setExperience(null)}
            >
              <ArrowLeft size={14} /> <span className="hidden sm:inline">All experiences</span>
            </button>
            <span className="flex items-center gap-1.5 rounded-full border border-[var(--ha)]/40 bg-[var(--ha)]/10 px-3.5 py-1.5 text-[12.5px] font-bold text-[var(--ha)]">
              {(() => {
                const MI = MODE_ICON[experience]
                return <MI size={13} aria-hidden />
              })()}
              {MODE_META[experience].name}
            </span>
            <div className="justify-self-end">
              <AuthCorner />
            </div>
          </div>
        )}

        {/* ================= THE GATE — the launcher ================= */}
        {!experience && (
          <>
            {/* The wrapper pulls the hero flush to the top of the page and overlays the profile
                on it, top-right (V2 §7/§8). The profile lives OUTSIDE the hero <section> in the
                DOM because the section clips (overflow-hidden) — inside it, the profile card
                popover could never extend past the hero's bottom edge. */}
            <div className="relative -mt-5 md:-mt-8">
              <HomeHero name={profile?.nickname ?? authUser?.name ?? null}>
                <FounderHistoryStrip createdAt={profile?.createdAt} />
              </HomeHero>
              <div className="home-in absolute top-2 right-0 z-10 md:top-2.5" style={vars({ '--d': '0ms' })}>
                <AuthCorner />
              </div>
            </div>

            <div className="home-in home-world-gap flex items-center gap-3" style={vars({ '--d': '220ms' })}>
              <h2 className={eyebrow}>Choose your world</h2>
              <span className="home-rule flex-1" aria-hidden="true" />
            </div>

            <div className="mt-3.5 grid gap-3 md:grid-cols-3 md:gap-4">
              {HOME_MODES(MODE_ICON).map((card, i) => (
                <ModeCard
                  key={card.id}
                  card={card}
                  delay={260 + i * 60}
                  onPick={() => {
                    setExperience(card.id)
                    setFormat('standard')
                  }}
                />
              ))}
            </div>

            {/* Daily stays one tap away without becoming a fourth pillar: Quick mode, Daily format. */}
            <div className="mt-3 md:mt-4">
              <DailyChallengeStrip
                delay={460}
                onPlay={() => {
                  setExperience('quick')
                  setFormat('daily_challenge')
                }}
              />
            </div>

            {/* On phones the founder history lives HERE, below the choices — the hero hides it
                (owner, 2026-08-23: the stats don't need the fold; the three worlds do). Delay
                after the daily strip's 460ms so the page still settles top-to-bottom. */}
            <div className="mt-3 md:hidden">
              <FounderHistoryStrip createdAt={profile?.createdAt} delay={520} />
            </div>

            <div className="home-in mt-10 grid gap-7 md:grid-cols-2" style={vars({ '--d': '520ms' })}>
              <HallOfFame />
              <AchievementGallery />
            </div>
          </>
        )}

        {/* ================= THE BRIEFING — the unified launch shell ================= */}
        {experience && (
          <div className="home-in mt-3 pb-2 md:mt-4" style={vars({ '--d': '0ms' })}>
            {/* One hero anatomy for all three modes (launch brief §15): the Home card's
                photograph continues into its world, the promise reads once, and Simulation's
                "Early access" is a hero badge — the old dev-facing paragraph about unfinished
                systems is gone (brief §19/§47). */}
            <div className="mb-1 md:mb-2">
              <LaunchHero mode={experience} />
            </div>

            {experience === 'quick' && (
              <SetupSection step={1} title="Pick a format" hint="Choose how you want to play.">
                <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
                  {(['standard', 'daily_challenge', 'scenario'] as GameFormat[]).map((f) => {
                    const meta = QUICK_FORMAT_META[f]
                    return (
                      <Opt
                        key={f}
                        on={format === f}
                        onClick={() => setFormat(f)}
                        title={f === 'daily_challenge' ? `${meta.name} #${daily.id}` : meta.name}
                        blurb={`${meta.promise} ${meta.blurb}`}
                        compact
                      />
                    )
                  })}
                </div>
              </SetupSection>
            )}

            <SetupSection
              step={experience === 'quick' ? 2 : 1}
              title="Name your company"
              hint={experience === 'arena' ? 'Your brand in the Arena.' : 'This is your startup.'}
            >
              <input
                type="text"
                placeholder="e.g. Hyperloop for Cats, Inc."
                value={name}
                maxLength={24}
                aria-label="Company name"
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </SetupSection>

            <SetupSection
              step={experience === 'quick' ? 3 : 2}
              title="Pick your founder role"
              hint="Your strengths shape your starting edge."
            >
              {/* two compact cards side-by-side at every width (brief §30) */}
              <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
                {(['technical', 'business'] as FounderKind[]).map((f) => (
                  <Opt key={f} on={founder === f} onClick={() => setFounder(f)} title={FOUNDER_META[f].name} blurb={FOUNDER_META[f].blurb} />
                ))}
              </div>
            </SetupSection>

            {daily_ && (
              <div className="mt-3.5 md:mt-4">
                <DailyLeaderboard day={daily.id} />
              </div>
            )}

            {solo && (
              <>
                <SetupSection
                  step={experience === 'quick' ? 4 : 3}
                  title="Choose your market"
                  hint={
                    daily_ ? (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <Lock size={11} /> locked by today&apos;s challenge
                      </span>
                    ) : (
                      'Every market has different rules.'
                    )
                  }
                >
                  {/* Quick Run scans (name + one-line identity, brief §32); Simulation reads
                      (the same cards plus the three pips, §33). The pip key is behind a toggle
                      (§34) so the setup stays quiet; first-timers on Simulation still get the
                      long-form note. */}
                  {experience === 'career' &&
                    (firstTimer ? (
                      <FirstRunBriefingNote mode="career" />
                    ) : (
                      <div className="mb-2.5 text-[12px] leading-relaxed">
                        <button type="button" className="font-semibold text-[var(--ha)] hover:underline" onClick={() => setPipHelp((v) => !v)}>
                          What do the pips mean?
                        </button>
                        {pipHelp && (
                          <span className="ml-2 text-mut">
                            {TRAITS.map((t, i) => (
                              <span key={t.k}>
                                {i > 0 && ' · '}
                                <b className="text-[10px] font-bold tracking-wider text-ink uppercase">{t.k}</b> {t.label.toLowerCase()}
                              </span>
                            ))}{' '}
                            — five pips each, read off the simulation.
                          </span>
                        )}
                      </div>
                    ))}
                  <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-3">
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
                          {experience === 'career' && (
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
                          )}
                        </Opt>
                      )
                    })}
                  </div>
                </SetupSection>

                {format === 'scenario' && experience === 'quick' && (
                  <SetupSection step={5} title="Pick your starting hand">
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-2.5 lg:grid-cols-3">
                      {SCENARIOS.map((sc) => (
                        <Opt key={sc.id} on={scenario === sc.id} onClick={() => setScenario(sc.id)} title={sc.name} blurb={sc.blurb} />
                      ))}
                    </div>
                  </SetupSection>
                )}

                {experience === 'career' && (
                  <div className="mb-3">
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line2/70 bg-surface2 px-3.5 py-2.5">
                      <input type="checkbox" checked={engineV2} onChange={(e) => setEngineV2(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
                      <span className="text-[12.5px] leading-snug">
                        <b>New market engine (beta).</b>{' '}
                        <span className="text-mut">
                          Customers choose between you, your rivals and doing nothing — based on what your product actually is, what each
                          segment values, and what you charge. Deeper causality, still under construction.
                        </span>
                      </span>
                    </label>
                    {engineV2 && (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {[{ id: 'standard', name: 'Week one', blurb: 'The classic start: an idea, $200k, and nobody knows if the market wants it.' }, ...V2_SCENARIOS].map((sc) => (
                          <button
                            key={sc.id}
                            type="button"
                            aria-pressed={v2Scenario === sc.id}
                            onClick={() => setV2Scenario(sc.id)}
                            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                              v2Scenario === sc.id ? 'border-accent bg-accent/10' : 'border-line2/70 bg-surface2 hover:border-accent/50'
                            }`}
                          >
                            <div className="text-[12.5px] font-bold">{sc.name}</div>
                            <div className="mt-0.5 text-[11px] leading-snug text-mut">{sc.blurb}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <LaunchSummaryBar
                  summary={
                    <>
                      <b>{name.trim() || 'Untitled Inc.'}</b>
                      <span className="text-mut">
                        {' '}
                        · {sectorById(activeSector).name} · {founder === 'technical' ? 'Technical' : 'Business'}
                      </span>
                    </>
                  }
                  meta={
                    experience === 'career'
                      ? 'Solo · Multi-session'
                      : daily_
                        ? `Daily #${daily.id} · One shot · Solo`
                        : '30–60 min · Solo'
                  }
                  ctaLabel={startLabel}
                  ctaIcon={daily_ ? <CalendarDays size={17} aria-hidden="true" /> : <Rocket size={17} aria-hidden="true" />}
                  onLaunch={() =>
                    startGame({
                      mode: experience === 'career' ? 'career' : 'quick',
                      format: experience === 'career' ? 'standard' : format,
                      sector,
                      name: name.trim(),
                      founder,
                      scenario:
                        experience === 'career'
                          ? engineV2 && v2Scenario !== 'standard'
                            ? v2Scenario
                            : 'standard'
                          : format === 'scenario'
                            ? scenario
                            : 'standard',
                      engineV2: experience === 'career' && engineV2,
                    })
                  }
                />
              </>
            )}

            {/* ---------- Arena ---------- */}
            {experience === 'arena' && (
              <>
                <SetupSection step={3} title="Open a room or join" hint="Play with your friends.">
                  {!onlineConfigured ? (
                    /* the build-time setup steps that used to live here were a README addressed to
                       whoever deploys the game, printed to a player who cannot act on them */
                    <div className="text-[13px] leading-relaxed text-mut">
                      <b className="text-warn">Online play isn&apos;t available in this build.</b> Quick Play and Simulation run entirely
                      on this device and need nothing.
                    </div>
                  ) : (
                    /* the section IS the card (brief §21) — the old card-inside-card wrapper is gone */
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-line2/70 bg-surface2 p-3.5">
                        <div className="text-[13.5px] font-bold">Create a room</div>
                        <div className="mt-0.5 text-[12px] text-mut">Get an invite code to challenge friends.</div>
                        <Btn
                          variant="primary"
                          disabled={connecting}
                          className="mt-3 h-11 w-full px-4"
                          onClick={() => netAction(() => hostRoom(name.trim(), founder))}
                        >
                          <Globe size={16} aria-hidden="true" /> {connecting ? 'Connecting…' : 'Create Room'}
                        </Btn>
                      </div>
                      <div className="rounded-xl border border-line2/70 bg-surface2 p-3.5">
                        <div className="text-[13.5px] font-bold">Join a room</div>
                        <div className="mt-0.5 text-[12px] text-mut">Enter a room code to join the action.</div>
                        <div className="mt-3 flex gap-2">
                          <input
                            type="text"
                            placeholder="CODE"
                            value={joinCode}
                            maxLength={5}
                            aria-label="Room code"
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                            className={`${inputCls} h-11 py-0 text-center font-mono text-[16px] tracking-[0.28em] uppercase`}
                          />
                          <Btn
                            disabled={connecting || joinCode.length < 5}
                            className="h-11 shrink-0 px-5"
                            onClick={() => netAction(() => joinRoom(joinCode, name.trim(), founder))}
                          >
                            Join
                          </Btn>
                        </div>
                      </div>
                    </div>
                  )}
                  {netError && (
                    <div className="mt-3 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-[13px] text-bad">{netError}</div>
                  )}
                </SetupSection>

                {/* Game settings, collapsed to facts (brief §54): everything here is real —
                    2–4 players, online, and the market is decided when the room starts. No
                    invented difficulty/pace controls. */}
                {onlineConfigured && (
                  <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl border border-line/80 bg-surface px-4 py-3 md:mt-4">
                    <Settings size={14} className="shrink-0 text-mut" aria-hidden />
                    <span className="text-[13px] font-bold">Game settings</span>
                    <span className="text-[12px] text-mut">2–4 players · Online · Market chosen when the room starts</span>
                  </div>
                )}

                {onlineConfigured && (
                  /* readiness, not a dead end (brief §55): the CTA arms in the lobby — creating
                     or joining a room navigates there, so this bar's job is to say what's missing */
                  <LaunchSummaryBar
                    summary="Ready to compete"
                    meta="Online · 2–4 players"
                    ctaLabel="Enter Arena"
                    disabled
                    disabledReason="Create or join a room to continue."
                    onLaunch={() => {}}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
