// V2 phase 3 — Forecast, Plan vs Actual, Commitments, and the TWO confidences (spec §15-17).
//
// Board Confidence is EXECUTION CREDIBILITY: did you do what you said, with discipline — it
// judges delivery against commitments and the honesty of your own forecasts, and it forgives
// what the macro broke (variance controllability, spec §0A.11). Investor Confidence is
// UPSIDE: growth, retention quality, fit momentum, the market's temperature. They move
// differently on purpose (spec §17.2): a revenue miss with improving enterprise retention can
// leave the board flat while investors warm. Deterministic, driver-logged, event-emitting.

import type { BusinessSimulationV2State, SimulationEvent, SimV2Snapshot } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface ConfidenceInputs {
  week: number
  revenue: number
  macroFactor: number
  runwayWeeks: number
  /** trailing measured weekly growth (revenue, 4w) */
  growth4w: number
  /** measured weekly churn rate 0..1 */
  churnRate: number
  /** best product-fit across segments */
  bestFit: number
  /** board growth target while a board exists (0 = no board yet) */
  boardTarget: number
}

const push = (v2: BusinessSimulationV2State, which: 'board' | 'investor', week: number, driverId: string, delta: number) => {
  const st = which === 'board' ? v2.boardConfidence : v2.investorConfidence
  st.value = clamp(st.value + delta, 0, 100)
  st.driverHistory.push({ week, driverId, delta })
  if (st.driverHistory.length > 60) st.driverHistory.shift()
}

export const confidenceWord = (v: number): string =>
  v >= 75 ? 'High' : v >= 55 ? 'Steady' : v >= 40 ? 'Wavering' : v >= 25 ? 'Low' : 'Critical'

/** The weekly confidence + planning pass (resolver steps 23-26). Mutates v2, returns events. */
export function tickConfidence(v2: BusinessSimulationV2State, inp: ConfidenceInputs): SimulationEvent[] {
  const events: SimulationEvent[] = []
  const eid = (t: string) => `v2_${inp.week}_${t}`
  const boardBefore = v2.boardConfidence.value
  const invBefore = v2.investorConfidence.value

  // ---- Plan vs Actual (spec §15.6): today's actual vs the projection made 4 weeks ago -------
  v2.planning.forecastLog ??= []
  const projection = v2.planning.forecastLog.find((f) => f.week === inp.week - 4)
  let planVariance = 0
  if (projection && projection.projectedRevenue > 100) {
    planVariance = (inp.revenue - projection.projectedRevenue) / projection.projectedRevenue
    // controllability (spec §0A.11): the part of the miss the macro moved is not yours
    const macroShift = Math.abs(inp.macroFactor - projection.macroAtForecast)
    const external = macroShift > 0.03
    if (planVariance < -0.25) {
      push(v2, 'board', inp.week, external ? 'miss_external' : 'miss_controllable', external ? -0.8 : -2)
      events.push({
        id: eid('plan_miss'),
        week: inp.week,
        category: 'board',
        type: 'plan_variance_miss',
        magnitude: clamp(-planVariance, 0, 1),
        urgency: 0.5,
        strategicRelevance: 0.6,
        facts: { variancePct: Math.round(planVariance * 100), controllable: !external },
        visibility: 'known',
      })
    } else if (Math.abs(planVariance) < 0.1) {
      push(v2, 'board', inp.week, 'forecast_accuracy', 0.4)
    }
  }
  // record this week's forward view (trailing-growth extrapolation — management's honest belief)
  v2.planning.forecastLog.push({
    week: inp.week,
    projectedRevenue: inp.revenue * Math.pow(1 + clamp(inp.growth4w, -0.2, 0.25), 4),
    macroAtForecast: inp.macroFactor,
  })
  if (v2.planning.forecastLog.length > 10) v2.planning.forecastLog.shift()

  // ---- commitments (spec §0A.10): due ones settle, and the settling is an EVENT -------------
  for (const c of v2.planning.commitments) {
    if (c.status !== 'on_track' && c.status !== 'at_risk') continue
    if (c.metricId === 'weekly_growth' && c.targetValue !== undefined) {
      if (inp.week >= c.dueWeek) {
        c.status = inp.growth4w >= c.targetValue ? 'delivered' : 'missed'
        const delta = c.status === 'delivered' ? 5 * c.importance : -7 * c.importance * (1 - 0.5 * c.ambition)
        push(v2, 'board', inp.week, `commitment_${c.status}`, delta)
        events.push({
          id: eid(`commitment_${c.id}`),
          week: inp.week,
          category: 'board',
          type: c.status === 'delivered' ? 'commitment_delivered' : 'commitment_missed',
          magnitude: 0.5 + 0.3 * c.importance,
          urgency: c.status === 'missed' ? 0.7 : 0.3,
          strategicRelevance: 0.8,
          facts: { targetPct: Math.round(c.targetValue * 100), actualPct: Math.round(inp.growth4w * 100) },
          visibility: 'known',
          eligibleForMajorMoment: c.status === 'missed',
        })
      } else if (inp.week >= c.dueWeek - 4 && inp.growth4w < c.targetValue * 0.6) {
        c.status = 'at_risk'
      }
    }
  }
  v2.planning.commitments = v2.planning.commitments.slice(-12)

  // ---- board confidence: discipline terms ---------------------------------------------------
  if (inp.runwayWeeks < 10) push(v2, 'board', inp.week, 'runway_discipline', -0.6)
  // slow reversion toward the middle — credibility is earned and forgiven gradually
  push(v2, 'board', inp.week, 'drift', (55 - v2.boardConfidence.value) * 0.01)

  // ---- investor confidence: upside terms ----------------------------------------------------
  if (inp.growth4w > 0.05) push(v2, 'investor', inp.week, 'growth', 1.2)
  else if (inp.growth4w > 0.02) push(v2, 'investor', inp.week, 'growth', 0.4)
  else if (inp.growth4w < 0) push(v2, 'investor', inp.week, 'growth', -0.9)
  if (inp.churnRate < 0.02) push(v2, 'investor', inp.week, 'retention_quality', 0.3)
  else if (inp.churnRate > 0.05) push(v2, 'investor', inp.week, 'retention_quality', -0.5)
  if (inp.bestFit >= 0.65) push(v2, 'investor', inp.week, 'fit_momentum', 0.25)
  push(v2, 'investor', inp.week, 'capital_environment', (inp.macroFactor - 0.97) * 4)
  push(v2, 'investor', inp.week, 'drift', (50 - v2.investorConfidence.value) * 0.008)

  // ---- shift events when a confidence has genuinely moved -----------------------------------
  const shifted = (before: number, now: number) => Math.abs(now - before) >= 4
  if (shifted(boardBefore, v2.boardConfidence.value)) {
    events.push({
      id: eid('board_shift'),
      week: inp.week,
      category: 'board',
      type: v2.boardConfidence.value > boardBefore ? 'board_confidence_up' : 'board_confidence_down',
      magnitude: clamp(Math.abs(v2.boardConfidence.value - boardBefore) / 10, 0, 1),
      urgency: v2.boardConfidence.value > boardBefore ? 0.3 : 0.6,
      strategicRelevance: 0.7,
      facts: { word: confidenceWord(v2.boardConfidence.value) },
      visibility: 'known',
    })
  }
  if (shifted(invBefore, v2.investorConfidence.value)) {
    events.push({
      id: eid('investor_shift'),
      week: inp.week,
      category: 'investor',
      type: v2.investorConfidence.value > invBefore ? 'investor_confidence_up' : 'investor_confidence_down',
      magnitude: clamp(Math.abs(v2.investorConfidence.value - invBefore) / 10, 0, 1),
      urgency: 0.35,
      strategicRelevance: 0.6,
      facts: { word: confidenceWord(v2.investorConfidence.value) },
      visibility: 'known',
    })
  }

  const snap = v2.weeklyHistory[v2.weeklyHistory.length - 1] as SimV2Snapshot | undefined
  if (snap && snap.week === inp.week) {
    snap.boardConfidence = v2.boardConfidence.value
    snap.investorConfidence = v2.investorConfidence.value
    snap.planVariance = planVariance
  }
  return events
}
