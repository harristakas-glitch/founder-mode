// The Capital section (owner brief + mockups, 2026-08-24) — the financial truth layer.
// Three internal pages, switched INSIDE the page (locked: no left-nav submenus): P&L, Unit
// Economics, Cap Table. Every number is a read of src/game/finance.ts, which closes to the
// engine's own weekly ledger. Trend colours follow the LOCKED rule: green = favourable,
// red = unfavourable, yellow = near-flat — purple is brand accent only, never direction.
// Simulation-first (owner call): quick and arena keep the classic Finance screen.

import { useState } from 'react'
import { Panel } from '../components'
import { money, pct } from '../format'
import { runwayWeeks, weeklyBurn } from '../game/engine'
import {
  capTable,
  dilutionOutlook,
  pnlRows,
  pnlTakeaways,
  TOTAL_SHARES,
  trendTone,
  unitCards,
  unitInsights,
  type PnlRow,
  type Tone,
  type UnitCard,
} from '../game/finance'
import { useStore } from '../store'
import { KpiStrip } from './people-shared'
import { DebtPanel, MacroPanel, UpcomingPayments } from './Finance'
import { hasCapability } from '../game/modes'

const TONE_TEXT: Record<Tone, string> = { good: 'text-good', bad: 'text-bad', flat: 'text-warn' }
const TONE_VAR: Record<Tone, string> = { good: 'var(--color-good)', bad: 'var(--color-bad)', flat: 'var(--color-warn)' }

// ---------- atoms ---------------------------------------------------------------------------

function Spark({ series, tone, w = 68, h = 18 }: { series: number[]; tone: Tone; w?: number; h?: number }) {
  const pts = series.filter((v) => Number.isFinite(v))
  if (pts.length < 2) return <span className="inline-block" style={{ width: w, height: h }} />
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * (w - 2) + 1},${h - 2 - ((v - min) / span) * (h - 4)}`).join(' ')
  return (
    <svg width={w} height={h} className="inline-block" aria-hidden>
      <polyline points={path} fill="none" stroke={TONE_VAR[tone]} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function ChangeBadge({ change, tone, pp = false }: { change: number; tone: Tone; pp?: boolean }) {
  const txt = pp ? `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)} pp` : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`
  return <span className={`text-[12px] font-bold tnum ${TONE_TEXT[tone]}`}>{txt}</span>
}

export function CapitalTabs({ tab, setTab }: { tab: string; setTab: (t: 'pnl' | 'unit' | 'cap') => void }) {
  return (
    <div className="flex gap-1.5">
      {(
        [
          ['pnl', 'P&L'],
          ['unit', 'Unit Economics'],
          ['cap', 'Cap Table'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`min-h-[34px] rounded-lg border px-3.5 text-[12.5px] font-semibold transition-colors ${
            tab === id ? 'border-accent bg-accent/20 text-ink' : 'border-line2 bg-surface2 text-mut hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function financeKpis(game: ReturnType<typeof useStore.getState>['game'] & object) {
  const burn = weeklyBurn(game)
  const runway = runwayWeeks(game)
  const net = game.lastRevenue - game.lastExpenses
  return [
    { label: 'Cash', value: money(game.cash) },
    { label: 'Burn / week', value: money(burn) },
    {
      label: 'Runway',
      value: runway === Infinity ? '∞' : `${Math.max(0, Math.floor(runway))} wk`,
      tone: runway === Infinity ? 'text-good' : runway < 12 ? 'text-bad' : runway < 26 ? 'text-warn' : '',
    },
    { label: 'Net / week', value: money(net), tone: net >= 0 ? 'text-good' : 'text-bad' },
  ]
}

// ---------- P&L -----------------------------------------------------------------------------

function DriverPanel({ row }: { row: PnlRow }) {
  if (row.drivers.length === 0) return null
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-[var(--elev-3)]">
      <div className="text-[10px] font-bold tracking-[0.1em] text-mut uppercase">Drivers of {row.label}</div>
      <div className="mt-1.5 space-y-1">
        {row.drivers.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-mut">{d.label}</span>
            {d.value !== 0 && <span className={`shrink-0 font-bold tnum ${TONE_TEXT[d.tone]}`}>{money(d.value)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function PnlPage() {
  const game = useStore((s) => s.game)!
  const [open, setOpen] = useState<string | null>(null)
  const rows = pnlRows(game)
  const takeaways = pnlTakeaways(game)

  if (rows.length === 0) {
    return (
      <Panel>
        <div className="text-[13px] text-mut">No financial history yet — advance the first week and the ledger begins.</div>
      </Panel>
    )
  }

  // trend chart: the four lines that tell the story, each coloured by ITS OWN direction of travel
  const chartKeys: { id: string; label: string }[] = [
    { id: 'revenue', label: 'Revenue' },
    { id: 'gross', label: 'Gross Profit' },
    { id: 'operating', label: 'Operating Profit' },
    { id: 'net', label: 'Net Income' },
  ]
  const chartRows = chartKeys.map((k) => rows.find((r) => r.id === k.id)!).filter(Boolean)
  const allVals = chartRows.flatMap((r) => r.series)
  const cMin = Math.min(...allVals, 0)
  const cMax = Math.max(...allVals, 1)
  const cSpan = cMax - cMin || 1
  const CW = 560
  const CH = 120

  return (
    <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {/* THE TABLE — hover (or tap) any line to see what drove it (brief §10D, required) */}
        <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--elev-2)]">
          <div className="grid grid-cols-[minmax(120px,1.6fr)_minmax(76px,1fr)_minmax(76px,1fr)_64px_76px] items-center gap-x-3 border-b border-line bg-surface2/60 px-3.5 py-2 text-[10px] font-bold tracking-[0.08em] text-mut uppercase">
            <span>P&L (this week)</span>
            <span className="text-right">This week</span>
            <span className="text-right hidden sm:block">Last week</span>
            <span className="text-right">Change</span>
            <span className="text-right hidden sm:block">Trend</span>
          </div>
          {rows.map((row) => {
            const strong = ['gross', 'operating', 'net'].includes(row.id)
            return (
              <div key={row.id} className="group relative">
                <button
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                  className={`grid w-full grid-cols-[minmax(120px,1.6fr)_minmax(76px,1fr)_minmax(76px,1fr)_64px_76px] items-center gap-x-3 border-b border-line/40 px-3.5 py-[7px] text-left text-[12.5px] transition-colors last:border-b-0 hover:bg-surface2/50 ${
                    row.sub ? 'text-[11.5px]' : ''
                  }`}
                >
                  <span className={`${row.sub ? 'pl-3 text-mut' : strong ? 'font-bold' : ''}`}>{row.label}</span>
                  <span className={`text-right tnum ${strong ? 'font-bold' : ''} ${row.id === 'net' ? (row.thisWeek >= 0 ? 'text-good' : 'text-bad') : ''}`}>
                    {row.id === 'margin' ? `${row.thisWeek.toFixed(1)}%` : money(row.thisWeek)}
                  </span>
                  <span className="hidden text-right text-mut tnum sm:block">
                    {row.id === 'margin' ? `${row.lastWeek.toFixed(1)}%` : money(row.lastWeek)}
                  </span>
                  <span className="text-right">
                    <ChangeBadge change={row.change} tone={row.tone} pp={row.id === 'margin'} />
                  </span>
                  <span className="hidden text-right sm:block">
                    <Spark series={row.series} tone={row.tone} />
                  </span>
                </button>
                {row.drivers.length > 0 && (
                  // desktop: HOVER reveals (brief §21), click pins; mobile: tap toggles
                  <div
                    className={`border-b border-line/40 bg-surface2/30 px-3.5 py-2 sm:absolute sm:top-full sm:right-3 sm:z-20 sm:w-[300px] sm:border-0 sm:bg-transparent sm:p-0 ${
                      open === row.id ? 'block' : 'hidden sm:group-hover:block'
                    }`}
                  >
                    <DriverPanel row={row} />
                  </div>
                )}
              </div>
            )
          })}
          <div className="px-3.5 py-1.5 text-[10.5px] text-mut/70">Tap or hover any line to see its drivers.</div>
        </div>

        {/* trend chart */}
        <Panel title="P&L trend (last 12 weeks)" className="mt-4">
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${CW} ${CH}`} className="h-[120px] w-full min-w-[420px]">
              <line x1="0" x2={CW} y1={CH - 2 - ((0 - cMin) / cSpan) * (CH - 8)} y2={CH - 2 - ((0 - cMin) / cSpan) * (CH - 8)} stroke="var(--color-line2)" strokeDasharray="3 4" />
              {chartRows.map((r) => {
                const slope = r.series.length >= 2 ? trendTone((r.series[r.series.length - 1] - r.series[0]) / (Math.abs(r.series[0]) || 1), true) : 'flat'
                const path = r.series
                  .map((v, i) => `${(i / Math.max(1, r.series.length - 1)) * (CW - 4) + 2},${CH - 2 - ((v - cMin) / cSpan) * (CH - 8)}`)
                  .join(' ')
                return <polyline key={r.id} points={path} fill="none" stroke={TONE_VAR[slope]} strokeWidth="1.8" strokeLinejoin="round" opacity={r.id === 'revenue' ? 1 : 0.75} />
              })}
            </svg>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mut">
            {chartRows.map((r) => {
              const slope = r.series.length >= 2 ? trendTone((r.series[r.series.length - 1] - r.series[0]) / (Math.abs(r.series[0]) || 1), true) : 'flat'
              return (
                <span key={r.id} className="inline-flex items-center gap-1.5">
                  <span className="h-[3px] w-4 rounded-full" style={{ background: TONE_VAR[slope] }} />
                  {r.label}
                </span>
              )
            })}
          </div>
        </Panel>

        {/* the machinery that was already here stays here — debt, macro, upcoming payments */}
        <div className="mt-4">
          {hasCapability(game, 'bankDebt') && <DebtPanel />}
          <MacroPanel />
          <UpcomingPayments />
        </div>
      </div>

      <div className="min-w-0">
        <Panel title="Key takeaways">
          {takeaways.length === 0 ? (
            <div className="text-[12.5px] text-mut">Nothing notable moved this week.</div>
          ) : (
            <div className="space-y-1.5">
              {takeaways.map((t) => (
                <div key={t.text} className="flex items-start gap-2 text-[12.5px] leading-snug">
                  <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-warn'}`} />
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ---------- Unit Economics ------------------------------------------------------------------

function UnitCardView({ card }: { card: UnitCard }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="rounded-[14px] border border-line bg-surface p-3.5 text-left shadow-[var(--elev-1)] transition-colors hover:border-line2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-mut uppercase">{card.label}</span>
        {card.changePct !== 0 && <ChangeBadge change={card.changePct} tone={card.tone} />}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className={`text-[22px] leading-none font-bold tnum ${card.id === 'ratio' ? TONE_TEXT[card.tone] : ''}`}>{card.value}</span>
        <Spark series={card.series} tone={card.tone} w={84} h={24} />
      </div>
      {(open || card.drivers.length === 0) && card.note && <div className="mt-2 text-[11px] leading-snug text-mut">{card.note}</div>}
      {open && card.drivers.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-line/50 pt-2">
          {card.drivers.map((d) => (
            <div key={d.label} className="flex items-baseline justify-between gap-3 text-[11.5px]">
              <span className="text-mut">{d.label}</span>
              {d.value !== 0 && <span className={`shrink-0 font-bold tnum ${TONE_TEXT[d.tone]}`}>{money(d.value)}</span>}
            </div>
          ))}
        </div>
      )}
    </button>
  )
}

function UnitPage() {
  const game = useStore((s) => s.game)!
  const cards = unitCards(game)
  const insights = unitInsights(game)
  return (
    <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <UnitCardView key={c.id} card={c} />
          ))}
        </div>
        <div className="mt-3 text-[11px] text-mut/80">Tap a card for what drives it. Sparklines build as the weeks pass.</div>
      </div>
      <div className="min-w-0 space-y-4">
        <Panel title="Insights">
          <div className="space-y-1.5">
            {insights.map((t) => (
              <div key={t.text} className="flex items-start gap-2 text-[12.5px] leading-snug">
                <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-warn'}`} />
                <span>{t.text}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="What healthy looks like">
          <div className="space-y-1 text-[12px] leading-relaxed text-mut">
            <div>· LTV/CAC <b className="text-ink">3x+</b> — every marketing dollar multiplies.</div>
            <div>· Payback <b className="text-ink">under ~12 weeks</b> — spend recycles inside the runway.</div>
            <div>· Gross margin <b className="text-ink">rising</b> as the product carries more of the work.</div>
            <div>· Scale spend <b className="text-ink">after</b> settled cohorts hold, not before.</div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ---------- Cap Table -----------------------------------------------------------------------

const HOLDER_COLORS = ['var(--color-accent)', '#38bdf8', '#22d3ee', '#f59e0b', '#a78bfa', '#f472b6', '#64748b']

function Donut({ holders }: { holders: { name: string; equity: number }[] }) {
  const R = 40
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <svg viewBox="0 0 100 100" className="h-[130px] w-[130px]">
      {holders.map((h, i) => {
        const seg = (
          <circle
            key={h.name}
            r={R}
            cx="50"
            cy="50"
            fill="none"
            stroke={HOLDER_COLORS[i % HOLDER_COLORS.length]}
            strokeWidth="11"
            strokeDasharray={`${Math.max(0.5, h.equity * C - 1)} ${C}`}
            strokeDashoffset={-acc * C}
            transform="rotate(-90 50 50)"
          />
        )
        acc += h.equity
        return seg
      })}
      <text x="50" y="47" textAnchor="middle" className="fill-[var(--color-ink)]" fontSize="11" fontWeight="700">
        {(TOTAL_SHARES / 1e6).toFixed(0)}M
      </text>
      <text x="50" y="59" textAnchor="middle" className="fill-[var(--color-mut)]" fontSize="6.5">
        total shares
      </text>
    </svg>
  )
}

function CapPage() {
  const game = useStore((s) => s.game)!
  const holders = capTable(game)
  const outlook = dilutionOutlook(game)
  const rounds = game.rounds ?? []

  return (
    <div className="mt-4 grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
      {/* ownership summary */}
      <Panel title="Ownership summary">
        <div className="flex items-center justify-center">
          <Donut holders={holders} />
        </div>
        <div className="mt-2 space-y-1">
          {holders.map((h, i) => (
            <div key={h.name} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: HOLDER_COLORS[i % HOLDER_COLORS.length] }} />
                <span className="truncate text-mut">{h.name}</span>
              </span>
              <span className="shrink-0 font-bold tnum">{pct(h.equity, 1)}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* the table */}
      <div className="min-w-0">
        <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--elev-2)]">
          <div className="grid grid-cols-[minmax(130px,1.6fr)_minmax(80px,1fr)_64px] items-center gap-x-3 border-b border-line bg-surface2/60 px-3.5 py-2 text-[10px] font-bold tracking-[0.08em] text-mut uppercase">
            <span>Shareholder</span>
            <span className="text-right">Shares</span>
            <span className="text-right">Own.</span>
          </div>
          {holders.map((h) => (
            <div key={h.name} className="grid grid-cols-[minmax(130px,1.6fr)_minmax(80px,1fr)_64px] items-center gap-x-3 border-b border-line/40 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="min-w-0">
                <span className={`block truncate ${h.kind === 'founder' ? 'font-bold' : ''}`}>{h.name}</span>
                {h.detail && <span className="block truncate text-[10.5px] text-mut">{h.detail}</span>}
              </span>
              <span className="text-right text-mut tnum">{h.shares.toLocaleString()}</span>
              <span className={`text-right font-bold tnum ${h.kind === 'founder' ? '' : 'text-mut'}`}>{pct(h.equity, 1)}</span>
            </div>
          ))}
        </div>

        {/* dilution over rounds */}
        {rounds.length > 0 && (
          <Panel title="Your ownership through the rounds" className="mt-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="w-20 shrink-0 text-mut">Day one</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
                  <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: '100%' }} />
                </span>
                <span className="w-12 shrink-0 text-right font-bold tnum">100%</span>
              </div>
              {rounds.map((r) => (
                <div key={r.week} className="flex items-center gap-2 text-[12px]">
                  <span className="w-20 shrink-0 truncate text-mut">{r.stage}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
                    <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${r.founderAfter * 100}%` }} />
                  </span>
                  <span className="w-12 shrink-0 text-right font-bold tnum">{pct(r.founderAfter, 1)}</span>
                </div>
              ))}
              {outlook.nextStage && (
                <div className="flex items-center gap-2 text-[12px] opacity-70">
                  <span className="w-20 shrink-0 truncate text-mut">{outlook.nextStage} (proj.)</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
                    <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${outlook.founderAfter * 100}%`, opacity: 0.6 }} />
                  </span>
                  <span className="w-12 shrink-0 text-right tnum text-mut">~{pct(outlook.founderAfter, 1)}</span>
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>

      {/* dilution summary */}
      <Panel title="Dilution summary">
        <div className="space-y-1.5 text-[12.5px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-mut">Total shares</span>
            <span className="font-bold tnum">{TOTAL_SHARES.toLocaleString()}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-mut">You hold</span>
            <span className="font-bold tnum">{pct(game.founderEquity, 1)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-mut">Company value</span>
            <span className="font-bold tnum">{money(outlook.currentValuation)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-mut">Your stake</span>
            <span className="font-bold tnum">{money(outlook.currentValuation * game.founderEquity)}</span>
          </div>
        </div>
        {outlook.nextStage && (
          <div className="mt-3 border-t border-line/50 pt-2.5 text-[12px] leading-relaxed text-mut">
            <b className="text-ink">Next: {outlook.nextStage}.</b> Investors open the door around a {money(outlook.threshold)} valuation. A
            typical round takes ~{pct(outlook.projectedEquity, 0)}, which would leave you near{' '}
            <b className="tnum text-warn">{pct(outlook.founderAfter, 1)}</b>. Raising later at a higher price sells less of the company —
            if the runway lets you wait.
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------- the section ---------------------------------------------------------------------

export function CapitalSection() {
  const game = useStore((s) => s.game)!
  const [tab, setTab] = useState<'pnl' | 'unit' | 'cap'>('pnl')
  const titles = {
    pnl: { t: 'P&L', sub: 'See how your decisions impact financial performance. Updated every week.' },
    unit: { t: 'Unit Economics', sub: 'Understand the core drivers of your business.' },
    cap: { t: 'Cap Table', sub: 'Track ownership and dilution.' },
  }[tab]

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight sm:text-[28px]">{titles.t}</h1>
          <div className="mt-0.5 text-[13px] text-mut">{titles.sub}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <CapitalTabs tab={tab} setTab={setTab} />
      </div>
      <div className="mt-3">
        <KpiStrip items={financeKpis(game)} />
      </div>
      {tab === 'pnl' && <PnlPage />}
      {tab === 'unit' && <UnitPage />}
      {tab === 'cap' && <CapPage />}
    </div>
  )
}
