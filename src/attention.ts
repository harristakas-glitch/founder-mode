// The attention register: the one route from the simulation to the player's attention.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The UX audit (docs/ux-audit-2026-08.md §2.3) found eleven ways to lose a run that could not
// reach the player. Six had no route at all — a covenant breach that costs 15% of the company, the
// founder-removal vote, a price war cutting revenue every week, a hostile rival, a candidate
// walking, founder burnout. The other five went through `attentionItems` in Dashboard.tsx, which
// ended `return out.slice(0, 3)` over PUSH ORDER, so a `good` item ("3 interview questions left")
// could silently discard "miss the next review and you can be replaced".
//
// Two design rules from the brief drive everything here:
//
//   §7  — severity is a TYPE, not a colour. urgent > decision > opportunity > insight > information.
//   R5  — never make the player hunt for something urgent. Which means: never DROP one either.
//
// And one rule that came out of the audit rather than the brief: **every item names the specific
// thing**. "2 decisions waiting" is a count, and the existence of a pending decision is already
// announced four times in the shell — its IDENTITY is announced nowhere. So an item says "The
// accelerator wants 7% for $120k", never "1 decision".
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS FILE MAY NOT DO
//
// It is PURE and READ-ONLY. It takes a GameState and returns an array. It must never mutate state,
// never call anything that mutates, and never import from a module that owns simulation. It lives
// outside `src/game/` on purpose: the determinism contract says `npm run bots` is byte-identical,
// and the cheapest way to keep that true is for the simulation to have no way of reaching this
// code at all.
//
// Adding an item here is not "adding UI". The strip already exists; this decides what goes in it.

import { sectorById } from './game/data'
import {
  boardEffectiveTarget,
  committedCosts,
  demandSignal,
  growthRate,
  productScore,
  runwayWeeks,
  totalUsers,
  weeklyBurn,
} from './game/engine'
import { hasCapability } from './game/modes'
import { openInteractions } from './game/world/interactions'
import type { GameState } from './game/types'
import type { ScreenId } from './store'

/** Career mode with the detailed-PMF loop on. Inlined from CareerUI's `careerActive` so this file
 *  never imports from a UI module — the import graph is part of the purity contract above. */
const careerActive = (g: GameState): boolean => !!g.career && hasCapability(g, 'detailedPMF')

/** Brief §7. Ordering is the enum's own order — index IS priority. */
export const ATTENTION_TYPES = ['urgent', 'decision', 'opportunity', 'insight', 'information'] as const
export type AttentionType = (typeof ATTENTION_TYPES)[number]

export interface AttentionItem {
  /** Stable across weeks for the same underlying cause, so React can keep a row mounted. */
  id: string
  type: AttentionType
  /** The specific thing. Never a count. */
  title: string
  /** One sentence of why it matters, in the player's own numbers. Optional — silence beats filler. */
  detail?: string
  /** Weeks until it is too late. Absent = no deadline. 0 = this week. Breaks ties within a type. */
  deadline?: number
  /** Where the player goes to act. Absent = there is nothing to do but know. */
  action?: { label: string; screen: ScreenId }
}

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}k` : `$${Math.round(n)}`

/**
 * Everything the player should know about, most severe first.
 *
 * Returns the FULL list, unsliced and unbounded. Truncation is a presentation decision and belongs
 * to whatever renders this — which is the whole point: the bug this replaces was a renderer
 * throwing away simulation facts it had no way to rank.
 */
export function attentionRegister(game: GameState): AttentionItem[] {
  const out: AttentionItem[] = []
  const runway = runwayWeeks(game)
  const push = (i: AttentionItem) => out.push(i)

  // ---- 1. the blocking decision, BY NAME -------------------------------------------------------
  const blocking = game.inbox.find((m) => m.kind === 'choice' && !m.resolved)
  if (blocking) {
    const more = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length - 1
    push({
      id: `decision:${blocking.id}`,
      type: 'urgent',
      title: blocking.title,
      // The count goes in the DETAIL, never the title — and only when there is more than one.
      detail: more > 0 ? `The week cannot end until this is resolved. ${more} more after it.` : 'The week cannot end until this is resolved.',
      deadline: 0,
      action: { label: 'Open', screen: 'inbox' },
    })
  }

  // ---- 2. runway ------------------------------------------------------------------------------
  if (runway !== Infinity && runway < 20) {
    const net = game.lastRevenue - weeklyBurn(game)
    push({
      id: 'runway',
      type: runway < 8 ? 'urgent' : 'decision',
      title: `${Math.max(0, Math.floor(runway))} weeks of runway left`,
      detail:
        net < 0
          ? `Net is ${money(net)} a week. Raise, cut burn, or get revenue above burn.`
          : 'Revenue covers burn — the clock has stopped, but the buffer is thin.',
      deadline: Math.max(0, Math.floor(runway)),
      action: { label: 'Capital', screen: 'fundraising' },
    })
  }

  // ---- 3. covenant proximity — NEW. 15% of the company, and it had no route to the player -------
  if (game.debt && game.lastRevenue < game.debt.covenantRevenue * 1.2) {
    const breached = game.lastRevenue < game.debt.covenantRevenue
    push({
      id: 'covenant',
      type: 'urgent',
      title: breached ? 'Debt covenant breached' : 'Debt covenant is close',
      detail: `Revenue must stay above ${money(game.debt.covenantRevenue)}/wk and is ${money(game.lastRevenue)}. A breach converts debt to equity.`,
      deadline: breached ? 0 : 1,
      action: { label: 'Finance', screen: 'finance' },
    })
  }

  // ---- 4. governance: the board, and the vote that ends the run --------------------------------
  if (game.board && game.board.strikes > 0) {
    push({
      id: 'board-strikes',
      type: 'urgent',
      title: `The board has issued ${game.board.strikes} strike${game.board.strikes === 1 ? '' : 's'}`,
      detail: game.board.defied
        ? 'You defied an ultimatum. Miss the next review and you are out.'
        : `Miss the review in week ${game.board.nextReview} and you can be replaced.`,
      deadline: Math.max(0, game.board.nextReview - game.week),
      action: { label: 'Capital', screen: 'fundraising' },
    })
  }

  // ---- 5. the named person about to resign -----------------------------------------------------
  //
  // Replaces an `avgMorale < 45` item that mathematically COULD NOT see this: one person at 20
  // among seven at 75 averages 68. Thresholds mirror engine.ts's resign roll — a mercenary leaves
  // at a much higher morale than anyone else, which is the trait's whole point.
  const atRisk = game.employees
    .filter((e) => e.morale < (e.trait === 'mercenary' ? 55 : 32))
    .sort((a, b) => a.morale - b.morale)[0]
  if (atRisk) {
    push({
      id: `resign:${atRisk.id}`,
      type: 'decision',
      title: `${atRisk.name} is about to quit`,
      detail: `${atRisk.role}, morale ${Math.round(atRisk.morale)}${atRisk.trait === 'mercenary' ? ' — and a mercenary leaves early' : ''}.`,
      deadline: 1,
      action: { label: 'People', screen: 'team' },
    })
  }

  // ---- 6. founder burnout — forced at energy <= 5, and invisible on mobile before this ----------
  if (game.energy <= 12) {
    push({
      id: 'energy',
      type: game.energy <= 6 ? 'urgent' : 'decision',
      title: `Your energy is ${Math.round(game.energy)}`,
      detail: 'At zero you are forced to take a week off: morale drops, a feature slips, and everything you touch is weaker until then.',
      deadline: Math.max(0, Math.round(game.energy / 3)),
      action: { label: 'People', screen: 'team' },
    })
  }

  // ---- 7. the market is acting on you ----------------------------------------------------------
  if ((game.flags.priceWar ?? 0) > 0) {
    push({
      id: 'price-war',
      type: 'decision',
      title: 'A price war is running',
      detail: `Revenue is cut every week it lasts — ${game.flags.priceWar} week${game.flags.priceWar === 1 ? '' : 's'} to go.`,
      deadline: game.flags.priceWar,
      action: { label: 'Market', screen: 'market' },
    })
  }
  const hostile = game.rivals.filter((r) => r.alive && r.hostileSince !== undefined)
  if (hostile.length > 0) {
    push({
      id: 'hostile',
      type: 'opportunity',
      title:
        hostile.length === 1
          ? `${hostile[0].name} has turned hostile`
          : `${hostile.length} rivals have turned hostile`,
      detail: 'They are coming for your users. An operation costs cash and energy, and doing nothing is also a choice.',
      action: { label: 'Market', screen: 'market' },
    })
  }

  // ---- 8. offers and candidates, both of which expire -------------------------------------------
  const sheet = [...game.termSheets].sort((a, b) => a.weeksLeft - b.weeksLeft)[0]
  if (sheet) {
    push({
      id: `sheet:${sheet.id}`,
      type: 'decision',
      title: `${sheet.investor} offers ${money(sheet.amount)} for ${Math.round(sheet.equity * 100)}%`,
      detail:
        sheet.weeksLeft <= 1
          ? 'This is the last week to sign.'
          : `${sheet.weeksLeft} weeks to decide${game.termSheets.length > 1 ? `, and ${game.termSheets.length - 1} other offer${game.termSheets.length === 2 ? '' : 's'} on the table` : ''}.`,
      deadline: sheet.weeksLeft,
      action: { label: 'Capital', screen: 'fundraising' },
    })
  }
  const leaving = game.candidates.filter((c) => c.weeksLeft <= 1).sort((a, b) => b.skill - a.skill)[0]
  if (leaving) {
    push({
      id: `candidate:${leaving.id}`,
      type: 'opportunity',
      title: `${leaving.name} leaves the pool this week`,
      detail: `${leaving.role}, skill ${leaving.skill}, ${money(leaving.salary)}/yr.`,
      deadline: 0,
      action: { label: 'Hiring', screen: 'hiring' },
    })
  }

  // ---- 9. the living world is waiting on you ----------------------------------------------------
  //
  // One room only — the one closest to going cold — because a queue of nudges is not a nudge.
  // (This is the rule the old Dashboard strip kept with a bare `break`; it holds here.)
  for (const room of openInteractions(game.world)) {
    if (room.kind === 'conversation') {
      push({ id: `room:${room.id}`, type: 'decision', title: room.title, detail: 'A conversation is open and goes cold if it waits.', action: { label: 'People', screen: 'team' } })
    } else if (room.kind === 'board_meeting') {
      push({ id: `room:${room.id}`, type: 'decision', title: 'The board is waiting on you', detail: 'The meeting is open on the HQ — the decision taken there becomes a commitment.', action: { label: 'HQ', screen: 'dashboard' } })
    } else {
      push({
        id: `room:${room.id}`,
        type: 'information',
        title: `${room.movesLeft} interview question${room.movesLeft === 1 ? '' : 's'} left`,
        detail: 'The calls are still running.',
        action: { label: 'Product', screen: 'discovery' },
      })
    }
    break
  }

  // ---- 10. the product is telling you something -------------------------------------------------
  //
  // Two register entries replaced the old Benchmarks panel: the audit's instruction was that the
  // benchmark verdicts become the TONE INPUT to attention rather than a second parallel evaluation
  // two screens compute differently. So the thresholds that lived in that panel live here now, and
  // the panel is gone.
  if (!careerActive(game) && demandSignal(game) === 'weak') {
    push({
      id: 'demand-weak',
      type: 'insight',
      title: 'Your research came back: demand is WEAK',
      detail: 'More effort will not fix the idea. A pivot might, and your research carries over.',
      action: { label: 'Product', screen: 'product' },
    })
  }
  const pmfPace = Math.min(85, game.week * 1.6)
  if (game.week > 6 && game.pmf < pmfPace * 0.6) {
    const career = careerActive(game) ? game.career! : null
    const retention = career ? (career.retentionBySegment[career.primaryTargetSegmentId] ?? 0) : 0
    push(
      career
        ? {
            id: 'pmf-pace',
            type: 'insight',
            title: `PMF is ${Math.round(game.pmf)} and falling behind`,
            detail:
              retention > 0
                ? `It is read off customers who stay, and only ${Math.round(retention * 100)}% of your target segment is still here after four weeks.`
                : 'Nothing has retained long enough to measure yet. Research moves your beliefs; only paying customers who stay move PMF.',
            action: { label: 'Product', screen: 'discovery' },
          }
        : {
            id: 'pmf-pace',
            type: 'insight',
            title: `PMF is ${Math.round(game.pmf)} against ~${Math.round(pmfPace)} expected`,
            detail: `The market isn't biting by week ${game.week} — research harder, or pivot.`,
            action: { label: 'Product', screen: 'product' },
          },
    )
  }
  if (game.bugs > 55) {
    push({
      id: 'bugs',
      type: 'insight',
      title: `Bugs at ${Math.round(game.bugs)} are driving churn`,
      detail: 'They also scare off the press. A quality week pays for itself.',
      action: { label: 'Product', screen: 'product' },
    })
  }

  // ---- 11. the rest of the old Benchmarks verdicts, as items that only speak when bad -----------
  if (game.board) {
    const growth = growthRate(game)
    const target = boardEffectiveTarget(game)
    if (growth < target * 0.6 && game.board.strikes === 0) {
      // Preventive — the strikes item above takes over once one lands.
      push({
        id: 'board-pace',
        type: 'insight',
        title: 'Growth is below the board’s bar',
        detail: `${(growth * 100).toFixed(1)}%/wk against their ${(target * 100).toFixed(1)}% — miss the review and it becomes a strike.`,
        action: { label: 'Capital', screen: 'fundraising' },
      })
    }
  }
  const sector = sectorById(game.sector)
  const churn = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))
  if (churn > sector.churn * 1.5 && totalUsers(game) > 100) {
    push({
      id: 'churn',
      type: 'insight',
      title: 'You are losing users faster than the market does',
      detail: `${(churn * 100).toFixed(1)}%/wk against a ${(sector.churn * 100).toFixed(1)}% average — driven by PMF, quality and bugs.`,
      action: { label: 'Product', screen: 'product' },
    })
  }
  // Guarded by week AND users: every week-1 company is 15+ points behind an incumbent, so unguarded
  // this fired on 100% of new runs — an item that always fires is noise, and the "calm run produces
  // nothing" test rightly refused it. It becomes true the moment there are users to steal.
  const bestRival = [...game.rivals.filter((r) => r.alive)].sort((a, b) => b.product - a.product)[0]
  if (bestRival && game.week > 8 && totalUsers(game) > 100 && productScore(game) < bestRival.product - 15) {
    push({
      id: 'rival-gap',
      type: 'insight',
      title: `${bestRival.name} is out-shipping you`,
      detail: `Their product reads ${Math.round(bestRival.product)} against your ${Math.round(productScore(game))} — fall 15+ behind and they steal users.`,
      action: { label: 'Product', screen: 'product' },
    })
  }
  if (runway >= 20 && game.cash < committedCosts(game).recommended * 0.5) {
    // Only when the runway item is silent — a thin buffer is a DIFFERENT failure (one bad one-off
    // bill) and stacking both would say "cash" twice.
    push({
      id: 'buffer',
      type: 'insight',
      title: 'Your cash buffer is thin',
      detail: `${money(game.cash)} against ${money(committedCosts(game).recommended)} recommended — one bad event (cloud bill, recruiter fee) could hurt.`,
      action: { label: 'Finance', screen: 'finance' },
    })
  }

  // Severity first, then the nearest deadline, then authored order. `sort` is stable in every engine
  // we target, so the order things are pushed above IS the final tie-break — which is why the
  // ordering above reads top-to-bottom by how bad it is.
  return out.sort((a, b) => {
    const t = ATTENTION_TYPES.indexOf(a.type) - ATTENTION_TYPES.indexOf(b.type)
    if (t !== 0) return t
    const ad = a.deadline ?? Number.POSITIVE_INFINITY
    const bd = b.deadline ?? Number.POSITIVE_INFINITY
    return ad - bd
  })
}

/**
 * The single recommendation — brief §9 and §10.
 *
 * "Prefer one strong recommendation over five weak ones." So this returns ONE item or nothing, and
 * it deliberately reuses the register rather than computing a second opinion: two functions
 * evaluating the same health into two UI regions is exactly the drift the audit found between
 * `Benchmarks` and `attentionItems`.
 *
 * It recommends INVESTIGATION, never strategy — "consider looking at", not "you should". The game
 * identifies; the founder decides.
 */
export function nextBestStep(game: GameState): AttentionItem | null {
  const reg = attentionRegister(game)
  // An `information` item is never a recommendation — by definition nothing is being asked.
  return reg.find((i) => i.type !== 'information') ?? null
}
