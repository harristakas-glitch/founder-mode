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
import { DailyLeaderboard } from './DailyLeaderboard'
import { FirstRunBriefingNote, useFirstTimer } from '../onboarding/FirstRun'
import { DailyChallengeStrip, FounderHistoryStrip, HOME_MODES, HomeHero, ModeCard } from './HomeLauncher'
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
    <div className={`home-root relative min-h-screen overflow-x-hidden ${experience ? 'home-briefing' : ''}`} style={vars({ '--ha': ha, '--ha2': ha2 })}>
      <div className="home-bg" aria-hidden="true" />
      <div className="home-vignette" aria-hidden="true" />

      <div className={`relative z-[1] mx-auto w-full px-4 pt-5 pb-10 sm:px-6 md:px-8 md:pt-8 ${experience ? "max-w-[1060px]" : "max-w-[1440px]"}`}>
        {/* ---------- top bar — the BRIEFING's chrome only. On the launcher the hero owns the
            chrome (brand top-left, profile top-right) so no separate row spends the fold. ---------- */}
        {experience && (
          <div className="flex min-h-[34px] items-start justify-between gap-3">
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
            <AuthCorner />
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

            <div className="mt-3.5 grid gap-4 md:grid-cols-3">
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
            <div className="mt-4">
              <DailyChallengeStrip
                delay={460}
                onPlay={() => {
                  setExperience('quick')
                  setFormat('daily_challenge')
                }}
              />
            </div>

            <div className="home-in mt-10 grid gap-7 md:grid-cols-2" style={vars({ '--d': '520ms' })}>
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
