// The lesson catalogue.
//
// Design contract, and the thing to hold this file to:
//
//   * A lesson appears the FIRST TIME the thing it teaches can actually be acted on. Never in a
//     wall at the start, never for a mechanic that is still locked.
//   * A lesson is anchored to a PLACE. It waits, silently and indefinitely, until the player is on
//     the screen where the thing lives — so it is always next to what it is talking about.
//   * A lesson is shown ONCE, ever, on this device. Most are also retired early by `retiredBy`:
//     the moment the player demonstrably does the thing, the lesson is dead in this run and every
//     future one, whether or not it was ever shown.
//   * A lesson quotes THIS WEEK'S REAL NUMBERS wherever it can. A note that says "cash fell
//     $13.9k this week and only $3.1k of that was burn" teaches the concept and the run at once;
//     the same sentence in the abstract teaches neither.
//
// Everything here reads state. Nothing here writes it.

import { money, num, pct } from '../format'
import type { ScreenId } from '../store'
import type { SkillId } from './progress'
import type { RunFacts } from './read'

export interface Concept {
  id: string
  /** Where the note belongs. 'any' renders on whichever screen the player is on. */
  screen: ScreenId | ScreenId[] | 'any'
  /** Which experience this is for. Omitted = both solo modes. */
  only?: 'quick' | 'career'
  /** Doing any of these retires the lesson permanently, across runs. */
  retiredBy?: SkillId[]
  /** The first moment the lesson is actionable. */
  when: (f: RunFacts) => boolean
  title: string
  body: (f: RunFacts) => string
  /** Glossary terms offered as chips under the note. Pull, never push. */
  terms?: string[]
  /** A jump to where the thing actually is. */
  goto?: { screen: ScreenId; label: string }
  /** Higher wins when more than one lesson is eligible at the same moment. */
  priority: number
}

const wk = (n: number) => (n === 1 ? '1 week' : `${Math.max(0, Math.floor(n))} weeks`)

export const CONCEPTS: Concept[] = [
  // ---------- the loop itself ----------
  {
    id: 'first-week',
    screen: 'any',
    priority: 100,
    retiredBy: ['advance'],
    when: (f) => f.week === 1,
    title: 'The week is the turn',
    body: () =>
      'Nothing moves until you advance. Set the team’s focus, spend money, send offers — then hit Advance Week and the world resolves all of it at once. Two questions decide whether this company lives: does the market want the idea, and does the money last long enough to find out.',
    terms: ['runway', 'pmf'],
  },
  {
    id: 'first-decision',
    screen: 'inbox',
    priority: 95,
    retiredBy: ['decide'],
    when: (f) => f.pendingDecisions > 0 && f.resolvedDecisions === 0,
    title: 'Amber items stop the clock',
    body: () =>
      'The week cannot end until you answer this. There is rarely a correct answer — only a trade. And the moment you pick, the game prints exactly what the choice did, in this same place. Reading that ledger is how these events stop being coin flips.',
  },

  // ---------- money ----------
  {
    id: 'one-off-shock',
    screen: 'any',
    priority: 93,
    when: (f) => f.cashDelta < 0 && f.oneOff < -Math.max(f.burn, 500) * 1.5 && f.week >= 3,
    title: 'That was not your burn',
    body: (f) =>
      `Cash fell ${money(-f.cashDelta)} this week. Only ${money(Math.max(0, -f.operatingDelta))} of it was operating burn — the rest was a one-off charge: a recruiter fee, a bill, or something you agreed to. Runway divides cash by BURN, so it never sees these coming. Keep a buffer for them.`,
    terms: ['runway', 'burn', 'fee'],
  },
  {
    id: 'runway-tight',
    screen: 'any',
    priority: 96,
    when: (f) => Number.isFinite(f.runway) && f.runway < 14 && f.week >= 4,
    title: 'The runway is the clock',
    body: (f) =>
      `${wk(f.runway)} of cash left at this burn. There are three ways out and they take very different amounts of time: raise (about ten weeks of your attention), cut burn (immediate, and it costs you people), or get revenue above burn (slowest, and the only one that ends the problem for good).`,
    terms: ['runway', 'burn', 'dilution'],
    goto: { screen: 'fundraising', label: 'Fundraising' },
  },
  {
    id: 'bank-line',
    screen: 'finance',
    priority: 50,
    retiredBy: ['debt'],
    when: (f) => !f.hasDebt && f.game.lastRevenue * 52 >= 250_000,
    title: 'The bank will pick up now',
    body: () =>
      'Non-dilutive cash, with a condition attached: your weekly revenue has to stay above the covenant floor. Fall below it and the bank calls the loan — it seizes the cash first and takes 15% of the company for anything it cannot collect. Leverage on a working machine, poison on a broken one.',
    terms: ['covenant'],
  },

  // ---------- product ----------
  {
    id: 'focus-weights',
    screen: 'product',
    priority: 90,
    retiredBy: ['allocate'],
    when: (f) => f.week >= 1,
    title: 'Those sliders are weights, not percentages',
    body: () =>
      'Drag one up and the others keep their handles but lose their share of the week — the % beside each row is what the team will actually spend. Research is how you find out whether the idea is any good. Features are how you exploit the answer once you have it.',
    terms: ['focus', 'idea-quality'],
  },
  {
    id: 'pmf-quick',
    screen: 'any',
    only: 'quick',
    priority: 70,
    when: (f) => f.week >= 3,
    title: 'PMF is the number everything else hangs off',
    body: (f) =>
      `You are at ${Math.round(f.game.pmf)}/100. It is not something you build directly — it is a reading of whether the market wants this idea, and it gates growth, word of mouth, churn and how many users ever pay. Research narrows what you know about the idea; quality and features decide whether you can exploit a good one.`,
    terms: ['pmf', 'idea-quality', 'product-score'],
  },
  {
    id: 'bugs-high',
    screen: 'any',
    priority: 58,
    when: (f) => f.bugs > 50,
    title: 'The bugs are a growth problem now',
    body: (f) =>
      `Bugs at ${Math.round(f.bugs)}. Above about 50 they push churn up, drag the product score rivals are measured against, and turn any press coverage against you. The bug-fixing share of team focus is the only thing that pays them back down.`,
    terms: ['bugs', 'churn', 'product-score'],
    goto: { screen: 'product', label: 'Shift focus' },
  },

  // ---------- the demand signal (Quick Play's central hidden mechanic) ----------
  {
    id: 'demand-unknown',
    screen: 'product',
    only: 'quick',
    priority: 91,
    when: (f) => f.demand === 'unknown' && f.week >= 2,
    title: 'You cannot read the market yet',
    body: (f) =>
      `The demand gauge on this screen is ${Math.min(100, Math.round((f.researchSignal / 14) * 100))}% of the way to saying anything at all. Until it fills, whether this idea is any good is genuinely unknown — not hidden behind a low number, simply not measured. User research is the only thing that fills it, and every week you build features first is a week you are betting blind.`,
    terms: ['idea-quality', 'focus'],
  },
  {
    id: 'demand-known',
    screen: 'any',
    only: 'quick',
    priority: 87,
    when: (f) => f.demand !== 'unknown',
    title: 'The market has answered',
    body: (f) =>
      f.demand === 'strong'
        ? 'Your research says demand is STRONG. That is the expensive question settled — stop buying more of the answer and start exploiting it: features and quality for the product, marketing for the growth.'
        : f.demand === 'weak'
          ? 'Your research says demand is WEAK, and no amount of execution fixes a market that does not want the thing. A pivot is the instrument for exactly this: it costs cash, energy and most of your progress, but the research you have already done carries over as a permanent bonus to the next idea’s roll, so pivoting informed beats pivoting early.'
          : 'Your research says demand is MIXED — a real business, not a great one. More research narrows the band but will not change the answer much from here, so this is a judgement call about time. The runway is the clock.',
    terms: ['idea-quality', 'pmf'],
    goto: { screen: 'product', label: 'Product' },
  },

  // ---------- people ----------
  {
    id: 'hiring-fee',
    screen: 'hiring',
    priority: 88,
    retiredBy: ['hire'],
    when: () => true,
    title: 'The salary is forever. The fee lands once.',
    body: () =>
      'The fee column is the recruiter’s cut, charged the week they actually start — not when they sign. It is not in your burn and not in your runway. Read the "runway after" figure on each candidate before you send anything: that is the number the hire leaves you with, and hiring past what the company can carry kills more young companies than any rival does. "In pool" is how many weeks before that candidate takes another job instead.',
    terms: ['fee', 'notice', 'runway'],
  },
  {
    id: 'energy-low',
    screen: 'any',
    priority: 65,
    when: (f) => f.energy < 55 && f.week >= 5,
    title: 'You are running on empty',
    body: (f) =>
      `Founder energy at ${Math.round(f.energy)}. It scales everything you personally touch, and every headline moment — a press cycle, a fundraise, a keynote — spends it. It refills slowly on its own, or in one go if you take a recharge week.`,
    terms: ['energy'],
  },
  {
    id: 'morale-low',
    screen: 'any',
    priority: 57,
    when: (f) => f.employees > 0 && f.morale < 45,
    title: 'People are looking at the exits',
    body: () =>
      'Low morale cuts what the team gets done every week, and then it starts costing you the team itself. Pay, promotions, a landed all-hands and simply not missing what you promised all move it; so does hiring past what the company can support.',
    terms: ['morale'],
    goto: { screen: 'team', label: 'Team' },
  },

  // ---------- market ----------
  {
    id: 'rivals-bigger',
    screen: 'market',
    priority: 55,
    when: (f) => f.users > 0 && f.biggestRivalUsers > f.users * 5,
    title: 'They start bigger. That is the design.',
    body: () =>
      'You are not trying to out-size them, you are trying to out-fit them. What they actually measure you on is product score, and the gap that matters is about fifteen points — fall further behind the leader and they start taking your users directly.',
    terms: ['posture', 'product-score'],
  },
  {
    id: 'marketing-untouched',
    screen: 'any',
    priority: 60,
    retiredBy: ['market'],
    when: (f) => f.week >= 8 && f.marketingSpend === 1000 && f.users > 0,
    title: 'You have not touched the megaphone',
    body: (f) =>
      `Marketing is still at the opening $1,000/wk and you have ${num(f.users)} users. Spend does two things: it buys users directly at a cost that falls as PMF rises, and it feeds hype — which decays about 8% a week on its own. It is capped by what the business can fund, not by what you want.`,
    terms: ['hype', 'cac'],
    goto: { screen: 'growth', label: 'Growth' },
  },

  // ---------- capital ----------
  {
    id: 'raise-ready',
    screen: 'any',
    priority: 80,
    retiredBy: ['raise'],
    when: (f) => f.stageProgress >= 0.8 && f.game.termSheets.length === 0,
    title: 'You are close to the bar',
    body: (f) =>
      `Valuation ${money(f.valuation)} — about ${pct(Math.min(1, f.stageProgress), 0)} of the way to the next stage. Investors price around that number and swing with the funding climate, and a fundraise eats roughly ten weeks of your attention, so this is a decision about timing as much as money. Dilution is permanent. So is running out of cash.`,
    terms: ['valuation', 'dilution', 'climate'],
    goto: { screen: 'fundraising', label: 'Fundraising' },
  },
  {
    id: 'board-arrived',
    screen: 'any',
    priority: 85,
    when: (f) => f.hasBoard,
    title: 'You have a board now',
    body: () =>
      'Outside investors own a piece of you, so somebody else now has an opinion about your growth rate. Miss a review and you collect a strike; collect enough of them and the board can replace you as CEO — which ends the run with you standing outside your own company.',
    terms: ['board'],
  },

  // ---------- the run as a story ----------
  {
    id: 'story-exists',
    screen: 'any',
    priority: 30,
    when: (f) => f.week >= 14,
    title: 'The run is writing itself down',
    body: () =>
      'Every milestone, pivot, raid and near-death is being recorded as a story you can read back at any point, not just at the end. It is the quickest way to see the shape of a run you have been living one week at a time.',
    goto: { screen: 'story', label: 'Story' },
  },

  // ---------- Career ----------
  {
    id: 'career-pmf-output',
    screen: 'any',
    only: 'career',
    priority: 99,
    when: (f) => f.week <= 2,
    title: 'PMF here is a measurement, not a target',
    body: () =>
      'Nothing you do sets it. Product work raises quality, quality raises fit for the segment you chose, fit raises retention — and retention is most of the score. Customers who leave do not count, which is why no amount of research can move the number on its own.',
    terms: ['pmf', 'retention', 'segment'],
    goto: { screen: 'discovery', label: 'Discovery' },
  },
  {
    id: 'career-discovery',
    screen: 'discovery',
    only: 'career',
    priority: 92,
    when: () => true,
    title: 'Two different things live on this screen',
    body: () =>
      'The top half is what customers ARE doing: how many there are, how many stayed a month, what PMF each segment has actually earned. The bottom half is what you BELIEVE about them, and how little of it is evidence yet. Experiments move the bottom half — and once you have real customers, their behaviour files onto it too. Only customers who stay move the top.',
    terms: ['segment', 'evidence', 'retention'],
  },
  {
    id: 'career-experiment',
    screen: 'discovery',
    only: 'career',
    priority: 88,
    retiredBy: ['experiment'],
    when: (f) => f.week >= 2 && f.experimentsRun === 0,
    title: 'Buy evidence before you buy engineering',
    body: () =>
      'Interviews are cheap, and people are generous with opinions they never act on. A paid pilot is slow, expensive and almost impossible to argue with. "Standing" re-runs and keeps charging you until you stop it; "Run once" does not.',
    terms: ['standing', 'evidence', 'problem-intensity'],
  },
  {
    id: 'career-interview-room',
    screen: 'discovery',
    only: 'career',
    priority: 94,
    retiredBy: ['interview'],
    when: (f) => f.openInterviewMoves > 0,
    title: 'Three real people are on the call',
    body: (f) =>
      `Further down this screen your study has become a conversation — ${f.openInterviewMoves} question${f.openInterviewMoves === 1 ? '' : 's'} left, and the questions are the budget. When it closes, the panel scores what each answer was worth: recalled behaviour is evidence, stated intent is a wish with a person attached to it.`,
    terms: ['reliability'],
  },
  {
    id: 'career-retention',
    screen: 'any',
    only: 'career',
    priority: 86,
    retiredBy: ['retain'],
    when: (f) => f.targetCustomers >= 15 && f.targetRetention > 0,
    title: 'Now the number can finally be measured',
    body: (f) =>
      `Your target segment has enough retained customers to be scored on behaviour instead of research. Four-week retention is ${pct(f.targetRetention, 0)}. Below about 62% the segment cannot leave "unproven" however good the product gets — and the fix for that is fit or price, never more marketing.`,
    terms: ['retention', 'cohort'],
    goto: { screen: 'discovery', label: 'Discovery' },
  },
  {
    id: 'career-conversation',
    screen: 'any',
    only: 'career',
    priority: 89,
    retiredBy: ['conversation'],
    when: (f) => f.openConversation,
    title: 'Someone is waiting at your door',
    body: () =>
      'One of your people has raised something specific and wants an answer from you. Saying nothing is also an answer, and they will remember which one you gave.',
    goto: { screen: 'team', label: 'Team' },
  },
  {
    id: 'career-boardroom',
    screen: 'any',
    only: 'career',
    priority: 90,
    retiredBy: ['boardroom'],
    when: (f) => f.openBoardRoom,
    title: 'The board is sitting',
    body: () =>
      'The topics were read off your own week, not drawn from a deck. Whatever you answer becomes a commitment with a deadline on it, and it is settled by what the company actually does afterwards.',
  },
  {
    id: 'career-advisors',
    screen: 'dashboard',
    only: 'career',
    priority: 62,
    when: (f) => f.advisorOpinions >= 2,
    title: 'They are allowed to disagree',
    body: () =>
      'Each of them reads the same week through their own incentives and their own competence, so two people looking at identical numbers will tell you different things. None of them is automatically right, and the panel will never tell you which one to believe.',
  },
  {
    id: 'career-promises',
    screen: 'dashboard',
    only: 'career',
    priority: 64,
    when: (f) => f.promises > 0,
    title: 'Somebody wrote that down',
    body: () =>
      'What you said in a room is now a commitment with a deadline on it. It gets settled by what the company actually does, not by how you meant it — and the ledger below shows who heard it and whether the numbers say you are on track.',
  },
  {
    id: 'career-cohorts',
    screen: 'any',
    only: 'career',
    priority: 40,
    when: (f) => f.cohorts >= 6,
    title: 'The retention table has a screen of its own',
    body: () =>
      'Cohorts lays every intake week side by side, so you can see whether the customers you won last month behave better than the ones from your first weeks. That difference is the only honest read on whether the product is genuinely getting better.',
    terms: ['cohort', 'retention'],
    goto: { screen: 'cohorts', label: 'Cohorts' },
  },
  {
    id: 'career-token-fork',
    screen: 'fundraising',
    only: 'career',
    priority: 45,
    retiredBy: ['tokenise'],
    when: (f) => f.week >= 10,
    title: 'There is a second capital path',
    body: () =>
      'Tokenising funds the company from a community and a treasury instead of investors and a board — and it is permanent. It closes the IPO for good, prices any acquisition at a discount, and hands part of the company’s direction to holders who vote on it. The readiness panel names exactly what you are still missing.',
    terms: ['token-fork'],
  },
]

/** Concepts that could apply to this run at all, ignoring what has already been shown. */
export function conceptsForRun(f: RunFacts): Concept[] {
  return CONCEPTS.filter((c) => !c.only || (c.only === 'career') === f.career)
}

const BY_ID: Record<string, Concept> = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]))

export const conceptById = (id: string): Concept | undefined => BY_ID[id]

export function conceptOnScreen(c: Concept, screen: ScreenId): boolean {
  if (c.screen === 'any') return true
  return Array.isArray(c.screen) ? c.screen.includes(screen) : c.screen === screen
}
