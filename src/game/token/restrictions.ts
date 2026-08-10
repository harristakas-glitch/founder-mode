// Tokenisation — what the fork closes. Slice 1.
//
// Brief §5 (traditional financing restrictions), §47 (fundraising integration), §48 (IPO
// integration), and docs/ico-architecture.md §7.5 (acquisitions).
//
// The governing rule, from §47, and it applies to every function here:
//
//     "Do not silently hide it without explanation."
//
// So none of these return a bare boolean. Each returns a reason written for the player, and the UI
// renders a DISABLED control with that reason attached — never a vanished one. A button that
// disappears teaches nothing; a button that says why it is dark teaches the fork.
//
// Everything is read from `capitalPath(s)`, which is `institutional` unless a token slice exists.
// A run that never tokenised therefore takes the identical branch it always took.

import type { GameState } from '../types'
import { isTokenised } from './state'

export interface PathRestriction {
  closed: boolean
  /** Player-facing. Present whenever `closed` is true. */
  reason?: string
}

const OPEN: PathRestriction = { closed: false }

/**
 * Brief §5 and §47. Series A/B/C and any traditional institutional round.
 *
 * Debt, revenue financing and strategic partnerships are deliberately NOT closed — §5 says not to
 * touch them, and a tokenised company still has a balance sheet.
 */
export function institutionalRoundsClosed(s: GameState): PathRestriction {
  if (!isTokenised(s)) return OPEN
  return {
    closed: true,
    reason:
      'Traditional equity fundraising is unavailable after tokenisation. The funds that price ' +
      'Series rounds will not buy equity in a company whose community already owns the upside. ' +
      'Debt and revenue financing are still open.',
  }
}

/**
 * Brief §48. The conventional IPO.
 *
 * `ipoVisible` deliberately stays TRUE for a tokenised company so this sentence has somewhere to
 * appear. The panel renders, the checklist is replaced by the explanation, and the button is
 * disabled rather than absent.
 */
export function ipoClosed(s: GameState): PathRestriction {
  if (!isTokenised(s)) return OPEN
  return {
    closed: true,
    reason: 'IPO unavailable. This company chose the community-capital path.',
  }
}

/**
 * docs/ico-architecture.md §7.5. The brief contradicts itself here — §45 says the token path's
 * endings are network endings, §5 says "traditional acquisition may remain possible in some
 * scenarios" — and the contract resolves it: acquisition STAYS POSSIBLE BUT IS MATERIALLY WORSE.
 *
 * An acquirer buying a tokenised company is buying a business whose users can be rented, whose
 * community has a claim on the roadmap, and whose token holders are a second constituency at the
 * table. They pay less, and they knock less often.
 *
 * Both numbers below apply only when a token slice exists, so the institutional offer band and the
 * single RNG draw that gates it are untouched for every traditional run — the draw ORDER is
 * identical, only the coefficients differ.
 */
export const TOKEN_ACQUISITION = {
  /** Weekly probability an offer arrives. Institutional runs use 0.03. */
  offerChance: 0.018,
  /** Premium band floor and span. Institutional runs use 1.1 + 0.9 × momentum → 1.10–2.00×. */
  premiumBase: 0.85,
  premiumSpan: 0.55,
} as const

/** True when the reduced acquisition terms apply. */
export function acquisitionDiscounted(s: GameState): boolean {
  return isTokenised(s)
}

/**
 * One place that answers "what did this fork cost me?", for the confirmation dialog (§3) and for
 * the postmortem.
 */
export function closedPaths(s: GameState): string[] {
  const out: string[] = []
  const rounds = institutionalRoundsClosed(s)
  if (rounds.closed && rounds.reason) out.push(rounds.reason)
  const ipo = ipoClosed(s)
  if (ipo.closed && ipo.reason) out.push(ipo.reason)
  if (acquisitionDiscounted(s))
    out.push('Acquisition offers arrive less often and at a lower premium — an acquirer pays less for a company its community co-owns.')
  return out
}

/** Brief §3: what the player is told BEFORE they confirm, in the order the brief writes it. */
export const FORK_WARNINGS: string[] = [
  'Traditional VC fundraising becomes unavailable',
  'The IPO path closes',
  'Institutional investor appetite collapses',
  'Community governance pressure will increase',
  'Token price and treasury value may become volatile',
  'This is permanent. There is no route back to the institutional path.',
]
