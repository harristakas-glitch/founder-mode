// Arena's two attacks that can cost the attacker.
//
// The three original attacks are purchases: pay cash, damage a rival, no downside. These two are
// decisions. A hit piece can be traced back to you, and the odds get worse every time you run one.
// A price war cuts your own revenue for as long as it runs, so you start it because you can
// OUTLAST them, not because you can afford it.
//
// State lives in `s.flags` (Record<string, number>) so no save migration is needed — a save
// written before this loads with the flags simply absent, which reads as "no campaign running".

import type { GameState } from './types'

// ---------------------------------------------------------------------------------------
// Hit piece — a multi-week campaign that might be traced back to you
// ---------------------------------------------------------------------------------------

export const PR_CAMPAIGN_WEEKS = 3
/** Weeks the target sees a story running before they learn who planted it. */
export const PR_DECOY_WEEKS = 2
export const PR_BASE_COST = 55_000

/**
 * Chance the story is traced back to you, by how many you have already run this match.
 *
 * Escalating rather than a flat rate on purpose: it makes the mechanic self-limiting without an
 * arbitrary cooldown, and it means the third hit piece is a genuinely different decision from the
 * first. Capped below 1 so it is always a gamble and never a guaranteed own goal.
 */
export function backfireChance(timesUsed: number): number {
  return Math.min(0.75, 0.18 + Math.max(0, timesUsed) * 0.19)
}

/**
 * Did it backfire? Deliberately NOT a draw from the attacker's local RNG.
 *
 * Arena is peer-to-peer with no referee, so an attacker who rolled locally could reroll until the
 * dice came up clean — the same class of cheat the sealed-bid commitment exists to stop. This is a
 * pure function of values both clients already have (match seed, week, attacker id, how many the
 * attacker has run), so the victim's client derives the identical answer and rerolling changes
 * nothing.
 */
export function prBackfired(seed: number, week: number, attackerId: string, timesUsed: number): boolean {
  let h = (seed ^ 0x5bf03635) >>> 0
  h = Math.imul(h ^ week, 0x85ebca6b) >>> 0
  h = Math.imul(h ^ timesUsed, 0xc2b2ae35) >>> 0
  for (let i = 0; i < attackerId.length; i++) h = Math.imul(h ^ attackerId.charCodeAt(i), 0x27d4eb2f) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296 < backfireChance(timesUsed)
}

/**
 * A running campaign's damage for one week. Front-loaded: the story breaks, then it fades, which
 * is both how coverage actually behaves and what stops a campaign being a flat drip the target can
 * ignore. Totals across three weeks to roughly 1.5x a single smear — the premium for taking on
 * backfire risk.
 */
export function prWeeklyDamage(weeksRemaining: number): { hype: number; reputation: number } {
  const age = PR_CAMPAIGN_WEEKS - weeksRemaining // 0 on the week it breaks
  const decay = age === 0 ? 1 : age === 1 ? 0.65 : 0.4
  return { hype: -Math.round(9 * decay), reputation: -Math.round(3 * decay) }
}

/** True while the target can see a story running but not yet who planted it. */
export function prSourceHidden(s: GameState): boolean {
  const remaining = s.flags.prTarget ?? 0
  if (remaining <= 0) return false
  return PR_CAMPAIGN_WEEKS - remaining < PR_DECOY_WEEKS
}

// ---------------------------------------------------------------------------------------
// Price war — the only attack that bills you too
// ---------------------------------------------------------------------------------------

export const PRICE_WAR_WEEKS = 6
export const PRICE_WAR_COST = 30_000
/**
 * Weeks after a war ENDS before another can be declared. The generic 5-week attack cooldown is
 * shorter than the 6-week war, so it never bit: bots re-declared the instant one lapsed and spent
 * 86% of all weeks at war, killing both founders in 3 of 12 duels. A price war has to be an
 * episode with a beginning and an end, not the weather.
 */
export const PRICE_WAR_COOLDOWN = 8

/**
 * Revenue multiplier while a price war runs.
 *
 * The initiator always takes the smaller cut — they chose the ground — but the gap closes as their
 * own margin worsens, so starting a war you cannot fund is punished rather than free. `margin` is
 * revenue over expenses, clamped: 1 means breaking even, above 1 is profitable.
 *
 * Deliberately NOT a knockout. The war should decide who blinks, not end the match on its own.
 */
export function priceWarMultiplier(isInitiator: boolean, margin: number): number {
  const health = Math.min(1.4, Math.max(0.4, margin))
  // a healthy company absorbs the cut; a struggling one feels it nearly double
  const absorb = (health - 0.4) / 1 // 0 at desperate, ~1 at comfortable
  const base = isInitiator ? 0.88 : 0.74
  return Math.min(0.97, base + absorb * 0.09)
}

export function marginOf(s: GameState): number {
  const expenses = Math.max(1, s.lastExpenses || 1)
  return (s.lastRevenue || 0) / expenses
}

/** Concede: end the war early by handing the initiator part of your market. */
export const CONCEDE_USER_SHARE = 0.06

// ---------------------------------------------------------------------------------------
// Weekly upkeep
// ---------------------------------------------------------------------------------------

/**
 * Tick both effects. Called from the weekly step BEFORE revenue is computed, so a price war
 * affects the week it is running rather than the week after.
 *
 * Returns the revenue multiplier this company is under, so the caller applies it once rather than
 * this module reaching into the revenue calculation.
 */
export function tickPvpEffects(s: GameState): { revenueMultiplier: number; prDamage: { hype: number; reputation: number } | null } {
  let prDamage: { hype: number; reputation: number } | null = null

  const prRemaining = s.flags.prTarget ?? 0
  if (prRemaining > 0) {
    prDamage = prWeeklyDamage(prRemaining)
    s.flags.prTarget = prRemaining - 1
    if (s.flags.prTarget <= 0) {
      delete s.flags.prTarget
      delete s.flags.prSourceKnown
    }
  }

  let revenueMultiplier = 1
  const warRemaining = s.flags.priceWar ?? 0
  if (warRemaining > 0) {
    revenueMultiplier = priceWarMultiplier((s.flags.priceWarInitiator ?? 0) === 1, marginOf(s))
    s.flags.priceWar = warRemaining - 1
    if (s.flags.priceWar <= 0) {
      delete s.flags.priceWar
      delete s.flags.priceWarInitiator
    }
  }

  return { revenueMultiplier, prDamage }
}
