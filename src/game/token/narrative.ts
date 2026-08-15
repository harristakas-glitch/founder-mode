// Tokenisation — the beats that reach the player. Slice 7. Brief §59 and §72.
//
// ---------------------------------------------------------------------------------------------
// THE GAP THIS CLOSES, STATED PLAINLY
//
// Slices 2–6 built a rich ledger and mailed almost none of it. `token.history` records launches,
// crashes, rallies, unlocks, votes, exoduses and milestones; `src/game/story.ts` reads that ledger
// and turns it into the run biography. So a 40% crash in week 51 was a sentence in the postmortem
// and NOTHING during the run — no inbox mail, no flash, nothing a player who did not open the
// token chart that week would ever see. The economy was legible only in retrospect.
//
// This module is the missing half. It is a PURE OBSERVER of the week the tick just wrote:
//
//   * it turns the ledger entries a player should not miss into inbox mail, rate-limited;
//   * it adds the three ledger entries nothing else produces — the utility milestone `story.ts`
//     has always known how to narrate but nothing ever wrote, the holder milestones, and the
//     network marks on the road to the `network` ending.
//
// It decides nothing. It moves no price, no trust, no supply. Every number it prints was computed
// by another module in the same week.
//
// ---------------------------------------------------------------------------------------------
// WHY IT WRITES TO `history` AND THE INBOX RATHER THAN THROUGH THE LIVING-WORLD DIRECTOR
//
// The Director emits ONE lead beat and a couple of also-rans per week, scored against runway
// crises, revenue drops and morale. A token crash routed through it competes with those and is
// dropped in most weeks it happens — which is fine for colour and wrong for consequence. Every
// other token module (governance.ts, community.ts, treasury.ts) already mails its own
// consequential events directly with a prefixed id, and `story.ts` is written around exactly that:
// it SKIPS `token-`/`gov-` inbox mail on the grounds that the ledger narrates those weeks. So the
// house pattern for token consequence is the direct one, and following it is what keeps the
// biography from saying every beat twice. Colour routed through the composer is a separate,
// additive job; see `tokenNarrativeCandidates` at the foot of this file.
//
// DETERMINISM: nothing here draws, reads the clock, or branches on anything but state.

import type { GameState } from '../types'
import { hasCapability } from '../modes'
import { networkEndingProgress } from './endings'
import { networkValue } from './scoring'
import { TOKEN_ENDINGS, TOKEN_LIMITS, TOKEN_NARRATIVE, type TokenHistoryEntry, type TokenState } from './types'

const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`

/** Is the narrative layer live? */
export function tokenNarrativeActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenNarrative')
}

export interface TokenNarrativeReport {
  ran: boolean
  /** Ledger entries this module ADDED this week. */
  recorded: TokenHistoryEntry['type'][]
  /** Inbox messages it sent. At most one per week, by construction. */
  mailed: string | null
}

export const NARRATIVE_IDLE: TokenNarrativeReport = { ran: false, recorded: [], mailed: null }

/** Has this exact milestone already been said? The ledger is the memory — no new state. */
function alreadySaid(t: TokenState, type: TokenHistoryEntry['type'], kind: string): boolean {
  return t.history.some((h) => h.type === type && String(h.metadata.kind ?? '') === kind)
}

function push(t: TokenState, entry: TokenHistoryEntry): void {
  t.history.push(entry)
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)
}

/**
 * Weeks since the last token beat reached the inbox. Derived by scanning the inbox — which is
 * never trimmed and is unshift-ordered newest-first — rather than stored, so it cannot desync from
 * a reload and no later slice has to remember to reset it.
 */
function weeksSinceLastBeat(s: GameState): number {
  for (const m of s.inbox) {
    if (typeof m?.id === 'string' && m.id.startsWith('token-beat-')) return s.week - m.week
  }
  return Number.POSITIVE_INFINITY
}

/**
 * The week, narrated. Runs AFTER `tickToken`, so `t.history` already holds whatever the week
 * recorded and every level is at its close.
 */
export function tickTokenNarrative(s: GameState): TokenNarrativeReport {
  const t = s.token
  if (!t || !tokenNarrativeActive(s)) return NARRATIVE_IDLE
  const recorded: TokenHistoryEntry['type'][] = []

  // ---- 1. the ledger entries nothing else writes ----

  // The beat `story.ts` has always known how to narrate ("the token is being used for the thing
  // itself — utility, not just a chart") and which no module has ever produced. Utility is the one
  // quantity in this economy that cannot be bought (§25), so crossing a bar on it is the single
  // most meaningful thing the token can do.
  if (t.market.utility >= TOKEN_NARRATIVE.utilityMilestone && !alreadySaid(t, 'utility_milestone', 'utility')) {
    push(t, {
      week: s.week,
      type: 'utility_milestone',
      importance: 70,
      metadata: { kind: 'utility', utility: Math.round(t.market.utility), price: t.market.price },
    })
    recorded.push('utility_milestone')
  }

  for (const bar of TOKEN_NARRATIVE.holderMilestones) {
    if (t.community.holders >= bar && !alreadySaid(t, 'community_milestone', `holders_${bar}`)) {
      push(t, {
        week: s.week,
        type: 'community_milestone',
        importance: 50,
        metadata: { kind: `holders_${bar}`, holders: t.community.holders, trust: Math.round(t.community.trust) },
      })
      recorded.push('community_milestone')
    }
  }

  const nv = networkValue(s)
  for (const bar of TOKEN_NARRATIVE.networkMilestones) {
    if (nv >= bar && !alreadySaid(t, 'network_milestone', `value_${bar}`)) {
      push(t, {
        week: s.week,
        type: 'network_milestone',
        importance: 60,
        metadata: { kind: `value_${bar}`, networkValue: Math.round(nv), utility: Math.round(t.market.utility) },
      })
      recorded.push('network_milestone')
    }
  }

  // ---- 2. the mail ----
  // One beat per week at most, and only after the cooldown. The ledger keeps recording either way,
  // so a beat suppressed here is still in the biography — it just did not interrupt the player.
  if (weeksSinceLastBeat(s) < TOKEN_NARRATIVE.cooldownWeeks) return { ran: true, recorded, mailed: null }

  const thisWeek = t.history.filter((h) => h.week === s.week)
  if (thisWeek.length === 0) return { ran: true, recorded, mailed: null }

  // Heaviest first — the ledger already scores every entry for the Director's benefit (§59), and
  // reusing that score is why this file needs no second opinion about what matters.
  const ranked = [...thisWeek].sort((a, b) => b.importance - a.importance)
  for (const entry of ranked) {
    const mail = compose(s, t, entry)
    if (!mail) continue
    s.inbox.unshift({ id: `token-beat-${entry.type}-${s.week}`, week: s.week, kind: 'news', title: mail.title, body: mail.body })
    return { ran: true, recorded, mailed: entry.type }
  }
  return { ran: true, recorded, mailed: null }
}

/**
 * One ledger entry → one piece of mail, or null when it does not clear the bar for interrupting
 * anyone. Facts only: every number quoted here was written by the module that produced the entry.
 */
function compose(s: GameState, t: TokenState, e: TokenHistoryEntry): { title: string; body: string } | null {
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const price = `$${t.market.price < 1 ? t.market.price.toFixed(4) : t.market.price.toFixed(2)}`

  switch (e.type) {
    case 'price_crash': {
      const move = num(e.metadata.move)
      if (move > TOKEN_NARRATIVE.mailCrashMove) return null
      const pct = Math.round(Math.abs(move) * 100)
      return {
        title: `The token is down ${pct}% this week`,
        body:
          `${price}, from ${money(t.market.price / Math.max(0.01, 1 + move))} seven days ago. Speculation is at ` +
          `${Math.round(t.market.speculation)} against real utility of ${Math.round(t.market.utility)}, and a market that far ahead of ` +
          `its fundamentals comes back to them — gravity is the model, not a mood.\n\n` +
          `What actually matters: the holders who bought this week are underwater, sentiment is ${Math.round(t.community.sentiment)} ` +
          `and trust is ${Math.round(t.community.trust)}. Nothing about the product changed. Everything about the mood did, and mood ` +
          `is what your market's depth is made of.`,
      }
    }
    case 'price_rally': {
      const move = num(e.metadata.move)
      if (move < TOKEN_NARRATIVE.mailRallyMove) return null
      return {
        title: `The token is up ${Math.round(move * 100)}% this week`,
        body:
          `${price}. The forums have discovered your roadmap and are reading it generously.\n\n` +
          `Speculation is at ${Math.round(t.market.speculation)} and utility at ${Math.round(t.market.utility)}. If those numbers are ` +
          `far apart, this is a crowd rather than a re-rating, and the same gravity that lifted the price this week is the one that ` +
          `will hand it back. Everyone is a genius in a rising market.`,
      }
    }
    case 'unlock': {
      const tokens = num(e.metadata.tokens)
      if (tokens / Math.max(1, t.supply.circulating) < TOKEN_NARRATIVE.mailUnlockFloatShare) return null
      return {
        title: 'A vesting unlock hits the float',
        body:
          `${Math.round(tokens).toLocaleString()} tokens came out of the locked bucket this week — the schedule you chose on launch ` +
          `day, arriving on time. ${Math.round(num(e.metadata.lockedLeft)).toLocaleString()} are still locked.\n\n` +
          `Nobody sold anything. The float simply got bigger, and every remaining token is now worth slightly less of the same ` +
          `network. This is the cost of a short vesting policy, and it is charged whether or not anyone takes the money.`,
      }
    }
    case 'utility_milestone':
      return {
        title: 'People are using the token for the thing itself',
        body:
          `Utility crossed ${Math.round(num(e.metadata.utility))}. That number is the one thing in this economy you cannot buy — ` +
          `treasury spend reaches engagement, not utility, and it never has — so it moved because the product got good enough that ` +
          `the token became the way to use it.\n\n` +
          `Utility is the anchor everything else reverts toward: it is what speculation mean-reverts TO, a third of what your exit ` +
          `discount reads, and a clause in the network ending's gate. This is the least exciting good news you will get and the ` +
          `most durable.`,
      }
    case 'community_milestone': {
      const kind = String(e.metadata.kind ?? '')
      if (!kind.startsWith('holders_')) return null
      const holders = num(e.metadata.holders)
      return {
        title: `${Math.round(holders).toLocaleString()} holders`,
        body:
          `The community passed ${Math.round(holders).toLocaleString()} holders this week, at ${Math.round(num(e.metadata.trust))} ` +
          `trust.\n\n` +
          `They are not your customers — plenty of them have never used the product — and they are not your investors either, ` +
          `because nobody negotiated anything with them. They are the closest thing this company has to an electorate, and ` +
          `governance is going to make that literal.`,
      }
    }
    case 'network_milestone': {
      const prog = networkEndingProgress(s)
      const missing = prog.clauses.filter((c) => !c.met)
      return {
        title: `The network is worth ${money(num(e.metadata.networkValue))}`,
        body:
          `Price × float, in public, continuously. It is not your company's valuation and it is not your money — but it is the ` +
          `number the network's own ending is measured on, and it needs ${money(TOKEN_ENDINGS.networkValue)}.\n\n` +
          (missing.length === 0
            ? 'Every other clause is already met. Hold it.'
            : `Still standing between you and it:\n${missing.map((c) => `• ${c.label}`).join('\n')}`),
      }
    }
    // Everything else already mails itself from the module that owns it — the launch, treasury
    // sales, founder sales, every governance beat, the exodus. Saying them again here would be the
    // same week twice, which is the exact failure `story.ts`'s `told` set exists to prevent.
    default:
      return null
  }
}
