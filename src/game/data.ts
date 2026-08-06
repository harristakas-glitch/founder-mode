import type { Choice, GameState, Sector, Stage } from './types'

export const SECTORS: Sector[] = [
  {
    id: 'saas',
    name: 'B2B SaaS',
    blurb: 'Steady revenue per customer, slow but loyal growth.',
    arpuWeekly: 9,
    acqBase: 5,
    viral: 0.025,
    churn: 0.012,
    perUserVal: 2500,
    infraCost: 0.12,
    tam: 250_000,
  },
  {
    id: 'social',
    name: 'Social App',
    blurb: 'Explosive viral growth, tiny revenue per user, fickle crowds.',
    arpuWeekly: 0.12,
    acqBase: 120,
    viral: 0.07,
    churn: 0.05,
    perUserVal: 70,
    infraCost: 0.011,
    tam: 60_000_000,
  },
  {
    id: 'fintech',
    name: 'Fintech',
    blurb: 'Good revenue, high trust bar — bugs hurt twice as much.',
    arpuWeekly: 4,
    acqBase: 8,
    viral: 0.02,
    churn: 0.02,
    perUserVal: 900,
    infraCost: 0.16,
    tam: 3_000_000,
  },
  {
    id: 'devtools',
    name: 'Dev Tools',
    blurb: 'Developers love quality and spread the word themselves.',
    arpuWeekly: 5,
    acqBase: 6,
    viral: 0.045,
    churn: 0.015,
    perUserVal: 1200,
    infraCost: 0.09,
    tam: 900_000,
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    blurb: 'Marketing-hungry, decent margins, growth you pay for.',
    arpuWeekly: 3,
    acqBase: 20,
    viral: 0.012,
    churn: 0.03,
    perUserVal: 350,
    infraCost: 0.05,
    tam: 8_000_000,
  },
]

export const sectorById = (id: string): Sector => SECTORS.find((s) => s.id === id)!

export const STAGES: Stage[] = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C']

// Valuation the company must reach before investors will fund the NEXT stage.
export const STAGE_THRESHOLDS: Record<Stage, number> = {
  'Pre-seed': 1_500_000, // to raise a Seed
  Seed: 12_000_000, // to raise an A
  'Series A': 60_000_000,
  'Series B': 250_000_000,
  'Series C': Infinity,
}

export const INVESTORS = [
  'Sandhill Standard',
  'Moonshot Capital',
  'Blue Turtle Ventures',
  'z16a',
  'Tiger Local',
  'SoftMoney Vision Fund',
  'Fifth Floor Partners',
  'Greenfield & Gray',
  'Antifragile Angels',
  'Hyperbola Capital',
  'North Loop Ventures',
  'Old Money Modern',
]

export const RIVAL_NAMES = [
  'Quantly', 'Nimbus Labs', 'Forgeline', 'Bytecrest', 'Loopwise', 'Vantage Nine',
  'Copperleaf', 'Straton', 'Helixio', 'Parallel North', 'Duskware', 'Kitefall',
  'Ironquill', 'Modulo', 'Fathomly', 'Brightpath', 'Zephyrix', 'Cobalt Row',
]

export const TRAITS: Record<string, { label: string; blurb: string }> = {
  tenx: { label: '10x', blurb: 'Ships 50% more than their skill suggests. Everyone knows it, including them.' },
  craftsman: { label: 'Craftsman', blurb: 'Slightly more output, and quietly squashes bugs wherever they go.' },
  mercenary: { label: 'Mercenary', blurb: '15% more output, but loyalty ends where a better offer begins — they bail early when things wobble.' },
  culture: { label: 'Culture carrier', blurb: 'Keeps everyone else a little happier, every single week.' },
  drama: { label: 'Drama magnet', blurb: 'Talented, but the team group-chat is 40% about them. Slowly drains everyone.' },
}

export function climateLabel(c: number): string {
  if (c < -0.6) return 'Frozen ❄️'
  if (c < -0.2) return 'Cool'
  if (c < 0.2) return 'Neutral'
  if (c < 0.6) return 'Warm'
  return 'Frothy 🔥'
}

const FIRST = [
  'Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Avery', 'Quinn', 'Dana', 'Jamie',
  'Elena', 'Marcus', 'Priya', 'Kenji', 'Sofia', 'Omar', 'Ingrid', 'Diego', 'Wei', 'Amara',
  'Lucas', 'Noor', 'Felix', 'Zara', 'Ivan', 'Maya', 'Tomas', 'Leila', 'Hugo', 'Nina',
]
const LAST = [
  'Chen', 'Patel', 'Kim', 'Novak', 'Garcia', 'Okafor', 'Larsson', 'Tanaka', 'Silva', 'Haddad',
  'Kowalski', 'Moreau', 'Ferrari', 'Ivanov', 'Nakamura', 'Andersson', 'Costa', 'Weber', 'Ali', 'Brooks',
  'Fischer', 'Santos', 'Nguyen', 'Petrov', 'Lindqvist', 'Duarte', 'Kaur', 'Yamamoto', 'Berg', 'Osei',
]

// Central RNG hook: newGame swaps this for a seeded generator so daily challenges
// and multiplayer matches deal everyone the identical starting world.
export const RNG = { next: () => Math.random() }

export function randomName(): string {
  return `${pick(FIRST)} ${pick(LAST)}`
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(RNG.next() * arr.length)]
}

export interface EventDef {
  id: string
  weight: number
  minWeek?: number
  cond?: (s: GameState) => boolean
  title: string
  body: (s: GameState) => string
  choices?: (s: GameState) => Choice[]
  autoEffects?: (s: GameState) => import('./types').Effects
}

export const EVENTS: EventDef[] = [
  {
    id: 'press-feature',
    weight: 10,
    minWeek: 4,
    cond: (s) => s.hype > 15,
    title: 'Journalist wants a story',
    body: () =>
      'A reporter from The Daily Disrupt wants to profile your company. A good story means hype — but they will dig into your product, warts and all.',
    choices: (s) => [
      {
        label: 'Give full access',
        resultText:
          s.bugs > 40
            ? 'The piece runs: "Promising, but buggy." Some hype, some bruises.'
            : 'A glowing profile! Sign-ups spike.',
        effects: s.bugs > 40 ? { hype: 8, reputation: -5 } : { hype: 18, reputation: 6 },
      },
      {
        label: 'Politely decline',
        resultText: 'The story never runs. Business as usual.',
        effects: {},
      },
    ],
  },
  {
    id: 'viral-moment',
    weight: 8,
    minWeek: 6,
    cond: (s) => s.users > 50 && s.pmf > 30,
    title: 'You went viral',
    body: () =>
      'A power user posted about you and it blew up overnight. Traffic is pouring in — and so are the crash reports.',
    autoEffects: (s) => ({ hype: 15, users: Math.max(20, Math.round(s.users * 0.15)), bugs: 6 }),
  },
  {
    id: 'server-outage',
    weight: 9,
    minWeek: 8,
    cond: (s) => s.users > 100,
    title: 'Major outage',
    body: () => 'Your service has been down for 6 hours. Users are furious on social media.',
    choices: () => [
      {
        label: 'All-hands emergency fix (team works the weekend)',
        resultText: 'Service restored fast, but the team is exhausted.',
        effects: { morale: -10, bugs: -8, reputation: 2 },
      },
      {
        label: 'Fix it during business hours',
        resultText: 'The outage drags on. Some users churn, but the team appreciates the sanity.',
        effects: { users: -0.06, reputation: -6, morale: 3 },
      },
    ],
  },
  {
    id: 'poach-attempt',
    weight: 8,
    minWeek: 10,
    cond: (s) => s.employees.length >= 2,
    title: 'BigTech is poaching your best person',
    body: (s) => {
      const best = [...s.employees].sort((a, b) => b.skill - a.skill)[0]
      return `${best.name} got an offer from a tech giant at nearly double their salary. They are torn.`
    },
    choices: (s) => {
      const best = [...s.employees].sort((a, b) => b.skill - a.skill)[0]
      return [
        {
          label: `Counter-offer: +25% salary, $${Math.round((best.salary * 0.25) / 4 / 1000)}k signing sweetener for ${best.name}`,
          resultText: `${best.name} stays, feeling valued. Payroll just got heavier.`,
          effects: { morale: 6, cash: -Math.round((best.salary * 0.25) / 4) },
        },
        {
          label: 'Wish them well',
          resultText: `${best.name} leaves for BigTech. The team feels the loss.`,
          effects: { morale: -8, special: 'lose-best' },
        },
      ]
    },
  },
  {
    id: 'raise-demand',
    weight: 9,
    minWeek: 16,
    cond: (s) => s.employees.some((e) => e.skill >= 7 && e.weeks >= 20 && e.morale < 68),
    title: 'Your star wants a raise',
    body: (s) => {
      const star = raiseDemandTarget(s)!
      return `${star.name} asked for a meeting. They know their market value, they have been here ${star.weeks} weeks, and they want a 20% raise. The rest of the team will hear about however this ends.`
    },
    choices: () => [
      {
        label: 'Grant the raise (+20%)',
        resultText: 'They shake your hand. Loyalty secured — at a price.',
        effects: { special: 'grant-raise' },
      },
      {
        label: 'Refuse — the comp bands are the comp bands',
        resultText: 'They go quiet. Their LinkedIn activity picks up noticeably.',
        effects: { special: 'refuse-raise' },
      },
    ],
  },
  {
    id: 'enterprise-deal',
    weight: 7,
    minWeek: 12,
    cond: (s) => (s.sector === 'saas' || s.sector === 'devtools' || s.sector === 'fintech') && s.features > 30,
    title: 'Enterprise customer knocking',
    body: () =>
      'A Fortune 500 company wants an annual contract — but demands two custom features and a security audit.',
    choices: (s) => [
      {
        label: 'Take the deal, build what they need',
        resultText: 'Contract signed! A big cash infusion, but the roadmap slips.',
        effects: { cash: Math.round(60000 + s.features * 1500), features: -6, morale: -4 },
      },
      {
        label: 'Stay focused on the core product',
        resultText: 'You pass. The roadmap stays clean.',
        effects: { morale: 2 },
      },
    ],
  },
  {
    id: 'burnout',
    weight: 7,
    minWeek: 10,
    cond: (s) => s.employees.length >= 3 && avgMorale(s) < 55,
    title: 'The team is burning out',
    body: () => 'Late nights are piling up. People are quietly updating their LinkedIn profiles.',
    choices: () => [
      {
        label: 'Company offsite + a week of no deadlines ($8,000)',
        resultText: 'Morale rebounds. Not much shipped this week.',
        effects: { cash: -8000, morale: 18, features: -2 },
      },
      {
        label: 'Push through — the roadmap matters',
        resultText: 'The grind continues. So does the grumbling.',
        effects: { morale: -8 },
      },
    ],
  },
  {
    id: 'accelerator',
    weight: 5,
    minWeek: 5,
    cond: (s) => s.stage === 'Pre-seed',
    title: 'Accelerator invitation',
    body: () =>
      'A famous accelerator offers you a spot in their next batch: $120,000 for 7% of the company, plus connections and press.',
    choices: () => [
      {
        label: 'Accept the deal',
        resultText: 'You are in the batch. Cash, connections, and a hype bump. They take 7% equity.',
        effects: { cash: 120000, hype: 12, reputation: 8, special: 'accelerator' },
      },
      {
        label: 'Decline — too much equity',
        resultText: 'You keep your cap table clean.',
        effects: {},
      },
    ],
  },
  {
    id: 'security-scare',
    weight: 6,
    minWeek: 14,
    cond: (s) => s.users > 300,
    title: 'Security researcher found a vulnerability',
    body: () =>
      'A white-hat researcher reported a serious vulnerability and asked for a bounty. Nothing was leaked — yet.',
    choices: () => [
      {
        label: 'Pay the bounty ($15,000), patch immediately',
        resultText: 'Patched and disclosed responsibly. The researcher praises you publicly.',
        effects: { cash: -15000, bugs: -5, reputation: 6 },
      },
      {
        label: 'Patch quietly, skip the bounty',
        resultText: 'Patched. The researcher writes an annoyed thread about companies that do not pay.',
        effects: { bugs: -5, reputation: -5 },
      },
    ],
  },
  {
    id: 'legal-letter',
    weight: 5,
    minWeek: 16,
    cond: (s) => s.users > 200,
    title: 'Cease & desist letter',
    body: () =>
      'A patent troll claims your product infringes their 2004 patent on "displaying information on a screen".',
    choices: () => [
      {
        label: 'Settle quietly ($25,000)',
        resultText: 'You pay them to go away. It stings.',
        effects: { cash: -25000 },
      },
      {
        label: 'Lawyer up and fight ($12,000)',
        resultText: 'Your lawyer sends a scorcher. The troll retreats, and the story earns you fans.',
        effects: { cash: -12000, reputation: 4, hype: 4 },
      },
    ],
  },
  {
    id: 'acquihire',
    weight: 14,
    minWeek: 10,
    cond: (s) =>
      s.rivals.some((r) => !r.alive) &&
      s.cash > 120_000 &&
      !s.inbox.some((m) => m.title === 'Acqui-hire a dead rival’s team?'),
    title: 'Acqui-hire a dead rival’s team?',
    body: (s) => {
      const dead = s.rivals.find((r) => !r.alive)!
      return `${dead.name} is winding down, and their core team is looking for a home. For $60,000 in signing bonuses you could bring two of them aboard next week — battle-tested people who know this market (and how to lose in it).`
    },
    choices: () => [
      {
        label: 'Bring them aboard ($60k)',
        resultText: 'Two new desks filled overnight. They carry scar tissue — and know every mistake not to repeat.',
        effects: { cash: -60000, special: 'acquihire' },
      },
      {
        label: 'Pass — culture is fragile',
        resultText: 'They land at BigTech within the month.',
        effects: {},
      },
    ],
  },
  {
    id: 'poach-rival',
    weight: 7,
    minWeek: 14,
    cond: (s) => s.rivals.some((r) => r.alive && r.product > 50) && s.cash > 50_000,
    title: 'A rival’s star engineer is listening',
    body: (s) => {
      const target = s.rivals.filter((r) => r.alive).sort((a, b) => b.product - a.product)[0]
      return `A recruiter whispers that ${target.name}’s best engineer is unhappy. For $25,000 in recruiter fees and some wining and dining, you could get them to the table.`
    },
    choices: () => [
      {
        label: 'Make the approach ($25k)',
        resultText: 'They are interested. A very strong candidate just appeared at the top of your hiring pool — move fast.',
        effects: { cash: -25000, special: 'poach-rival' },
      },
      {
        label: 'Leave them be',
        resultText: 'You stay classy. The rival ships their next release on time.',
        effects: {},
      },
    ],
  },
  {
    id: 'angel-check',
    weight: 40,
    minWeek: 8,
    cond: (s) =>
      s.stage === 'Pre-seed' &&
      s.cash > 0 &&
      s.cash < 12 * (s.lastExpenses - s.lastRevenue) &&
      s.lastExpenses > s.lastRevenue &&
      !s.inbox.some((m) => m.title === 'An angel investor calls'),
    title: 'An angel investor calls',
    body: () =>
      'Word got around that your runway is short. A well-known angel investor offers $120,000 for 8% — ' +
      '"I back founders early, when it hurts. That is the price of oxygen." It is not a great deal. It might be the only one.',
    choices: () => [
      {
        label: 'Take the $120k for 8%',
        resultText: 'The wire clears. You live to iterate another quarter.',
        effects: { cash: 120000, special: 'angel' },
      },
      {
        label: 'Decline — the terms are insulting',
        resultText: 'You hang up politely. The runway keeps shrinking.',
        effects: { reputation: 2 },
      },
    ],
  },
  {
    id: 'user-insight',
    weight: 8,
    minWeek: 5,
    cond: (s) => s.allocation.research > 10 && s.pmf < 70,
    title: 'A pattern in the user interviews',
    body: () =>
      'Three different users described the same unexpected way they use your product. There might be something real here.',
    autoEffects: () => ({ pmf: 3, morale: 3 }),
  },
  {
    id: 'churn-scare',
    weight: 8,
    minWeek: 8,
    cond: (s) => s.pmf < 40 && s.users > 80,
    title: 'Cohort report: users are not sticking',
    body: () =>
      'Your retention curves all slope to zero. People try the product, shrug, and leave. Marketing more will not fix this — the product is not landing.',
    autoEffects: () => ({ morale: -3 }),
  },
  {
    id: 'cloud-bill',
    weight: 7,
    minWeek: 10,
    cond: (s) => s.users > 500,
    title: 'Cloud bill spike',
    body: (s) =>
      `Growth is great — but your infrastructure provider flags a $${Math.round(s.users * 8).toLocaleString()} overage this cycle. Pay it, or pull engineers off the roadmap to optimize it away.`,
    choices: (s) => {
      const full = Math.round(s.users * 8)
      const reduced = Math.round(full / 3)
      return [
        {
          label: `Pay the overage ($${full.toLocaleString()})`,
          resultText: 'The bill clears. The roadmap does not slip.',
          effects: { cash: -full },
        },
        {
          label: `Optimization sprint (pay $${reduced.toLocaleString()}, lose a week of product work)`,
          resultText: 'The team rewrites the hot paths and caches everything. The bill shrinks; the roadmap slips a little.',
          effects: { cash: -reduced, features: -2 },
        },
      ]
    },
  },
  {
    id: 'fan-mail',
    weight: 8,
    minWeek: 4,
    cond: (s) => s.users > 20 && s.pmf > 25,
    title: 'A user love letter',
    body: () =>
      'A customer wrote a long post about how your product changed their workflow. The team passes it around all day.',
    autoEffects: () => ({ morale: 6, hype: 3 }),
  },
  {
    id: 'conference-invite',
    weight: 6,
    minWeek: 8,
    cond: (s) => s.reputation > 30,
    title: 'Conference keynote slot',
    body: () =>
      'A major industry conference wants you to demo on stage next week. Great exposure — if the demo does not crash.',
    choices: (s) => [
      {
        label: 'Take the stage',
        resultText:
          s.bugs > 45
            ? 'The demo crashes live. The clip goes viral for the wrong reasons.'
            : 'The demo lands perfectly. The signup queue is visible from space.',
        effects: s.bugs > 45 ? { hype: -6, reputation: -8, morale: -5 } : { hype: 16, reputation: 8 },
      },
      {
        label: 'Send a polite no',
        resultText: 'Maybe next year.',
        effects: {},
      },
    ],
  },
  {
    id: 'pricing-experiment',
    weight: 6,
    minWeek: 12,
    cond: (s) => s.users > 100,
    title: 'Pricing consultant pitch',
    body: () =>
      'A pricing consultant swears you are leaving money on the table and offers a rapid pricing overhaul.',
    choices: (s) => [
      {
        label: 'Run the overhaul ($10k)',
        resultText:
          s.quality > 50
            ? 'The new pricing sticks. Revenue per user climbs.'
            : 'Users balk at paying more for a rough product. Some walk.',
        effects: s.quality > 50 ? { cash: -10000, reputation: 3 } : { cash: -10000, users: -0.04 },
      },
      {
        label: 'Keep pricing as is',
        resultText: 'Steady as she goes.',
        effects: {},
      },
    ],
  },

  // ---------- macro-reactive ----------
  {
    id: 'layoffs-wave',
    weight: 7,
    minWeek: 8,
    cond: (s) => s.climate < -0.4,
    title: 'Industry layoffs wave',
    body: () =>
      'Three big names cut 20% in the same week. The talent market floods with excellent people — and your team quietly checks the runway math.',
    autoEffects: () => ({ morale: -2, special: 'talent-influx' }),
  },
  {
    id: 'crash-fire-sale',
    weight: 6,
    minWeek: 20,
    cond: (s) => s.climate < -0.5 && s.cash > 500_000,
    title: 'Distressed startup fire sale',
    body: () =>
      'A dying competitor-adjacent startup is auctioning its codebase and patents for a fraction of what they raised. Their loss, potentially your gain.',
    choices: () => [
      {
        label: 'Buy the assets ($150,000)',
        resultText: 'Two repos, one patent family, and a very sad README. Your product grows overnight — so does your bug tracker.',
        effects: { cash: -150_000, features: 8, bugs: 5 },
      },
      { label: 'Let it pass', resultText: 'Someone else buys the scraps.', effects: {} },
    ],
  },
  {
    id: 'crypto-mania',
    weight: 5,
    minWeek: 10,
    cond: (s) => s.climate > 0.5,
    title: 'Speculative mania sucks the air out',
    body: () =>
      'The hot money found a new toy this month, and it is not your category. Attention drifts; your launch tweet lands in an empty room.',
    autoEffects: () => ({ hype: -4 }),
  },
  {
    id: 'index-ath',
    weight: 6,
    minWeek: 6,
    cond: (s) => s.macro.index > 125,
    title: 'Markets hit all-time highs',
    body: () => 'Everyone feels rich, budgets loosen, and B2B buyers say yes faster. Enjoy it while it lasts — it never lasts.',
    autoEffects: () => ({ hype: 5, morale: 3 }),
  },
  {
    id: 'cola-demand',
    weight: 8,
    minWeek: 12,
    cond: (s) => s.macro.inflation > 6 && s.employees.length >= 3,
    title: 'Cost-of-living revolt',
    body: (s) =>
      `Inflation is running at ${s.macro.inflation.toFixed(1)}% and the team did the math on their groceries. A delegation asks for a company-wide cost-of-living adjustment.`,
    choices: () => [
      {
        label: 'Grant a 5% company-wide adjustment',
        resultText: 'Payroll rises; so does loyalty. "They actually did it," someone writes in the group chat.',
        effects: { morale: 10, special: 'cola-raise' },
      },
      {
        label: 'Hold the line on salaries',
        resultText: 'The delegation files out silently. Grocery math continues.',
        effects: { morale: -9 },
      },
    ],
  },
  {
    id: 'vc-tourist',
    weight: 5,
    minWeek: 10,
    cond: (s) => s.climate > 0.55 && s.pmf > 40,
    title: 'A fund you never called is calling',
    body: () =>
      'A partner from a mega-fund "would love to get to know the story — no agenda". In a frothy market, capital chases anything that moves.',
    autoEffects: () => ({ hype: 4, reputation: 2 }),
  },
  // ---------- debt & banking ----------
  {
    id: 'refi-offer',
    weight: 9,
    minWeek: 10,
    cond: (s) => !!s.debt && s.macro.rate + 2 < s.debt.apr - 1,
    title: 'Refinancing window',
    body: (s) =>
      `Rates have fallen since you drew your loan at ${s.debt!.apr}%. Your banker — suddenly friendly — offers to reprice the line at ${(s.macro.rate + 2).toFixed(1)}%.`,
    choices: () => [
      { label: 'Refinance at the new rate', resultText: 'Papers signed. Same debt, smaller bite.', effects: { special: 'refinance' } },
      { label: 'Ignore the banker', resultText: 'The old rate stands. The banker stops sending holiday cards.', effects: {} },
    ],
  },
  {
    id: 'credit-tightening',
    weight: 6,
    minWeek: 10,
    cond: (s) => !!s.debt && s.macro.rate > 8,
    title: 'Credit tightens',
    body: () =>
      'With rates this high, your bank reprices risk across its whole book. A letter informs you of a 1-point increase on your line, citing clause 14(b), which you definitely read.',
    autoEffects: () => ({ special: 'rate-hike-debt' }),
  },
  {
    id: 'banker-dinner',
    weight: 4,
    minWeek: 15,
    cond: (s) => !!s.debt && s.lastRevenue > s.debt.covenantRevenue * 1.5,
    title: 'Dinner with the bank',
    body: () =>
      'Your revenue is comfortably above covenant, and suddenly it is steak dinners and "what else can we do for you". Banks love you exactly when you don\'t need them.',
    autoEffects: () => ({ reputation: 2 }),
  },
  // ---------- ventures & product lines ----------
  {
    id: 'bet-breakthrough',
    weight: 8,
    minWeek: 10,
    cond: (s) => s.ventures.some((v) => !v.launched),
    title: 'The tiger team finds a thread',
    body: () =>
      'The new-bet team ran twelve customer interviews in four days and came back vibrating. Something in the new market is pulling.',
    autoEffects: () => ({ special: 'bet-insight', morale: 3 }),
  },
  {
    id: 'venture-press',
    weight: 6,
    minWeek: 20,
    cond: (s) => s.ventures.some((v) => v.launched),
    title: '"The everything company?"',
    body: () =>
      'A columnist writes about your expansion strategy with grudging admiration and one mean paragraph. Net effect: people now know you do more than one thing.',
    autoEffects: () => ({ hype: 6 }),
  },
  {
    id: 'cross-sell',
    weight: 6,
    minWeek: 25,
    cond: (s) => s.ventures.filter((v) => v.launched).length >= 2,
    title: 'Cross-sell machine kicks in',
    body: () =>
      'Sales discovers that customers of one product line convert beautifully into the others. The bundle deck writes itself.',
    autoEffects: () => ({ special: 'line-surge', reputation: 2 }),
  },
  {
    id: 'roadmap-war',
    weight: 6,
    minWeek: 20,
    cond: (s) => s.ventures.some((v) => v.launched) && s.employees.length >= 6,
    title: 'Roadmap turf war',
    body: () =>
      'The core team and the new-line team both claim the same two engineers for next quarter. The meeting has an agenda, a counter-agenda, and snacks nobody touches.',
    choices: () => [
      {
        label: 'Offsite to settle priorities ($15,000)',
        resultText: 'Two days, one whiteboard, a truce. Everyone knows what winning means now.',
        effects: { cash: -15_000, morale: 6 },
      },
      {
        label: 'Let them fight it out',
        resultText: 'The loudest roadmap wins. The quietest engineers update their priors about how decisions happen here.',
        effects: { morale: -5 },
      },
    ],
  },
  {
    id: 'conglomerate-award',
    weight: 4,
    minWeek: 40,
    cond: (s) => s.ventures.filter((v) => v.launched).length >= 3,
    title: 'Cover story: the mini-conglomerate',
    body: () =>
      'A business magazine puts your multi-product empire on the cover with the headline "The Compounder". Your parents finally understand what you do. Sort of.',
    autoEffects: () => ({ reputation: 8, hype: 6, morale: 4 }),
  },
  // ---------- board & investors ----------
  {
    id: 'board-tweet',
    weight: 6,
    minWeek: 12,
    cond: (s) => !!s.board,
    title: 'A board member is posting again',
    body: () =>
      'Your most online investor posted a spicy take that is being screenshotted widely — with your company named in their bio.',
    choices: () => [
      {
        label: 'Ask them to delete it',
        resultText: 'They delete it and respect you slightly more, which they express by interrupting you slightly less.',
        effects: { reputation: 2 },
      },
      {
        label: 'Quote-post with a meme',
        resultText: 'The exchange goes viral. Brand: chaotic. Reach: enormous.',
        effects: { hype: 7, reputation: -3 },
      },
    ],
  },
  {
    id: 'investor-intro',
    weight: 6,
    minWeek: 15,
    cond: (s) => !!s.board && (s.sector === 'saas' || s.sector === 'fintech' || s.sector === 'devtools'),
    title: 'A warm intro from the board',
    body: () =>
      'One of your investors walks you into their old employer — a logo big enough to anchor your next sales deck.',
    autoEffects: (s) => ({ cash: Math.round(20_000 + s.lastRevenue * 0.5), reputation: 3 }),
  },
  {
    id: 'founder-award',
    weight: 4,
    minWeek: 30,
    cond: (s) => s.reputation > 55,
    title: 'You made a list',
    body: () =>
      '"Founders to Watch." Your photo is fine. Your quote got trimmed weirdly. Your mother bought nine copies.',
    autoEffects: () => ({ reputation: 5, hype: 5, morale: 2 }),
  },
  {
    id: 'analyst-coverage',
    weight: 5,
    minWeek: 40,
    cond: (s) => s.lastRevenue * 52 > 5_000_000,
    title: 'An analyst starts covering your category',
    body: () =>
      'A research firm publishes a market map with your logo in the "leaders" quadrant-ish area. Procurement departments suddenly return calls.',
    autoEffects: () => ({ hype: 5, reputation: 4 }),
  },
  {
    id: 'unicorn-watch',
    weight: 4,
    minWeek: 50,
    cond: (s) => (s.history[s.history.length - 1]?.valuation ?? 0) > 650_000_000,
    title: 'The unicorn watchlist',
    body: () =>
      'A tracker site lists you under "approaching $1B". Recruiters, bankers, and long-lost acquaintances all notice simultaneously.',
    autoEffects: () => ({ hype: 8 }),
  },

  // ---------- trait-driven team moments ----------
  {
    id: 'tenx-keynote',
    weight: 6,
    minWeek: 12,
    cond: (s) => s.employees.some((e) => e.trait === 'tenx'),
    title: 'Your 10x wants the spotlight',
    body: (s) => {
      const star = s.employees.find((e) => e.trait === 'tenx')!
      return `${star.name} got invited to keynote a conference about "how we ship so fast". The talk would be great marketing — and insufferable to sit through for the rest of the team.`
    },
    choices: () => [
      {
        label: 'Send them — with a slide about the team',
        resultText: 'The talk kills. The team slide gets exactly four seconds of screen time.',
        effects: { hype: 8, morale: -2 },
      },
      { label: 'Keep them heads-down', resultText: 'They sulk in four programming languages.', effects: { morale: -2 } },
    ],
  },
  {
    id: 'drama-blowup',
    weight: 7,
    minWeek: 10,
    cond: (s) => s.employees.some((e) => e.trait === 'drama') && s.employees.length >= 3,
    title: 'The group chat is on fire',
    body: (s) => {
      const magnet = s.employees.find((e) => e.trait === 'drama')!
      return `${magnet.name} had Opinions about a code review, in public, at length. Two channels have gone quiet in the bad way.`
    },
    choices: () => [
      {
        label: 'Mediate over lunch ($500 of sushi)',
        resultText: 'Grievances aired, boundaries drawn, spicy tuna consumed. Peace, for now.',
        effects: { cash: -500, morale: 6 },
      },
      { label: 'Let adults be adults', resultText: 'They are not, currently, being adults.', effects: { morale: -6 } },
    ],
  },
  {
    id: 'culture-carrier-moment',
    weight: 5,
    minWeek: 8,
    cond: (s) => s.employees.some((e) => e.trait === 'culture'),
    title: 'A small kindness scales',
    body: (s) => {
      const carrier = s.employees.find((e) => e.trait === 'culture')!
      return `${carrier.name} quietly started a Friday demo-and-doughnuts ritual. Attendance is now 100% and nobody mandated anything.`
    },
    autoEffects: () => ({ morale: 5 }),
  },
  {
    id: 'mercenary-sidegig',
    weight: 6,
    minWeek: 14,
    cond: (s) => s.employees.some((e) => e.trait === 'mercenary'),
    title: 'Moonlighting suspicions',
    body: (s) => {
      const merc = s.employees.find((e) => e.trait === 'mercenary')!
      return `${merc.name}'s GitHub is suspiciously active on someone else's product at 2am. Their output here hasn't dropped — yet.`
    },
    choices: () => [
      {
        label: 'Confront them directly',
        resultText: 'They shrug, quote their contract, and resign by lunch. Mercenaries gonna mercenary.',
        effects: { special: 'lose-mercenary', morale: 2 },
      },
      {
        label: 'Look away while the work is good',
        resultText: 'You now co-own their attention with a mystery startup.',
        effects: { features: -2 },
      },
    ],
  },
  {
    id: 'craftsman-refactor',
    weight: 6,
    minWeek: 12,
    cond: (s) => s.employees.some((e) => e.trait === 'craftsman') && s.bugs > 25,
    title: 'The craftsman proposes a cleanup week',
    body: (s) => {
      const c = s.employees.find((e) => e.trait === 'craftsman')!
      return `${c.name} presents a one-pager titled "The Refactor We Deserve". It promises to halve the bug pile at the cost of a week of features.`
    },
    choices: () => [
      {
        label: 'Grant the cleanup week',
        resultText: 'A week of deletion, renaming, and quiet joy. The codebase breathes again.',
        effects: { features: -2, bugs: -12, morale: 3 },
      },
      { label: 'Roadmap first', resultText: 'The one-pager joins its ancestors in the icebox.', effects: { morale: -2 } },
    ],
  },
  // ---------- people & office ----------
  {
    id: 'referral-network',
    weight: 6,
    minWeek: 10,
    cond: (s) => s.employees.length >= 3,
    title: 'Referral bonus program?',
    body: () => 'The team knows great people. Great people know the team. A referral bonus might shake a few loose.',
    choices: () => [
      {
        label: 'Offer $15k in referral bonuses',
        resultText: 'Two impressive CVs land within days — pre-vouched, pre-vetted.',
        effects: { cash: -15_000, special: 'talent-influx' },
      },
      { label: 'Keep hiring the hard way', resultText: 'The pipeline stays artisanal.', effects: {} },
    ],
  },
  {
    id: 'salary-leak',
    weight: 6,
    minWeek: 16,
    cond: (s) => s.employees.length >= 6,
    title: 'The salary spreadsheet leaked',
    body: () => 'Someone left the comp sheet open on the office TV for eleven minutes. Everyone saw everything. Slack is very quiet.',
    choices: () => [
      {
        label: 'Go transparent: publish salary bands',
        resultText: 'Radical honesty, retroactively adopted. After the initial shock, it reads as courage.',
        effects: { morale: 6, reputation: 3 },
      },
      {
        label: 'Pretend it never happened',
        resultText: 'Everyone pretends too. Badly.',
        effects: { morale: -8 },
      },
    ],
  },
  {
    id: 'office-dog',
    weight: 5,
    minWeek: 6,
    cond: (s) => s.employees.length >= 2,
    title: 'A dog has adopted the office',
    body: () =>
      'A golden retriever belonging to the café downstairs has decided your standup is her standup. Productivity dips for exactly one day, then soars.',
    autoEffects: () => ({ morale: 5 }),
  },
  {
    id: 'alumni-founder',
    weight: 4,
    minWeek: 40,
    cond: (s) => s.employees.some((e) => e.weeks > 30),
    title: 'An early employee starts their own thing',
    body: () =>
      'One of your veterans gives notice — to found their own company, "inspired by what we built here". Bittersweet, in the way of good schools.',
    autoEffects: () => ({ morale: -2, reputation: 3 }),
  },
  {
    id: 'intern-cohort',
    weight: 5,
    minWeek: 20,
    cond: (s) => s.employees.length >= 5,
    title: 'Summer intern cohort?',
    body: () => 'Three universities ask if you take interns. Chaos, energy, and at least one future star — for the price of some mentoring bandwidth.',
    choices: () => [
      {
        label: 'Run the internship ($12,000)',
        resultText: 'The interns ship a tool the whole team now depends on, and leave behind an inexplicable amount of soda.',
        effects: { cash: -12_000, morale: 5, features: 3 },
      },
      { label: 'Not this year', resultText: 'The universities move down their list.', effects: {} },
    ],
  },
  // ---------- product & users ----------
  {
    id: 'power-user-council',
    weight: 6,
    minWeek: 10,
    cond: (s) => s.users > 150 && s.pmf < 75,
    title: 'Assemble a power-user council?',
    body: () => 'Your ten most obsessive users would happily meet monthly and tell you exactly what to build, in exchange for stickers and early access.',
    choices: () => [
      {
        label: 'Convene the council ($5,000)',
        resultText: 'Ninety minutes of brutal, loving feedback. Your roadmap is now sharper than your pitch deck.',
        effects: { cash: -5_000, pmf: 4 },
      },
      { label: 'Trust the analytics', resultText: 'The dashboards say things. Different things.', effects: {} },
    ],
  },
  {
    id: 'feature-storm',
    weight: 6,
    minWeek: 14,
    cond: (s) => s.users > 800,
    title: 'The feature-request storm',
    body: () => 'One request has 400 upvotes, a hashtag, and fan art. It is not on your roadmap.',
    choices: () => [
      {
        label: 'Build the people\'s feature',
        resultText: 'Shipped in two weeks. The hashtag turns celebratory; the codebase turns slightly wilder.',
        effects: { features: 5, bugs: 4, hype: 5 },
      },
      { label: 'Hold the roadmap line', resultText: 'The hashtag turns sarcastic.', effects: { reputation: -3 } },
    ],
  },
  {
    id: 'localization',
    weight: 5,
    minWeek: 25,
    cond: (s) => s.users > 4_000,
    title: 'The world wants in',
    body: () => 'A third of your signups now come from countries you have never marketed to, using the product through browser translation. Imagine if it spoke their language.',
    choices: () => [
      {
        label: 'Localize into 5 languages ($25,000)',
        resultText: 'Conversion in the new markets doubles overnight. Turns out people like being spoken to.',
        effects: { cash: -25_000, users: 0.06, reputation: 2 },
      },
      { label: 'English is the language of software', resultText: 'The browser translations soldier on heroically.', effects: {} },
    ],
  },
  {
    id: 'app-store-feature',
    weight: 5,
    minWeek: 15,
    cond: (s) => (s.sector === 'social' || s.sector === 'ecommerce') && s.users > 2_000,
    title: 'Featured on the app store',
    body: () => 'An editor at the platform picked you for the front page. For seventy-two glorious hours, the install graph goes vertical.',
    autoEffects: (s) => ({ users: Math.round(s.users * 0.12), hype: 8, bugs: 3 }),
  },
  {
    id: 'accessibility-audit',
    weight: 4,
    minWeek: 18,
    cond: (s) => s.users > 500,
    title: 'Accessibility audit request',
    body: () => 'A user who relies on a screen reader sends a detailed, generous, damning report about everything your product gets wrong.',
    choices: () => [
      {
        label: 'Fix it properly ($8,000)',
        resultText: 'The fixes ship. The user posts a thank-you thread that outperforms your last three launches.',
        effects: { cash: -8_000, reputation: 5, quality: 4 },
      },
      { label: 'Backlog it', resultText: 'The report joins the backlog, where reports go to think about what they\'ve done.', effects: { reputation: -3 } },
    ],
  },
  {
    id: 'dark-mode',
    weight: 4,
    minWeek: 8,
    cond: (s) => s.users > 100,
    title: 'The dark mode ultimatum',
    body: () => 'The most-upvoted request of all time is, of course, dark mode. An engineer builds it in a weekend "for fun". Ship it?',
    autoEffects: () => ({ features: 2, morale: 3, hype: 2 }),
  },
  // ---------- drama & misc ----------
  {
    id: 'domain-squatter',
    weight: 5,
    minWeek: 10,
    cond: (s) => s.hype > 25,
    title: 'Domain squatter',
    body: (s) => `Someone bought every misspelling of ${s.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com and wants $8,000 for the bundle.`,
    choices: () => [
      { label: 'Pay the troll ($8,000)', resultText: 'The typos are yours. It feels bad and correct.', effects: { cash: -8_000 } },
      { label: 'Refuse on principle', resultText: 'A typo\'d clone site appears within the month, harvesting confused visitors.', effects: { reputation: -3 } },
    ],
  },
  {
    id: 'documentary-crew',
    weight: 4,
    minWeek: 25,
    cond: (s) => s.reputation > 40,
    title: 'A documentary crew wants access',
    body: () => 'A streaming platform is making a series about startups. They want three weeks of fly-on-the-wall access. Cameras change rooms.',
    choices: () => [
      {
        label: 'Let them in',
        resultText: 'The team performs "casual" for three weeks. The episode, airing later, is unreasonably flattering.',
        effects: { hype: 10, morale: -3, features: -1 },
      },
      { label: 'Closed set', resultText: 'They film your competitor instead. You watch the episode twice.', effects: {} },
    ],
  },
  {
    id: 'meme-moment',
    weight: 5,
    minWeek: 8,
    cond: (s) => s.users > 300,
    title: 'You are a meme now',
    body: () => 'A screenshot of your error message — accidentally poetic — is everywhere. "This is so us," say thousands of strangers.',
    autoEffects: () => ({ hype: 7 }),
  },
  {
    id: 'founder-podcast',
    weight: 5,
    minWeek: 12,
    cond: (s) => s.reputation > 25,
    title: 'Podcast invitation',
    body: () => 'A mid-sized podcast wants two hours of your origin story. Founders before you have converted rambling into recruiting gold.',
    choices: () => [
      {
        label: 'Record the episode',
        resultText: 'You tell the pivot story well. Three great candidates mention the episode in cover letters.',
        effects: { hype: 6, features: -1, special: 'talent-influx' },
      },
      { label: 'Politely decline', resultText: 'The host books a thought leader instead.', effects: {} },
    ],
  },
  {
    id: 'gdpr-request',
    weight: 4,
    minWeek: 20,
    cond: (s) => s.users > 1_000,
    title: 'Regulatory data request',
    body: () => 'A privacy regulator sends a questionnaire with 44 questions and a deadline. Question 12 has sub-parts.',
    choices: () => [
      { label: 'Lawyer + engineer sprint ($10,000)', resultText: 'Compliant, documented, filed. Boring in the best way.', effects: { cash: -10_000, reputation: 2 } },
      { label: 'Answer it yourself over a weekend', resultText: 'Probably fine. Probably.', effects: { morale: -2, reputation: -2 } },
    ],
  },
  {
    id: 'rival-alumni-ship',
    weight: 4,
    minWeek: 20,
    cond: (s) => s.rivals.some((r) => !r.alive),
    title: 'Refugees from a dead rival',
    body: (s) => {
      const dead = s.rivals.find((r) => !r.alive)!
      return `Two ex-${dead.name} engineers, now freelancing, offer you the integration playbook they wish their old company had used. Cheap, and it slots right in.`
    },
    autoEffects: () => ({ features: 4, bugs: -2 }),
  },
  // ---------- sector catastrophes: each market's signature nightmare ----------
  {
    id: 'cat-breach',
    weight: 5,
    minWeek: 30,
    cond: (s) => s.sector === 'fintech' && s.users > 2_000,
    title: '🚨 Data breach',
    body: (s) =>
      s.bugs > 30
        ? 'Attackers found a hole your bug backlog knew about. Customer financial data is out. This is the fintech nightmare, and it is happening to you.'
        : 'A sophisticated attack got partial access before your (solid) defenses cut it off. Bad — but your clean engineering just saved the company.',
    choices: (s) => {
      const bad = s.bugs > 30
      return [
        {
          label: 'Full disclosure, credit monitoring for all ($120,000)',
          resultText: bad
            ? 'Brutal week, honest handling. The coverage is harsh but notes you "responded like adults".'
            : 'Transparent handling of a contained incident. Security researchers publicly praise the response.',
          effects: bad
            ? { cash: -120_000, users: -0.12, reputation: -12, morale: -6 }
            : { cash: -120_000, users: -0.03, reputation: 4 },
        },
        {
          label: 'Minimal statement, lawyer-approved',
          resultText: 'The statement satisfies regulators and no one else. The story drips out for weeks.',
          effects: bad ? { users: -0.18, reputation: -20, hype: -10, morale: -8 } : { users: -0.06, reputation: -8 },
        },
      ]
    },
  },
  {
    id: 'cat-algorithm',
    weight: 5,
    minWeek: 30,
    cond: (s) => s.sector === 'social' && s.users > 20_000,
    title: '🚨 The algorithm turns',
    body: () =>
      'The platform your growth rides on changed its ranking overnight. Your content — everyone\'s content — is buried. Distribution you didn\'t own was never yours.',
    autoEffects: (s) => ({ users: -Math.round(s.users * 0.15), hype: -12 }),
  },
  {
    id: 'cat-dependency',
    weight: 5,
    minWeek: 30,
    cond: (s) => s.sector === 'saas' && s.users > 3_000,
    title: '🚨 Your platform dependency breaks',
    body: () =>
      'The cloud service half your product sits on had a catastrophic multi-day outage. Your customers don\'t care whose fault it is — their tools were down.',
    choices: () => [
      {
        label: 'Issue service credits to every customer',
        resultText: 'Expensive, classy, remembered. Churn stays low; the invoice stings.',
        effects: { cash: -60_000, reputation: 4, users: -0.02 },
      },
      {
        label: 'Point at the provider\'s status page',
        resultText: 'Technically correct. Contractually fine. Emotionally, your customers wanted to hear something else.',
        effects: { users: -0.08, reputation: -6 },
      },
    ],
  },
  {
    id: 'cat-cve',
    weight: 5,
    minWeek: 30,
    cond: (s) => s.sector === 'devtools' && s.users > 3_000,
    title: '🚨 Critical CVE in your tool',
    body: () =>
      'A researcher dropped a critical vulnerability in your most-used component — with a proof of concept. Every security team using you is paging someone right now.',
    choices: () => [
      {
        label: 'All-hands patch sprint + public post-mortem',
        resultText: 'Patched in 48 hours with a post-mortem the industry links to as "how to do it right".',
        effects: { features: -3, morale: -5, bugs: -6, reputation: 6 },
      },
      {
        label: 'Quiet patch, no fuss',
        resultText: 'The patch ships; the silence gets noticed. Security Twitter does your comms for you, unkindly.',
        effects: { features: -2, reputation: -8, users: -0.04 },
      },
    ],
  },
  {
    id: 'cat-logistics',
    weight: 5,
    minWeek: 30,
    cond: (s) => s.sector === 'ecommerce' && s.users > 10_000,
    title: '🚨 Logistics meltdown',
    body: () =>
      'Your fulfillment partner collapsed mid-season. Thousands of orders are sitting in a warehouse that has stopped answering the phone.',
    choices: () => [
      {
        label: 'Emergency re-route via premium carriers ($90,000)',
        resultText: 'Orders arrive late but they arrive, each with an apology credit. You keep most of the customers and none of the margin.',
        effects: { cash: -90_000, reputation: 2, morale: -3 },
      },
      {
        label: 'Refund the stuck orders and move on',
        resultText: 'Cheaper this quarter. The one-star reviews mention "never again" with remarkable consistency.',
        effects: { cash: -40_000, users: -0.1, reputation: -8 },
      },
    ],
  },
  {
    id: 'award-gala',
    weight: 4,
    minWeek: 30,
    cond: (s) => s.reputation > 45,
    title: 'Industry awards night',
    body: () => 'You are nominated for "Breakout Company". Attendance means a table, a tux, and small talk with rivals.',
    choices: () => [
      {
        label: 'Buy the table ($3,000)',
        resultText: 'You lose to a juice company, but the networking pays for the tux tenfold.',
        effects: { cash: -3_000, reputation: 4, hype: 3 },
      },
      { label: 'Skip it', resultText: 'The juice company wins in your absence too.', effects: {} },
    ],
  },
]

export function raiseDemandTarget(s: GameState) {
  return [...s.employees].filter((e) => e.skill >= 7 && e.weeks >= 20 && e.morale < 68).sort((a, b) => b.skill - a.skill)[0]
}

export function avgMorale(s: GameState): number {
  if (s.employees.length === 0) return 70
  return s.employees.reduce((a, e) => a + e.morale, 0) / s.employees.length
}
