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
import { tickConfidence } from './confidence'
import { tickResearch } from './research'
import { tickStory } from './story'

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
  /** the sales team's weekly effectiveness points (engine's eff() sum for sales role) */
  salesPoints: number
  /** the whole team's service-capable effort (everyone answers tickets at a startup) */
  servicePoints: number
  /** AI support leverage multiplier (≥1) — strategic/ai support maturity, folded once */
  aiSupportMult: number
  /** analytics capability (≥1): AI maturity sharpens research (spec §14.5) */
  analyticsMult: number
  founderKind: 'technical' | 'business'
  /** projected runway in weeks (engine's own read) and the live board growth target (0 = none) */
  runwayWeeks: number
  boardTarget: number
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
    if (a.id === 'core') gain = inp.engPointsP * inp.af * 0.18
    if (a.id === 'ease') gain = inp.engPointsP * inp.aq * 0.1
    if (a.id === 'reliability') gain = inp.engPointsP * (inp.aq * 0.09 + inp.ab * 0.1) - inp.bugs * 0.012
    if (a.id === 'performance') gain = inp.engPointsP * inp.ab * 0.06
    if (a.id === 'content') gain = inp.engPointsP * inp.af * 0.08
    // every attribute needs a SOURCE (first probe run: security/integrations/service only ever
    // decayed, so fintech and enterprise fits were permanently threshold-gated — nothing the
    // player did could move them). Quality work hardens and serves; feature work integrates.
    if (a.id === 'security') gain = inp.engPointsP * inp.aq * 0.05
    if (a.id === 'service') gain = inp.engPointsP * inp.aq * 0.035
    if (a.id === 'integrations') gain = inp.engPointsP * inp.af * 0.05
    if (a.id === 'network') gain = 0 // network value accrues from customers below, not from code
    a.value = clamp(a.value + gain * headroom - a.decayRate, 0, a.technicalCeiling)
  }
  // network value is the installed base speaking (social archetypes only)
  const netAttr = v2.attributes.find((a) => a.id === 'network')
  if (netAttr) {
    const base = v2.cohorts.reduce((x, c) => x + c.size, 0)
    netAttr.value = clamp(Math.max(netAttr.value, 100 * (base / (base + 400_000))), 0, netAttr.technicalCeiling)
  }

  // ---- 07: segment needs EVOLVE (spec §8.2) — slowly, deterministically, from state ---------
  // Adoption matures a hair every week (categories normalise); a sour macro makes every
  // segment a little more price-sensitive, a hot one relaxes them. Gradual, never a reshuffle.
  for (const seg of v2.segments) {
    seg.adoptionMaturity = clamp01(seg.adoptionMaturity + 0.0006)
    seg.priceSensitivity = clamp01(seg.priceSensitivity + (inp.macroFactor < 0.95 ? 0.0012 : inp.macroFactor > 1.02 ? -0.0006 : 0))
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
      // aggressive rivals run periodic discount campaigns (spec §21.2) — deterministic from the
      // seeded name, so replays agree; the cut is REAL in the same choice market, no script
      let discountUntil = prev?.discountUntil
      if (posture > 0.65 && inp.week > 12 && (inp.week + Math.floor(hash01(r.name, 3) * 34)) % 34 === 0) {
        discountUntil = inp.week + 6
      }
      const discounted = discountUntil !== undefined && inp.week < discountUntil
      const price = inp.price * (0.75 + 0.6 * posture) * (discounted ? 0.75 : 1)

      // RIVALS PLAY (engagement §7): deterministic strategic decisions per seeded name —
      // rounds raised (a funded rival outbids and outshouts you for a quarter), and feature
      // launches (permanent product jumps in the attributes they care about). All of it lands
      // in the SAME choice market — never a scripted share change.
      let fundedUntil = prev?.fundedUntil
      const launches: Record<string, number> = { ...(prev?.launches ?? {}) }
      if (inp.week > 16 && (inp.week + Math.floor(hash01(r.name, 11) * 52)) % 52 === 0) {
        fundedUntil = inp.week + 13
        events.push({
          id: eid(`competitor_raised_${key}`),
          week: inp.week,
          category: 'competitor',
          type: 'competitor_raised',
          magnitude: 0.6,
          urgency: 0.45,
          strategicRelevance: 0.7,
          entityIds: [key],
          facts: { competitor: r.name, amount: Math.round(4 + hash01(r.name, 13) * 20) },
          visibility: 'known',
        })
      }
      if (inp.week > 10 && (inp.week + Math.floor(hash01(r.name, 17) * 30)) % 30 === 0) {
        const attrIds = v2.attributes.map((a2) => a2.id)
        const target = attrIds[Math.floor(hash01(r.name + inp.week, 19) * attrIds.length)] ?? attrIds[0]
        launches[target] = Math.min(25, (launches[target] ?? 0) + 8)
        events.push({
          id: eid(`competitor_launch_${key}`),
          week: inp.week,
          category: 'competitor',
          type: 'competitor_launched',
          magnitude: 0.45,
          urgency: 0.35,
          strategicRelevance: 0.6,
          entityIds: [key],
          facts: { competitor: r.name, area: v2.attributes.find((a2) => a2.id === target)?.label ?? target },
          visibility: 'signal',
        })
      }
      const funded = fundedUntil !== undefined && inp.week < fundedUntil
      const attributes: Record<string, number> = {}
      for (const a of v2.attributes) {
        // a rival's product level spreads around their single product score, stably per
        // attribute — plus whatever they have permanently LAUNCHED on top
        attributes[a.id] = clamp(r.product * (0.75 + 0.5 * hash01(r.name + a.id)) + (launches[a.id] ?? 0), 5, 95)
      }
      const brand = clamp((15 + 70 * (r.users / (r.users + 80_000))) * (funded ? 1.25 : 1), 0, 100)
      const segmentFocus: Record<string, number> = {}
      for (const seg of v2.segments) {
        // each rival genuinely courts 1-2 segments; others get scraps
        segmentFocus[seg.id] = hash01(r.name + seg.id, 7) > 0.55 ? 1 : 0.25
      }
      const c = { id: key, name: r.name, price, attributes, brand, segmentFocus, lastShare: prev?.lastShare ?? {}, discountUntil, fundedUntil, launches }
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

  // ---- 13: GTM reach, saturation and sales capacity (spec §18) ------------------------------
  // The paid channel REMEMBERS: sustained heavy spend saturates (EMA), and the next dollar buys
  // less. Brand and the installed base open organic doors paid money cannot.
  v2.gtm ??= { paidSaturationEma: 0, lastCac: 0 }
  v2.intel ??= {}
  v2.positioning ??= { targetSegmentId: null }
  v2.gtm.paidSaturationEma = v2.gtm.paidSaturationEma * 0.85 + inp.perfSpend * 0.15
  const saturation = v2.gtm.paidSaturationEma / (v2.gtm.paidSaturationEma + 25_000)
  // LEVER SWEEP (2026-08-25): after marketingMax learned to respect runway, pegging the
  // slider at its cap dominated informed spend 2.5-4x — safe max spending bought linear
  // reach. Channels drown: past ~$80k/wk each extra dollar buys visibly less.
  const effectiveSpend = (inp.perfSpend * (1 - 0.45 * saturation)) / (1 + inp.perfSpend / 80_000)
  // human selling is a capacity, not a multiplier (spec §18.6): deals a week, founder included —
  // a business founder carries real early sales; a technical founder carries a little
  let salesCapacity = inp.salesPoints * 0.5 + (inp.founderKind === 'business' ? 1.5 : 0.4)

  // ---- 10-16, 18-19: fit → choice → demand → acquisition → cohorts → revenue ----------------
  const attrs = attrRecord(v2.attributes)
  const totalCustomersBySegment: Record<string, number> = {}
  for (const c of v2.cohorts) totalCustomersBySegment[c.segmentId] = (totalCustomersBySegment[c.segmentId] ?? 0) + c.size

  let newCustomersTotal = 0
  let churnedTotal = 0
  const salesConstrained: { seg: string; pipeline: number; capacity: number }[] = []
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

    // demand → realized: reach is per-CHANNEL and per-segment (spec §18) — paid money reaches
    // paid-reachable people, brand and the installed base pull organically, and sales-led
    // segments are additionally capped by human selling capacity
    const demand = weeklyDemand(seg, inp.week, inp.macroFactor)
    const paidAccess = seg.paidAccessibility ?? 0.7
    // competitor auction pressure (spec §18.5): every live rival bids for the same attention,
    // and a rival mid-discount-campaign bids hardest — your dollar buys less in a crowded auction
    const auction =
      1 +
      0.12 * v2.competitors.length +
      0.25 * v2.competitors.filter((c) => c.discountUntil !== undefined && inp.week < c.discountUntil).length +
      0.2 * v2.competitors.filter((c) => c.fundedUntil !== undefined && inp.week < c.fundedUntil).length +
      // your own volume bids the price up too: at scale you compete with yourself for the
      // same attention (lever sweep, 2026-08-25 — the runway-safe max still dominated).
      // Keyed on RAW spend, not effectiveSpend: effectiveSpend asymptotes at ~$44k, so an
      // effectiveSpend-based term capped at ~0.9 and reach rose monotonically with money —
      // a Series-C fintech pegging $1.5M/wk held ~0.55 reach and bought a $360M valuation
      // at negative unit economics (measured, seed 1000). Raw spend makes reach peak around
      // $80-150k/wk and DEGRADE past it: pegging the cap now buys ~$20k worth of reach.
      inp.perfSpend / 100_000
    const paidReach = clamp01((effectiveSpend / (effectiveSpend + 8_000 * auction)) * paidAccess)
    const organicReach = clamp01(0.02 + (inp.brandStock / 100) * 0.28 + installedShare * 0.3)
    // positioning (spec §12, minimal): the declared segment hears the story better
    const posMult = v2.positioning?.targetSegmentId ? (v2.positioning.targetSegmentId === seg.id ? 1.18 : 0.94) : 1
    const reach = clamp01((paidReach + organicReach) * posMult) * inp.acquisitionEff
    const noise = 0.9 + 0.2 * inp.rng()
    let won = Math.max(0, demand * (shares.player ?? 0) * reach * noise)
    if (seg.salesLed ?? seg.baseWtp > 40) {
      // each closed deal consumes capacity; whatever the pipeline offered beyond that WAITS
      const closable = Math.min(won, salesCapacity)
      if (won > salesCapacity * 1.4 && won > 1) salesConstrained.push({ seg: seg.name, pipeline: won, capacity: salesCapacity })
      salesCapacity = Math.max(0, salesCapacity - closable)
      won = closable
    }
    if (won >= 0.5) {
      v2.cohorts.push({
        id: `${seg.id}_${inp.week}`,
        segmentId: seg.id,
        acquiredWeek: inp.week,
        size: won,
        sizeAtAcquisition: won,
        priceAtAcquisition: inp.price,
        fitAtAcquisition: fit,
        expansion: 1,
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
    const service = ((v2.serviceQuality ?? 70) - 70) / 100 // −0.55..+0.3 → ±0.005 on keep
    // PRICE ELASTICITY (balance audit 2026-08-25): a cohort billed far above its willingness
    // to pay LEAVES — up to 2x WTP is tolerated (tiers, inertia), past that each extra
    // multiple bleeds ~2.5%/wk, capped at 10%/wk. Without this term the peg-the-dial-at-max
    // strategy beat honest pricing in 52/54 paired seeds across three sectors.
    const wtpKeep = effectiveWtp(seg, fitNow, inp.brandStock)
    const priceBleed = Math.min(0.1, 0.025 * Math.max(0, inp.price / Math.max(0.1, wtpKeep) - 2))
    const keepBase = clamp(seg.retentionBaseline + 0.03 * (fitNow - 0.6) + service * 0.017 - priceBleed, 0.8, 0.998)
    // churnRelief is V1's ≤1 churn multiplier (retention roadmap work) — folded exactly once:
    // the part of the cohort that would leave, leaves churnRelief as often
    const kept = c.size * clamp(1 - (1 - keepBase) * inp.churnRelief, 0.85, 0.999)
    churnedTotal += c.size - kept
    // retained customers DEEPEN (spec §20.4): seats, usage, upgrades — bounded, slow, real
    const expansion = Math.min(1.8, (c.expansion ?? 1) * (1 + (seg.expansionRate ?? 0.001)))
    // the 4-week survival snapshot, frozen once — the fact the Cohorts screen plots
    const atFour =
      c.retentionAt4wk === undefined && inp.week - c.acquiredWeek === 4 && (c.sizeAtAcquisition ?? 0) > 0
        ? clamp01(kept / c.sizeAtAcquisition!)
        : c.retentionAt4wk
    if (kept >= 0.5) nextCohorts.push({ ...c, size: kept, expansion, retentionAt4wk: atFour })
  }
  v2.cohorts = nextCohorts.slice(-520) // a decade of weekly cohorts is plenty

  // ---- 18-19: revenue truth --------------------------------------------------------------
  const customers = v2.cohorts.reduce((x, c) => x + c.size, 0)
  const adScale = tpl.adModel ? 1 + Math.log10(Math.max(10, customers)) / 3 : 1
  let expansionRevenue = 0
  const revenue = v2.cohorts.reduce((x, c) => {
    const seg = v2.segments.find((sg) => sg.id === c.segmentId)
    if (!seg) return x
    // customers pay the price, but a segment priced far over its head quietly downgrades/laps
    // collection floor 0.45 (was 0.75 — measured hole: pricing 10x above a mass segment's WTP
    // still collected three-quarters, making overpricing free money). Below-WTP pricing now
    // genuinely converts better; above-WTP pricing genuinely leaks to downgrades and laps.
    const wtpHere = effectiveWtp(seg, fitBySegment[c.segmentId] ?? 0.5, inp.brandStock)
    // COLLECTION with a decaying floor (balance audit 2026-08-25). The 0.45 floor is the
    // downgrade-tier mechanic — but flat-in-price it made 45% of ANY sticker collectible,
    // which is why the dial pegged at 6x dominated every honest strategy and two week-18
    // unicorns got minted. Up to 2.5x a cohort's WTP the floor holds; past that collected
    // revenue goes flat at ~1.1x WTP (the decay is exactly 2.5/ratio, continuous at the knee).
    // Mass-segment WTP was re-authored to ~1.2-2x under the reference price in the same
    // commit, so this decay never binds at honest prices.
    const ratio = inp.price / Math.max(0.1, wtpHere)
    const floorDecay = ratio <= 2.5 ? 1 : 2.5 / ratio
    const collect = (0.45 + 0.55 * priceFit(inp.price, wtpHere, seg.priceSensitivity)) * floorDecay
    // ad-model archetypes (social): revenue per user compounds with network scale — CPMs and
    // fill rates climb, same shape the classic engine uses. Config-driven, not sector-coded.
    const base = c.size * inp.price * collect * adScale
    expansionRevenue += base * ((c.expansion ?? 1) - 1)
    return x + base * (c.expansion ?? 1)
  }, 0)
  const cogs = customers * inp.infraCostPerUser + newCustomersTotal * (tpl.onboardingCost ?? 0)
  const cac = newCustomersTotal > 0.5 ? inp.perfSpend / newCustomersTotal : v2.gtm.lastCac
  v2.gtm.lastCac = cac
  v2.finance = {
    revenue,
    cogs,
    opex: 0,
    netIncome: 0,
    revenueDrivers: {
      newBusiness: newCustomersTotal * inp.price,
      expansion: expansionRevenue,
      churnLoss: -churnedTotal * inp.price,
    },
  }

  // ---- 17: functional operating capacity, v1 domain: SERVICE (spec §19) ---------------------
  // Load: every customer takes touch, high-WTP customers take far more. Capacity: the team's
  // service-capable effort, multiplied by support AI. Sustained overload degrades REAL service
  // quality, which folds into cohort retention (exactly once — this IS the V2 service→churn
  // path); slack heals it. Three overloaded weeks make the situation crisis-eligible.
  v2.serviceQuality ??= 70
  v2.overloadWeeks ??= 0
  const load = v2.cohorts.reduce((x, c) => {
    const sg = v2.segments.find((q) => q.id === c.segmentId)
    return x + c.size * (0.5 + Math.min(6, (sg?.baseWtp ?? 10) / 30))
  }, 0)
  const serviceCapacity = Math.max(1, inp.servicePoints) * 320 * inp.aiSupportMult
  const utilization = load / serviceCapacity
  if (utilization > 1.2) {
    v2.serviceQuality = clamp(v2.serviceQuality - 3 - 2 * Math.min(1, utilization - 1.2), 15, 100)
    v2.overloadWeeks += 1
  } else {
    if (utilization < 0.9) v2.serviceQuality = clamp(v2.serviceQuality + 2, 15, 88)
    v2.overloadWeeks = 0
  }
  // raises at week 3 of the episode, and re-raises every 10 overloaded weeks it stays unfixed
  if (v2.overloadWeeks >= 3 && (v2.overloadWeeks - 3) % 10 === 0 && utilization > 1.3) {
    events.push({
      id: eid('service_overload'),
      week: inp.week,
      category: 'capacity',
      type: 'service_capacity_critical',
      magnitude: clamp01((utilization - 1) / 1.5),
      urgency: 0.85,
      strategicRelevance: 0.7,
      facts: { utilizationPct: Math.round(utilization * 100), weeks: v2.overloadWeeks, quality: Math.round(v2.serviceQuality) },
      visibility: 'known',
      eligibleForMajorMoment: true,
    })
  }

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
  // the fact behind "we have twice the pipeline we can handle" (spec §0A.16) — capacity, not vibes
  for (const sc of salesConstrained) {
    events.push({
      id: eid(`salescap_${sc.seg.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`),
      week: inp.week,
      category: 'capacity',
      type: 'sales_capacity_constrained',
      magnitude: clamp01(sc.pipeline / Math.max(0.5, sc.capacity) / 4),
      urgency: 0.65,
      strategicRelevance: 0.75,
      facts: { segment: sc.seg, pipeline: Math.round(sc.pipeline), capacity: Math.round(sc.capacity * 10) / 10 },
      visibility: 'known',
      eligibleForMajorMoment: true,
    })
  }
  if (prevSnap && prevSnap.cac > 1 && cac > 1) {
    const dCac = (cac - prevSnap.cac) / prevSnap.cac
    if (dCac > 0.25 && inp.perfSpend > 1_000) {
      events.push({
        id: eid('cac_spike'),
        week: inp.week,
        category: 'growth',
        type: 'cac_spike',
        magnitude: clamp01(dCac),
        urgency: 0.55,
        strategicRelevance: 0.6,
        facts: { cac: Math.round(cac), pct: Math.round(dCac * 100), saturated: saturation > 0.5 },
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
      // losing a bar is news too — fit decay used to be completely silent (owner playtest)
      if (prevFit >= bar && (fitBySegment[seg.id] ?? 0) < bar && (totalCustomersBySegment[seg.id] ?? 0) > 5) {
        events.push({
          id: eid(`fitlost_${seg.id}_${bar}`),
          week: inp.week,
          category: 'product',
          type: 'fit_threshold_lost',
          magnitude: 0.4 + bar * 0.4,
          urgency: 0.6,
          strategicRelevance: 0.7,
          entityIds: [seg.id],
          facts: { segment: seg.name, level: bar === 0.5 ? 'Competitive' : bar === 0.65 ? 'Strong' : 'Best-in-class' },
          visibility: 'known',
        })
      }
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
  // CREDIBILITY (owner playtest 2026-08-25): with a handful of customers, one lucky
  // zero-churn week read retentionQuality ~1 and PMF spiked past 60 — then "mysteriously"
  // decayed as reality arrived. Thin data now reads closer to neutral; the blend is gone
  // (cred ~1) by a few hundred customers.
  const rawRetention = customers > 0 ? clamp01(1 - churnedTotal / Math.max(1, customers + churnedTotal) / 0.06) : 0.3
  const cred = clamp01(customers / (customers + 60))
  const retentionQuality = customers > 0 ? 0.55 + (rawRetention - 0.55) * cred : 0.3
  const displayedPmf = clamp(100 * (0.55 * weightedFit + 0.45 * retentionQuality), 0, 100)
  // a real PMF slide gets NAMED, once per slide: which leg is falling, and where
  {
    const h = v2.weeklyHistory
    const p4 = h[h.length - 4]
    const p5 = h[h.length - 5]
    const p1 = h[h.length - 1]
    const delta = p4?.pmf !== undefined ? displayedPmf - p4.pmf : 0
    const prevDelta = p1?.pmf !== undefined && p5?.pmf !== undefined ? p1.pmf - p5.pmf : 0
    if (p4?.pmf !== undefined && delta <= -4 && prevDelta > -4) {
      const dFit = Math.round(100 * 0.55 * weightedFit) - (p4.pmfFitLeg ?? Math.round(100 * 0.55 * weightedFit))
      const dRet = Math.round(100 * 0.45 * retentionQuality) - (p4.pmfRetentionLeg ?? Math.round(100 * 0.45 * retentionQuality))
      // the biggest served segment with the lowest fit is usually the story
      const biggest = [...v2.segments]
        .filter((sg) => (totalCustomersBySegment[sg.id] ?? 0) > customers * 0.15)
        .sort((a2, b2) => (fitBySegment[a2.id] ?? 0) - (fitBySegment[b2.id] ?? 0))[0]
      events.push({
        id: eid('pmf_shift'),
        week: inp.week,
        category: 'product',
        type: 'pmf_shift',
        magnitude: clamp01(Math.abs(delta) / 12),
        urgency: 0.65,
        strategicRelevance: 0.8,
        entityIds: biggest ? [biggest.id] : [],
        facts: {
          from: Math.round(p4.pmf),
          to: Math.round(displayedPmf),
          driver: Math.abs(dFit) >= Math.abs(dRet) ? 'product fit' : 'churn',
          detail:
            Math.abs(dFit) >= Math.abs(dRet)
              ? biggest
                ? `${biggest.name} are a growing share of your base and rate the product ${Math.round((fitBySegment[biggest.id] ?? 0) * 100)}/100`
                : 'the average customer rates the product lower than your early base did'
              : `churn is up — check price vs willingness-to-pay, service quality, and reliability`,
        },
        visibility: 'known',
      })
    }
  }

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
    newCustomers: Math.round(newCustomersTotal),
    churnedCustomers: Math.round(churnedTotal),
    paidSpend: inp.perfSpend,
    cac: Math.round(cac),
    serviceUtilization: Math.round(utilization * 100) / 100,
    serviceQuality: Math.round(v2.serviceQuality),
    productFit: fitBySegment,
    attributes: attrs,
    brand: inp.brandStock,
    pmf: Math.round(displayedPmf),
    pmfFitLeg: Math.round(100 * 0.55 * weightedFit),
    pmfRetentionLeg: Math.round(100 * 0.45 * retentionQuality),
    boardConfidence: v2.boardConfidence.value,
    investorConfidence: v2.investorConfidence.value,
    planVariance: 0,
    eventIds: events.filter((e) => e.visibility === 'known').map((e) => e.id),
  }
  v2.weeklyHistory.push(snap)
  if (v2.weeklyHistory.length > 420) v2.weeklyHistory.shift()

  // ---- 23-26: plan vs actual, commitments, the two confidences (phase 3) --------------------
  const h4 = v2.weeklyHistory[v2.weeklyHistory.length - 5]
  const growth4w = h4 && h4.revenue > 100 ? Math.pow(revenue / h4.revenue, 1 / 4) - 1 : 0
  const churnRate = customers > 0 ? churnedTotal / Math.max(1, customers + churnedTotal) : 0
  const confEvents = tickConfidence(v2, {
    week: inp.week,
    revenue,
    macroFactor: inp.macroFactor,
    runwayWeeks: inp.runwayWeeks,
    growth4w,
    churnRate,
    bestFit: Math.max(0, ...Object.values(fitBySegment)),
    boardTarget: inp.boardTarget,
  })
  events.push(...confEvents)

  // ---- 27: due research lands — knowledge narrows, truth never moves (phase 4) --------------
  events.push(...tickResearch(v2, inp.week, inp.analyticsMult))

  // ---- 31-32: milestones fire once; chapters are earned (phase 6) ---------------------------
  const story = tickStory(v2, inp.week)
  events.push(...story.events)
  snap.eventIds = events.filter((e) => e.visibility === 'known').map((e) => e.id)

  const visibleEvents = rankEvents(v2, inp.week)
  for (const e of visibleEvents) v2.lastSeen[e.type] = inp.week

  return { customers: Math.round(customers), revenue: Math.round(revenue), cogs, displayedPmf, visibleEvents }
}
