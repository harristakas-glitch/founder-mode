// V2 close-out — chapter objectives (spec §0A.9, engagement §4). Two or three per era, every
// one evaluated off REAL snapshots, progress 0..1, multiple strategies allowed, never a quest
// checklist. Pure derivation at read time — nothing is stored, so the objectives can never
// drift from the state they describe.

import type { BusinessSimulationV2State } from './types'

export interface ObjectiveView {
  id: string
  text: string
  /** 0..1 */
  progress: number
  done: boolean
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function objectivesFor(v2: BusinessSimulationV2State): ObjectiveView[] {
  const hist = v2.weeklyHistory
  const now = hist[hist.length - 1]
  if (!now) return []
  const bestFit = Math.max(0, ...Object.values(now.productFit))
  const bestShare = Math.max(0, ...Object.values(now.choiceShare))
  const g4 = hist.length >= 5 ? Math.pow(Math.max(1, now.revenue) / Math.max(1, hist[hist.length - 5].revenue), 1 / 4) - 1 : 0
  const bestWtpConf = Math.max(0, ...v2.segments.map((s) => s.knowledge.wtp.confidence))
  const out: ObjectiveView[] = []
  const add = (id: string, text: string, progress: number) => out.push({ id, text, progress: clamp01(progress), done: progress >= 1 })

  switch (v2.chapter) {
    case 'searching_for_fit':
      add('fit', 'Get a segment rating the product Strong (fit 0.55+)', bestFit / 0.55)
      add('customers', 'Win 200 real customers', now.customers / 200)
      add('knowledge', 'Know what somebody would pay (WTP confidence to Medium)', bestWtpConf / 0.45)
      break
    case 'early_traction':
      add('scale', 'Reach 1,000 customers', now.customers / 1_000)
      add('repeat', 'Sustain 2%+ weekly revenue growth over a month', g4 / 0.02)
      add('serve', 'Keep service quality above 60 while growing', now.serviceQuality / 60)
      break
    case 'scaling':
      add('share', 'Take 18% preference share in a segment', bestShare / 0.18)
      add('economics', 'Hold CAC under 20 weeks of customer revenue', now.cac > 0 && now.customers > 0 ? clamp01((20 * (now.revenue / now.customers)) / now.cac) : 0)
      add('promise', 'Deliver the live board commitment', v2.planning.commitments.some((c) => c.status === 'delivered') ? 1 : v2.planning.commitments.some((c) => c.status === 'on_track') ? 0.5 : 0)
      break
    case 'category_fight':
      add('lead', 'Out-share every rival in two segments', bestShare / 0.35)
      add('profit', 'Reach a profitable week at scale', now.netIncome > 0 ? 1 : clamp01(1 + now.netIncome / Math.max(1, now.revenue)))
      break
    case 'market_leader':
      add('hold', 'Hold the lead — 35%+ share', bestShare / 0.35)
      add('compound', 'Keep the machine compounding (2%+ weekly)', g4 / 0.02)
      break
  }
  return out
}
