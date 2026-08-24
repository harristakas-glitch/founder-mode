// V2 weekly resolution — phase 1 of the pipeline (spec §30 steps 04, 08-16, 18-19, 28-35).
// Called from advanceWeekInner ONLY when the run's V2 gate is on; it REPLACES the V1 customer/
// PMF/revenue core and nothing else — cash flow, payroll, events, board, valuation stay the
// engine's. Each step is small and pure-ish over the v2 slice; every random draw comes from
// the caller's seeded rng (the unseeded global RNG is banned and tested). GTM capacity,
// planning and confidence deepen in phases 2-3 — the shapes are already here.

import type { Rival } from '../types'
import type { BusinessSimulationV2State, CustomerCohortV2, SimulationEvent, SimV2Snapshot } from './types'
import { attrRecord, choiceShares, effectiveWtp, priceFit, productFit, weeklyDemand, type OfferInput } from './economics'
import { marketTemplate } from './config/markets'
import { rankEvents } from './rank'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/** Stable tiny hash for competitor personality — keyed on the rival's NAME (seeded, stable
 *  across replays), never their uid (which is deliberately non-deterministic identity). */
const hash01 = (s: string, salt = 0): number => {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (((h + salt * 2654435761) >>> 8) % 10_000) / 10_000
}

export interface V2WeekInputs {
  week: number
  sector: string
  /** engineering output AFTER draws and velocity — the week's real build power */
  engPointsP: number
  /** allocation shares 0..1 */
  af: number
  aq: number
  ab: number
  bugs: number
  brandStock: number
  perfSpend: number
  /** $/week the player charges (derived from the pricing strategy until the dial ships) */
  price: number
  infraCostPerUser: number
  macroFactor: number
  rivals: Rival[]
  /** V1 strategic multipliers that V2 folds ONCE (contract D4) */
  churnRelief: number
  acquisitionEff: number
  rng: () => number
}

export interface V2WeekResult {
  customers: number
  revenue: number
  cogs: number
  /** the single-number read legacy consumers still need (UI gates, valuation terms) */
  displayedPmf: number
  /** the ranked, player-visible consequences of the week */
  visibleEvents: SimulationEvent[]
}

export function resolveWeekV2(v2: BusinessSimulationV2State, inp: V2WeekInputs): V2WeekResult {
  const tpl = marketTemplate(inp.sector)
  const events: SimulationEvent[] = []
  const prevSnap = v2.weeklyHistory[v2.weeklyHistory.length - 1]
  const eid = (type: string) => `v2_${inp.week}_${type}`

  // ---- 04: product attributes move from the week's real work --------------------------------
  for (const a of v2.attributes) {
    const headroom = Math.max(0, 1 - a.value / a.technicalCeiling)
    let gain = 0
    if (a.id === 'core') gain = inp.engPointsP * inp.af * 0.11
    if (a.id === 'ease') gain = inp.engPointsP * inp.aq * 0.05
    if (a.id === 'reliability') gain = inp.engPointsP * (inp.aq * 0.05 + inp.ab * 0.06) - inp.bugs * 0.012
    if (a.id === 'performance') gain = inp.engPointsP * inp.ab * 0.035
    if (a.id === 'content') gain = inp.engPointsP * inp.af * 0.04
    if (a.id === 'network') gain = 0 // network value accrues from customers below, not from code
    a.value = clamp(a.value + gain * headroom - a.decayRate, 0, a.technicalCeiling)
  }
  // network value is the installed base speaking (social archetypes only)
  const netAttr = v2.attributes.find((a) => a.id === 'network')
  if (netAttr) {
    const base = v2.cohorts.reduce((x, c) => x + c.size, 0)
    netAttr.value = clamp(Math.max(netAttr.value, 100 * (base / (base + 400_000))), 0, netAttr.technicalCeiling)
  }

  // ---- 08-09: competitors participate in the SAME market (spec §21.3) -----------------------
  v2.competitors = inp.rivals
    .filter((r) => r.alive && !r.acquired)
    .map((r) => {
      // V2 identity is the seeded NAME (slugged) — rival uids are deliberately non-deterministic
      // and would break replay/determinism if stored; UI maps back to rivals by name.
      const key = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      const prev = v2.competitors.find((c) => c.id === key)
      const posture = hash01(r.name)
      const attributes: Record<string, number> = {}
      for (const a of v2.attributes) {
        // a rival's product level spreads around their single product score, stably per attribute
        attributes[a.id] = clamp(r.product * (0.75 + 0.5 * hash01(r.name + a.id)), 5, 95)
      }
      const price = inp.price * (0.75 + 0.6 * posture)
      const brand = clamp(15 + 70 * (r.users / (r.users + 80_000)), 0, 100)
      const segmentFocus: Record<string, number> = {}
      for (const seg of v2.segments) {
        // each rival genuinely courts 1-2 segments; others get scraps
        segmentFocus[seg.id] = hash01(r.name + seg.id, 7) > 0.55 ? 1 : 0.25
      }
      const c = { id: key, name: r.name, price, attributes, brand, segmentFocus, lastShare: prev?.lastShare ?? {} }
      // a material competitor price move is an EVENT (they cut, the market noticed)
      if (prev && Math.abs(price - prev.price) / Math.max(1, prev.price) > 0.12) {
        events.push({
          id: eid(`competitor_price_${key}`),
          week: inp.week,
          category: 'competitor',
          type: 'competitor_price_change',
          magnitude: clamp01(Math.abs(price - prev.price) / Math.max(1, prev.price)),
          urgency: 0.6,
          strategicRelevance: 0.7,
          entityIds: [key],
          facts: { competitor: r.name, oldPrice: Math.round(prev.price), newPrice: Math.round(price) },
          visibility: 'signal',
          eligibleForMajorMoment: true,
        })
      }
      return c
    })

  // ---- 10-16, 18-19: fit → choice → demand → acquisition → cohorts → revenue ----------------
  const attrs = attrRecord(v2.attributes)
  const totalCustomersBySegment: Record<string, number> = {}
  for (const c of v2.cohorts) totalCustomersBySegment[c.segmentId] = (totalCustomersBySegment[c.segmentId] ?? 0) + c.size

  let newCustomersTotal = 0
  let churnedTotal = 0
  const fitBySegment: Record<string, number> = {}
  const shareBySegment: Record<string, number> = {}

  for (const seg of v2.segments) {
    const fit = productFit(attrs, seg.attributePreferences)
    fitBySegment[seg.id] = fit
    const wtp = effectiveWtp(seg, fit, inp.brandStock)
    const served = totalCustomersBySegment[seg.id] ?? 0
    const installedShare = clamp01(served / Math.max(1, seg.potentialCustomers * 0.2))

    const offers: OfferInput[] = [
      { id: 'player', fit, priceFitV: priceFit(inp.price, wtp, seg.priceSensitivity), brand: inp.brandStock, installedShare },
      ...v2.competitors.map((c) => ({
        id: c.id,
        fit: productFit(c.attributes, seg.attributePreferences) * (0.6 + 0.4 * c.segmentFocus[seg.id]),
        priceFitV: priceFit(c.price, effectiveWtp(seg, 0.6, c.brand), seg.priceSensitivity),
        brand: c.brand,
        installedShare: clamp01((c.lastShare[seg.id] ?? 0) * 0.5),
      })),
    ]
    const shares = choiceShares(seg, offers, tpl.choiceTemperature)
    shareBySegment[seg.id] = shares.player ?? 0
    for (const c of v2.competitors) c.lastShare[seg.id] = shares[c.id] ?? 0

    // demand → realized (phase-1 GTM approximation: paid reach; real channels land in phase 2)
    const demand = weeklyDemand(seg, inp.week, inp.macroFactor)
    const reach = clamp01(0.18 + inp.perfSpend / (inp.perfSpend + 6_000)) * inp.acquisitionEff
    const noise = 0.9 + 0.2 * inp.rng()
    const won = Math.max(0, demand * (shares.player ?? 0) * reach * noise)
    if (won >= 0.5) {
      v2.cohorts.push({
        id: `${seg.id}_${inp.week}`,
        segmentId: seg.id,
        acquiredWeek: inp.week,
        size: won,
        priceAtAcquisition: inp.price,
        fitAtAcquisition: fit,
      })
      newCustomersTotal += won
    }
  }

  // retention: every cohort keeps by its segment's truth, bent by how the product fits TODAY —
  // and V1's roadmap churnRelief folds in HERE, once (contract D4)
  const nextCohorts: CustomerCohortV2[] = []
  for (const c of v2.cohorts) {
    const seg = v2.segments.find((x) => x.id === c.segmentId)
    if (!seg) continue
    const fitNow = fitBySegment[c.segmentId] ?? 0.5
    const keepBase = clamp(seg.retentionBaseline + 0.03 * (fitNow - 0.6), 0.85, 0.998)
    // churnRelief is V1's ≤1 churn multiplier (retention roadmap work) — folded exactly once:
    // the part of the cohort that would leave, leaves churnRelief as often
    const kept = c.size * clamp(1 - (1 - keepBase) * inp.churnRelief, 0.85, 0.999)
    churnedTotal += c.size - kept
    if (kept >= 0.5) nextCohorts.push({ ...c, size: kept })
  }
  v2.cohorts = nextCohorts.slice(-520) // a decade of weekly cohorts is plenty

  // ---- 18-19: revenue truth --------------------------------------------------------------
  const customers = v2.cohorts.reduce((x, c) => x + c.size, 0)
  const revenue = v2.cohorts.reduce((x, c) => {
    const seg = v2.segments.find((sg) => sg.id === c.segmentId)
    if (!seg) return x
    // customers pay the price, but a segment priced far over its head quietly downgrades/laps
    const collect = 0.75 + 0.25 * priceFit(inp.price, effectiveWtp(seg, fitBySegment[c.segmentId] ?? 0.5, inp.brandStock), seg.priceSensitivity)
    return x + c.size * inp.price * collect
  }, 0)
  const cogs = customers * inp.infraCostPerUser
  v2.finance = { revenue, cogs, opex: 0, netIncome: 0 }

  // ---- events for the week's real movements ------------------------------------------------
  // the heartbeat: a real revenue move or a customer-base crossing speaks even in a quiet week
  if (prevSnap && prevSnap.revenue > 50) {
    const dRev = (revenue - prevSnap.revenue) / prevSnap.revenue
    if (Math.abs(dRev) >= 0.05) {
      events.push({
        id: eid('revenue_moved'),
        week: inp.week,
        category: 'finance',
        type: dRev > 0 ? 'revenue_up' : 'revenue_down',
        magnitude: clamp01(Math.abs(dRev) * 3),
        urgency: dRev > 0 ? 0.25 : 0.5,
        strategicRelevance: 0.5,
        facts: { pct: Math.round(dRev * 100), revenue: Math.round(revenue) },
        visibility: 'known',
      })
    }
  }
  for (const bar of [10, 100, 1_000, 10_000, 100_000]) {
    if ((prevSnap?.customers ?? 0) < bar && customers >= bar) {
      events.push({
        id: eid(`customers_${bar}`),
        week: inp.week,
        category: 'customer',
        type: 'customer_base_crossed',
        magnitude: 0.5 + Math.log10(bar) * 0.08,
        urgency: 0.2,
        strategicRelevance: 0.6,
        facts: { count: bar },
        visibility: 'known',
      })
    }
  }
  for (const seg of v2.segments) {
    const prevShare = prevSnap?.choiceShare[seg.id] ?? 0
    const d = (shareBySegment[seg.id] ?? 0) - prevShare
    if (Math.abs(d) > 0.025 && prevSnap) {
      events.push({
        id: eid(`share_${seg.id}`),
        week: inp.week,
        category: 'market',
        type: d > 0 ? 'segment_share_gain' : 'segment_share_loss',
        magnitude: clamp01(Math.abs(d) * 8),
        urgency: d > 0 ? 0.3 : 0.55,
        strategicRelevance: 0.6,
        entityIds: [seg.id],
        facts: { segment: seg.name, sharePct: Math.round((shareBySegment[seg.id] ?? 0) * 100), deltaPct: Math.round(d * 100) },
        visibility: 'known',
      })
    }
    const prevFit = prevSnap?.productFit[seg.id] ?? 0
    for (const bar of [0.5, 0.65, 0.8]) {
      if (prevFit < bar && (fitBySegment[seg.id] ?? 0) >= bar) {
        events.push({
          id: eid(`fit_${seg.id}_${bar}`),
          week: inp.week,
          category: 'product',
          type: 'fit_threshold_crossed',
          magnitude: 0.4 + bar * 0.4,
          urgency: 0.3,
          strategicRelevance: 0.7,
          entityIds: [seg.id],
          facts: { segment: seg.name, level: bar === 0.5 ? 'Competitive' : bar === 0.65 ? 'Strong' : 'Best-in-class' },
          visibility: 'known',
        })
      }
    }
  }

  // ---- 28-35: explanations, ranking, snapshot ---------------------------------------------
  const weightedFit =
    v2.segments.reduce((x, sg) => x + (fitBySegment[sg.id] ?? 0) * (totalCustomersBySegment[sg.id] ?? 1), 0) /
    Math.max(1, v2.segments.reduce((x, sg) => x + (totalCustomersBySegment[sg.id] ?? 1), 0))
  const retentionQuality = customers > 0 ? clamp01(1 - churnedTotal / Math.max(1, customers + churnedTotal) / 0.06) : 0.3
  const displayedPmf = clamp(100 * (0.55 * weightedFit + 0.45 * retentionQuality), 0, 100)

  v2.explanations = [
    {
      id: `rev_${inp.week}`,
      metricId: 'revenue',
      value: revenue,
      previousValue: prevSnap?.revenue,
      direction: !prevSnap || revenue >= prevSnap.revenue ? 'improving' : 'worsening',
      drivers: [
        { id: 'new', label: `${Math.round(newCustomersTotal)} new customers won`, impact: newCustomersTotal * inp.price, sourceSystem: 'market', sentiment: 'positive' },
        { id: 'churn', label: `${Math.round(churnedTotal)} customers churned`, impact: -churnedTotal * inp.price, sourceSystem: 'customer', sentiment: 'negative' },
      ],
    },
  ]
  v2.events = events

  const snap: SimV2Snapshot = {
    week: inp.week,
    customers: Math.round(customers),
    revenue: Math.round(revenue),
    netIncome: 0, // engine fills after expenses resolve
    cash: 0,
    price: inp.price,
    choiceShare: shareBySegment,
    productFit: fitBySegment,
    attributes: attrs,
    brand: inp.brandStock,
    boardConfidence: v2.boardConfidence.value,
    investorConfidence: v2.investorConfidence.value,
    eventIds: events.filter((e) => e.visibility === 'known').map((e) => e.id),
  }
  v2.weeklyHistory.push(snap)
  if (v2.weeklyHistory.length > 420) v2.weeklyHistory.shift()

  const visibleEvents = rankEvents(v2, inp.week)
  for (const e of visibleEvents) v2.lastSeen[e.type] = inp.week

  return { customers: Math.round(customers), revenue: Math.round(revenue), cogs, displayedPmf, visibleEvents }
}
