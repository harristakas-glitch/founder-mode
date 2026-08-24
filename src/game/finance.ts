// The Capital section's truth layer (owner brief 2026-08-24). Other systems create movement;
// Capital explains the result — so EVERY number here is a read of engine state or its own
// recorded history, never a re-derivation that could drift. The P&L closes to the exact weekly
// ledger: rows sum to `revenue − expenses`, with the residual the engine spent on one-time
// costs (severance, fees, events) shown as its own honest line rather than smeared elsewhere.

import type { GameState, HistoryPoint, Stage } from './types'
import { STAGES, STAGE_THRESHOLDS, sectorById } from './data'
import { unitEconomics, valuation, weeklyPayroll } from './engine'

export type Tone = 'good' | 'bad' | 'flat'

/** The locked trend rule (§6-7): green = favourable, red = unfavourable, yellow = near-flat.
 *  `goodWhenUp` carries the BUSINESS meaning — burn up is red, revenue up is green. */
export function trendTone(changePct: number, goodWhenUp: boolean): Tone {
  if (Math.abs(changePct) < 0.03) return 'flat'
  return changePct > 0 === goodWhenUp ? 'good' : 'bad'
}

export interface Driver {
  label: string
  value: number
  tone: Tone
}

export interface PnlRow {
  id: string
  label: string
  /** indented context line (Gross Margin) rather than a money row */
  sub?: boolean
  thisWeek: number
  lastWeek: number
  /** fractional change vs last week; margin rows carry pp difference instead */
  change: number
  tone: Tone
  /** spark series, oldest first (up to 12 weeks) */
  series: number[]
  drivers: Driver[]
}

const last = (s: GameState, back = 0): HistoryPoint | undefined => s.history[s.history.length - 1 - back]

const seriesOf = (s: GameState, f: (h: HistoryPoint) => number, n = 12): number[] =>
  s.history.slice(-n).map(f)

const pctChange = (now: number, then: number): number => (then !== 0 ? (now - then) / Math.abs(then) : now !== 0 ? 1 : 0)

/** One-time & other: what the week actually spent beyond the recurring lines. */
const oneTime = (h: HistoryPoint): number =>
  Math.max(0, h.expenses - (h.payroll + h.marketing + h.office + h.infra + (h.interest ?? 0)))

export function pnlRows(s: GameState): PnlRow[] {
  const now = last(s)
  const prev = last(s, 1)
  if (!now) return []
  const p = prev ?? now
  const dTone = (nowV: number, prevV: number, goodWhenUp: boolean): { change: number; tone: Tone } => {
    const change = pctChange(nowV, prevV)
    return { change, tone: trendTone(change, goodWhenUp) }
  }

  const gross = (h: HistoryPoint) => h.revenue - h.infra
  const operating = (h: HistoryPoint) => h.revenue - h.infra - h.payroll - h.marketing - h.office - oneTime(h)
  const net = (h: HistoryPoint) => h.revenue - h.expenses
  const marginPP = (h: HistoryPoint) => (h.revenue > 0 ? (gross(h) / h.revenue) * 100 : 0)

  const newStarts = s.employees.filter((e) => e.weeks <= 1)
  const perfShare = s.growth?.performanceShare ?? 1
  const arpuNow = now.users > 0 ? now.revenue / now.users : 0
  const arpuPrev = p.users > 0 ? p.revenue / p.users : 0
  const usersDelta = now.users - p.users

  const rows: PnlRow[] = [
    {
      id: 'revenue',
      label: 'Revenue',
      thisWeek: now.revenue,
      lastWeek: p.revenue,
      ...dTone(now.revenue, p.revenue, true),
      series: seriesOf(s, (h) => h.revenue),
      drivers: [
        { label: `Customer base ${usersDelta >= 0 ? 'grew' : 'shrank'} (${usersDelta >= 0 ? '+' : ''}${usersDelta.toLocaleString()})`, value: usersDelta * arpuNow, tone: usersDelta >= 0 ? 'good' : 'bad' },
        { label: `Revenue per customer ${arpuNow >= arpuPrev ? 'up' : 'down'}`, value: (arpuNow - arpuPrev) * p.users, tone: trendTone(pctChange(arpuNow, arpuPrev), true) },
        ...((s.growth?.brand.stock ?? 0) > 8 ? [{ label: 'Brand pulls organic demand', value: 0, tone: 'good' as Tone }] : []),
      ],
    },
    {
      id: 'cogs',
      label: 'COGS (infrastructure)',
      thisWeek: -now.infra,
      lastWeek: -p.infra,
      ...dTone(now.infra, p.infra, false),
      series: seriesOf(s, (h) => -h.infra),
      drivers: [
        { label: 'Serving the customer base', value: -now.infra, tone: 'flat' },
        { label: `${sectorById(s.sector).name} infra per customer`, value: 0, tone: 'flat' },
      ],
    },
    {
      id: 'gross',
      label: 'Gross Profit',
      thisWeek: gross(now),
      lastWeek: gross(p),
      ...dTone(gross(now), gross(p), true),
      series: seriesOf(s, gross),
      drivers: [],
    },
    {
      id: 'margin',
      label: 'Gross Margin',
      sub: true,
      thisWeek: marginPP(now),
      lastWeek: marginPP(p),
      change: (marginPP(now) - marginPP(p)) / 100,
      tone: trendTone((marginPP(now) - marginPP(p)) / 100, true),
      series: seriesOf(s, marginPP),
      drivers: [],
    },
    {
      id: 'payroll',
      label: 'Payroll',
      thisWeek: -now.payroll,
      lastWeek: -p.payroll,
      ...dTone(now.payroll, p.payroll, false),
      series: seriesOf(s, (h) => -h.payroll),
      drivers: [
        ...(newStarts.length ? [{ label: `${newStarts.length} new ${newStarts.length === 1 ? 'hire' : 'hires'} started`, value: -newStarts.reduce((a, e) => a + e.salary / 52, 0), tone: 'bad' as Tone }] : []),
        { label: `${s.employees.length} on payroll`, value: -weeklyPayroll(s), tone: 'flat' },
        { label: 'Cost-of-living drift (inflation)', value: -(now.payroll - p.payroll - newStarts.reduce((a, e) => a + e.salary / 52, 0)), tone: 'flat' },
      ],
    },
    {
      id: 'growthspend',
      label: 'Growth Spend',
      thisWeek: -now.marketing,
      lastWeek: -p.marketing,
      ...dTone(now.marketing, p.marketing, false),
      series: seriesOf(s, (h) => -h.marketing),
      drivers: [
        { label: 'Performance (paid acquisition)', value: -now.marketing * perfShare, tone: 'flat' },
        ...(perfShare < 1 ? [{ label: 'Brand (matures in ~8 weeks)', value: -now.marketing * (1 - perfShare), tone: 'flat' as Tone }] : []),
      ],
    },
    {
      id: 'ga',
      label: 'Office & G&A',
      thisWeek: -now.office,
      lastWeek: -p.office,
      ...dTone(now.office, p.office, false),
      series: seriesOf(s, (h) => -h.office),
      drivers: [{ label: 'Desks for the non-remote team', value: -now.office, tone: 'flat' }],
    },
    ...(oneTime(now) > 0 || oneTime(p) > 0
      ? [
          {
            id: 'onetime',
            label: 'One-time & other',
            thisWeek: -oneTime(now),
            lastWeek: -oneTime(p),
            ...dTone(oneTime(now), oneTime(p), false),
            series: seriesOf(s, (h) => -oneTime(h)),
            drivers: [{ label: 'Severance, fees, events — the week’s non-recurring costs', value: -oneTime(now), tone: 'flat' as Tone }],
          },
        ]
      : []),
    {
      id: 'operating',
      label: 'Operating Profit',
      thisWeek: operating(now),
      lastWeek: operating(p),
      ...dTone(operating(now), operating(p), true),
      series: seriesOf(s, operating),
      drivers: [],
    },
    {
      id: 'interest',
      label: 'Other / Interest',
      thisWeek: -(now.interest ?? 0),
      lastWeek: -(p.interest ?? 0),
      ...dTone(now.interest ?? 0, p.interest ?? 0, false),
      series: seriesOf(s, (h) => -(h.interest ?? 0)),
      drivers: s.debt
        ? [{ label: 'Interest on the outstanding debt', value: -(now.interest ?? 0), tone: 'bad' }]
        : [{ label: 'No debt on the books', value: 0, tone: 'good' }],
    },
    {
      id: 'net',
      label: 'Net Income',
      thisWeek: net(now),
      lastWeek: net(p),
      ...dTone(net(now), net(p), true),
      series: seriesOf(s, net),
      drivers: [
        { label: 'Revenue', value: now.revenue, tone: now.revenue >= p.revenue ? 'good' : 'bad' },
        { label: 'Total costs', value: -now.expenses, tone: now.expenses <= p.expenses ? 'good' : 'bad' },
      ],
    },
  ]
  return rows
}

/** The CEO-finance brief (§10F) — a handful of lines that read the same rows the table shows. */
export function pnlTakeaways(s: GameState): { text: string; tone: Tone }[] {
  const now = last(s)
  const prev = last(s, 1)
  const old = last(s, 4)
  if (!now || !prev) return []
  const out: { text: string; tone: Tone }[] = []
  const revChange = pctChange(now.revenue, prev.revenue)
  const revChangeOld = old ? pctChange(prev.revenue, old.revenue) : 0
  if (revChange > 0.03 && revChange > revChangeOld) out.push({ text: 'Revenue growth is accelerating.', tone: 'good' })
  else if (revChange > 0.03) out.push({ text: 'Revenue is growing.', tone: 'good' })
  else if (revChange < -0.03) out.push({ text: 'Revenue fell this week.', tone: 'bad' })
  if (pctChange(now.marketing, prev.marketing) > 0.1) out.push({ text: `Growth spend is up ${Math.round(pctChange(now.marketing, prev.marketing) * 100)}% vs last week.`, tone: 'flat' })
  if (now.payroll > prev.payroll * 1.05) out.push({ text: 'Payroll increased — new hires landed.', tone: 'flat' })
  const netNow = now.revenue - now.expenses
  const netPrev = prev.revenue - prev.expenses
  if (netNow < 0 && netNow < netPrev) out.push({ text: `Operating loss widened by ${Math.round(pctChange(-netNow, -netPrev) * 100)}%.`, tone: 'bad' })
  else if (netNow < 0 && netNow > netPrev) out.push({ text: 'The loss narrowed — the machine is getting cheaper.', tone: 'good' })
  else if (netNow >= 0 && netPrev < 0) out.push({ text: 'The company crossed into profit this week.', tone: 'good' })
  return out.slice(0, 4)
}

// ---------- unit economics ------------------------------------------------------------------

export interface UnitCard {
  id: string
  label: string
  value: string
  changePct: number
  tone: Tone
  series: number[]
  drivers: Driver[]
  note?: string
}

export function unitCards(s: GameState): UnitCard[] {
  const ue = unitEconomics(s)
  const now = last(s)
  const prev = last(s, 4)
  const fh = s.finHistory ?? []
  const fPrev = fh.length >= 5 ? fh[fh.length - 5] : fh[0]
  const fNow = fh[fh.length - 1]
  const money = (n: number) => (Number.isFinite(n) ? `$${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n)}` : '—')
  const margin = now && now.revenue > 0 ? ((now.revenue - now.infra) / now.revenue) * 100 : 0
  const marginPrev = prev && prev.revenue > 0 ? ((prev.revenue - prev.infra) / prev.revenue) * 100 : margin
  const arpu = now && now.users > 0 ? now.revenue / now.users : 0
  const infraPer = sectorById(s.sector).infraCost
  const contribution = Math.max(0, arpu - infraPer)
  const cacChange = fNow && fPrev && fPrev.cac > 0 && fNow.cac > 0 ? pctChange(fNow.cac, fPrev.cac) : 0
  const ltvChange = fNow && fPrev && fPrev.ltv > 0 ? pctChange(fNow.ltv, fPrev.ltv) : 0
  const perfShare = s.growth?.performanceShare ?? 1

  return [
    {
      id: 'cac',
      label: 'CAC',
      value: money(ue.cac),
      changePct: cacChange,
      tone: trendTone(cacChange, false),
      series: fh.map((x) => (x.cac > 0 ? x.cac : 0)),
      drivers: [
        { label: 'Paid acquisition at the current budget', value: 0, tone: 'flat' },
        ...((s.growth?.brand.stock ?? 0) > 8 ? [{ label: 'Brand relief on paid cost', value: 0, tone: 'good' as Tone }] : []),
        ...(perfShare < 1 ? [{ label: 'Part of the budget builds brand, not customers-now', value: 0, tone: 'flat' as Tone }] : []),
      ],
      note: 'What the last $1,000 of spend actually bought, measured on the live engine.',
    },
    {
      id: 'ltv',
      label: 'LTV',
      value: money(ue.ltv),
      changePct: ltvChange,
      tone: trendTone(ltvChange, true),
      series: fh.map((x) => x.ltv),
      drivers: [
        { label: 'Revenue per customer per week', value: arpu, tone: 'flat' },
        { label: 'How long a settled customer stays', value: 0, tone: 'flat' },
      ],
      note: 'Real revenue per customer, discounted by your settled cohorts’ measured keep rate.',
    },
    {
      id: 'ratio',
      label: 'LTV / CAC',
      value: Number.isFinite(ue.ratio) && ue.ratio > 0 ? `${ue.ratio >= 100 ? '99+' : ue.ratio.toFixed(1)}x` : '—',
      changePct: ltvChange - cacChange,
      tone: ue.ratio >= 3 ? 'good' : ue.ratio >= 1 ? 'flat' : 'bad',
      series: fh.map((x) => (x.cac > 0 ? x.ltv / x.cac : 0)),
      drivers: [],
      note: ue.ratio >= 3 ? 'Healthy — every marketing dollar multiplies.' : ue.ratio >= 1 ? 'Workable, not yet compounding. 3x is the bar.' : 'Every dollar spent buys less than it returns — fix retention before scaling spend.',
    },
    {
      id: 'margin',
      label: 'Gross Margin',
      value: `${margin.toFixed(1)}%`,
      changePct: (margin - marginPrev) / 100,
      tone: trendTone((margin - marginPrev) / 100, true),
      series: seriesOf(s, (h) => (h.revenue > 0 ? ((h.revenue - h.infra) / h.revenue) * 100 : 0)),
      drivers: [
        { label: 'Revenue', value: now?.revenue ?? 0, tone: 'flat' },
        { label: 'Infrastructure to serve it', value: -(now?.infra ?? 0), tone: 'flat' },
      ],
    },
    {
      id: 'payback',
      label: 'Payback',
      value: Number.isFinite(ue.paybackWeeks) ? `${Math.ceil(ue.paybackWeeks)} wk` : '—',
      changePct: 0,
      tone: !Number.isFinite(ue.paybackWeeks) ? 'flat' : ue.paybackWeeks <= 12 ? 'good' : ue.paybackWeeks <= 30 ? 'flat' : 'bad',
      series: [],
      drivers: [
        { label: 'CAC to recover', value: Number.isFinite(ue.cac) ? -ue.cac : 0, tone: 'flat' },
        { label: 'Weekly value per customer', value: contribution, tone: 'flat' },
      ],
      note: 'Weeks before a bought customer has paid for themselves.',
    },
    {
      id: 'contribution',
      label: 'Contribution / customer',
      value: money(contribution),
      changePct: 0,
      tone: contribution > 0 ? 'good' : 'bad',
      series: seriesOf(s, (h) => (h.users > 0 ? Math.max(0, h.revenue / h.users - infraPer) : 0)),
      drivers: [],
      note: 'What each customer contributes weekly after the cost of serving them.',
    },
  ]
}

export function unitInsights(s: GameState): { text: string; tone: Tone }[] {
  const cards = unitCards(s)
  const out: { text: string; tone: Tone }[] = []
  const cac = cards.find((c) => c.id === 'cac')
  const ratio = cards.find((c) => c.id === 'ratio')
  if (cac && cac.changePct > 0.05) out.push({ text: 'CAC is rising — the current channel is saturating at this spend.', tone: 'bad' })
  if (cac && cac.changePct < -0.05) out.push({ text: 'CAC is falling — brand and fit are doing quiet work.', tone: 'good' })
  if (ratio) out.push({ text: ratio.note!, tone: ratio.tone })
  const pb = cards.find((c) => c.id === 'payback')
  if (pb && pb.tone === 'good') out.push({ text: 'Payback is inside the ideal range.', tone: 'good' })
  if (pb && pb.tone === 'bad') out.push({ text: 'Payback is too slow to scale spend safely.', tone: 'bad' })
  return out.slice(0, 4)
}

// ---------- cap table -----------------------------------------------------------------------

/** Presentation fiction, derived from truth: 10M shares, split by real equity fractions. */
export const TOTAL_SHARES = 10_000_000

export interface CapHolder {
  name: string
  kind: 'founder' | 'round' | 'legacy'
  equity: number
  shares: number
  detail?: string
}

export function capTable(s: GameState): CapHolder[] {
  const rounds = s.rounds ?? []
  const holders: CapHolder[] = [
    { name: 'You (Founder & CEO)', kind: 'founder', equity: s.founderEquity, shares: Math.round(s.founderEquity * TOTAL_SHARES) },
  ]
  // Rounds as issued, diluted forward to TODAY: a round that took e of the company then was
  // itself diluted by every later round — chain the (1 − e_later) factors so the columns sum.
  for (let i = 0; i < rounds.length; i++) {
    let eq = rounds[i].equity
    for (let j = i + 1; j < rounds.length; j++) eq *= 1 - rounds[j].equity
    holders.push({
      name: rounds[i].investor,
      kind: 'round',
      equity: eq,
      shares: Math.round(eq * TOTAL_SHARES),
      detail: `${rounds[i].stage} · wk ${rounds[i].week} · $${(rounds[i].amount / 1e6).toFixed(1)}M`,
    })
  }
  const explained = holders.reduce((a, h) => a + h.equity, 0)
  if (explained < 0.995) {
    holders.push({
      name: 'Earlier investors',
      kind: 'legacy',
      equity: 1 - explained,
      shares: Math.round((1 - explained) * TOTAL_SHARES),
      detail: 'rounds closed before the register existed',
    })
  }
  return holders
}

export interface DilutionOutlook {
  nextStage: Stage | null
  threshold: number
  currentValuation: number
  /** projected equity a typical next round takes (the engine's own 15-25% band, midpoint) */
  projectedEquity: number
  founderAfter: number
}

export function dilutionOutlook(s: GameState): DilutionOutlook {
  const idx = STAGES.indexOf(s.stage)
  const nextStage = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null
  const projectedEquity = 0.2
  return {
    nextStage,
    threshold: nextStage ? STAGE_THRESHOLDS[s.stage] : 0,
    currentValuation: valuation(s),
    projectedEquity,
    founderAfter: s.founderEquity * (1 - projectedEquity),
  }
}
