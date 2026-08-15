// Structured interactions — content for §38 (employee conversations), §41-§44 (customer
// interviews) and §46-§47 (board meetings).
//
// THREE TABLES AND ONE POOL, and the split is deliberate:
//
//   INTERVIEW_QUESTIONS  — §41's eight questions, verbatim, each tagged with the truth metric it
//                          probes. The question list is fixed because it is the lesson: a founder
//                          learns which of these is worth asking, not how to phrase them.
//   CUSTOMER_FRAGMENTS   — how a customer answers. Gated on the QUESTION tag plus the tags the
//                          customer's hidden profile produces (§42/§43), so the same question gets
//                          a different sentence from a polite enthusiast and a blunt sceptic —
//                          which is §43's whole point: stated interest is weaker than behaviour.
//   CONVERSATION_TOPICS  — what an employee can raise (§38's list), the tags that let the EXISTING
//                          employee voice pool speak it, and the three things a founder may say
//                          back. No new employee fragments: the person who raises a promotion in a
//                          conversation must sound like the same person who raises it in the inbox.
//   BOARD_DECISIONS      — §47's Accelerate / Maintain / Slow down. Board members react through the
//                          advisor fragment pool (they are reading the same week the advisors read),
//                          so this table carries only the founder's half of the room.
//
// NOTHING HERE CARRIES AN EFFECT ON A SIMULATION FIELD. A founder's answer moves trust, respect,
// alignment, memory and — where it is genuinely a commitment — the promise ledger. It never moves
// morale, salary, headcount or cash: those levers exist elsewhere in the game and duplicating them
// on a narrative surface is exactly the rule this subsystem is built to keep (§64).

import type { Fragment, FragmentLibrary, MemoryTag, MemoryType } from '../types'
import type { RelationshipFactKind } from './relationships-facts'
import { PROMISE_KEYS } from './memory-cues'
import type { MessageShape } from './composer-shapes'

// ---------------------------------------------------------------------------------------
// 1. Customer interviews (§41-§45)
// ---------------------------------------------------------------------------------------

/** The truth metrics an interview can probe. Slugs, matching Career's TruthMetric keys. */
export type InterviewMetric = 'needIntensity' | 'willingnessToPay' | 'productRequirement' | 'acquisitionAccessibility' | 'marketSize'

export interface InterviewQuestion {
  id: string
  /** §41, verbatim. */
  text: string
  /** The tag the answer pool gates on. */
  tag: MemoryTag
  /** What the answer is evidence ABOUT. */
  metric: InterviewMetric
  /**
   * 0–1, how much an answer to THIS question is worth before the customer's own biases are
   * applied. Behaviour beats opinion: "when did it last happen" is a recalled fact, "would you
   * pay" is a hypothetical, and the ladder between them is the thing being taught.
   */
  baseReliability: number
}

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  { id: 'today', text: 'How are you solving this today?', tag: 'q_today', metric: 'needIntensity', baseReliability: 0.62 },
  { id: 'last', text: 'When did this problem last happen?', tag: 'q_last', metric: 'needIntensity', baseReliability: 0.7 },
  { id: 'frustrates', text: 'What frustrates you most?', tag: 'q_frustrates', metric: 'productRequirement', baseReliability: 0.5 },
  { id: 'who_buys', text: 'Who decides whether you buy software?', tag: 'q_who_buys', metric: 'acquisitionAccessibility', baseReliability: 0.75 },
  { id: 'cost', text: 'What does the problem cost you?', tag: 'q_cost', metric: 'willingnessToPay', baseReliability: 0.45 },
  { id: 'pay', text: 'Would you pay for this?', tag: 'q_pay', metric: 'willingnessToPay', baseReliability: 0.24 },
  { id: 'switch', text: 'What would stop you switching?', tag: 'q_switch', metric: 'productRequirement', baseReliability: 0.55 },
  { id: 'why', text: 'Why?', tag: 'q_why', metric: 'needIntensity', baseReliability: 0.4 },
]

export const interviewQuestion = (id: string): InterviewQuestion | undefined => INTERVIEW_QUESTIONS.find((q) => q.id === id)

/**
 * How many questions one session has room for, and how many people are in it. Four questions is
 * the decision: the eight on the list do not all pay, and finding out which ones do is the game.
 */
export const INTERVIEW_QUESTION_BUDGET = 4
export const INTERVIEW_PANEL_SIZE = 3

/** What the segment is doing instead of buying from you. Never a real product name (§71). */
export const INTERVIEW_ALTERNATIVES: readonly string[] = [
  'a spreadsheet',
  'a shared doc nobody owns',
  'two contractors and a group chat',
  'the tool we already pay for, badly',
  'a script one of our engineers wrote',
  'nothing — we just absorb it',
  'a weekly meeting that exists for this',
  'an agency, once a quarter',
]

/** How often, in words. Index by band so the sentence never has to pluralise a raw number. */
export const INTERVIEW_FREQUENCY_WORDS: readonly string[] = [
  'once or twice a year',
  'maybe once a month',
  'most weeks',
  'two or three times a week',
  'several times a day',
]

// The direct answer. Gated on (question tag + a profile tag), which is what makes the same
// question produce a different sentence from a different person. Every question keeps at least two
// profile-free lines so no combination of biases can leave a customer silent.
const customerAnswers: readonly Fragment[] = [
  // --- "How are you solving this today?" -------------------------------------------------
  { id: 'cust.a.today.alt', type: 'reaction', text: 'We mostly handle it with {alternative}.', tags: ['q_today'], weight: 3, conditions: { requiresTags: ['q_today'] } },
  { id: 'cust.a.today.nobody_owns', type: 'reaction', text: 'Honestly? {alternative}, and nobody really owns it.', tags: ['q_today'], weight: 2, conditions: { requiresTags: ['q_today'] } },
  { id: 'cust.a.today.works_fine', type: 'reaction', text: '{alternative}, and it works well enough that nobody has pushed to change it.', tags: ['q_today', 'statusquo'], weight: 4, conditions: { requiresTags: ['q_today', 'statusquo'] } },
  { id: 'cust.a.today.duct_tape', type: 'reaction', text: 'Badly. {alternative}, held together with people remembering to do things.', tags: ['q_today', 'pain_high'], weight: 4, conditions: { requiresTags: ['q_today', 'pain_high'] } },
  { id: 'cust.a.today.tried_everything', type: 'reaction', text: "We've tried three things. Right now it's {alternative} and I'd swap tomorrow.", tags: ['q_today', 'keen'], weight: 3, conditions: { requiresTags: ['q_today', 'keen'] } },

  // --- "When did this problem last happen?" ----------------------------------------------
  { id: 'cust.a.last.plain', type: 'reaction', text: 'It probably happens {frequency}.', tags: ['q_last'], weight: 3, conditions: { requiresTags: ['q_last'] } },
  { id: 'cust.a.last.hedged', type: 'reaction', text: "I'd say {frequency}, though I'm going off memory.", tags: ['q_last'], weight: 2, conditions: { requiresTags: ['q_last'] } },
  { id: 'cust.a.last.today', type: 'reaction', text: 'This morning. It happens {frequency}.', tags: ['q_last', 'freq_high'], weight: 4, conditions: { requiresTags: ['q_last', 'freq_high'] } },
  { id: 'cust.a.last.rare', type: 'reaction', text: '{frequency}. I had to think about it, which probably tells you something.', tags: ['q_last', 'freq_low'], weight: 4, conditions: { requiresTags: ['q_last', 'freq_low'] } },
  { id: 'cust.a.last.friday', type: 'reaction', text: 'Friday, I think. It is roughly {frequency}.', tags: ['q_last'], weight: 3, conditions: { requiresTags: ['q_last'] } },
  { id: 'cust.a.last.ask_team', type: 'reaction', text: 'You would have to ask my team. From where I sit it looks like {frequency}.', tags: ['q_last'], weight: 2, conditions: { requiresTags: ['q_last'] } },
  { id: 'cust.a.last.constant', type: 'reaction', text: 'It never really stops. Call it {frequency} if you need a number.', tags: ['q_last', 'pain_high'], weight: 3, conditions: { requiresTags: ['q_last', 'pain_high'] } },
  { id: 'cust.a.last.calendar', type: 'reaction', text: 'I could look it up. Off the top of my head, {frequency}.', tags: ['q_last'], weight: 2, conditions: { requiresTags: ['q_last'], styles: ['analytical', 'formal', 'cautious'] } },

  // --- "What frustrates you most?" -------------------------------------------------------
  { id: 'cust.a.frustrates.time', type: 'reaction', text: 'The time it eats. Not the task — the chasing around it.', tags: ['q_frustrates'], weight: 3, conditions: { requiresTags: ['q_frustrates'] } },
  { id: 'cust.a.frustrates.rework', type: 'reaction', text: 'Doing the same work twice because the first version went stale.', tags: ['q_frustrates'], weight: 3, conditions: { requiresTags: ['q_frustrates'] } },
  { id: 'cust.a.frustrates.features', type: 'reaction', text: 'It does not do half of what we need. If it had proper approvals and an audit trail we would be fine.', tags: ['q_frustrates', 'featurey'], weight: 4, conditions: { requiresTags: ['q_frustrates', 'featurey'] } },
  { id: 'cust.a.frustrates.blame', type: 'reaction', text: 'When it goes wrong, it goes wrong in front of a customer. That is what I actually mind.', tags: ['q_frustrates', 'pain_high'], weight: 4, conditions: { requiresTags: ['q_frustrates', 'pain_high'] } },
  { id: 'cust.a.frustrates.mild', type: 'reaction', text: 'Frustrates is a strong word. It is mildly annoying about once a month.', tags: ['q_frustrates', 'pain_low'], weight: 4, conditions: { requiresTags: ['q_frustrates', 'pain_low'] } },

  // --- "Who decides whether you buy software?" -------------------------------------------
  { id: 'cust.a.who.me', type: 'reaction', text: 'Me. Under a certain number I just buy it.', tags: ['q_who_buys', 'authority'], weight: 4, conditions: { requiresTags: ['q_who_buys', 'authority'] } },
  { id: 'cust.a.who.me_and_check', type: 'reaction', text: 'I do, and then I tell finance afterwards.', tags: ['q_who_buys', 'authority'], weight: 3, conditions: { requiresTags: ['q_who_buys', 'authority'] } },
  { id: 'cust.a.who.committee', type: 'reaction', text: "It goes to a group. I can recommend it; I can't sign it.", tags: ['q_who_buys', 'no_authority'], weight: 4, conditions: { requiresTags: ['q_who_buys', 'no_authority'] } },
  { id: 'cust.a.who.boss', type: 'reaction', text: 'My director, and their year is already budgeted.', tags: ['q_who_buys', 'no_authority'], weight: 3, conditions: { requiresTags: ['q_who_buys', 'no_authority'] } },
  { id: 'cust.a.who.depends', type: 'reaction', text: 'Depends on the number. Small things are mine.', tags: ['q_who_buys'], weight: 2, conditions: { requiresTags: ['q_who_buys'] } },
  { id: 'cust.a.who.unsure', type: 'reaction', text: "Good question. I'd have to find out.", tags: ['q_who_buys'], weight: 2, conditions: { requiresTags: ['q_who_buys'] } },

  // --- "What does the problem cost you?" -------------------------------------------------
  { id: 'cust.a.cost.hours', type: 'reaction', text: 'A few hours a week of somebody good. Call it whatever that is worth.', tags: ['q_cost'], weight: 3, conditions: { requiresTags: ['q_cost'] } },
  { id: 'cust.a.cost.never_costed', type: 'reaction', text: 'Nobody has ever put a number on it, which probably means it is not big enough to.', tags: ['q_cost'], weight: 3, conditions: { requiresTags: ['q_cost'] } },
  { id: 'cust.a.cost.deal', type: 'reaction', text: 'We lost a renewal over it last year. That is the number I would use.', tags: ['q_cost', 'pain_high'], weight: 4, conditions: { requiresTags: ['q_cost', 'pain_high'] } },
  { id: 'cust.a.cost.small', type: 'reaction', text: 'Not much, if I am honest. It is an irritation, not a line item.', tags: ['q_cost', 'pain_low'], weight: 4, conditions: { requiresTags: ['q_cost', 'pain_low'] } },

  // --- "Would you pay for this?" — §43's whole lesson lives in this block -----------------
  { id: 'cust.a.pay.definitely', type: 'reaction', text: "Yeah, I'd definitely consider it.", tags: ['q_pay', 'polite'], weight: 5, conditions: { requiresTags: ['q_pay', 'polite'] } },
  { id: 'cust.a.pay.love_it', type: 'reaction', text: 'Honestly, this sounds great. I would love to try it.', tags: ['q_pay', 'polite'], weight: 4, conditions: { requiresTags: ['q_pay', 'polite'] } },
  { id: 'cust.a.pay.at_that_price', type: 'reaction', text: 'Not at {price}. That is more than I would get signed off.', tags: ['q_pay', 'price_tight'], weight: 4, conditions: { requiresTags: ['q_pay', 'price_tight'] } },
  { id: 'cust.a.pay.fine', type: 'reaction', text: 'The number is fine at {price}. That is not the part I would argue about.', tags: ['q_pay', 'price_ok'], weight: 4, conditions: { requiresTags: ['q_pay', 'price_ok'] } },
  { id: 'cust.a.pay.today', type: 'reaction', text: 'If it did what you just described, I would put it on a card today.', tags: ['q_pay', 'keen'], weight: 4, conditions: { requiresTags: ['q_pay', 'keen'] } },
  { id: 'cust.a.pay.maybe', type: 'reaction', text: 'Maybe. I would want to see it working on our own data first.', tags: ['q_pay'], weight: 3, conditions: { requiresTags: ['q_pay'] } },
  { id: 'cust.a.pay.budget_cycle', type: 'reaction', text: 'Not this year. Budget is set in the autumn and this is not in it.', tags: ['q_pay'], weight: 2, conditions: { requiresTags: ['q_pay'] } },

  // --- "What would stop you switching?" ---------------------------------------------------
  { id: 'cust.a.switch.migration', type: 'reaction', text: 'Moving everything across. That is a month of somebody I do not have.', tags: ['q_switch'], weight: 3, conditions: { requiresTags: ['q_switch'] } },
  { id: 'cust.a.switch.training', type: 'reaction', text: 'Teaching forty people a new thing. That is the real cost.', tags: ['q_switch'], weight: 3, conditions: { requiresTags: ['q_switch'] } },
  { id: 'cust.a.switch.fine_already', type: 'reaction', text: 'Nothing dramatic. What we have is good enough, and good enough is very hard to beat.', tags: ['q_switch', 'statusquo'], weight: 5, conditions: { requiresTags: ['q_switch', 'statusquo'] } },
  { id: 'cust.a.switch.bar', type: 'reaction', text: 'It would have to clear security review and single sign-on. Everything else is negotiable.', tags: ['q_switch', 'featurey'], weight: 4, conditions: { requiresTags: ['q_switch', 'featurey'] } },
  { id: 'cust.a.switch.nothing', type: 'reaction', text: 'Genuinely nothing. I have wanted to move for a year.', tags: ['q_switch', 'keen'], weight: 4, conditions: { requiresTags: ['q_switch', 'keen'] } },

  // --- "Why?" — the follow-up, and the one that most often collects the real answer -------
  { id: 'cust.a.why.habit', type: 'reaction', text: 'Habit, mostly. Nobody has had a reason to open the question.', tags: ['q_why'], weight: 3, conditions: { requiresTags: ['q_why'] } },
  { id: 'cust.a.why.priorities', type: 'reaction', text: 'Because there are four things ahead of it and there always will be.', tags: ['q_why'], weight: 3, conditions: { requiresTags: ['q_why'] } },
  { id: 'cust.a.why.burned', type: 'reaction', text: 'We bought something like this before and it did not survive contact with us.', tags: ['q_why', 'statusquo'], weight: 4, conditions: { requiresTags: ['q_why', 'statusquo'] } },
  { id: 'cust.a.why.mandate', type: 'reaction', text: 'Because it is my name on it when it goes wrong.', tags: ['q_why', 'pain_high'], weight: 4, conditions: { requiresTags: ['q_why', 'pain_high'] } },
  { id: 'cust.a.why.curious', type: 'reaction', text: 'Because I like trying things and most of my team does not.', tags: ['q_why', 'keen'], weight: 3, conditions: { requiresTags: ['q_why'] , personalityMin: { optimism: 55 } } },
]

// The trailing qualifier — §44's "although I'm not actually the person who signs off on software".
// Gated on the profile ONLY, so any answer can pick one up, which is what makes an enthusiastic
// sentence quietly disqualify itself.
const customerQualifiers: readonly Fragment[] = [
  { id: 'cust.q.not_signer', type: 'context', text: "Although I'm not actually the person who signs off on software.", tags: ['no_authority'], weight: 4, conditions: { requiresTags: ['no_authority'] } },
  { id: 'cust.q.would_need_boss', type: 'context', text: "I'd have to get my director behind it, and they're hard to get in a room.", tags: ['no_authority'], weight: 3, conditions: { requiresTags: ['no_authority'] } },
  { id: 'cust.q.good_enough', type: 'context', text: "It's annoying, but honestly our current workaround is good enough.", tags: ['statusquo'], weight: 4, conditions: { requiresTags: ['statusquo'] } },
  { id: 'cust.q.no_appetite', type: 'context', text: 'There is no appetite here for another migration this year.', tags: ['statusquo'], weight: 3, conditions: { requiresTags: ['statusquo'] } },
  { id: 'cust.q.price_ceiling', type: 'context', text: 'Anything over a couple of hundred a month becomes a procurement conversation.', tags: ['price_tight'], weight: 3, conditions: { requiresTags: ['price_tight'] } },
  { id: 'cust.q.cheap_relative', type: 'context', text: 'The price honestly is not the obstacle here.', tags: ['price_ok'], weight: 2, conditions: { requiresTags: ['price_ok'] } },
  { id: 'cust.q.would_pilot', type: 'context', text: 'Put me on the early list — I will find you a team to try it on.', tags: ['keen'], weight: 4, conditions: { requiresTags: ['keen'] } },
  { id: 'cust.q.daily_pain', type: 'context', text: 'It came up again this week, which is why I agreed to this call.', tags: ['pain_high'], weight: 3, conditions: { requiresTags: ['pain_high'] } },
  { id: 'cust.q.polite_hedge', type: 'context', text: 'Sorry — I do not want to be discouraging. It is a real problem, it is just not my loudest one.', tags: ['polite', 'pain_low'], weight: 4, conditions: { requiresTags: ['polite', 'pain_low'] } },
  { id: 'cust.q.blunt', type: 'context', text: 'I would rather tell you now than waste your quarter.', tags: ['blunt_customer'], weight: 3, conditions: { requiresTags: ['blunt_customer'] } },
  { id: 'cust.q.features', type: 'context', text: 'If you build the reporting side of it, come back to me.', tags: ['featurey'], weight: 3, conditions: { requiresTags: ['featurey'] } },
]

export const CUSTOMER_FRAGMENTS: FragmentLibrary = {
  'customer.reaction': customerAnswers,
  'customer.context': customerQualifiers,
}

/** How the company's pricing strategy sounds to somebody being asked to pay it. */
export const INTERVIEW_PRICE_PHRASE: Record<string, string> = {
  low: 'entry pricing',
  market: 'mid-market pricing',
  premium: 'enterprise pricing',
}

/** How a board topic is titled. The slugs are engine-facing; the room heading is not. */
export const BOARD_TOPIC_LABEL: Record<string, string> = {
  runway: 'Runway',
  profit: 'Burn',
  growth: 'Growth',
  retention: 'Retention',
  quality: 'Quality',
  pmf: 'Product-market fit',
  marketing: 'Acquisition cost',
  morale: 'The team',
  board: 'The growth target',
  market: 'The funding market',
  commitment: 'A missed commitment',
}

/**
 * Two shapes, and the split matters. §44's example answer is a sentence followed by the clause
 * that quietly undercuts it — but if EVERY answer trailed a qualifier the qualifier would stop
 * being a tell and start being punctuation, and a customer who just answers the question is also
 * a real thing. Roughly two in five come back bare.
 */
export const CUSTOMER_SHAPES: readonly MessageShape[] = [
  { key: 'cust.answer_qualified', subject: ['reaction'], body: ['context'], required: ['reaction', 'context'], weight: 3 },
  { key: 'cust.answer_plain', subject: ['reaction'], body: [], required: ['reaction'], weight: 2 },
]

// ---------------------------------------------------------------------------------------
// 2. Employee conversations (§38-§39)
// ---------------------------------------------------------------------------------------

/** What the founder can do with what they just heard. Three shapes, and only one is free. */
export type ConversationAnswer = 'explain' | 'commit' | 'hold'

export interface ConversationOutcome {
  /** The founder's answer, narrated. `{firstName}` is filled from the person in the room. */
  text: string
  /** How this lands, as relationship facts. Sign is a fact; personality decides the volume. */
  facts: { kind: RelationshipFactKind; magnitude: number }[]
  /** What they will remember about it. */
  memory: { type: MemoryType; summaryKey: string; importance: number; emotionalImpact: number; tags: MemoryTag[] }
}

export interface ConversationTopicDef {
  id: string
  /** How the room is titled: "{name} wants to talk about their scope". */
  title: string
  /** Tags handed to the EXISTING employee voice pool so they raise this specific thing. */
  tags: MemoryTag[]
  /** The memory cue the composer scores callbacks against (§39). */
  cueKey: string
  /**
   * The commitment 'commit' actually makes. Absent means the commit option is delivered on the
   * spot rather than owed — recognition is given in the moment or not at all.
   */
  promise?: {
    summaryKey: string
    /** Weeks until the person starts expecting it. */
    window: number
    importance: number
  }
  answers: Record<ConversationAnswer, { label: string; detail: string; outcome: ConversationOutcome }>
}

/**
 * §38's list, restricted to the ones the simulation can actually produce a FACT for — a topic the
 * game cannot detect is a topic that would have to be invented, and inventing one is the thing
 * this system is not allowed to do.
 *
 * Every `commit` here settles on something the simulation computes: a salary that rose, a round
 * that closed, headcount that grew, a strategy that held still. See settleWeeklyPromises.
 */
export const CONVERSATION_TOPICS: readonly ConversationTopicDef[] = [
  {
    id: 'promotion',
    title: 'wants to talk about where they are going',
    tags: ['promotion', 'leadership'],
    cueKey: 'promotion_passed_over',
    promise: { summaryKey: PROMISE_KEYS.promotion, window: 16, importance: 78 },
    answers: {
      explain: {
        label: 'Explain why the shape of the company is what it is',
        detail: 'An honest reason, and nothing owed. It costs you nothing and buys you nothing.',
        outcome: {
          text: 'You walk {firstName} through how the org is actually put together and why. They follow the argument. Following an argument is not the same as being persuaded by it.',
          facts: [{ kind: 'one_on_one', magnitude: 1 }, { kind: 'request_denied', magnitude: 0.5 }],
          memory: { type: 'support', summaryKey: 'conversation_promotion_explained', importance: 45, emotionalImpact: -10, tags: ['promotion', 'trust'] },
        },
      },
      commit: {
        label: 'Commit to the step up — and put a date on it',
        detail: 'A promise with a deadline. Kept when their pay actually moves; remembered forever if it does not.',
        outcome: {
          text: 'You tell {firstName} the job is theirs and you name a date. They write it down. So does the ledger.',
          facts: [{ kind: 'promise_made', magnitude: 1.3 }],
          memory: { type: 'promise', summaryKey: PROMISE_KEYS.promotion, importance: 78, emotionalImpact: 55, tags: ['promotion', 'trust'] },
        },
      },
      hold: {
        label: 'Tell them the decision is final',
        detail: 'The clean version of no. Some people respect it; nobody enjoys it.',
        outcome: {
          text: '"That is the decision." {firstName} takes it without argument, which is not the same as taking it well.',
          facts: [{ kind: 'passed_over', magnitude: 0.85 }],
          memory: { type: 'rejection', summaryKey: 'conversation_promotion_refused', importance: 70, emotionalImpact: -60, tags: ['promotion', 'recognition', 'blame'] },
        },
      },
    },
  },
  {
    id: 'compensation',
    title: 'wants to talk about what they are paid',
    tags: ['compensation', 'equity'],
    cueKey: 'raise_refused',
    promise: { summaryKey: PROMISE_KEYS.equity, window: 20, importance: 72 },
    answers: {
      explain: {
        label: 'Show them the numbers the company is actually working with',
        detail: 'Open the books far enough that the answer stops looking arbitrary.',
        outcome: {
          text: 'You put the runway on the table and let {firstName} read it. The number is not what they wanted. At least it is a number.',
          facts: [{ kind: 'one_on_one', magnitude: 1.2 }, { kind: 'raise_denied', magnitude: 0.4 }],
          memory: { type: 'support', summaryKey: 'conversation_comp_explained', importance: 48, emotionalImpact: -8, tags: ['compensation', 'trust'] },
        },
      },
      commit: {
        label: 'Commit to a real refresh at the next round',
        detail: 'A promise with a deadline. Kept when a round actually closes; broken when the window runs out first.',
        outcome: {
          text: 'You commit to an equity refresh the moment the next round closes. {firstName} does the arithmetic in their head and nods.',
          facts: [{ kind: 'promise_made', magnitude: 1.2 }],
          memory: { type: 'promise', summaryKey: PROMISE_KEYS.equity, importance: 72, emotionalImpact: 50, tags: ['compensation', 'equity', 'trust'] },
        },
      },
      hold: {
        label: 'The comp bands are the comp bands',
        detail: 'No exception, no date. Consistent, and felt as such.',
        outcome: {
          text: '"The bands are the bands." {firstName} says they understand. They have said that before.',
          facts: [{ kind: 'raise_denied', magnitude: 1 }],
          memory: { type: 'rejection', summaryKey: 'conversation_comp_refused', importance: 62, emotionalImpact: -50, tags: ['compensation', 'fairness'] },
        },
      },
    },
  },
  {
    id: 'workload',
    title: 'is carrying too much of this company',
    tags: ['workload', 'headcount'],
    cueKey: 'crunch',
    promise: { summaryKey: PROMISE_KEYS.headcount, window: 14, importance: 68 },
    answers: {
      explain: {
        label: 'Explain that this is the season the company is in',
        detail: 'True, and true is not always enough.',
        outcome: {
          text: 'You tell {firstName} this is what the next stretch looks like. They already knew. What they wanted was for you to say it out loud.',
          facts: [{ kind: 'one_on_one', magnitude: 1 }, { kind: 'overworked', magnitude: 0.6 }],
          memory: { type: 'support', summaryKey: 'conversation_workload_explained', importance: 42, emotionalImpact: -12, tags: ['workload'] },
        },
      },
      commit: {
        label: 'Commit to two more people on their team',
        detail: 'A promise with a deadline. Kept when headcount actually grows.',
        outcome: {
          text: 'You promise {firstName} two hires. They look relieved, and slightly wary — they have heard a version of this before.',
          facts: [{ kind: 'promise_made', magnitude: 1.1 }],
          memory: { type: 'promise', summaryKey: PROMISE_KEYS.headcount, importance: 68, emotionalImpact: 45, tags: ['workload', 'headcount', 'trust'] },
        },
      },
      hold: {
        label: 'Ask them to hold the line a while longer',
        detail: 'No relief, no date. It is what the company can afford.',
        outcome: {
          text: 'You ask {firstName} to hold on a bit longer. They say yes. Everybody in this conversation knows what "a bit longer" has meant so far.',
          facts: [{ kind: 'overworked', magnitude: 1.2 }, { kind: 'request_denied', magnitude: 0.8 }],
          memory: { type: 'conflict', summaryKey: 'conversation_workload_refused', importance: 60, emotionalImpact: -48, tags: ['workload', 'burnout'] },
        },
      },
    },
  },
  {
    id: 'strategy',
    title: 'does not agree with where this is going',
    tags: ['strategy'],
    cueKey: 'strategy_change',
    promise: { summaryKey: PROMISE_KEYS.steadyCourse, window: 12, importance: 64 },
    answers: {
      explain: {
        label: 'Make the case for the strategy properly',
        detail: 'Argue it out. Disagreement that has been heard is cheaper than disagreement that has not.',
        outcome: {
          text: 'You take {firstName} through the reasoning end to end. They still think you are wrong. They stop thinking you are careless.',
          facts: [{ kind: 'one_on_one', magnitude: 1.4 }],
          memory: { type: 'support', summaryKey: 'conversation_strategy_argued', importance: 50, emotionalImpact: 8, tags: ['strategy', 'trust'] },
        },
      },
      commit: {
        label: 'Commit to holding this course for a full quarter',
        detail: 'A promise with a deadline. Broken by the next pivot, repricing or refocus.',
        outcome: {
          text: 'You promise {firstName} a quarter without another turn of the wheel. It is the cheapest thing they have asked you for and the easiest one to break.',
          facts: [{ kind: 'promise_made', magnitude: 1 }],
          memory: { type: 'promise', summaryKey: PROMISE_KEYS.steadyCourse, importance: 64, emotionalImpact: 40, tags: ['strategy', 'trust'] },
        },
      },
      hold: {
        label: 'The strategy is not up for a vote',
        detail: 'Closes the discussion. Also closes the channel it came through.',
        outcome: {
          text: '"This one is not a discussion." {firstName} says fine. They do not raise the next one.',
          facts: [{ kind: 'criticised', magnitude: 1 }, { kind: 'request_denied', magnitude: 0.9 }],
          memory: { type: 'conflict', summaryKey: 'conversation_strategy_closed', importance: 58, emotionalImpact: -45, tags: ['strategy', 'trust', 'blame'] },
        },
      },
    },
  },
  {
    id: 'departure',
    title: 'has been taking the recruiters’ calls',
    tags: ['departure', 'recognition'],
    cueKey: 'employee_quit',
    promise: { summaryKey: PROMISE_KEYS.equity, window: 12, importance: 80 },
    answers: {
      explain: {
        label: 'Ask what would actually have to change',
        detail: 'Listen. It is free, and it is not nothing.',
        outcome: {
          text: 'You ask {firstName} what it would take, and then you let them finish. Nobody has asked them that in a while.',
          facts: [{ kind: 'one_on_one', magnitude: 1.6 }, { kind: 'praised', magnitude: 0.8 }],
          memory: { type: 'support', summaryKey: 'conversation_departure_heard', importance: 55, emotionalImpact: 25, tags: ['trust', 'recognition'] },
        },
      },
      commit: {
        label: 'Commit to matching them properly at the next round',
        detail: 'A promise with a deadline, made to somebody already halfway out of the door.',
        outcome: {
          text: 'You tell {firstName} you will make it right at the next round. They stay. What they do next depends entirely on whether you meant it.',
          facts: [{ kind: 'promise_made', magnitude: 1.5 }, { kind: 'counter_offer_matched', magnitude: 0.5 }],
          memory: { type: 'promise', summaryKey: PROMISE_KEYS.equity, importance: 80, emotionalImpact: 55, tags: ['compensation', 'equity', 'trust'] },
        },
      },
      hold: {
        label: 'Wish them well and mean it',
        detail: 'No counter-offer. Dignified, final, and remembered as both.',
        outcome: {
          text: 'You tell {firstName} you would be sorry to lose them and you will not be bidding. They appreciate the honesty more than they expected to.',
          facts: [{ kind: 'request_denied', magnitude: 0.7 }, { kind: 'praised', magnitude: 0.6 }],
          memory: { type: 'rejection', summaryKey: 'conversation_departure_released', importance: 58, emotionalImpact: -25, tags: ['departure', 'trust'] },
        },
      },
    },
  },
]

export const conversationTopic = (id: string): ConversationTopicDef | undefined => CONVERSATION_TOPICS.find((t) => t.id === id)

/**
 * A conversation only opens for somebody genuinely strained, and never twice in a row for the same
 * person. Deliberately far rarer than the four-weekly inbox check-in: this is the version with a
 * commitment attached, and one of those a quarter is already a lot to owe.
 */
export const CONVERSATION_GAP_WEEKS = 10
/** relationshipStrain (0–1) below which nobody has anything worth a room. */
export const CONVERSATION_STRAIN_FLOOR = 0.42

// ---------------------------------------------------------------------------------------
// 3. Board meetings (§46-§47)
// ---------------------------------------------------------------------------------------

export type BoardDecision = 'accelerate' | 'maintain' | 'slow'

export interface BoardDecisionDef {
  id: BoardDecision
  label: string
  detail: string
  /** Narrated outcome. `{target}` and `{burn}` are filled from the facts the room was built on. */
  text: string
  facts: { kind: RelationshipFactKind; magnitude: number }[]
  memory: { type: MemoryType; summaryKey: string; importance: number; emotionalImpact: number; tags: MemoryTag[] }
  /** The commitment this decision IS. 'maintain' makes none — that is what makes it the safe one. */
  promise?: { summaryKey: string; importance: number }
}

/** §47's three answers. The founder's decision is a stance the board holds them to, not a lever. */
export const BOARD_DECISIONS: readonly BoardDecisionDef[] = [
  {
    id: 'accelerate',
    label: 'Accelerate',
    detail: 'You take the number. Judged at the next review against the growth the board asked for.',
    text: 'You tell the room you will take the number. It goes in the minutes, and the minutes are read at the next review.',
    facts: [{ kind: 'promise_made', magnitude: 1.4 }],
    memory: { type: 'promise', summaryKey: PROMISE_KEYS.boardPace, importance: 82, emotionalImpact: 40, tags: ['board', 'growth', 'trust'] },
    promise: { summaryKey: PROMISE_KEYS.boardPace, importance: 82 },
  },
  {
    id: 'maintain',
    label: 'Maintain',
    detail: 'No new commitment. Nothing is owed, and nothing is bought either.',
    text: 'You hold the line without promising anything on top of it. The room accepts it. Nobody writes anything down.',
    facts: [{ kind: 'one_on_one', magnitude: 0.7 }],
    memory: { type: 'strategy_change', summaryKey: 'board_meeting_maintained', importance: 45, emotionalImpact: 0, tags: ['board', 'strategy'] },
  },
  {
    id: 'slow',
    label: 'Slow down',
    detail: 'You commit to a smaller burn by the next review. Judged on what the company actually spends.',
    text: 'You tell them you are taking the burn down instead. Half the table relaxes; the other half writes the number down.',
    facts: [{ kind: 'promise_made', magnitude: 1.1 }, { kind: 'criticised', magnitude: 0.5 }],
    memory: { type: 'promise', summaryKey: PROMISE_KEYS.burnCut, importance: 74, emotionalImpact: 20, tags: ['board', 'strategy', 'trust'] },
    promise: { summaryKey: PROMISE_KEYS.burnCut, importance: 74 },
  },
]

export const boardDecision = (id: string): BoardDecisionDef | undefined => BOARD_DECISIONS.find((d) => d.id === id)

/** Weeks between board meetings, counted from the last one rather than from week zero. */
export const BOARD_MEETING_INTERVAL_WEEKS = 12
/** §46: "identify 2–4 important topics". */
export const BOARD_MEETING_MIN_TOPICS = 2
export const BOARD_MEETING_MAX_TOPICS = 4

/**
 * §46's two chairs, weighing the same week differently — which is where the disagreement in §47's
 * example comes from. The lead investor is the one who wrote the cheque and wants the curve; the
 * independent director is the one who has seen this go wrong before.
 *
 * Weights index AdvisorTopic slugs. An unlisted topic is invisible to that chair.
 */
export const BOARD_CHAIR_WEIGHTS: Record<'lead' | 'independent', Record<string, number>> = {
  lead: { growth: 0.34, board: 0.26, market: 0.16, commitment: 0.34, runway: 0.14, marketing: 0.14, pmf: 0.12 },
  independent: { retention: 0.32, runway: 0.28, quality: 0.2, profit: 0.24, morale: 0.16, commitment: 0.22, pmf: 0.18 },
}

/** The verb each chair reaches for. Same table shape as SEAT_DEFS.stances, per §31. */
export const BOARD_CHAIR_STANCES: Record<'lead' | 'independent', Record<string, { bad: string; good: string }>> = {
  lead: {
    growth: { bad: 'warn', good: 'push' },
    board: { bad: 'warn', good: 'celebrate' },
    market: { bad: 'hold', good: 'push' },
    commitment: { bad: 'warn', good: 'celebrate' },
    runway: { bad: 'warn', good: 'push' },
    marketing: { bad: 'push', good: 'push' },
    pmf: { bad: 'warn', good: 'push' },
  },
  independent: {
    retention: { bad: 'fix', good: 'celebrate' },
    runway: { bad: 'cut', good: 'hold' },
    quality: { bad: 'fix', good: 'celebrate' },
    profit: { bad: 'cut', good: 'celebrate' },
    morale: { bad: 'warn', good: 'celebrate' },
    commitment: { bad: 'warn', good: 'hold' },
    pmf: { bad: 'fix', good: 'hold' },
  },
}
