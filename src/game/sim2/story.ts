// V2 phase 6 — the run becomes a STORY (engagement roadmap §3-4, §14-15; spec §0A.8/15/19).
// Milestones are state TRANSITIONS that fire exactly once and persist. Chapters are eras the
// company actually earns — never a week counter. Identity is derived from how the run was
// really played; the player discovers what kind of company they built, they never pick a class.
// All pure reads over snapshots; the resolver calls, the engagement layer speaks.

import type { BusinessSimulationV2State, SimulationEvent, SimV2Snapshot } from './types'

// ---------- milestones (spec §0A.15) ---------------------------------------------------------

interface MilestoneRow {
  id: string
  reached: (prev: SimV2Snapshot | undefined, now: SimV2Snapshot) => boolean
  headline: (now: SimV2Snapshot, firstWeek: number) => string
  magnitude: number
}

const MILESTONES: MilestoneRow[] = [
  {
    id: 'first_customer',
    reached: (p, n) => (p?.customers ?? 0) < 1 && n.customers >= 1,
    headline: () => 'Your first customer. Somebody chose you over doing nothing.',
    magnitude: 0.7,
  },
  {
    id: 'customers_100',
    reached: (p, n) => (p?.customers ?? 0) < 100 && n.customers >= 100,
    headline: (n, f) => `100 customers, ${n.week - f} weeks in.`,
    magnitude: 0.6,
  },
  {
    id: 'customers_1000',
    reached: (p, n) => (p?.customers ?? 0) < 1_000 && n.customers >= 1_000,
    headline: (n, f) => `1,000 customers. ${n.week - f} weeks ago you had none.`,
    magnitude: 0.75,
  },
  {
    id: 'first_profitable_week',
    reached: (p, n) => (p?.netIncome ?? -1) < 0 && n.netIncome > 0,
    headline: () => 'The first week the company made more than it spent.',
    magnitude: 0.8,
  },
  {
    id: 'arr_1m',
    reached: (p, n) => (p?.revenue ?? 0) * 52 < 1_000_000 && n.revenue * 52 >= 1_000_000,
    headline: (n, f) => `$1M run-rate. ${n.week - f} weeks from zero.`,
    magnitude: 0.9,
  },
  {
    id: 'arr_10m',
    reached: (p, n) => (p?.revenue ?? 0) * 52 < 10_000_000 && n.revenue * 52 >= 10_000_000,
    headline: () => '$10M run-rate. This is a company now.',
    magnitude: 1,
  },
  {
    id: 'best_in_class_fit',
    reached: (p, n) =>
      Math.max(0, ...Object.values(p?.productFit ?? {})) < 0.8 && Math.max(0, ...Object.values(n.productFit)) >= 0.8,
    headline: () => 'A segment now rates the product best-in-class.',
    magnitude: 0.7,
  },
]

// ---------- chapters (spec §0A.8) — earned, ordered, monotonic -------------------------------

export const CHAPTER_META: Record<string, { name: string; entering: string }> = {
  searching_for_fit: { name: 'Searching for Fit', entering: 'Nobody knows if the market wants this. Finding out is the job.' },
  early_traction: { name: 'Early Traction', entering: 'Real customers, staying and paying. The question changes: can it repeat?' },
  scaling: { name: 'Scaling', entering: 'The machine repeats. Now the machine itself is the work.' },
  category_fight: { name: 'Category Fight', entering: 'The market noticed. Somebody has to lose this.' },
  market_leader: { name: 'Market Leader', entering: 'You set the reference price now. Everyone else positions against you.' },
}

const CHAPTER_ORDER = ['searching_for_fit', 'early_traction', 'scaling', 'category_fight', 'market_leader']

/** Multi-signal entry conditions (never elapsed weeks). Each requires the PREVIOUS chapter. */
function chapterReached(id: string, now: SimV2Snapshot, history: SimV2Snapshot[]): boolean {
  const bestFit = Math.max(0, ...Object.values(now.productFit))
  const bestShare = Math.max(0, ...Object.values(now.choiceShare))
  const g4 = history.length >= 5 ? Math.pow(Math.max(1, now.revenue) / Math.max(1, history[history.length - 5].revenue), 1 / 4) - 1 : 0
  switch (id) {
    case 'early_traction':
      return now.customers >= 200 && bestFit >= 0.55 && now.churnedCustomers <= now.customers * 0.05
    case 'scaling':
      return now.customers >= 1_000 && g4 > 0.02 && now.cac > 0 && now.revenue / Math.max(1, now.customers) > 0
    case 'category_fight':
      return now.customers >= 4_000 && bestShare >= 0.18
    case 'market_leader':
      return now.customers >= 15_000 && bestShare >= 0.35
    default:
      return true
  }
}

// ---------- emergent identity (spec §0A.19) --------------------------------------------------

export function companyIdentity(v2: BusinessSimulationV2State, aiMaturityAvg: number): string {
  const hist = v2.weeklyHistory
  if (hist.length < 8) return 'Too early to say'
  const now = hist[hist.length - 1]
  // capital posture: cumulative net vs revenue scale
  const cumNet = hist.slice(-26).reduce((a, s) => a + s.netIncome, 0)
  const capital = cumNet > 0 ? 'Capital-Efficient' : cumNet < -now.revenue * 10 ? 'High-Burn' : 'Lean'
  // who the customers actually are
  const served: Record<string, number> = {}
  for (const c of v2.cohorts) served[c.segmentId] = (served[c.segmentId] ?? 0) + c.size
  const top = Object.entries(served).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const topSeg = v2.segments.find((s) => s.id === top)
  const who = topSeg ? (topSeg.baseWtp >= 100 ? 'Enterprise' : topSeg.baseWtp >= 10 ? 'SMB' : 'Consumer') : ''
  // price posture vs the segment's nature
  const posture = topSeg && now.price > topSeg.baseWtp * 1.1 ? 'Premium' : topSeg && now.price < topSeg.baseWtp * 0.6 ? 'Value-Priced' : ''
  const ai = aiMaturityAvg >= 1.5 ? 'AI-Native' : ''
  const brandLed = now.brand >= 40 ? 'Brand-Led' : ''
  const engine = now.netIncome > 0 ? 'Operator' : (hist[hist.length - 1]?.newCustomers ?? 0) > 50 ? 'Rocketship' : 'Machine'
  return [capital, ai || brandLed, posture, who, engine].filter(Boolean).join(' ')
}

// ---------- the weekly pass (resolver steps 31-32) -------------------------------------------

export function tickStory(v2: BusinessSimulationV2State, week: number): { events: SimulationEvent[]; chapterChanged: string | null } {
  const events: SimulationEvent[] = []
  const hist = v2.weeklyHistory
  const now = hist[hist.length - 1]
  if (!now) return { events, chapterChanged: null }
  const prev = hist[hist.length - 2]
  const firstWeek = hist[0]?.week ?? week

  for (const m of MILESTONES) {
    if (v2.firedMilestones.includes(m.id)) continue
    if (m.reached(prev, now)) {
      v2.firedMilestones.push(m.id)
      events.push({
        id: `v2_${week}_milestone_${m.id}`,
        week,
        category: 'milestone',
        type: 'milestone_' + m.id,
        magnitude: m.magnitude,
        urgency: 0.2,
        strategicRelevance: 0.6,
        facts: { headline: m.headline(now, firstWeek) },
        visibility: 'known',
      })
    }
  }

  // chapters advance one at a time, forward only — an era is not un-lived
  const idx = CHAPTER_ORDER.indexOf(v2.chapter)
  const next = CHAPTER_ORDER[idx + 1]
  let chapterChanged: string | null = null
  if (next && chapterReached(next, now, hist)) {
    v2.chapter = next
    chapterChanged = next
    events.push({
      id: `v2_${week}_chapter_${next}`,
      week,
      category: 'milestone',
      type: 'chapter_entered',
      magnitude: 0.95,
      urgency: 0.3,
      strategicRelevance: 0.9,
      facts: { chapter: CHAPTER_META[next].name, line: CHAPTER_META[next].entering },
      visibility: 'known',
    })
  }
  return { events, chapterChanged }
}
