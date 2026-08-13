// Advisor content — §28-§33's opinion engine as data, §76's panel as fragments.
//
// Two tables and two pools:
//
//   SEAT_DEFS       — what each seat WEIGHS (§28) and what verb it reaches for (§31's bias, the
//                     part of it that is role-shaped). The engine multiplies these by the week's
//                     facts; nothing here is a judgement about any particular run.
//   ADVISOR_FRAGMENTS — how an opinion is worded. 'advisor.reaction' is the verdict line, gated
//                     on the stance tag plus personality/style so two CFOs with different
//                     temperaments deliver the same call differently; 'advisor.context' is the
//                     grounded reason, gated on topic + direction and carrying the week's actual
//                     numbers in slots (§66: every line depends on at least two contextual
//                     dimensions — the number and the interpretation).
//
// Slot discipline matches the other pools: a context fragment whose slot the reader did not
// supply is ineligible, so a topic can never borrow another topic's sentence.

import type { AdvisorSeat, AdvisorStance, Fragment, FragmentLibrary } from '../types'
import type { MessageShape } from './composer-shapes'

/** Everything an advisor can choose to talk about. A topic is a fact family, not an event. */
export type AdvisorTopic =
  | 'runway'
  | 'profit'
  | 'growth'
  | 'retention'
  | 'quality'
  | 'pmf'
  | 'marketing'
  | 'morale'
  | 'board'
  | 'market'
  // Phase 7 (§35): a promise coming due, delivered, or missed. The fact itself is produced by
  // world/promises.ts from the promise ledger, so a run without that capability never has one.
  | 'commitment'

export const ADVISOR_TOPICS: readonly AdvisorTopic[] = [
  'runway',
  'profit',
  'growth',
  'retention',
  'quality',
  'pmf',
  'marketing',
  'morale',
  'board',
  'market',
  'commitment',
]

export interface SeatDef {
  /** Panel heading fallback when the seat's character has no title. */
  label: string
  /** §28. How much of this seat's attention each topic commands. Unlisted topic = invisible to the seat. */
  weights: Partial<Record<AdvisorTopic, number>>
  /** §31, the role-shaped half of bias: the verb this seat reaches for, per topic and direction. */
  stances: Partial<Record<AdvisorTopic, { bad: AdvisorStance; good: AdvisorStance }>>
}

// The weights are deliberately NOT identical (§28): the same week must read differently from each
// chair, which is where §29's disagreement comes from — no seat is wrong, they are weighing.
export const SEAT_DEFS: Record<AdvisorSeat, SeatDef> = {
  finance: {
    label: 'Finance',
    weights: { runway: 0.3, profit: 0.25, marketing: 0.2, growth: 0.1, board: 0.1, market: 0.05, commitment: 0.15 },
    stances: {
      runway: { bad: 'cut', good: 'celebrate' },
      profit: { bad: 'cut', good: 'celebrate' },
      marketing: { bad: 'cut', good: 'hold' },
      growth: { bad: 'warn', good: 'hold' },
      board: { bad: 'warn', good: 'hold' },
      market: { bad: 'warn', good: 'hold' },
      // §35's mid-way warning: "we're not currently on track for the commitment" is a CFO line.
      commitment: { bad: 'warn', good: 'hold' },
    },
  },
  growth: {
    label: 'Growth',
    // §31: the sales chair overrates pipeline. Growth and marketing dominate, runway barely
    // registers — and its answer to a marketing problem is to push through it, not to cut.
    weights: { growth: 0.3, marketing: 0.25, pmf: 0.15, market: 0.1, morale: 0.1, runway: 0.1 },
    stances: {
      growth: { bad: 'push', good: 'push' },
      marketing: { bad: 'push', good: 'push' },
      pmf: { bad: 'warn', good: 'push' },
      market: { bad: 'hold', good: 'push' },
      morale: { bad: 'warn', good: 'celebrate' },
      runway: { bad: 'warn', good: 'push' },
    },
  },
  product: {
    label: 'Product',
    // §31: the product chair underweights aggressive distribution — strong growth without
    // retention behind it reads to this seat as risk, hence good growth → 'hold'.
    weights: { retention: 0.3, quality: 0.25, pmf: 0.2, growth: 0.1, morale: 0.15 },
    stances: {
      retention: { bad: 'fix', good: 'celebrate' },
      quality: { bad: 'fix', good: 'celebrate' },
      pmf: { bad: 'fix', good: 'celebrate' },
      growth: { bad: 'hold', good: 'hold' },
      morale: { bad: 'warn', good: 'celebrate' },
    },
  },
  investor: {
    label: 'Board',
    // §31: the growth investor pushes expansion; the board chair also owns the commitments —
    // literally, now: 'commitment' is the promise ledger speaking, and it outweighs everything
    // else in this chair because the person you promised is the person doing the weighing.
    weights: { growth: 0.3, board: 0.25, market: 0.15, runway: 0.15, pmf: 0.15, commitment: 0.35 },
    stances: {
      growth: { bad: 'warn', good: 'push' },
      board: { bad: 'warn', good: 'celebrate' },
      market: { bad: 'hold', good: 'push' },
      runway: { bad: 'warn', good: 'push' },
      pmf: { bad: 'warn', good: 'push' },
      commitment: { bad: 'warn', good: 'celebrate' },
    },
  },
}

export const ADVISOR_SEATS: readonly AdvisorSeat[] = ['finance', 'growth', 'product', 'investor']

// ---------- fragments ----------

// The verdict line. Gated on the stance tag; personality/style conditions are what make the same
// call sound like a different person. Every stance keeps one unconditioned line so a seat is
// never silenced by an unlucky temperament.
const reactions: readonly Fragment[] = [
  // cut
  { id: 'adv.re.cut.slow_spending', type: 'reaction', text: 'Slow spending.', tags: ['cut'], weight: 3, conditions: { requiresTags: ['cut'] } },
  { id: 'adv.re.cut.now', type: 'reaction', text: 'Cut burn now, not next quarter.', tags: ['cut'], weight: 3, conditions: { requiresTags: ['cut'], personalityMin: { directness: 60 } } },
  { id: 'adv.re.cut.everything_discretionary', type: 'reaction', text: 'I would freeze everything discretionary this week.', tags: ['cut'], weight: 2, conditions: { requiresTags: ['cut'], styles: ['formal', 'cautious', 'analytical'] } },
  { id: 'adv.re.cut.buying_time', type: 'reaction', text: 'Every dollar we keep is a week we buy.', tags: ['cut'], weight: 2, conditions: { requiresTags: ['cut'], personalityMin: { optimism: 55 } } },
  // push
  { id: 'adv.re.push.keep_pushing', type: 'reaction', text: 'Keep pushing.', tags: ['push'], weight: 3, conditions: { requiresTags: ['push'] } },
  { id: 'adv.re.push.wrong_time_to_slow', type: 'reaction', text: 'Now is exactly the wrong time to slow down.', tags: ['push'], weight: 3, conditions: { requiresTags: ['push'], personalityMin: { riskTolerance: 55 } } },
  { id: 'adv.re.push.momentum_rare', type: 'reaction', text: 'Momentum like this is rare — lean into it.', tags: ['push'], weight: 3, conditions: { requiresTags: ['push'], personalityMin: { optimism: 55 } } },
  { id: 'adv.re.push.cutting_mistake', type: 'reaction', text: 'Cutting here would be a mistake.', tags: ['push'], weight: 2, conditions: { requiresTags: ['push'], personalityMin: { directness: 60 } } },
  // fix
  { id: 'adv.re.fix.first', type: 'reaction', text: 'Fix this first.', tags: ['fix'], weight: 3, conditions: { requiresTags: ['fix'] } },
  { id: 'adv.re.fix.upstream', type: 'reaction', text: 'The problem is upstream of sales.', tags: ['fix'], weight: 3, conditions: { requiresTags: ['fix'], styles: ['analytical', 'direct', 'blunt'] } },
  { id: 'adv.re.fix.before_buying_growth', type: 'reaction', text: 'Stop buying growth until this is fixed.', tags: ['fix'], weight: 2, conditions: { requiresTags: ['fix'], personalityMin: { directness: 55 } } },
  { id: 'adv.re.fix.foundations', type: 'reaction', text: 'I would put the team on the foundations this week.', tags: ['fix'], weight: 2, conditions: { requiresTags: ['fix'], styles: ['formal', 'cautious', 'warm'] } },
  // hold
  { id: 'adv.re.hold.steady', type: 'reaction', text: 'Hold steady.', tags: ['hold'], weight: 3, conditions: { requiresTags: ['hold'] } },
  { id: 'adv.re.hold.no_sudden_moves', type: 'reaction', text: 'No sudden moves.', tags: ['hold'], weight: 2, conditions: { requiresTags: ['hold'], styles: ['cautious', 'analytical', 'formal'] } },
  { id: 'adv.re.hold.working', type: 'reaction', text: "Don't touch what's working.", tags: ['hold'], weight: 2, conditions: { requiresTags: ['hold'], personalityMin: { patience: 55 } } },
  // warn
  { id: 'adv.re.warn.attention', type: 'reaction', text: 'This needs your attention.', tags: ['warn'], weight: 3, conditions: { requiresTags: ['warn'] } },
  { id: 'adv.re.warn.serious', type: 'reaction', text: 'I would treat this as serious.', tags: ['warn'], weight: 3, conditions: { requiresTags: ['warn'], styles: ['formal', 'cautious', 'analytical'] } },
  { id: 'adv.re.warn.before_expensive', type: 'reaction', text: "Flagging this before it gets expensive.", tags: ['warn'], weight: 2, conditions: { requiresTags: ['warn'], personalityMin: { directness: 55 } } },
  { id: 'adv.re.warn.not_panicking', type: 'reaction', text: "I'm not panicking, but I'm watching this.", tags: ['warn'], weight: 2, conditions: { requiresTags: ['warn'], personalityMin: { optimism: 55 } } },
  // celebrate
  { id: 'adv.re.cel.take_the_win', type: 'reaction', text: 'Take the win.', tags: ['celebrate'], weight: 3, conditions: { requiresTags: ['celebrate'] } },
  { id: 'adv.re.cel.what_good_looks_like', type: 'reaction', text: 'This is what good looks like.', tags: ['celebrate'], weight: 3, conditions: { requiresTags: ['celebrate'], personalityMin: { optimism: 50 } } },
  { id: 'adv.re.cel.credit', type: 'reaction', text: 'Credit where due — this is working.', tags: ['celebrate'], weight: 2, conditions: { requiresTags: ['celebrate'], personalityMin: { empathy: 50 } } },
]

// The grounded reason. Gated on topic + direction; the slots ARE the week's facts, so the same
// fragment can never say the same thing about two different weeks.
const contexts: readonly Fragment[] = [
  // runway — {runway} arrives preformatted ('1 week' / '9 weeks') so no fragment has to pluralise
  { id: 'adv.cx.runway.weeks_left', type: 'context', text: 'We have {runway} of cash at this burn', tags: ['runway', 'bad'], weight: 3, conditions: { requiresTags: ['runway', 'bad'] } },
  { id: 'adv.cx.runway.account_empty', type: 'context', text: 'At the current burn the account is empty in {runway}', tags: ['runway', 'bad'], weight: 3, conditions: { requiresTags: ['runway', 'bad'] } },
  { id: 'adv.cx.runway.hiring_stops', type: 'context', text: 'Runway is {runway} — below ten weeks, hiring and fundraising both get harder', tags: ['runway', 'bad'], weight: 2, conditions: { requiresTags: ['runway', 'bad'] } },
  // profit
  { id: 'adv.cx.profit.made_more', type: 'context', text: 'We took in {revenue} against {expenses} out last week — the business pays for itself', tags: ['profit', 'good'], weight: 3, conditions: { requiresTags: ['profit', 'good'] } },
  { id: 'adv.cx.profit.margin_gone', type: 'context', text: 'Expenses ran {expenses} against {revenue} of revenue last week', tags: ['profit', 'bad'], weight: 3, conditions: { requiresTags: ['profit', 'bad'] } },
  // growth
  { id: 'adv.cx.growth.weekly_pace', type: 'context', text: 'Users are compounding at {growth} a week over the last month', tags: ['growth', 'good'], weight: 3, conditions: { requiresTags: ['growth', 'good'] } },
  { id: 'adv.cx.growth.best_channel', type: 'context', text: '{growth} weekly growth is the kind of pace rounds get raised on', tags: ['growth', 'good'], weight: 2, conditions: { requiresTags: ['growth', 'good'] } },
  { id: 'adv.cx.growth.stalled', type: 'context', text: 'Growth has stalled at {growth} a week', tags: ['growth', 'bad'], weight: 3, conditions: { requiresTags: ['growth', 'bad'] } },
  { id: 'adv.cx.growth.shrinking', type: 'context', text: 'We grew {growth} a week over the last month — the top of the funnel is not replacing what churn takes', tags: ['growth', 'bad'], weight: 2, conditions: { requiresTags: ['growth', 'bad'] } },
  // retention
  { id: 'adv.cx.retention.leaving', type: 'context', text: 'Only {retention} of the customers we win are still here four weeks later', tags: ['retention', 'bad'], weight: 3, conditions: { requiresTags: ['retention', 'bad'] } },
  { id: 'adv.cx.retention.bucket', type: 'context', text: "At {retention} four-week retention we are filling a leaking bucket", tags: ['retention', 'bad'], weight: 3, conditions: { requiresTags: ['retention', 'bad'] } },
  { id: 'adv.cx.retention.sticking', type: 'context', text: '{retention} of new customers are still active after four weeks', tags: ['retention', 'good'], weight: 3, conditions: { requiresTags: ['retention', 'good'] } },
  // quality
  { id: 'adv.cx.quality.bugs_churn', type: 'context', text: 'Bugs are at {bugs} and every one of them is churn we paid to acquire', tags: ['quality', 'bad'], weight: 3, conditions: { requiresTags: ['quality', 'bad'] } },
  { id: 'adv.cx.quality.support_load', type: 'context', text: 'The bug count is {bugs} — support load is eating the roadmap', tags: ['quality', 'bad'], weight: 2, conditions: { requiresTags: ['quality', 'bad'] } },
  { id: 'adv.cx.quality.solid', type: 'context', text: 'Quality sits at {quality} with bugs at {bugs} — the product can carry more users than we are sending it', tags: ['quality', 'good'], weight: 3, conditions: { requiresTags: ['quality', 'good'] } },
  // pmf
  { id: 'adv.cx.pmf.behind_pace', type: 'context', text: 'PMF reads {pmf} against roughly {pace} expected by week {week}', tags: ['pmf', 'bad'], weight: 3, conditions: { requiresTags: ['pmf', 'bad'] } },
  { id: 'adv.cx.pmf.not_biting', type: 'context', text: 'The market is not biting — PMF is {pmf} and spend cannot fix that', tags: ['pmf', 'bad'], weight: 2, conditions: { requiresTags: ['pmf', 'bad'] } },
  { id: 'adv.cx.pmf.pulling', type: 'context', text: 'PMF is {pmf} — the market is starting to pull instead of being pushed', tags: ['pmf', 'good'], weight: 3, conditions: { requiresTags: ['pmf', 'good'] } },
  // marketing
  { id: 'adv.cx.marketing.cost_per_user', type: 'context', text: 'We spent {marketing} on marketing last week and netted {added} new users', tags: ['marketing', 'bad'], weight: 3, conditions: { requiresTags: ['marketing', 'bad'] } },
  { id: 'adv.cx.marketing.efficiency', type: 'context', text: 'Acquisition efficiency is deteriorating — {marketing} a week of spend is buying less than it did a month ago', tags: ['marketing', 'bad'], weight: 3, conditions: { requiresTags: ['marketing', 'bad'] } },
  { id: 'adv.cx.marketing.paying_off', type: 'context', text: '{marketing} a week of marketing is converting — the funnel is the strongest part of the business right now', tags: ['marketing', 'good'], weight: 3, conditions: { requiresTags: ['marketing', 'good'] } },
  // morale
  { id: 'adv.cx.morale.low', type: 'context', text: 'Team morale is at {morale} and output follows morale with a lag', tags: ['morale', 'bad'], weight: 3, conditions: { requiresTags: ['morale', 'bad'] } },
  { id: 'adv.cx.morale.exits', type: 'context', text: 'Morale is {morale} — people polish their CVs long before they resign', tags: ['morale', 'bad'], weight: 2, conditions: { requiresTags: ['morale', 'bad'] } },
  { id: 'adv.cx.morale.high', type: 'context', text: 'Morale is {morale} — the team is running hot in the good sense', tags: ['morale', 'good'], weight: 3, conditions: { requiresTags: ['morale', 'good'] } },
  // board
  { id: 'adv.cx.board.behind_target', type: 'context', text: 'The board expects {target} weekly growth and we are delivering {growth}', tags: ['board', 'bad'], weight: 3, conditions: { requiresTags: ['board', 'bad'] } },
  { id: 'adv.cx.board.strikes', type: 'context', text: 'We are behind the {target} commitment with {strikes} strike(s) already on the table', tags: ['board', 'bad'], weight: 3, conditions: { requiresTags: ['board', 'bad'] } },
  { id: 'adv.cx.board.on_target', type: 'context', text: 'We are ahead of the {target} the board asked for', tags: ['board', 'good'], weight: 3, conditions: { requiresTags: ['board', 'good'] } },
  // market
  { id: 'adv.cx.market.winter', type: 'context', text: 'The funding market is frozen — raising in this climate costs twice the dilution', tags: ['market', 'bad'], weight: 3, conditions: { requiresTags: ['market', 'bad'] } },
  { id: 'adv.cx.market.window', type: 'context', text: 'Capital is cheap right now, and windows like this close without notice', tags: ['market', 'good'], weight: 3, conditions: { requiresTags: ['market', 'good'] } },
  // commitment (§35) — the promise ledger speaking. 'due' tags a deadline still ahead, 'settled'
  // tags this week's verdict; the fact carries the tag, so an approaching commitment can never
  // borrow the "we missed it" sentence or vice versa.
  { id: 'adv.cx.commitment.off_track', type: 'context', text: 'The {commitment} commitment lands {duein} and we are not currently on track for it', tags: ['commitment', 'bad'], weight: 3, conditions: { requiresTags: ['commitment', 'bad', 'due'] } },
  { id: 'adv.cx.commitment.clock', type: 'context', text: 'You committed to {commitment} — that clock runs out {duein}', tags: ['commitment', 'bad'], weight: 2, conditions: { requiresTags: ['commitment', 'bad', 'due'] } },
  { id: 'adv.cx.commitment.missed', type: 'context', text: 'We missed the {commitment} commitment — it was promised, and it was not delivered', tags: ['commitment', 'bad'], weight: 3, conditions: { requiresTags: ['commitment', 'bad', 'settled'] } },
  { id: 'adv.cx.commitment.on_track', type: 'context', text: 'The {commitment} commitment lands {duein} and the numbers are there', tags: ['commitment', 'good'], weight: 3, conditions: { requiresTags: ['commitment', 'good', 'due'] } },
  { id: 'adv.cx.commitment.delivered', type: 'context', text: 'You delivered on {commitment}, exactly as committed — that buys real credibility', tags: ['commitment', 'good'], weight: 3, conditions: { requiresTags: ['commitment', 'good', 'settled'] } },
]

export const ADVISOR_FRAGMENTS: FragmentLibrary = {
  'advisor.reaction': reactions,
  'advisor.context': contexts,
}

// One shape: §76's format is fixed — verdict on top, grounded reason under it. Variety lives in
// the fragments and in WHO is speaking, not in the panel's structure.
export const ADVISOR_SHAPES: readonly MessageShape[] = [
  { key: 'adv.view', subject: ['reaction'], body: ['context'], required: ['reaction', 'context'], weight: 1 },
]
