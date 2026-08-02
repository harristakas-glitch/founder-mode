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
]

export function raiseDemandTarget(s: GameState) {
  return [...s.employees].filter((e) => e.skill >= 7 && e.weeks >= 20 && e.morale < 68).sort((a, b) => b.skill - a.skill)[0]
}

export function avgMorale(s: GameState): number {
  if (s.employees.length === 0) return 70
  return s.employees.reduce((a, e) => a + e.morale, 0) / s.employees.length
}
