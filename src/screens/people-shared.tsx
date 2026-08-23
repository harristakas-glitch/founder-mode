// The People area's shared vocabulary (owner brief "Hiring & Team Pages", 2026-08-24).
//
// Both pages read the company through the same derivations, so the Hiring rail's Team Health and
// the Team page's Team Health can never disagree. Everything here is computed from real engine
// state via src/game/people.ts and engine reads — no number is invented for decoration. The
// visual grammar (KPI strip, status badge, fit tier, health gauge) matches the approved mockups:
// premium and playable, never a spreadsheet.

import type { ReactNode } from 'react'
import { money } from '../format'
import { runwayWeeks, weeklyPayroll } from '../game/engine'
import { TARGET_MIX, ROLE_LABEL, burnRisk, stageOutputMultiplier } from '../game/people'
import type { Employee, GameState, Role } from '../game/types'

export const PEOPLE_ROLES: Role[] = ['engineer', 'designer', 'marketer', 'sales']

/** The engine's weekly quit roll floor (src/game/engine.ts `quitters`): mercenaries walk early. */
export const quitFloor = (e: Employee): number => (e.trait === 'mercenary' ? 55 : 32)

export const weeklyMoney = (annual: number): string => `${money(annual / 52)}/wk`

// ---------- fit tiers (the card banner) ------------------------------------------------------

export type FitTier = { label: string; text: string; bg: string }

/** Mockup grammar: one loud verdict across the card top. Bands sit on the same `teamFit` number
 *  the engine's people model produces — the banner is a reading, not a second opinion. */
export function fitTier(fit: number): FitTier {
  if (fit >= 75) return { label: 'Great fit', text: 'text-good', bg: 'border-good/40 bg-good/10' }
  if (fit >= 62) return { label: 'Strong fit', text: 'text-accent', bg: 'border-accent/40 bg-accent/10' }
  if (fit >= 46) return { label: 'Good fit', text: 'text-info', bg: 'border-info/40 bg-info/10' }
  return { label: 'Risky pick', text: 'text-warn', bg: 'border-warn/45 bg-warn/10' }
}

// ---------- employee status (the roster badge) -----------------------------------------------

export type PersonStatus = { word: string; sub: string; tone: 'good' | 'warn' | 'bad' | 'info' }

/** One status, priority-ordered, every band measured against the engine's own thresholds. */
export function statusFor(e: Employee, stage: GameState['stage']): PersonStatus {
  const floor = quitFloor(e)
  if (e.morale < floor) return { word: 'At risk', sub: 'likely to leave', tone: 'bad' }
  if (e.morale < floor + 18) {
    return burnRisk(e) >= 55
      ? { word: 'Burnout risk', sub: 'high workload', tone: 'warn' }
      : { word: 'Unsettled', sub: 'needs attention', tone: 'warn' }
  }
  if (e.weeks <= 2) return { word: 'Healthy', sub: 'learning fast', tone: 'good' }
  if (stageOutputMultiplier(e, stage) >= 1.08) return { word: 'Healthy', sub: 'high impact', tone: 'good' }
  return { word: 'Healthy', sub: 'on track', tone: 'good' }
}

const STATUS_DOT = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' } as const
const STATUS_TEXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info' } as const

export function StatusBadge({ status, compact = false }: { status: PersonStatus; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status.tone]}`} aria-hidden />
      <span className={`text-[12px] font-semibold ${STATUS_TEXT[status.tone]}`}>{status.word}</span>
      {!compact && <span className="text-[11px] text-mut">{status.sub}</span>}
    </span>
  )
}

// ---------- role coverage (what the org lacks) -----------------------------------------------

export interface RoleNeed {
  role: Role
  have: number
  want: number
}

/** What the stage's own output mix wants at this headcount — the same TARGET_MIX derivation the
 *  old hiring sidebar used, now feeding "Open roles", the insights rail and Role Coverage. */
export function roleNeeds(game: GameState): RoleNeed[] {
  const heads = game.employees.length
  const target = TARGET_MIX[game.stage] ?? TARGET_MIX['Pre-seed']
  return PEOPLE_ROLES.map((role) => {
    const have = game.employees.filter((e) => e.role === role).length
    const want = Math.max(heads === 0 && role === 'engineer' ? 1 : 0, Math.round(target[role] * Math.max(heads, 3)))
    return { role, have, want }
  })
}

export const openRoles = (game: GameState): number => roleNeeds(game).reduce((a, n) => a + Math.max(0, n.want - n.have), 0)

// ---------- team health (one score, shared by both rails) ------------------------------------

export interface TeamHealth {
  /** average morale — the score IS the number the simulation runs on, not a composite fiction */
  score: number
  word: string
  tone: 'good' | 'warn' | 'bad'
  highPerformers: number
  atRisk: number
  burnout: number
  newThisMonth: number
}

export function teamHealth(game: GameState): TeamHealth | null {
  if (game.employees.length === 0) return null
  const score = Math.round(game.employees.reduce((a, e) => a + e.morale, 0) / game.employees.length)
  const atRisk = game.employees.filter((e) => e.morale < quitFloor(e)).length
  const burnout = game.employees.filter((e) => e.morale >= quitFloor(e) && e.morale < quitFloor(e) + 18 && burnRisk(e) >= 55).length
  return {
    score,
    word: score >= 70 ? 'Good' : score >= 55 ? 'Steady' : score >= 40 ? 'Strained' : 'Critical',
    tone: score >= 70 ? 'good' : score >= 45 ? 'warn' : 'bad',
    highPerformers: game.employees.filter((e) => stageOutputMultiplier(e, game.stage) >= 1.08).length,
    atRisk,
    burnout,
    newThisMonth: game.employees.filter((e) => e.weeks <= 4).length,
  }
}

/** The one-sentence nudge the brief asks for — why hiring/attention matters right now. */
export function teamNudge(game: GameState): string | null {
  const h = teamHealth(game)
  if (!h) return null
  if (h.atRisk > 0) return `${h.atRisk} team member${h.atRisk === 1 ? '' : 's'} may quit — talk money or lighten the load.`
  if (h.burnout > 0) return `${h.burnout} carrying burnout risk — a cash crunch would hit them first.`
  const short = roleNeeds(game).filter((n) => n.want - n.have > 0)
  if (short.length) return `${ROLE_LABEL[short[0].role]} is the org's biggest gap right now.`
  return null
}

// ---------- runway impact -------------------------------------------------------------------

/** What the whole payroll costs in runway weeks: runway without the team minus runway with it.
 *  A pure counterfactual read off the engine's own runwayWeeks — nothing re-derived. */
export function teamRunwayImpact(game: GameState): { text: string; tone: 'bad' | 'warn' | '' } {
  if (weeklyPayroll(game) <= 0) return { text: '—', tone: '' }
  const now = runwayWeeks(game)
  const free = runwayWeeks({ ...game, employees: [] } as GameState)
  if (now === Infinity) return { text: 'covered', tone: '' }
  if (free === Infinity) return { text: 'the burn', tone: 'warn' }
  const delta = free - now
  return { text: `-${delta >= 10 ? Math.round(delta) : delta.toFixed(1)} wks`, tone: delta > 20 ? 'bad' : 'warn' }
}

// ---------- shared UI atoms ------------------------------------------------------------------

/** The mockup's compact KPI strip: tiny uppercase label over a bold value, boxed. */
export function KpiStrip({ items }: { items: { label: string; value: ReactNode; sub?: string; tone?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-[104px] flex-1 rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--elev-1)] sm:flex-none">
          <div className="text-[9.5px] font-bold tracking-[0.1em] text-mut uppercase">{it.label}</div>
          <div className={`mt-0.5 text-[15px] font-bold tnum ${it.tone ?? ''}`}>{it.value}</div>
          {it.sub && <div className="text-[10.5px] text-mut">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}

/** The team-health gauge — a semicircle arc, score centred, word under. */
export function HealthGauge({ score, word, tone }: { score: number; word: string; tone: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--color-good)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-bad)'
  const R = 44
  const C = Math.PI * R
  return (
    <div className="relative mx-auto h-[72px] w-[128px]">
      <svg viewBox="0 0 128 72" className="h-full w-full">
        <path d="M 20 66 A 44 44 0 0 1 108 66" fill="none" stroke="var(--color-line2)" strokeWidth="9" strokeLinecap="round" />
        <path
          d="M 20 66 A 44 44 0 0 1 108 66"
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * C} ${C}`}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-[24px] leading-none font-bold tnum">{score}</div>
        <div className="text-[11px] font-semibold" style={{ color }}>
          {word}
        </div>
      </div>
    </div>
  )
}

/** A labelled count row for the "what's driving this" list. */
export function DriverRow({ label, value, tone = '' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[12.5px]">
      <span className="text-mut">{label}</span>
      <span className={`font-bold tnum ${tone}`}>{value}</span>
    </div>
  )
}

/** Coverage bar: have/want per role. Full-width track so the gaps read at a glance. */
export function CoverageRow({ need }: { need: RoleNeed }) {
  const pctv = need.want > 0 ? Math.min(100, (need.have / need.want) * 100) : 100
  const tone = need.want === 0 ? 'var(--color-line2)' : need.have >= need.want ? 'var(--color-good)' : pctv >= 60 ? 'var(--color-accent)' : 'var(--color-warn)'
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-mut">{ROLE_LABEL[need.role]}</span>
        <span className="font-semibold tnum">
          {need.have} / {need.want === 0 ? '—' : need.want}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/40">
        <div className="h-full rounded-full" style={{ width: `${pctv}%`, background: tone }} />
      </div>
    </div>
  )
}

