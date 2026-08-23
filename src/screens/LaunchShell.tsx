// The unified launch system (owner brief "Founder Mode — Unified Launch Experience Redesign"):
// one shell for Quick Run, Simulation and Arena, so the player learns the interface once.
//
// The formula the brief hard-codes: ARENA POLISH + QUICK RUN SPEED + SIMULATION CLARITY.
// Three pages are three expressions of one system — LaunchHero, SetupSection and
// LaunchSummaryBar are that system. Mode-specific controls (format tiles, room setup) stay in
// NewGame; nothing visual is duplicated per mode.
//
// The hero continues the Home card's photograph into the mode's launch page — that continuity
// is intentional (brief §4): the world you tapped is the world you land in.

import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight, Clock, Globe, User, Users, Gem, type LucideIcon } from 'lucide-react'
import { Btn } from '../components'
import type { GameMode } from '../game/modes'
import { arenaImg, quickRunImg, simulationImg } from './HomeLauncher'

const vars = (o: Record<string, string>) => o as CSSProperties

// ---------- hero ----------

interface HeroMeta {
  icon: LucideIcon
  label: string
}

interface HeroSpec {
  eyebrow: string
  title: string
  desc: string
  image: string
  /** intentional mobile crop (brief §64): notebook / analytics screens / trophy */
  posMobile: string
  posDesktop: string
  meta: HeroMeta[]
  badge?: string
}

/** Copy is the brief's §18–§20, mockup-first where the two differ. */
export const LAUNCH_HERO: Record<GameMode, HeroSpec> = {
  quick: {
    eyebrow: 'Quick Run',
    title: 'Build a unicorn tonight.',
    desc: 'Fast startup management. Make the big calls and see how far you can take it.',
    image: quickRunImg,
    posMobile: '70% 40%',
    posDesktop: '60% 42%',
    meta: [
      { icon: Clock, label: '30–60 min' },
      { icon: User, label: 'Solo' },
    ],
  },
  career: {
    eyebrow: 'Simulation',
    title: 'Run the company. Every decision matters.',
    desc: 'A deeper founder simulation about product, people, strategy and capital.',
    image: simulationImg,
    posMobile: '72% 45%',
    posDesktop: '65% 45%',
    meta: [
      { icon: User, label: 'Solo / multi-session' },
      { icon: Gem, label: 'Deep simulation' },
    ],
    // shown ONCE, here in the hero metadata (brief §47) — the old dev-facing paragraph is gone
    badge: 'Early access',
  },
  arena: {
    eyebrow: 'Arena',
    title: 'Outbuild your friends.',
    desc: 'Compete against other founders in the same market.',
    image: arenaImg,
    posMobile: '68% 35%',
    posDesktop: '70% 40%',
    meta: [
      { icon: Globe, label: 'Online' },
      { icon: Users, label: '2–4 players' },
    ],
  },
}

/**
 * The canonical mode hero (brief §15–§17): identical height, radius, padding, overlay and text
 * position for all three modes — only image, copy and accent differ.
 */
export function LaunchHero({ mode }: { mode: GameMode }) {
  const h = LAUNCH_HERO[mode]
  return (
    <section className="relative flex min-h-[150px] flex-col justify-center overflow-hidden rounded-[18px] border border-line2/60 bg-bg2 md:min-h-[210px]">
      <img src={h.image} alt="" aria-hidden fetchPriority="high" className="launch-hero-img pointer-events-none absolute inset-0 h-full w-full object-cover" style={vars({ '--pos-m': h.posMobile, '--pos-d': h.posDesktop })} />
      {/* one realistic dark gradient, no purple colourisation (brief §16) */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(90deg, rgba(5,7,11,0.96) 0%, rgba(5,7,11,0.78) 38%, rgba(5,7,11,0.30) 72%, rgba(5,7,11,0.06) 100%)',
        }}
      />
      <div className="relative px-4 py-4 sm:px-6 md:px-7 md:py-6">
        <div className="text-[11px] font-bold tracking-[0.24em] text-[var(--ha)] uppercase">{h.eyebrow}</div>
        <h1 className="mt-1.5 max-w-[560px] text-[clamp(24px,5.4vw,38px)] leading-[1.06] font-extrabold tracking-[-0.015em]">{h.title}</h1>
        <p className="mt-1.5 line-clamp-2 max-w-[560px] text-[13px] leading-snug text-mut md:text-[14px]">{h.desc}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase md:mt-3.5">
          {h.meta.map((m) => (
            <span key={m.label} className="inline-flex items-center gap-1.5 text-mut">
              <m.icon size={12} aria-hidden /> {m.label}
            </span>
          ))}
          {h.badge && (
            <span className="rounded-full border border-warn/45 bg-warn/10 px-2 py-0.5 text-[10px] font-bold tracking-normal text-warn">{h.badge}</span>
          )}
        </div>
      </div>
    </section>
  )
}

// ---------- setup section ----------

/**
 * The canonical setup module (brief §21–§24): one raised surface per decision, numbered, with at
 * most one supporting sentence. The section IS the card — controls inside sit directly on it,
 * never card-inside-card-inside-card.
 */
export function SetupSection({ step, title, hint, children }: { step: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-3.5 rounded-2xl border border-line/80 bg-surface p-4 md:mt-4 md:p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="flex h-6 w-6 shrink-0 translate-y-0.5 items-center justify-center rounded-md border border-[var(--ha)]/40 bg-[var(--ha)]/10 text-[12px] font-bold tnum text-[var(--ha)]">
          {step}
        </span>
        <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>
        {hint && <span className="text-[12px] text-mut">{hint}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

// ---------- launch summary bar ----------

/**
 * The one obvious action at the end (brief §35–§38): sticky, summary left, the page's single
 * primary CTA right. When the setup cannot launch yet, the CTA is visibly disabled and the
 * summary line says the one thing to do — no modal, no error list.
 */
export function LaunchSummaryBar({
  summary,
  meta,
  ctaLabel,
  ctaIcon,
  disabled,
  disabledReason,
  onLaunch,
}: {
  summary: ReactNode
  meta?: ReactNode
  ctaLabel: string
  ctaIcon?: ReactNode
  disabled?: boolean
  disabledReason?: string
  onLaunch: () => void
}) {
  return (
    <div className="sticky z-20 mt-5 md:mt-6" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--ha)]/25 bg-surface2/95 p-2.5 shadow-[var(--elev-3)] backdrop-blur-md">
        <div className="ml-1.5 min-w-0 flex-1 sm:ml-2.5">
          <div className="truncate text-[12.5px] font-semibold text-ink sm:text-[13px]">{disabled && disabledReason ? disabledReason : summary}</div>
          {meta && <div className="mt-0.5 truncate text-[10px] font-semibold tracking-[0.1em] text-mut uppercase">{meta}</div>}
        </div>
        <Btn variant="primary" disabled={disabled} className="h-12 shrink-0 px-5 sm:px-6" onClick={onLaunch}>
          {ctaIcon}
          <span className="whitespace-nowrap">{ctaLabel}</span>
          <ArrowRight size={16} aria-hidden />
        </Btn>
      </div>
    </div>
  )
}
