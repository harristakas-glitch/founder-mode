// The field guide's vocabulary.
//
// This is the PULL half of onboarding: nothing here is ever pushed at the player. It exists because
// the audit found nineteen terms the game uses before it defines them — PMF, hype, reputation,
// runway, burn, idea quality, product score, product bar, problem intensity, reachability, standing
// experiment, posture, covenant, energy, cohort, retention, dilution, down round, S-curve — and a
// player who cannot look one up has to guess or leave.
//
// Every definition states what the SIMULATION does with the term, not what a startup blog would say.
// If a line here stops being true of the engine, it is a bug in this file.

export interface Term {
  id: string
  name: string
  /** One sentence. What it is. */
  short: string
  /** What moves it, what it moves, and the trap. Optional — some terms need no more. */
  long?: string
  group: TermGroup
  /** Career-only vocabulary is hidden in Quick Play, where the words never appear. */
  career?: boolean
}

export type TermGroup = 'money' | 'product' | 'market' | 'people' | 'capital' | 'career'

export const TERM_GROUPS: { id: TermGroup; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'product', label: 'Product' },
  { id: 'market', label: 'Market' },
  { id: 'people', label: 'People' },
  { id: 'capital', label: 'Capital' },
  { id: 'career', label: 'Career: discovery' },
]

export const TERMS: Term[] = [
  // ---- money ----
  {
    id: 'burn',
    name: 'Burn',
    group: 'money',
    short: 'What the company spends in a week: payroll, office, infrastructure, marketing, loan interest.',
    long: 'Burn is recurring only. One-off charges — a recruiter fee, a legal bill, the cost of a decision you took — are not in it.',
  },
  {
    id: 'runway',
    name: 'Runway',
    group: 'money',
    short: 'Cash divided by weekly burn: how many weeks you last if nothing changes.',
    long: 'It is a projection, not a promise. Because burn excludes one-off charges, a comfortable runway can still be one recruiter fee and a cloud bill away from being a bad one. Under about 10 weeks, candidates start refusing your offers.',
  },
  {
    id: 'net',
    name: 'Net per week',
    group: 'money',
    short: 'Weekly revenue minus weekly burn. Negative is normal early; the question is whether the line is turning.',
  },
  {
    id: 'covenant',
    name: 'Covenant',
    group: 'money',
    short: 'The condition attached to the bank credit line: your revenue must stay above a floor.',
    long: 'Fall below it and the bank calls the loan — it takes the cash first and 15% of the company for anything it cannot collect. Debt is leverage on a working machine and poison on a broken one.',
  },

  // ---- product ----
  {
    id: 'pmf',
    name: 'Product-market fit (PMF)',
    group: 'product',
    short: 'How much the market actually wants what you built, 0–100.',
    long: 'PMF is an OUTPUT. You never set it directly. It gates growth, word of mouth, churn and how many of your users pay. In Career it is read off customers who stayed — retention is most of the score. In Quick Play it grows from research plus quality against a hidden demand roll for your current idea.',
  },
  {
    id: 'idea-quality',
    name: 'Idea quality',
    group: 'product',
    short: 'Your team’s estimate of the true demand behind your current idea.',
    long: 'The white band on the Product screen is the range your research can currently narrow the truth to. More user research narrows it. It measures the IDEA, not the execution — the number does not move because you shipped features.',
  },
  {
    id: 'product-score',
    name: 'Product score',
    group: 'product',
    short: 'Execution quality: features and polish, minus the drag from bugs.',
    long: 'Different from PMF. A beautifully executed product nobody wants scores high here and low there. Rivals compare against this number, not PMF — fall about 15 behind the leader and they start taking your users.',
  },
  {
    id: 'bugs',
    name: 'Bugs',
    group: 'product',
    short: 'Defect load, 0–100. Raises churn, drags the product score, and turns press coverage against you.',
    long: 'Every week spent on features adds some. The bug-fixing share of team focus is what pays it back down.',
  },
  {
    id: 'focus',
    name: 'Team focus',
    group: 'product',
    short: 'How your engineering week is split between features, polish, bug fixing and user research.',
    long: 'The sliders are WEIGHTS, not percentages. Raising one lowers everyone else’s share of the week without moving their handles — the percentage beside each row is the share you will actually get.',
  },

  // ---- market ----
  {
    id: 'hype',
    name: 'Hype',
    group: 'market',
    short: 'How loudly the market is talking about you, 0–100. Drives sign-ups.',
    long: 'It decays about 8% a week on its own, so it has to be fed: marketing spend, press, launches, viral moments. Hype without PMF buys users who leave again.',
  },
  {
    id: 'reputation',
    name: 'Reputation',
    group: 'market',
    short: 'What the market thinks of you as an operator, 0–100.',
    long: 'Slower and stickier than hype. It shows up in acquisition, in whether good candidates take your calls, and in how a bad news cycle lands.',
  },
  {
    id: 'churn',
    name: 'Churn',
    group: 'market',
    short: 'The share of your users who leave each week.',
    long: 'Driven by PMF, quality and bugs against the market’s baseline. Marketing on top of high churn is a bigger leak, not a bigger company.',
  },
  {
    id: 'cac',
    name: 'CAC',
    group: 'market',
    short: 'Cost to acquire one paid user. Climbs as the market saturates and falls as PMF rises.',
  },
  {
    id: 'posture',
    name: 'Rival posture',
    group: 'market',
    short: 'What a rival is doing about you: Building, Watching, Hostile or Cornered.',
    long: 'Read off market position, growth and funding gap, not a hidden die roll. Hostile means a move is coming. Rivals start much larger than you and that is normal — you are not trying to out-size them, you are trying to out-fit them.',
  },
  {
    id: 's-curve',
    name: 'S-curve',
    group: 'market',
    short: 'Every market saturates. Growth in one product line eventually flattens however well you run it.',
    long: 'A second product line restarts the curve in a fresh sector with its own demand roll and its own TAM. It needs a real company underneath it first.',
  },

  // ---- people ----
  {
    id: 'morale',
    name: 'Morale',
    group: 'people',
    short: 'How the team feels, 0–100. Low morale cuts output and starts resignations.',
  },
  {
    id: 'energy',
    name: 'Founder energy',
    group: 'people',
    short: 'Your own tank, 0–100. Every big move — a press cycle, a fundraise, a keynote — drains it.',
    long: 'It scales everything you personally touch. Running at low energy quietly weakens every other system; a recharge week is the only way back up.',
  },
  {
    id: 'fee',
    name: 'Recruiter fee',
    group: 'people',
    short: 'A one-off charge, due the week a hire actually starts — not when they sign.',
    long: 'It is roughly 15% of first-year salary and it is not in your burn or your runway. This is the single most common way a first company surprises itself.',
  },
  {
    id: 'notice',
    name: 'In pool / notice',
    group: 'people',
    short: '"In pool" is how many weeks before that candidate takes another job. Signed hires then serve a notice period before they start.',
  },

  // ---- capital ----
  {
    id: 'valuation',
    name: 'Valuation',
    group: 'capital',
    short: 'What the market would price the company at today. Investors offer around it.',
    long: 'Built from users, revenue, growth, PMF and stage. The number that matters week to week is not the total — it is how close you are to the bar for the next stage.',
  },
  {
    id: 'dilution',
    name: 'Dilution',
    group: 'capital',
    short: 'The share of the company you give up in a round. It never comes back.',
    long: 'It is also not the worst outcome available: dead founders keep 100% of nothing. The trade is always dilution now against runway to reach a higher price later.',
  },
  {
    id: 'down-round',
    name: 'Down round',
    group: 'capital',
    short: 'Raising below your last round’s price. Cash in the bank, morale out the door.',
  },
  {
    id: 'climate',
    name: 'Funding climate',
    group: 'capital',
    short: 'The market’s appetite this quarter, from Frozen to Frothy. It swings what investors will pay.',
    long: 'Driven by the macro index and central-bank rate on the Finance screen. In a frozen market good companies get ghosted; in a warm one, strike.',
  },
  {
    id: 'board',
    name: 'The board',
    group: 'capital',
    short: 'Appears once outside investors own a piece of you. It sets a growth target and reviews you against it.',
    long: 'Miss reviews and it issues strikes. Enough strikes and it can replace you as CEO — which ends the run with you outside the building.',
  },

  // ---- career ----
  {
    id: 'segment',
    name: 'Segment',
    group: 'career',
    career: true,
    short: 'A distinct kind of customer with its own truth: what they need, what they will pay, whether they stay.',
    long: 'The company is scored as its best PROVEN segment. Your target decides who the product is built for; switching costs weeks of velocity.',
  },
  {
    id: 'retention',
    name: '4-week retention',
    group: 'career',
    career: true,
    short: 'The share of a cohort still paying a month after they arrived.',
    long: 'It is most of the PMF score. Below 15 retained customers in a segment nothing can be measured at all and the score is capped however good the research looks.',
  },
  {
    id: 'cohort',
    name: 'Cohort',
    group: 'career',
    career: true,
    short: 'Everyone who arrived in the same week, tracked as a group so you can see whether they stayed.',
  },
  {
    id: 'evidence',
    name: 'Evidence vs belief',
    group: 'career',
    career: true,
    short: 'Experiments move what you BELIEVE about a segment. They never move the segment, and they never move PMF on their own.',
    long: 'The bar under each line on the Hypothesis Board is confidence, not quality. A belief can be confident and wrong.',
  },
  {
    id: 'problem-intensity',
    name: 'Problem intensity',
    group: 'career',
    career: true,
    short: 'How sharply this segment feels the problem. Low intensity means they will nod along and never buy.',
  },
  {
    id: 'product-bar',
    name: 'Product bar',
    group: 'career',
    career: true,
    short: 'How good the product has to be before this segment will keep using it.',
    long: 'A high bar is why Enterprise can love your pitch and still churn: they need more than you have shipped.',
  },
  {
    id: 'reachability',
    name: 'Reachability',
    group: 'career',
    career: true,
    short: 'How easily you can get in front of this segment at all. It prices your acquisition, not your fit.',
  },
  {
    id: 'standing',
    name: 'Standing experiment',
    group: 'career',
    career: true,
    short: 'Runs again every time it finishes, and keeps charging you, until you stop it. "Run once" does it a single time.',
  },
  {
    id: 'reliability',
    name: 'Answer reliability',
    group: 'career',
    career: true,
    short: 'How much a given interview answer is worth: anecdote, weak, mixed or solid.',
    long: 'Recalled behaviour is evidence. Stated intent is a wish with a person attached to it — and somebody who cannot sign a purchase order cannot tell you whether you have a business.',
  },
  {
    id: 'token-fork',
    name: 'The capital fork',
    group: 'career',
    career: true,
    short: 'Tokenising is the other way to fund the company — a community and a treasury instead of investors and a board.',
    long: 'It is permanent. Taking it closes the IPO for good and prices any acquisition at a discount, and it hands part of the company’s direction to holders who vote. The readiness panel on Fundraising names exactly what you are still missing.',
  },
]

export const TERMS_BY_ID: Record<string, Term> = Object.fromEntries(TERMS.map((t) => [t.id, t]))

/** Look a term up for an inline definition; undefined for anything not in the guide. */
export const term = (id: string): Term | undefined => TERMS_BY_ID[id]
