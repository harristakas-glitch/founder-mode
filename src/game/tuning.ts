// THE TUNING TABLE — the balance knobs, as data, in one place.
//
// Before this file, mode- and campaign-tuned constants lived scattered through the engine
// (a board-appetite ternary here, a fuse constant there), so a balance pass meant hunting
// call sites and the diff of a tuning change was illegible. Balance passes edit THIS file;
// the engine reads it. Every value at `standard` difficulty reproduces the pre-table engine
// bit for bit — the golden traces and the balance lockfile pin that.
//
// DIFFICULTY is a player choice (Simulation + Quick Play, chosen at New Game), mapping to a
// small set of honest knobs — the same game, priced differently. `standard` is the calibrated
// baseline every probe band refers to; `relaxed`/`brutal` bands get their own lockfile cells
// once the calibration fleet has measured them.

import type { GameState } from './types'

export type Difficulty = 'relaxed' | 'standard' | 'brutal'

export interface DifficultyKnobs {
  /** seed capital multiplier — the length of the first runway */
  startCashMult: number
  /** board growth-ask multiplier — how hard the people with the fuse push */
  boardTargetMult: number
  /** extra (or fewer) strikes before the ultimatum machinery bites */
  boardFuseDelta: number
  /** term-sheet equity multiplier — what a cheque costs in ownership */
  sheetEquityMult: number
}

export const DIFFICULTY: Record<Difficulty, DifficultyKnobs> = {
  relaxed: { startCashMult: 1.25, boardTargetMult: 0.9, boardFuseDelta: 1, sheetEquityMult: 0.92 },
  standard: { startCashMult: 1, boardTargetMult: 1, boardFuseDelta: 0, sheetEquityMult: 1 },
  brutal: { startCashMult: 0.8, boardTargetMult: 1.12, boardFuseDelta: -1, sheetEquityMult: 1.1 },
}

export function difficultyOf(s: Pick<GameState, 'config'>): Difficulty {
  return s.config?.difficulty ?? 'standard'
}

export function knobs(s: Pick<GameState, 'config'>): DifficultyKnobs {
  return DIFFICULTY[difficultyOf(s)]
}

// ---- consolidated balance-campaign constants (moved from engine call sites, values UNCHANGED) ----

/** Board appetite outside deep career (BALANCE round 2, 2026-08-24): a B2B SaaS board prices
 *  the sector's churn-proof compounding into its ask (measured: 13% quick-saas casual failure
 *  without it, in-band with it); a consumer-app board funds the viral curve and expects it.
 *  Social eased 1.18 → 1.14 (2026-08-26): the quick-social casual cell sat exactly ON the
 *  40% band ceiling, so every unrelated engine change re-rolled the marginal seed — the ask
 *  now leaves a seed of headroom (measured 37.5% with the full item-batch in). */
export const BOARD_APPETITE: Partial<Record<string, number>> = { saas: 1.2, social: 1.14 }

/** Quick-V2 board ease (2026-08-26): the arcade board's asks were calibrated for V1's viral
 *  spikes; the causal engine grows steadier — and consumer sectors most of all (V1 quick
 *  social runs count users in the hundreds of thousands, V2 counts real customers in the
 *  thousands). Same target machinery, priced for the curve it actually funds. */
export const V2_QUICK_BOARD_EASE: Partial<Record<string, number>> = { social: 0.5, fintech: 0.68 }
export const V2_QUICK_BOARD_EASE_DEFAULT = 0.78

/** V2 board fuse (spec §16.4): a board that has stopped believing moves a review early. */
export const V2_FUSE_CONFIDENCE = 35
export const FUSE_STRIKES = { v2LowConfidence: 2, normal: 3 }
