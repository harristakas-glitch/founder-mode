import type { ReactNode } from 'react'
import { TRAITS } from './game/data'
import type { TraitId } from './game/types'

export function TraitChip({ trait }: { trait?: TraitId | null }) {
  if (!trait) return null
  const t = TRAITS[trait]
  if (!t) return null
  const cls = trait === 'drama' || trait === 'mercenary' ? 'bad' : trait === 'culture' || trait === 'craftsman' ? 'good' : ''
  return (
    <span className={`chip ${cls}`} title={t.blurb}>
      {t.label}
    </span>
  )
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="panel">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  )
}

export function StatCard({ label, value, delta, tone }: { label: string; value: string; delta?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="panel statcard">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {delta && <div className={`delta ${tone ?? ''}`}>{delta}</div>}
    </div>
  )
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  )
}

export function BarRow({ name, value, color, display }: { name: string; value: number; color?: string; display?: string }) {
  return (
    <div className="bar-row">
      <span className="name">{name}</span>
      <Bar value={value} color={color} />
      <span className="val">{display ?? Math.round(value)}</span>
    </div>
  )
}

export function SkillDots({ skill }: { skill: number }) {
  return (
    <span className="skill-dots">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < skill ? (skill >= 9 ? 'elite' : 'on') : ''} />
      ))}
    </span>
  )
}

// Demand gauge: weak / mixed / strong zones with the team's confidence band overlaid.
export function DemandGauge({ lo, hi, min, max, weakBelow, strongAbove }: { lo: number; hi: number; min: number; max: number; weakBelow: number; strongAbove: number }) {
  const span = max - min
  const pct = (v: number) => `${(((v - min) / span) * 100).toFixed(1)}%`
  return (
    <div>
      <div className="gauge">
        <div className="zone weak" style={{ width: pct(weakBelow) }} />
        <div className="zone mixed" style={{ width: `${(((strongAbove - weakBelow) / span) * 100).toFixed(1)}%` }} />
        <div className="zone strong" style={{ flex: 1 }} />
        <div className="band" style={{ left: pct(lo), width: `${Math.max(2, ((hi - lo) / span) * 100).toFixed(1)}%` }} />
      </div>
      <div className="gauge-labels">
        <span>Dead-end ideas</span>
        <span>Grindable</span>
        <span>Market pull</span>
      </div>
    </div>
  )
}

export function BenchRow({ metric, tone, children }: { metric: string; tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <div className="bench-row">
      <span className={`dot ${tone}`} />
      <span className="metric">{metric}</span>
      <span className="vals">{children}</span>
    </div>
  )
}

export function Sparkline({ data, color = 'var(--accent)' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <div className="spark muted" style={{ fontSize: '0.8rem' }}>Not enough data yet — advance a few weeks.</div>
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 100
  const h = 30
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
