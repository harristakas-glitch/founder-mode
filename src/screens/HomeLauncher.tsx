// The launcher: the front door, and the one screen that is not the game.
//
// Design brief "Founder Mode — Full Home Page Redesign". Two rules drive everything here:
// HOME IS A LAUNCHER, NOT A DASHBOARD (no company metrics, no management sidebar — the questions
// are "who am I / what can I play / where do I want to go", never "how is my company doing"), and
// IMAGES CREATE ATMOSPHERE, UI CREATES CLARITY (photographic backgrounds carry the mood; every
// number on top of them is real).
//
// Nothing here is fabricated. The founder history reads the same local records the results screen
// and the profile card read, and a player with no history gets em-dashes rather than invented
// numbers.

import { ArrowRight, Building2, CalendarDays, Clock, Gem, Globe, type LucideIcon, User, Users } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { sectorById } from '../game/data'
import type { GameMode } from '../game/modes'
import { money } from '../format'
import { dailyInfo, readHall, readRunCount } from '../store'

const vars = (o: Record<string, string>) => o as CSSProperties

/**
 * IMPORTED, not referenced by path. These lived in `public/` behind a root-absolute
 * `/assets/home/...` string and 404'd on the deployed site: `vite.config.ts` sets `base: './'`
 * (so the build also runs from `file://`), and the game is served from a SUB-PATH —
 * `…github.io/founder-mode/` — where a leading slash resolves to the domain root, not the app.
 * Importing hands the URL to Vite, which rewrites it for whatever base is in force and adds a
 * content hash for cache-busting. It also makes a missing file a BUILD error instead of a blank
 * card nobody notices until it is live — which is exactly how the broken paths shipped.
 *
 * WebP, encoded from the original PNGs rather than from the intermediate JPEGs, so there is only
 * one lossy generation: 136 KB for all four against 492 KB as JPEG and ~6 MB raw.
 */
import heroImg from '../assets/home/hero-founder-office.webp'
import quickRunImg from '../assets/home/quick-run.webp'
import simulationImg from '../assets/home/simulation.webp'
import arenaImg from '../assets/home/arena.webp'

// ---------- founder history ----------

/**
 * The player's biography in four facts, read from real records only.
 *
 * `weeks` is the LONGEST run rather than the sum: "weeks survived" is a personal best, and a total
 * would climb forever and stop meaning anything. `companies` uses the lifetime counter rather than
 * the hall's length, because the hall keeps only the top ten by score (see `readRunCount`).
 */
function founderHistory(createdAt: string | undefined) {
  const hall = readHall()
  const best = hall.reduce((a, r) => Math.max(a, r.score), 0)
  const weeks = hall.reduce((a, r) => Math.max(a, r.weeks), 0)
  const runs = readRunCount()
  const since = createdAt ? new Date(createdAt) : null
  return {
    since: since ? since.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : runs > 0 ? null : 'Today',
    best: best > 0 ? money(best) : null,
    weeks: weeks > 0 ? String(weeks) : null,
    runs: String(runs),
  }
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 sm:px-4">
      <Icon size={17} className="shrink-0 text-[var(--ha)]" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-[10.5px] tracking-[0.02em] text-mut">{label}</div>
        {/* an em-dash, never a zero dressed up as an achievement */}
        <div className="truncate text-[15px] font-bold tnum">{value ?? '—'}</div>
      </div>
    </div>
  )
}

export function FounderHistoryStrip({ createdAt }: { createdAt?: string }) {
  const h = founderHistory(createdAt)
  return (
    <div className="home-in grid grid-cols-2 rounded-2xl border border-line/70 bg-[rgba(9,12,20,0.72)] backdrop-blur-[6px] sm:flex sm:items-stretch" style={vars({ '--d': '160ms' })}>
      <Stat icon={User} label="Founder since" value={h.since} />
      <span className="hidden w-px shrink-0 self-stretch bg-line/60 sm:block" aria-hidden />
      <Stat icon={Gem} label="Best result" value={h.best} />
      <span className="hidden w-px shrink-0 self-stretch bg-line/60 sm:block" aria-hidden />
      <Stat icon={CalendarDays} label="Weeks survived" value={h.weeks} />
      <span className="hidden w-px shrink-0 self-stretch bg-line/60 sm:block" aria-hidden />
      <Stat icon={Building2} label="Companies built" value={h.runs} />
    </div>
  )
}

// ---------- hero ----------

export function HomeHero({ name, children }: { name: string | null; children?: ReactNode }) {
  return (
    <section className="relative -mx-4 overflow-hidden sm:-mx-6 md:-mx-8">
      {/* The image is a SECTION, not a card: it bleeds to the page edges and fades into the page
          background at the bottom, so it never reads as a picture pasted onto a screen. */}
      <img
        src={heroImg}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[72%_center]"
        fetchPriority="high"
      />
      {/* left-to-right for text legibility, then bottom fade into the page */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(90deg, rgba(5,7,12,0.98) 0%, rgba(5,7,12,0.90) 34%, rgba(5,7,12,0.55) 62%, rgba(5,7,12,0.12) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 md:h-32"
        aria-hidden
        style={{ background: 'linear-gradient(to bottom, rgba(5,7,12,0) 0%, var(--color-bg) 100%)' }}
      />

      <div className="relative px-4 pt-10 pb-7 sm:px-6 md:px-8 md:pt-16 md:pb-10">
        <div className="home-in" style={vars({ '--d': '0ms' })}>
          <div className="text-[10.5px] font-bold tracking-[0.28em] uppercase">
            <span className="text-[var(--ha)]">Welcome back</span>
            {name && <span className="text-ink">, {name}</span>}
          </div>
          <h1 className="mt-3.5 text-[clamp(30px,6vw,64px)] leading-[1.02] font-extrabold tracking-[-0.02em]">
            <span className="block">Build companies.</span>
            <span className="block">Make decisions.</span>
            <span className="block text-[var(--ha)]">Live with the consequences.</span>
          </h1>
        </div>
        <div className="mt-6 max-w-[720px] md:mt-9">{children}</div>
      </div>
    </section>
  )
}

// ---------- mode cards ----------

export interface HomeModeCard {
  id: GameMode
  title: string
  tagline: string
  description: string
  image: string
  icon: LucideIcon
  meta: { icon: LucideIcon; label: string }[]
  badge?: { text: string; tone: 'warn' | 'accent' }
  cta: string
}

/**
 * Configuration, not three near-identical JSX blocks (brief §60). The visible names are the
 * brief's — "Quick Run", "Simulation" — while the ids stay the engine's `quick` / `career` /
 * `arena`, because renaming a mode enum to change a label is how save compatibility dies.
 */
export const HOME_MODES: (icons: Record<GameMode, LucideIcon>) => HomeModeCard[] = (icons) => [
  {
    id: 'quick',
    title: 'Quick Run',
    tagline: 'Build a unicorn tonight.',
    description: 'Fast startup management. Start a company, make the big decisions and see how far you can take it.',
    image: quickRunImg,
    icon: icons.quick,
    meta: [
      { icon: Clock, label: '30–60 min' },
      { icon: User, label: 'Solo' },
    ],
    cta: 'Play Now',
  },
  {
    id: 'career',
    title: 'Simulation',
    tagline: 'Build the company. Become the CEO.',
    description: 'A deeper founder simulation about product, people, strategy and capital.',
    image: simulationImg,
    icon: icons.career,
    meta: [
      { icon: Gem, label: 'Deep simulation' },
      { icon: User, label: 'Solo / multi-session' },
    ],
    badge: { text: 'Early access', tone: 'warn' },
    cta: 'Start Simulation',
  },
  {
    id: 'arena',
    title: 'Arena',
    tagline: 'Outbuild your friends.',
    description: 'Compete against other founders in the same market.',
    image: arenaImg,
    icon: icons.arena,
    meta: [
      { icon: Users, label: '2–4 players' },
      { icon: Globe, label: 'Online' },
    ],
    cta: 'Enter Arena',
  },
]

export function ModeCard({ card, onPick, delay }: { card: HomeModeCard; onPick: () => void; delay: number }) {
  const Icon = card.icon
  return (
    <button
      type="button"
      onClick={onPick}
      // No mode is pre-selected (brief §21/§22): the concept art highlighted Simulation, but there
      // is no recommendation system behind it, so all three rest at equal prominence.
      className="home-in group relative flex min-h-[330px] flex-col overflow-hidden md:min-h-[400px] rounded-2xl border border-line/80 bg-surface text-left shadow-[0_20px_50px_rgba(0,0,0,0.35)] transition-[transform,border-color] duration-[180ms] hover:-translate-y-0.5 hover:border-[var(--ha)]/70 focus-visible:border-[var(--ha)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={vars({ '--d': `${delay}ms` })}
    >
      <img
        src={card.image}
        alt=""
        aria-hidden
        loading="lazy"
        className="pointer-events-none absolute inset-x-0 top-0 h-[52%] w-full object-cover md:h-[58%] transition-[filter] duration-[180ms] group-hover:brightness-110"
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,12,0.10) 0%, rgba(5,7,12,0.45) 30%, rgba(5,7,12,0.92) 58%, rgba(5,7,12,0.99) 100%)',
        }}
      />

      <div className="relative flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--ha)]/45 bg-[rgba(24,16,48,0.75)]"
            aria-hidden
          >
            <Icon size={22} className="text-[var(--ha)]" />
          </span>
          {card.badge && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                card.badge.tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-[var(--ha)]/40 bg-[var(--ha)]/10 text-[var(--ha)]'
              }`}
            >
              {card.badge.text}
            </span>
          )}
        </div>

        <div className="mt-auto pt-12 md:pt-16">
          <div className="text-[21px] font-bold tracking-[-0.01em]">{card.title}</div>
          <div className="mt-1 text-[13.5px] font-bold">{card.tagline}</div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-mut">{card.description}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-semibold tracking-[0.08em] text-mut uppercase">
            {card.meta.map((m) => (
              <span key={m.label} className="inline-flex items-center gap-1.5">
                <m.icon size={13} aria-hidden /> {m.label}
              </span>
            ))}
          </div>

          {/* Dark translucent at rest, purple fill on hover — so three CTAs are not equally loud
              at rest, and the one you are pointing at is unmistakable (brief §24). */}
          <span className="mt-4 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--ha)]/45 bg-[var(--ha)]/10 text-[14px] font-bold text-[var(--ha)] transition-colors duration-[180ms] group-hover:bg-[var(--ha)] group-hover:text-bg">
            {card.cta}
            <ArrowRight size={16} className="transition-transform duration-[180ms] group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </button>
  )
}

// ---------- daily challenge ----------

export function DailyChallengeStrip({ onPlay, delay }: { onPlay: () => void; delay: number }) {
  const daily = dailyInfo()
  const sector = sectorById(daily.sector)
  return (
    <button
      type="button"
      onClick={onPlay}
      // Subordinate to the three worlds by construction: one short strip, no artwork (brief §26/§27).
      className="home-in flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-2xl border border-line/80 bg-surface px-4 py-3.5 text-left transition-colors duration-[180ms] hover:border-[var(--ha)]/60 hover:bg-surface2"
      style={vars({ '--d': `${delay}ms` })}
    >
      <span className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ha)]/40 bg-[rgba(24,16,48,0.7)]" aria-hidden>
          <CalendarDays size={19} className="text-[var(--ha)]" />
        </span>
        <span>
          <span className="block text-[10.5px] font-bold tracking-[0.16em] text-mut uppercase">Today&apos;s challenge</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-bold tnum">#{daily.id}</span>
            <span className="text-mut">{sector.name}</span>
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--ha)]">
        Same world for everyone <ArrowRight size={14} aria-hidden />
      </span>
    </button>
  )
}
