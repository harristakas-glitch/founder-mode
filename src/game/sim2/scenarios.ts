// V2 phase 7 — the scenario library (spec §0A.17, engagement §21). A scenario initialises REAL
// V2 state — cohorts, cash, competitors, commitments — and then the normal engine runs. It
// creates the starting problem; the player and the simulation create the story. No special-case
// economics anywhere: after init, a scenario run is indistinguishable from an organic one that
// arrived at the same state.

import type { GameState } from '../types'
// runtime-only circular use (engine imports this module; BOARD_TARGETS is read at call time,
// long after both modules initialise — same pattern the career modules already rely on)
import { BOARD_TARGETS } from '../engine'

export interface V2ScenarioDef {
  id: string
  name: string
  blurb: string
}

export const V2_SCENARIOS: V2ScenarioDef[] = [
  {
    id: 'v2_pivot',
    name: 'The Pivot',
    blurb: 'Growth looks great. Retention is terrible — you inherited 600 customers in the segment that never stays.',
  },
  {
    id: 'v2_burn_machine',
    name: 'The Burn Machine',
    blurb: 'You raised big and promised bigger. $2.5M in the bank, an aggressive board commitment, and a burn to match.',
  },
  {
    id: 'v2_price_war',
    name: 'The Price War',
    blurb: 'Your largest competitor just cut price 25% into your best market — and their campaign has weeks left to run.',
  },
]

export const isV2Scenario = (id?: string): boolean => V2_SCENARIOS.some((x) => x.id === id)

/** Applied ONCE at creation, inside the run's seeded stream, after createSimV2. Mutates real
 *  state only — every downstream week is the ordinary engine. */
export function applyV2Scenario(s: GameState, id: string): void {
  const v2 = s.simV2
  if (!v2) return

  if (id === 'v2_pivot') {
    // 600 inherited customers in the truly worst-retaining segment — the numbers look alive,
    // the cohort math is a countdown. Cash is fine; the CLOCK is the retention curve.
    const worst = [...v2.segments].sort((a, b) => a.retentionBaseline - b.retentionBaseline)[0]
    for (let back = 8; back >= 1; back--) {
      v2.cohorts.push({
        id: `${worst.id}_inherited_${back}`,
        segmentId: worst.id,
        acquiredWeek: 1 - back,
        size: 75,
        priceAtAcquisition: v2.pricing.price,
        fitAtAcquisition: 0.5,
        expansion: 1,
      })
    }
    s.users = 600
    s.cash = 320_000
    s.marketingSpend = 6_000
    s.hype = 40
    s.inbox.unshift({
      id: `scen_${s.week}`,
      week: s.week,
      kind: 'system',
      title: 'The Pivot — your inheritance',
      body: '600 customers, healthy top-line, and a retention curve that says most of them are already leaving. Growth is not your problem. Who you sell to is.',
    })
  }

  if (id === 'v2_burn_machine') {
    s.cash = 2_500_000
    s.stage = 'Seed'
    s.lastPostMoney = 12_000_000
    s.founderEquity = 0.78
    s.marketingSpend = 18_000
    ;(s.rounds ??= []).push({ week: 0, stage: 'Seed', investor: 'Vantage Growth', amount: 2_500_000, equity: 0.22, founderAfter: 0.78 })
    s.board = { targetGrowth: BOARD_TARGETS.Seed * 1.3, nextReview: s.week + 12, strikes: 0, defied: false }
    v2.planning.commitments.push({
      id: 'burn_machine_promise',
      createdWeek: s.week,
      dueWeek: s.week + 12,
      metricId: 'weekly_growth',
      targetValue: BOARD_TARGETS.Seed * 1.3,
      importance: 1,
      ambition: 0.9,
      status: 'on_track',
    })
    v2.boardConfidence.value = 68 // they believed the pitch — that is the trap
    s.inbox.unshift({
      id: `scen_${s.week}`,
      week: s.week,
      kind: 'system',
      title: 'The Burn Machine — the money is real, and so is the promise',
      body: 'Vantage wired $2.5M against a growth number you chose in a hotel lobby at 1am. The board believes you. The burn is $18k/wk of marketing before payroll. Deliver, or learn what a board that stops believing feels like.',
    })
  }

  if (id === 'v2_price_war') {
    // the biggest rival opens ALREADY mid-campaign against your most accessible market
    const biggest = [...s.rivals].sort((a, b) => b.users - a.users)[0]
    if (biggest) {
      const key = biggest.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      const focus: Record<string, number> = {}
      for (const seg of v2.segments) focus[seg.id] = seg.paidAccessibility >= 0.7 ? 1 : 0.25
      v2.competitors.push({
        id: key,
        name: biggest.name,
        price: v2.pricing.price * 0.75,
        attributes: {},
        brand: 55,
        segmentFocus: focus,
        lastShare: {},
        discountUntil: s.week + 8,
      })
      biggest.users = Math.round(biggest.users * 2.2)
      s.inbox.unshift({
        id: `scen_${s.week}`,
        week: s.week,
        kind: 'system',
        title: `The Price War — ${biggest.name} moved first`,
        body: `${biggest.name} cut 25% into your most reachable market this morning, and their campaign runs for two more months. Match and bleed, hold and argue, or go where they aren't.`,
      })
    }
    s.cash = 260_000
  }
}
