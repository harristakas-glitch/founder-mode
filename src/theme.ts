// Presentation constants shared across the UI — the tables that used to be copied into whichever
// file needed them next.
//
// This module exists because neither of the obvious homes worked. `App.tsx` owns the in-game accent
// binding but a screen importing from `App.tsx` is a cycle; `components.tsx` pulls in React, and
// `shareImage.ts` draws to a canvas and must stay React-free. So: no imports, no JSX, no runtime
// dependencies. Anything that is *data about how the game looks* belongs here rather than beside
// its first consumer.

import type { GameOver } from './game/types'

/** Each market gets its own accent identity — the whole UI subtly rethemes per run. */
export const SECTOR_ACCENTS: Record<string, [string, string]> = {
  saas: ['#7c9aff', '#a78bfa'],
  social: ['#f472b6', '#fb7185'],
  fintech: ['#34d399', '#2dd4bf'],
  devtools: ['#a78bfa', '#818cf8'],
  ecommerce: ['#fbbf24', '#fb923c'],
  aiml: ['#22d3ee', '#38bdf8'],
}

/** Accent pair for a sector id, falling back to the house blue for an unknown one. */
export const sectorAccent = (id: string | undefined): [string, string] => SECTOR_ACCENTS[id ?? 'saas'] ?? SECTOR_ACCENTS.saas

/**
 * Each experience gets its own light: Quick is the house electric blue, Career the institutional
 * gold it earns, Arena the heat of a fight. Deliberately expressed in terms of the sector palette —
 * these are the same three pairs, and letting them drift apart would be an accident, not a choice.
 */
export const MODE_ACCENTS: Record<'quick' | 'career' | 'arena', [string, string]> = {
  quick: SECTOR_ACCENTS.saas,
  career: SECTOR_ACCENTS.ecommerce,
  arena: SECTOR_ACCENTS.social,
}

export type EndingType = GameOver['type']

/**
 * How each ending is presented. One table, keyed on the ending union so the type checker catches a
 * new ending that nobody gave a face to.
 *
 * `name` is the compact label (results table, history list); `title` is the sentence-shaped one the
 * share card uses. Both vocabularies are deliberate and both were already in the codebase — this
 * only stops them being maintained in two files that did not know about each other.
 */
export const ENDINGS: Record<EndingType, { emoji: string; name: string; title: string }> = {
  unicorn: { emoji: '🦄', name: 'Unicorn', title: 'Unicorn' },
  ipo: { emoji: '🔔', name: 'IPO', title: 'Rang the bell' },
  acquired: { emoji: '🤝', name: 'Acquired', title: 'Acquired' },
  timeup: { emoji: '⏱', name: 'Time up', title: 'Challenge complete' },
  fired: { emoji: '🪑', name: 'Fired', title: 'Fired by the board' },
  bankrupt: { emoji: '💸', name: 'Bankrupt', title: 'Out of money' },
}

/**
 * The emoji for an ending that arrived from somewhere untrusted — a peer's presence blob, a
 * leaderboard row, an old save. Never throws and never renders `undefined`; the two call sites that
 * had no fallback at all are the reason this is a function rather than a bare lookup.
 */
export const endingEmoji = (type: string | undefined): string => ENDINGS[type as EndingType]?.emoji ?? '🏁'

/** Where the game lives. Used by the share links and printed on the share card. */
export const GAME_URL = 'https://harristakas-glitch.github.io/founder-mode/'
