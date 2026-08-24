// V2 phase 7 — the end-of-run postmortem (spec §0A.16, engagement §16). The run itself is the
// story: everything here is DERIVED from the snapshots, the commitment record, the round
// register and the milestone log the run actually produced. No scripted narrative, no false
// causal certainty — turning points are named, mistakes are measured, and the one place the
// hidden TRUTH is finally shown is here, after the run is over, as the classic sim payoff:
// what the market would really have paid.

import type { GameState } from '../types'
import { CHAPTER_META } from './story'

export interface PostmortemData {
  identity: string
  /** the eras the company actually lived, in order, with the week each began */
  chapterPath: { name: string; week: number }[]
  /** weeks that changed the company, chronological */
  turningPoints: { week: number; text: string }[]
  /** measured, honest — never invented */
  mistakes: string[]
  /** end-of-run truth reveals (the fog lifts exactly once, here) */
  reveals: string[]
  promisesKept: number
  promisesMissed: number
}

const MILESTONE_TEXT: Record<string, string> = {
  first_customer: 'First customer',
  customers_100: '100 customers',
  customers_1000: '1,000 customers',
  first_profitable_week: 'First profitable week',
  arr_1m: '$1M run-rate',
  arr_10m: '$10M run-rate',
  best_in_class_fit: 'A segment rated the product best-in-class',
}

export function buildPostmortem(s: GameState, identity: string): PostmortemData | null {
  const v2 = s.simV2
  if (!v2 || v2.weeklyHistory.length < 4) return null
  const hist = v2.weeklyHistory

  // ---- chapter path + turning points from the persisted event ids --------------------------
  const chapterPath: { name: string; week: number }[] = [{ name: CHAPTER_META.searching_for_fit.name, week: hist[0].week }]
  const turningPoints: { week: number; text: string }[] = []
  for (const snap of hist) {
    for (const id of snap.eventIds) {
      const chapterM = id.match(/^v2_(\d+)_chapter_(.+)$/)
      if (chapterM) {
        const meta = CHAPTER_META[chapterM[2]]
        if (meta) {
          chapterPath.push({ name: meta.name, week: Number(chapterM[1]) })
          turningPoints.push({ week: Number(chapterM[1]), text: `Entered ${meta.name}` })
        }
      }
      const milestoneM = id.match(/^v2_(\d+)_milestone_(.+)$/)
      if (milestoneM && MILESTONE_TEXT[milestoneM[2]]) turningPoints.push({ week: Number(milestoneM[1]), text: MILESTONE_TEXT[milestoneM[2]] })
      const priceM = id.match(/^v2_(\d+)_competitor_price_(.+)$/)
      if (priceM) turningPoints.push({ week: Number(priceM[1]), text: 'A rival moved pricing against you' })
      if (/^v2_(\d+)_service_overload$/.test(id)) turningPoints.push({ week: snap.week, text: 'Service capacity crisis' })
    }
  }
  for (const r of s.rounds ?? []) turningPoints.push({ week: r.week, text: `${r.stage} closed — $${(r.amount / 1e6).toFixed(1)}M from ${r.investor}` })
  turningPoints.sort((a, b) => a.week - b.week)

  // ---- the promise record -------------------------------------------------------------------
  const promisesKept = v2.planning.commitments.filter((c) => c.status === 'delivered').length
  const promisesMissed = v2.planning.commitments.filter((c) => c.status === 'missed').length

  // ---- measured mistakes --------------------------------------------------------------------
  const mistakes: string[] = []
  const cacs = hist.map((h) => h.cac).filter((c) => c > 0)
  const medianCac = cacs.length ? [...cacs].sort((a, b) => a - b)[Math.floor(cacs.length / 2)] : 0
  const burnedWeeks = hist.filter((h) => h.paidSpend >= 8_000 && h.cac > medianCac * 2).length
  if (medianCac > 0 && burnedWeeks >= 6) mistakes.push(`Kept scaling paid spend into a saturated channel (${burnedWeeks} weeks at 2x+ your normal CAC).`)
  const drownedWeeks = hist.filter((h) => h.serviceQuality < 45).length
  if (drownedWeeks >= 5) mistakes.push(`Grew past the team's ability to serve — service quality sat below 45/100 for ${drownedWeeks} weeks, and churn did the rest.`)
  if (promisesMissed >= 2) mistakes.push(`Promised the board more than the machine could deliver — ${promisesMissed} commitments missed.`)
  const lowConfLate = v2.segments.every((seg) => seg.knowledge.wtp.confidence < 0.45) && hist.length > 40
  if (lowConfLate) mistakes.push('Never bought certainty — every pricing decision was made at LOW confidence, all run long.')

  // ---- the fog lifts: truth reveals (end-of-run only) ---------------------------------------
  const reveals: string[] = []
  const served: Record<string, number> = {}
  for (const c of v2.cohorts) served[c.segmentId] = (served[c.segmentId] ?? 0) + c.size
  const topId = Object.entries(served).sort((a, b) => b[1] - a[1])[0]?.[0]
  const top = v2.segments.find((x) => x.id === topId)
  if (top) {
    const avgPrice = hist.slice(-26).reduce((a, h) => a + h.price, 0) / Math.min(26, hist.length)
    const trueWtp = top.baseWtp
    if (avgPrice < trueWtp * 0.55) reveals.push(`${top.name} would have paid ~$${Math.round(trueWtp)}/wk. You charged $${Math.round(avgPrice)} — money left on the table, every week.`)
    if (avgPrice > trueWtp * 1.6) reveals.push(`${top.name}'s true willingness-to-pay was ~$${Math.round(trueWtp)}/wk. At $${Math.round(avgPrice)} you were taxing your own growth.`)
    reveals.push(`${top.name}'s real pool: ${Math.round(top.potentialCustomers).toLocaleString()} customers. You won ${Math.round(served[topId] ?? 0).toLocaleString()}.`)
  }

  return { identity, chapterPath, turningPoints: turningPoints.slice(0, 10), mistakes: mistakes.slice(0, 4), reveals: reveals.slice(0, 3), promisesKept, promisesMissed }
}
