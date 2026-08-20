import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TRAITS } from './game/data'
import type { TraitId } from './game/types'

// ---------- animated number ----------

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Local to this module: `Ticker` is the only consumer and the hook is not part of the
// component library's surface.
function useTicker(value: number, ms = 500): number {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    // a player who asked for less motion gets the number, not the count-up
    if (reducedMotion()) {
      fromRef.current = value
      setShown(value)
      return
    }
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
  default: 'border border-line bg-surface2 text-ink hover:border-line2 hover:bg-surface2/70',
  primary: 'bg-accent text-bg shadow-[var(--elev-2)] hover:brightness-110',
  good: 'bg-good text-bg shadow-[var(--elev-2)] hover:brightness-110',
  danger: 'border border-line bg-surface2 text-ink hover:border-bad/70 hover:text-bad',
  ghost: 'text-mut hover:bg-surface2 hover:text-ink',
} as const

// 44px minimum on touch widths (WCAG target size), tighter on the desktop dashboards.
export function Btn({
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BTN_VARIANTS }) {
  return (
    <button
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform,opacity] duration-[120ms] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 md:min-h-[34px] ${BTN_VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

// ---------- tables ----------

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    // pr-2 mirrors Td, so adjacent column headers can't run into each other
    <th className={`border-b border-line pr-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

export function Td({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={`border-b border-line/40 py-2.5 pr-2 text-[13px] leading-[1.45] ${right ? 'text-right tnum' : ''} ${className}`}>
      {children}
    </td>
  )
}

// ---------- surfaces ----------

// One card recipe for the whole game — plane 1 of four (docs/ui-audit-2026-08.md §1.1).
//
// `bg-surface` is OPAQUE and must stay that way. It was `bg-surface/80` over a fixed page gradient,
// which is what made the same card read as raised at one end of the screen and sunken at the other.
// A card whose apparent depth depends on where it scrolled to is not an elevation ramp.
//
// The old recipe also carried `ring-1 ring-inset ring-white/[0.03]` under a comment describing "a
// 1px inner highlight along the TOP edge". `ring` draws all four sides — the code did not do what
// its own comment said, and a box outlined in white on every side reads as a selection state, not
// as light. The real top highlight now lives in `--elev-2` as an `inset 0 1px 0`, which is the only
// shape that puts light where light would actually fall.
//
// Radius is 14px, down from `rounded-2xl` (16px), with nested boxes at 10px: a nested corner has to
// be visibly tighter than its parent or the nesting disappears.
const CARD = 'rounded-[14px] border border-line bg-surface shadow-[var(--elev-2)]'

/** Plane 2 — a box INSIDE a card. Exported so screens stop inventing their own nested recipe. */
export const NESTED = 'rounded-[10px] border border-line/70 bg-surface2'

export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`${CARD} p-5 ${className}`}>
      {title && (
        <div className="mb-3.5 flex min-h-[18px] items-center justify-between gap-3">
          {/* 15px sentence case, not 11px UPPERCASE with letter-spacing. The old treatment was
              designed for two-word labels and the game has titles like "Cohort triangle — % of each
              group still here, N weeks after joining": 69 characters, tracked out, in grey, at
              eleven pixels. Uppercase survives in exactly one place now — the metric label in
              StatCard — because that is short by construction. */}
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// A calm, consistent way to say "there is nothing here yet".
export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line/70 px-4 py-8 text-center">
      {icon && <span className="text-mut/60">{icon}</span>}
      <div className="text-[13px] font-semibold text-mut">{title}</div>
      {hint && <div className="max-w-[38ch] text-[12px] leading-relaxed text-mut/70">{hint}</div>}
    </div>
  )
}

// Signed weekly change with a glyph — the glyph is the secondary encoding, never color alone.
export function TrendBadge({ value, format, invert }: { value: number; format?: (n: number) => string; invert?: boolean }) {
  if (!isFinite(value) || value === 0) return null
  const up = value > 0
  const goodDir = invert ? !up : up
  return (
    <span className={`ml-1.5 whitespace-nowrap text-[11px] font-bold tnum ${goodDir ? 'text-good' : 'text-bad'}`}>
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
  // Label first, value second — same reading order as the topbar rail, so the eye
  // finds the metric by its name and only then parses the digits.
  //
  // The label is the ONE surviving uppercase treatment in the game. It earns it by being short by
  // construction ("Cash", "Runway", "Users"); the 69-character tracked-out uppercase sentences that
  // used to head every Panel do not, and are now sentence case at a readable size.
  //
  // The figure is 34px, up from 26px, and `font-bold` rather than `extrabold`. That is not a
  // decoration: with 111 bold and 48 extrabold declarations against 2 normal ones, weight had
  // stopped carrying any hierarchy at all, so the number now separates from its label by SIZE —
  // 34 against 11 — which is a difference that survives being looked at quickly on a phone.
  return (
    <div className={`${CARD} p-4 transition-colors duration-[120ms] hover:border-line2`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mut">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[34px] leading-[1.05] font-bold tracking-[-0.02em] tnum">
        {numeric !== undefined && format ? <Ticker value={numeric} format={format} /> : value}
        {trend !== undefined && <TrendBadge value={trend} format={trendFormat} />}
      </div>
      {delta && (
        <div className={`mt-2 text-[13px] leading-snug ${tone === 'up' ? 'text-good' : tone === 'down' ? 'text-bad' : 'text-mut'}`}>
          {/* status colour never travels alone */}
          {tone === 'up' ? '▲ ' : tone === 'down' ? '▼ ' : ''}
          {delta}
        </div>
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
      className="flex shrink-0 items-center justify-center rounded-xl font-extrabold text-bg shadow-[var(--elev-2)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        // bright chip, dark initials — the one pairing that clears AA at every hue
        background: `linear-gradient(135deg, hsl(${hue} 68% 68%), hsl(${(hue + 50) % 360} 70% 58%))`,
      }}
    >
      {initials || '?'}
    </div>
  )
}

const ROLE_COLORS: Record<string, string> = {
  engineer: 'hsl(230 75% 72%)',
  designer: 'hsl(270 70% 74%)',
  marketer: 'hsl(38 85% 62%)',
  sales: 'hsl(155 55% 62%)',
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
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-bg"
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
    <div className="h-2 overflow-hidden rounded-full bg-black/40 ring-1 ring-inset ring-white/[0.04]">
      <div
        className="h-full rounded-full transition-[width,background-color] duration-[400ms] ease-out"
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
          className={`h-[7px] w-[7px] rounded-full ${i < skill ? (skill >= 9 ? 'bg-accent2' : 'bg-accent') : 'bg-line'}`}
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
          className="absolute top-[3px] bottom-[3px] min-w-[6px] rounded-md bg-ink/90 shadow-[0_0_10px_rgba(220,229,245,0.45)] transition-[left,width] duration-[400ms] ease-out"
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
      {/* The stroke below reads --color-accent, which App rebinds per sector. This fill used to be a
          literal rgba() copy of the SaaS blue, so on a fintech, social or ecommerce run the line
          retinted and the area under it stayed blue. Same token, same retint. */}
      <polygon points={`2,${H - 6} ${line} ${W - 2},${H - 6}`} fill="var(--color-accent)" fillOpacity="0.15" />
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
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line/60 text-center"
        style={{ height }}
      >
        <span className="text-[13px] font-semibold text-mut">No trend yet</span>
        <span className="text-[12px] text-mut/70">Advance a few weeks and the line appears here.</span>
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

  const gid = `g-${color.replace(/[^a-z0-9]/gi, '')}`
  const AXIS = 16 // px reserved under the plot for the week axis
  // fraction along the plot; doubles as the tooltip's own transform origin so it
  // never hangs off either end of the card
  const p = hi === null ? 0 : hi / (data.length - 1)

  return (
    <div className="select-none" style={{ height }}>
      <div className="flex" style={{ height: height - AXIS }}>
        {/* value gutter — labels live beside the plot, never on top of the line */}
        <div className="relative w-12 shrink-0 text-[10px] text-mut tnum">
          <span className="absolute top-0 right-2">{formatY(max)}</span>
          <span className="absolute top-1/2 right-2 -translate-y-1/2 text-mut/70">{formatY((max + min) / 2)}</span>
          <span className="absolute right-2 bottom-0">{formatY(min)}</span>
        </div>
        <div
          ref={boxRef}
          className="relative min-w-0 flex-1"
          onMouseMove={(e) => {
            const rect = boxRef.current!.getBoundingClientRect()
            setHover(Math.round(((e.clientX - rect.left) / rect.width) * (data.length - 1)))
          }}
          onMouseLeave={() => setHover(null)}
        >
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {/* recessive gridlines at max / mid / min */}
            {[y(max), y((max + min) / 2), y(min)].map((gy, i) => (
              <line key={i} x1="0" y1={gy} x2={W} y2={gy} stroke="rgba(220,229,245,0.07)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <polygon points={area} fill={`url(#${gid})`} />
            <polyline
              points={line}
              fill="none"
              stroke={color}
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {hi !== null && (
              <line x1={x(hi)} y1="0" x2={x(hi)} y2={H} stroke="rgba(220,229,245,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {/* the read-out dot is HTML, so the stretched viewBox can't turn it into an ellipse */}
          {hi !== null && (
            <span
              className="pointer-events-none absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg2"
              style={{ left: `${p * 100}%`, top: `${y(data[hi])}%`, background: color }}
            />
          )}
          {hi !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-bg2/95 px-2 py-1 text-[11px] shadow-[var(--elev-3)] tnum"
              style={{ left: `${p * 100}%`, transform: `translateX(${-p * 100}%)` }}
            >
              <span className="text-mut">wk {startWeek + hi}</span> <b>{formatY(data[hi])}</b>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between pl-12 text-[10px] text-mut tnum" style={{ height: AXIS }}>
        <span>wk {startWeek}</span>
        <span>wk {startWeek + data.length - 1}</span>
      </div>
    </div>
  )
}
