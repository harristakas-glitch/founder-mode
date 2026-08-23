// The shared in-game shell primitives (owner brief "Shared In-Game Shell Design System",
// 2026-08-23): one brand, one utility-button grammar, one nav-item grammar — used by every
// screen AFTER Home and the launchers. The rules the brief hard-codes:
//
//   THE SHELL IS PERSISTENT; PAGE CONTENT CHANGES INSIDE IT.
//   Desktop = top information bar + left navigation rail.
//   Mobile  = top bar + metric rail + bottom navigation.
//   The top bar is company heartbeat, not page navigation.
//   Purple signals brand and selection — not decoration everywhere.
//
// Composition (which screens, which metrics, which actions) stays in App.tsx, where the game
// state lives; these components know nothing about pages.

import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * The F mark: an italic bolt-cut F in the brand gradient (purple → cyan), drawn inline — this
 * app ships no external images in the shell (CSP, offline). Crisp at 20–28px, no glow.
 *
 * The gradient id comes from useId, NOT a constant: the shell renders the mark twice (hidden
 * desktop bar + mobile bar), url(#…) resolves document-wide to the FIRST match, and a first
 * match inside a display:none subtree paints nothing — the mark simply vanished on phones.
 */
export function FounderMark({ size = 24 }: { size?: number }) {
  const gid = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <defs>
        <linearGradient id={gid} x1="4" y1="22" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      {/* one continuous italic F: top bar, mid bar, leaning stem — the lean is the "motion" */}
      <path d="M9.4 2.5h11.2l-1.7 4.1h-7.2l-1 2.9h6.3l-1.6 4H8.3l-2.6 8H1.6l6-19z" fill={`url(#${gid})`} />
    </svg>
  )
}

/**
 * Brand lockup. `stacked` is the rail-width desktop treatment (mark beside a two-line
 * FOUNDER / MODE); the flat version is the mobile top-bar centre. Same identity everywhere —
 * the brief bans per-surface wordmarks.
 */
export function FounderModeBrand({ stacked = false }: { stacked?: boolean }) {
  if (stacked)
    return (
      <span className="flex items-center gap-1.5">
        <FounderMark size={22} />
        <span className="leading-[1.1]">
          <span className="block text-[9.5px] font-extrabold tracking-[0.14em] text-ink">FOUNDER</span>
          <span className="block text-[9.5px] font-extrabold tracking-[0.14em] text-accent">MODE</span>
        </span>
      </span>
    )
  return (
    <span className="flex items-center gap-2">
      <FounderMark size={20} />
      <span className="text-[13px] font-extrabold tracking-[0.14em]">
        FOUNDER <span className="text-accent">MODE</span>
      </span>
    </span>
  )
}

/**
 * A shell utility action (brief §15): 40px raised square, subtle border, centred icon.
 * Never a naked icon floating in space.
 */
export function UtilityButton({
  label,
  onClick,
  danger,
  expanded,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  expanded?: boolean
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-mut transition-colors duration-[120ms] hover:bg-surface2 ${
        danger ? 'hover:border-bad/60 hover:text-bad' : 'hover:border-accent/50 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * One desktop rail destination (brief §18–§22): icon over label, ~72px footprint, selected =
 * raised tile + subtle glow + edge indicator. Game navigation, not a SaaS sidebar.
 */
export function RailItem({
  icon: Icon,
  label,
  active,
  badge = 0,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-semibold transition-colors duration-[120ms] ${
        active ? 'bg-surface2 text-ink shadow-[var(--glow-accent)]' : 'text-mut hover:bg-surface2/60 hover:text-ink'
      }`}
    >
      {active && <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-full bg-accent" aria-hidden />}
      <span className="relative">
        <Icon size={22} strokeWidth={2} className={active ? 'text-accent' : ''} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[16px] rounded-full bg-bad px-1 text-center text-[9.5px] font-bold leading-[16px] text-bg tnum">
            {badge}
          </span>
        )}
      </span>
      {label}
    </button>
  )
}

/**
 * One mobile bottom-nav destination (brief §35): the desktop selected language shrunk to a
 * capsule — raised tile, purple glow, purple icon and label.
 */
export function BottomNavItem({
  icon: Icon,
  label,
  active,
  badge = 0,
  expanded,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  badge?: number
  expanded?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active && expanded === undefined ? 'page' : undefined}
      aria-expanded={expanded}
      className="flex min-h-[54px] flex-1 items-center justify-center px-0.5 py-1.5"
    >
      <span
        className={`flex min-w-[52px] flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-semibold transition-colors duration-[120ms] ${
          active ? 'bg-surface2 text-accent shadow-[var(--glow-accent)]' : 'text-mut'
        }`}
      >
        <span className="relative">
          <Icon size={21} strokeWidth={active ? 2.4 : 2} />
          {badge > 0 && (
            <span className="absolute -top-1 -right-2 min-w-[15px] rounded-full bg-bad px-1 text-[9px] font-bold leading-[15px] text-bg tnum">
              {badge}
            </span>
          )}
        </span>
        {label}
      </span>
    </button>
  )
}
