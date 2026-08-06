import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TRAITS } from './game/data'
import type { TraitId } from './game/types'

// ---------- animated number ----------

export function useTicker(value: number, ms = 500): number {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      const now = from + (value - from) * eased
      setShown(now)
      // track where we actually are, so an interrupted animation resumes from here
      // instead of snapping back to the previous animation's origin
      fromRef.current = now
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, ms])
  return shown
}

export function Ticker({ value, format }: { value: number; format: (n: number) => string }) {
  const shown = useTicker(value)
  return <span className="tnum">{format(shown)}</span>
}

// ---------- buttons ----------

const BTN_VARIANTS = {
  default: 'border border-line bg-surface2 text-ink hover:border-accent hover:text-white',
  primary: 'bg-accent text-white shadow-md shadow-accent/25 hover:brightness-110',
  good: 'bg-good text-white shadow-md shadow-good/25 hover:brightness-110',
  danger: 'border border-line bg-surface2 text-ink hover:border-bad hover:text-bad',
  ghost: 'text-mut hover:bg-surface2 hover:text-ink',
} as const

export function Btn({
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BTN_VARIANTS }) {
  return (
    <button
      className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${BTN_VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

// ---------- tables ----------

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th className={`border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-mut ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

export function Td({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <td className={`border-b border-line/40 py-2.5 pr-2 text-[13.5px] ${right ? 'text-right tnum' : ''} ${className}`}>{children}</td>
}

// ---------- surfaces ----------

export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line/70 bg-gradient-to-b from-surface to-surface/60 p-4 shadow-lg shadow-black/25 ${className}`}>
      {title && <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-mut">{title}</h3>}
      {children}
    </div>
  )
}

// Signed weekly change with a glyph — the glyph is the secondary encoding, never color alone.
export function TrendBadge({ value, format, invert }: { value: number; format?: (n: number) => string; invert?: boolean }) {
  if (!isFinite(value) || value === 0) return null
  const up = value > 0
  const goodDir = invert ? !up : up
  return (
    <span className={`ml-1.5 text-[11px] font-bold tnum ${goodDir ? 'text-good' : 'text-bad'}`}>
      {up ? '▲' : '▼'} {format ? format(Math.abs(value)) : `${(Math.abs(value) * 100).toFixed(1)}%`}
    </span>
  )
}

export function StatCard({
  label,
  value,
  numeric,
  format,
  delta,
  tone,
  trend,
  trendFormat,
}: {
  label: string
  value?: string
  numeric?: number
  format?: (n: number) => string
  delta?: string
  tone?: 'up' | 'down'
  trend?: number
  trendFormat?: (n: number) => string
}) {
  return (
    <div className="rounded-2xl border border-line/70 bg-gradient-to-b from-surface to-surface/60 p-4 shadow-lg shadow-black/25 transition-colors hover:border-line">
      <div className="text-2xl font-extrabold tracking-tight">
        {numeric !== undefined && format ? <Ticker value={numeric} format={format} /> : value}
        {trend !== undefined && <TrendBadge value={trend} format={trendFormat} />}
      </div>
      <div className="mt-0.5 text-xs text-mut">{label}</div>
      {delta && (
        <div className={`mt-1.5 text-xs ${tone === 'up' ? 'text-good' : tone === 'down' ? 'text-bad' : 'text-mut'}`}>{delta}</div>
      )}
    </div>
  )
}

// Deterministic company monogram: two initials on a gradient seeded by the name.
export function Monogram({ name, size = 38 }: { name: string; size?: number }) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl font-extrabold text-white shadow-lg"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 50) % 360} 70% 42%))`,
      }}
    >
      {initials || '?'}
    </div>
  )
}

const ROLE_COLORS: Record<string, string> = {
  engineer: 'hsl(230 70% 60%)',
  designer: 'hsl(270 65% 62%)',
  marketer: 'hsl(38 80% 52%)',
  sales: 'hsl(155 55% 45%)',
}

export function RoleAvatar({ name, role, size = 36 }: { name: string; role: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      title={role}
      style={{ width: size, height: size, fontSize: size * 0.38, background: ROLE_COLORS[role] ?? 'var(--color-accent)' }}
    >
      {initials}
    </div>
  )
}

// Radial skill indicator: ring fill + the number, so the value is never color-alone.
export function SkillRing({ skill, size = 40 }: { skill: number; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const frac = Math.min(1, skill / 10)
  return (
    <svg width={size} height={size} className="shrink-0" aria-label={`skill ${skill}/10`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={skill >= 9 ? 'var(--color-accent2)' : 'var(--color-accent)'}
        strokeWidth="4"
        strokeDasharray={`${c * frac} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fontSize={size * 0.34} fontWeight="800" fill="var(--color-ink)">
        {skill}
      </text>
    </svg>
  )
}

// A one-shot celebration: 26 pieces, pure CSS animation, self-cleaning.
export function Confetti() {
  const pieces = Array.from({ length: 26 }, (_, i) => ({
    left: `${(i * 137.5) % 100}%`,
    delay: `${(i % 9) * 0.12}s`,
    duration: `${2 + (i % 5) * 0.35}s`,
    color: ['#7c9aff', '#a78bfa', '#34d399', '#fbbf24', '#f472b6'][i % 5],
  }))
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: p.left, background: p.color, animationDelay: p.delay, animationDuration: p.duration }}
        />
      ))}
    </>
  )
}

// ---------- bars & meters ----------

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-black/40">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color ?? 'var(--color-accent)' }}
      />
    </div>
  )
}

export function BarRow({ name, value, color, display }: { name: string; value: number; color?: string; display?: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-3 last:mb-0">
      <span className="w-24 shrink-0 text-[13px] text-mut">{name}</span>
      <div className="flex-1">
        <Bar value={value} color={color} />
      </div>
      <span className="w-10 shrink-0 text-right text-[13px] font-semibold tnum">{display ?? Math.round(value)}</span>
    </div>
  )
}

export function SkillDots({ skill }: { skill: number }) {
  return (
    <span className="inline-flex gap-[3px]">
      {Array.from({ length: 10 }, (_, i) => (
        <i
          key={i}
          className={`h-[7px] w-[7px] rounded-full ${i < skill ? (skill >= 9 ? 'bg-accent2 shadow-[0_0_6px_rgba(167,139,250,0.6)]' : 'bg-accent') : 'bg-line'}`}
        />
      ))}
    </span>
  )
}

export function TraitChip({ trait }: { trait?: TraitId | null }) {
  if (!trait) return null
  const t = TRAITS[trait]
  if (!t) return null
  const cls =
    trait === 'drama' || trait === 'mercenary'
      ? 'border-bad/40 bg-bad/10 text-bad'
      : trait === 'culture' || trait === 'craftsman'
        ? 'border-good/40 bg-good/10 text-good'
        : 'border-accent2/40 bg-accent2/10 text-accent2'
  return (
    <span className={`ml-1.5 inline-block cursor-help rounded-md border px-1.5 py-px text-[10px] font-bold ${cls}`} title={t.blurb}>
      {t.label}
    </span>
  )
}

// ---------- demand gauge ----------

export function DemandGauge({ lo, hi, min, max, weakBelow, strongAbove }: { lo: number; hi: number; min: number; max: number; weakBelow: number; strongAbove: number }) {
  const span = max - min
  const pct = (v: number) => `${(((v - min) / span) * 100).toFixed(1)}%`
  return (
    <div>
      <div className="relative flex h-7 overflow-hidden rounded-lg">
        <div className="h-full bg-bad/25" style={{ width: pct(weakBelow) }} />
        <div className="h-full bg-warn/25" style={{ width: `${(((strongAbove - weakBelow) / span) * 100).toFixed(1)}%` }} />
        <div className="h-full flex-1 bg-good/25" />
        <div
          className="absolute top-[3px] bottom-[3px] min-w-[6px] rounded-md bg-ink/90 shadow-[0_0_10px_rgba(220,229,245,0.5)] transition-all duration-700"
          style={{ left: pct(lo), width: `${Math.max(2, ((hi - lo) / span) * 100).toFixed(1)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-mut">
        <span>Dead-end ideas</span>
        <span>Grindable</span>
        <span>Market pull</span>
      </div>
    </div>
  )
}

export function BenchRow({ metric, tone, children }: { metric: string; tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const dot = tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-bad'
  return (
    <div className="flex items-center gap-2.5 border-b border-line/40 py-2 text-[13px] last:border-b-0">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="w-32 shrink-0 text-mut">{metric}</span>
      <span className="flex-1">{children}</span>
    </div>
  )
}

// ---------- chart ----------

// The story of a run: valuation curve with emoji markers for its big moments.
export function TimelineChart({ history, markers }: { history: { week: number; valuation: number }[]; markers: { week: number; emoji: string; label: string }[] }) {
  if (history.length < 2) return null
  const vals = history.map((h) => Math.sqrt(Math.max(0, h.valuation)))
  const vMax = Math.max(...vals) || 1
  const W = 100
  const H = 46
  const x = (i: number) => (i / (vals.length - 1)) * (W - 4) + 2
  const y = (v: number) => H - 6 - (v / vMax) * (H - 18)
  const line = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const markerPos = markers.map((mk) => {
    let i = history.findIndex((h) => h.week >= mk.week)
    if (i < 0) i = history.length - 1
    return { ...mk, i }
  })
  return (
    <svg className="block w-full" viewBox={`0 0 ${W} ${H}`} style={{ height: 150 }}>
      <polygon points={`2,${H - 6} ${line} ${W - 2},${H - 6}`} fill="rgba(124,154,255,0.15)" />
      <polyline points={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      {markerPos.map((mk, idx) => (
        <text key={idx} x={x(mk.i)} y={Math.max(6, y(vals[mk.i]) - 3)} fontSize="5.5" textAnchor="middle">
          {mk.emoji}
        </text>
      ))}
      <text x="2" y={H - 1} fontSize="3.2" fill="var(--color-mut)">
        wk {history[0].week}
      </text>
      <text x={W - 2} y={H - 1} fontSize="3.2" fill="var(--color-mut)" textAnchor="end">
        wk {history[history.length - 1].week}
      </text>
    </svg>
  )
}

export function LineChart({
  data,
  color = 'var(--color-chart)',
  height = 120,
  formatY = (n: number) => `${Math.round(n)}`,
  startWeek = 1,
}: {
  data: number[]
  color?: string
  height?: number
  formatY?: (n: number) => string
  startWeek?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  if (data.length < 2)
    return (
      <div className="flex items-center justify-center text-xs text-mut" style={{ height }}>
        Not enough data yet — advance a few weeks.
      </div>
    )
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const W = 100
  const H = 100
  const x = (i: number) => (i / (data.length - 1)) * W
  const y = (v: number) => H - 4 - ((v - min) / range) * (H - 8)
  const line = data.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  const hi = hover !== null ? Math.min(data.length - 1, Math.max(0, hover)) : null

  return (
    <div
      ref={boxRef}
      className="relative select-none"
      style={{ height }}
      onMouseMove={(e) => {
        const rect = boxRef.current!.getBoundingClientRect()
        setHover(Math.round(((e.clientX - rect.left) / rect.width) * (data.length - 1)))
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* recessive gridlines at max / mid / min */}
        {[y(max), y((max + min) / 2), y(min)].map((gy, i) => (
          <line key={i} x1="0" y1={gy} x2={W} y2={gy} stroke="rgba(220,229,245,0.07)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={area} fill={`url(#g-${color.replace(/[^a-z0-9]/gi, '')})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {hi !== null && (
          <line x1={x(hi)} y1="0" x2={x(hi)} y2={H} stroke="rgba(220,229,245,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hi !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-bg2/95 px-2 py-1 text-[11px] shadow-lg tnum"
          style={{ left: `${(hi / (data.length - 1)) * 100}%`, top: 0 }}
        >
          <span className="text-mut">wk {startWeek + hi}:</span> <b>{formatY(data[hi])}</b>
        </div>
      )}
      <span className="absolute top-0 left-1 text-[10px] text-mut tnum">{formatY(max)}</span>
      <span className="absolute top-1/2 left-1 -translate-y-1/2 text-[10px] text-mut/70 tnum">{formatY((max + min) / 2)}</span>
      <span className="absolute bottom-0 left-1 text-[10px] text-mut tnum">{formatY(min)}</span>
      <span className="absolute right-1 bottom-0 text-[10px] text-mut">wk {startWeek + data.length - 1}</span>
    </div>
  )
}
