// Everything onboarding knows about the run, derived READ-ONLY from GameState.
//
// The hard rule for this whole module lives here: nothing below writes. Not to the game state, not
// through the store, not via a helper that mutates in place. Onboarding observes the simulation and
// then talks; if it ever needed to change an outcome, it would be a game system and would belong in
// src/game. `npm run bots` must stay byte-identical with this module present, which it does because
// no code path here is reachable from the engine at all.

import { runwayWeeks, valuation, weeklyBurn } from '../game/engine'
import { STAGE_THRESHOLDS } from '../game/data'
import { hasCapability } from '../game/modes'
import type { GameState } from '../game/types'
import type { ScreenId } from '../store'
import type { SkillId } from './progress'

/** The facts every lesson predicate is allowed to ask about. Cheap to build; built once per render. */
export interface RunFacts {
  game: GameState
  screen: ScreenId
  /** Stable per run, so the "one note per week" limiter resets when a new company starts. */
  runId: string
  career: boolean
  week: number
  cash: number
  burn: number
  /** Infinity when the company is profitable — every consumer must handle that. */
  runway: number
  valuation: number
  /** Fraction of the way to the next stage's bar, 0–1+. */
  stageProgress: number
  employees: number
  /** Cash movement over the last completed week, and how much of it the weekly burn explains. */
  cashDelta: number
  operatingDelta: number
  /** A one-off charge is any part of this week's cash move the operating result cannot account for. */
  oneOff: number
  pendingDecisions: number
  resolvedDecisions: number
  hasBoard: boolean
  hasDebt: boolean
  bugs: number
  morale: number
  energy: number
  marketingSpend: number
  biggestRivalUsers: number
  users: number
  /** Career only. Zero/false on every other mode rather than undefined, so predicates stay flat. */
  experimentsRun: number
  evidenceItems: number
  targetRetention: number
  targetCustomers: number
  openInterviewMoves: number
  openConversation: boolean
  openBoardRoom: boolean
  advisorOpinions: number
  promises: number
  cohorts: number
  tokenised: boolean
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

export function readRun(game: GameState, screen: ScreenId): RunFacts {
  const career = hasCapability(game, 'detailedPMF') && !!game.career
  const h = game.history
  const last = h.length >= 1 ? h[h.length - 1] : undefined
  const prev = h.length >= 2 ? h[h.length - 2] : undefined
  const cashDelta = last && prev ? last.cash - prev.cash : 0
  // What the week's own P&L says the move should have been. Anything left over is a one-off — a
  // recruiter fee, a cloud bill, an event that took cash — and one-offs are exactly what the
  // runway figure does NOT include, which is the trap that eats first-run founders.
  const operatingDelta = last ? num(last.revenue) - num(last.expenses) : 0
  const c = career ? game.career! : undefined
  const target = c?.primaryTargetSegmentId ?? ''
  const rooms = game.world?.interactions ?? []
  const openRooms = Array.isArray(rooms) ? rooms.filter((r) => r && r.status === 'open') : []
  const cohorts = c?.cohorts?.length ?? 0
  const bestRival = game.rivals.filter((r) => r.alive).reduce((m, r) => Math.max(m, num(r.users)), 0)
  const bar = STAGE_THRESHOLDS[game.stage] ?? 0
  const val = valuation(game)

  return {
    game,
    screen,
    runId: `${game.companyName}|${game.config?.seed ?? 0}`,
    career,
    week: game.week,
    cash: game.cash,
    burn: weeklyBurn(game),
    runway: runwayWeeks(game),
    valuation: val,
    stageProgress: bar > 0 ? val / bar : 1,
    employees: game.employees.length,
    cashDelta,
    operatingDelta,
    oneOff: cashDelta - operatingDelta,
    pendingDecisions: game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length,
    resolvedDecisions: game.inbox.filter((m) => m.kind === 'choice' && m.resolved).length,
    hasBoard: !!game.board,
    hasDebt: !!game.debt,
    bugs: game.bugs,
    morale: game.employees.length === 0 ? 100 : game.employees.reduce((a, e) => a + e.morale, 0) / game.employees.length,
    energy: game.energy,
    marketingSpend: game.marketingSpend,
    biggestRivalUsers: bestRival,
    users: game.users,
    experimentsRun: (c?.activeExperiments.length ?? 0) + (c?.journal.filter((j) => j.category === 'experiment').length ?? 0),
    evidenceItems: c?.evidence.length ?? 0,
    targetRetention: num(c?.retentionBySegment?.[target]),
    targetCustomers: c?.cohorts?.filter((x) => x.segmentId === target).reduce((a, x) => a + num(x.activeCustomers), 0) ?? 0,
    openInterviewMoves: openRooms.filter((r) => r.kind === 'interview').reduce((a, r) => a + num(r.movesLeft), 0),
    openConversation: openRooms.some((r) => r.kind === 'conversation'),
    openBoardRoom: openRooms.some((r) => r.kind === 'board_meeting'),
    advisorOpinions: game.world?.advisorPanel?.week === game.week ? (game.world?.advisorPanel?.opinions.length ?? 0) : 0,
    promises: game.world?.promises?.length ?? 0,
    cohorts,
    tokenised: !!game.token,
  }
}

/**
 * Which lessons this run has already made unnecessary.
 *
 * Read off the same state a player can see, so it is impossible for the ledger to claim a skill the
 * player did not demonstrate. Every one of these is "you have done the thing", never "you were told
 * about the thing" — being told is what `seen` records, and the two must not be confused.
 */
export function observedSkills(f: RunFacts): SkillId[] {
  const g = f.game
  const out: SkillId[] = []
  if (g.week > 2) out.push('advance')
  if (g.employees.length + g.pendingHires.length + g.offersOut.length > 0) out.push('hire')
  if (f.resolvedDecisions > 0) out.push('decide')
  // The default allocation is the one buildGame deals. Any change means the player found the sliders.
  const a = g.allocation
  if (a.features !== 50 || a.quality !== 20 || a.bugs !== 10 || a.research !== 20 || a.bet !== 0) out.push('allocate')
  if (g.marketingSpend !== 1000) out.push('market')
  if (g.founderEquity < 0.999 || g.stage !== 'Pre-seed' || g.board) out.push('raise')
  if (g.pivots > 0) out.push('pivot')
  if (g.debt || g.flags?.tookDebt) out.push('debt')
  if (g.ventures.length > 0) out.push('venture')
  if (f.evidenceItems > 0 || f.experimentsRun > 0) out.push('experiment')
  const rooms = g.world?.interactions ?? []
  if (Array.isArray(rooms)) {
    if (rooms.some((r) => r.kind === 'interview' && r.chosen.length > 0)) out.push('interview')
    if (rooms.some((r) => r.kind === 'conversation' && r.status === 'resolved')) out.push('conversation')
    if (rooms.some((r) => r.kind === 'board_meeting' && r.status === 'resolved')) out.push('boardroom')
  }
  if (f.targetRetention >= 0.6 && f.targetCustomers >= 15) out.push('retain')
  if (g.token) out.push('tokenise')
  return out
}
