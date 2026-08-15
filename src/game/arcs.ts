// Story arcs: multi-week narratives with memory. Each stage fires `after` weeks
// past the previous one; choice stages pause the arc until the player answers,
// and choices write facts into arc.data that later stages read.
import type { ActiveArc, Choice, Effects, GameState } from './types'

export interface ArcStageBuild {
  title: string
  body: string
  choices?: Choice[]
  autoEffects?: Effects
  goto?: string // for auto (news) stages: the next stage; omit to conclude the arc
}

export interface ArcStageDef {
  after: number
  build: (s: GameState, arc: ActiveArc) => ArcStageBuild
}

export interface ArcDef {
  id: string
  weight: number
  cond: (s: GameState) => boolean
  start: string
  stages: Record<string, ArcStageDef>
}

const b2b = (s: GameState) => s.sector === 'saas' || s.sector === 'devtools' || s.sector === 'fintech' || s.sector === 'aiml'

export const ARC_DEFS: ArcDef[] = [
  // ---------- the whale pilot: enterprise sales as a saga ----------
  {
    id: 'whale-pilot',
    weight: 10,
    cond: (s) => b2b(s) && s.pmf >= 50 && s.users > 200,
    start: 'offer',
    stages: {
      offer: {
        after: 0,
        build: () => ({
          title: '📖 MegaCorp wants a pilot',
          body:
            'A Fortune 100 company proposes a six-week pilot. Land it and the contract could anchor your revenue for years. ' +
            'But pilots consume engineering attention, and MegaCorp will judge everything — especially your bug count.',
          choices: [
            {
              label: 'Accept the pilot',
              resultText: 'The pilot begins. Six weeks to look enterprise-grade.',
              effects: { features: -2, morale: 2 },
              arcGoto: 'verdict',
            },
            {
              label: 'Decline — focus on the core',
              resultText: 'You pass politely. MegaCorp moves down its vendor list.',
              effects: { reputation: 1 },
              arcEnd: true,
            },
          ],
        }),
      },
      verdict: {
        after: 6,
        build: (s, arc) => {
          const good = s.quality >= 55 && s.bugs <= 45
          arc.data.pilotGood = good ? 1 : 0
          return good
            ? {
                title: '📖 The pilot report lands',
                body: 'MegaCorp\'s eval team writes: "robust, responsive, production-ready." Procurement wants to talk numbers next week.',
                autoEffects: { morale: 4, reputation: 3 },
                goto: 'negotiation',
              }
            : {
                title: '📖 The pilot report lands — with bruises',
                body: 'MegaCorp\'s eval flags stability issues. They\'re still interested — "the roadmap is compelling" — but you\'ve lost the strong hand in the negotiation.',
                autoEffects: { morale: -3 },
                goto: 'negotiation',
              }
        },
      },
      negotiation: {
        after: 1,
        build: (_s, arc) => {
          const strong = arc.data.pilotGood === 1
          return {
            title: '📖 MegaCorp: the negotiation',
            body: strong
              ? 'Procurement opens with a lowball anyway — it\'s procurement. But the eval report is your leverage, and everyone at the table knows it.'
              : 'Procurement opens with a lowball, and after that pilot report, your leverage is thin. Push too hard and they may walk.',
            choices: [
              {
                label: 'Hardball: name your price',
                resultText: strong
                  ? 'Silence. Then: "We\'ll make it work." The contract lands at full price — and the logo alone is worth the fight.'
                  : 'They confer, then walk. "Timing isn\'t right." The pilot bruises made hardball a bluff they could call.',
                effects: strong
                  ? { cash: 280_000, reputation: 6, hype: 5, morale: 5 }
                  : { reputation: -3, morale: -4 },
                arcEnd: true,
              },
              {
                label: 'Meet in the middle',
                resultText: 'A fair deal, signed in a week. Not the headline number, but real money from a real logo.',
                effects: { cash: 130_000, reputation: 3, morale: 2 },
                arcEnd: true,
              },
            ],
          }
        },
      },
    },
  },
  // ---------- the regulator: an inquiry with stages ----------
  {
    id: 'regulator',
    weight: 8,
    cond: (s) => (s.sector === 'fintech' || s.sector === 'ecommerce') && s.week > 25 && s.users > 500,
    start: 'inquiry',
    stages: {
      inquiry: {
        after: 0,
        build: () => ({
          title: '📖 The regulator opens an inquiry',
          body:
            'A formal letter: your data-handling practices are under review. Nothing is alleged — yet — but the process has begun, and processes like this one have momentum.',
          autoEffects: { reputation: -3 },
          goto: 'strategy',
        }),
      },
      strategy: {
        after: 3,
        build: () => ({
          title: '📖 Inquiry: choose your defense',
          body: 'The document requests arrive. Your lawyer outlines three postures, each with a price.',
          choices: [
            {
              label: 'Full legal defense ($60,000)',
              resultText: 'A serious firm takes the case. Every response lands polished, on time, unimpeachable.',
              effects: { cash: -60_000 },
              arcSet: { defense: 2 },
              arcGoto: 'verdict',
            },
            {
              label: 'Cooperate openly, minimal counsel',
              resultText: 'You over-share cheerfully. Risky, but regulators remember good faith.',
              effects: { reputation: 2 },
              arcSet: { defense: 1 },
              arcGoto: 'verdict',
            },
            {
              label: 'Stonewall and hope',
              resultText: 'Minimal responses, maximum delay. The team notices the strategy and doesn\'t love it.',
              effects: { morale: -3 },
              arcSet: { defense: 0 },
              arcGoto: 'verdict',
            },
          ],
        }),
      },
      verdict: {
        after: 5,
        build: (_s, arc) => {
          const d = arc.data.defense ?? 0
          if (d === 2)
            return {
              title: '📖 Inquiry closed: no action',
              body: 'The regulator closes the file without findings. Expensive, but the clean bill of health becomes a sales asset in enterprise deals.',
              autoEffects: { reputation: 6 },
            }
          if (d === 1)
            return {
              title: '📖 Inquiry closed: minor findings',
              body: 'A small fine and a compliance checklist — and a paragraph noting your "exemplary cooperation" that reads almost warm, for a regulator.',
              autoEffects: { cash: -25_000, reputation: 3 },
            }
          return {
            title: '📖 Inquiry closed: sanctions',
            body: 'The stonewalling read as guilt. A six-figure fine, a scathing public notice, and a compliance monitor who now attends your standups.',
            autoEffects: { cash: -120_000, reputation: -8, hype: -5, morale: -4 },
          }
        },
      },
    },
  },
  // ---------- the influencer: love, invoice, consequences ----------
  {
    id: 'influencer',
    weight: 9,
    cond: (s) => (s.sector === 'social' || s.sector === 'ecommerce') && s.hype > 30 && s.users > 500,
    start: 'adoption',
    stages: {
      adoption: {
        after: 0,
        build: (s) => ({
          title: '📖 A mega-influencer found you',
          body: 'Eight million followers just watched them use your product unprompted, for free, glowingly. The signup graph does something vertical.',
          autoEffects: { users: Math.max(50, Math.round(s.users * 0.08)), hype: 10 },
          goto: 'invoice',
        }),
      },
      invoice: {
        after: 4,
        build: () => ({
          title: '📖 The influencer\'s manager calls',
          body: '"Organic love is great, but let\'s formalize the partnership." The rate card is attached. It is not shy.',
          choices: [
            {
              label: 'Sign the partnership ($40,000)',
              resultText: 'The content keeps coming, now with contractual enthusiasm.',
              effects: { cash: -40_000 },
              arcSet: { paid: 1 },
              arcGoto: 'payoff',
            },
            {
              label: 'Decline — the love was free',
              resultText: 'The manager\'s "totally understood!" has a temperature of absolute zero.',
              effects: {},
              arcSet: { paid: 0 },
              arcGoto: 'payoff',
            },
          ],
        }),
      },
      payoff: {
        after: 3,
        build: (s, arc) =>
          arc.data.paid === 1
            ? {
                title: '📖 The partnership compounds',
                body: 'Three videos, one "day in my life" segment, and a merch cameo later — the audience keeps converting.',
                autoEffects: { users: Math.max(40, Math.round(s.users * 0.06)), hype: 6 },
              }
            : {
                title: '📖 The influencer turns',
                body: 'Today\'s video: "Why I quit [your product]". It is extremely watchable. The comments section is a crime scene.',
                autoEffects: { users: -0.05, hype: -8, reputation: -3 },
              },
      },
    },
  },
  // ---------- the acquired team: does it gel? ----------
  {
    id: 'acquihire-gel',
    weight: 10,
    cond: (s) => !!s.flags.acquihired,
    start: 'friction',
    stages: {
      friction: {
        after: 2,
        build: () => ({
          title: '📖 The acquired team keeps to itself',
          body: 'They lunch together, code together, and reference in-jokes from a company that no longer exists. Integration is not happening by osmosis.',
          autoEffects: { morale: -2 },
          goto: 'decision',
        }),
      },
      decision: {
        after: 2,
        build: () => ({
          title: '📖 Integrate or tolerate?',
          body: 'Your leads propose a joint sprint — mixed pairs, shared ownership, one codebase. It costs a feature cycle. The alternative is hoping time fixes culture.',
          choices: [
            {
              label: 'Run the joint sprint',
              resultText: 'Two weeks of pair programming and pointed retro conversations. Something shifts.',
              effects: { features: -2 },
              arcSet: { gel: 1 },
              arcGoto: 'outcome',
            },
            {
              label: 'Give it time',
              resultText: 'Time passes. That is all time does.',
              effects: {},
              arcSet: { gel: 0 },
              arcGoto: 'outcome',
            },
          ],
        }),
      },
      outcome: {
        after: 4,
        build: (_s, arc) =>
          arc.data.gel === 1
            ? {
                title: '📖 The acquired team ships a hit',
                body: 'Their scar tissue plus your momentum: the mixed team ships the quarter\'s best feature, and the in-jokes are now everyone\'s.',
                autoEffects: { features: 8, morale: 7, reputation: 2 },
              }
            : {
                title: '📖 The acquired team dissolves',
                body: 'Two of them resign the same Friday, references to "culture fit" in both notes. The playbook they carried walks out the door.',
                autoEffects: { morale: -5, features: -3 },
              },
      },
    },
  },
  // ---------- the wobbling whale: macro reaches your revenue ----------
  {
    id: 'whale-wobble',
    weight: 9,
    cond: (s) => b2b(s) && s.climate < -0.45 && s.lastRevenue > 15_000,
    start: 'freeze',
    stages: {
      freeze: {
        after: 0,
        build: () => ({
          title: '📖 Your biggest customer freezes spending',
          body: 'Their CFO issued a company-wide freeze — every vendor contract goes under review, yours included. A renewal that was a formality is now a fight.',
          autoEffects: { morale: -2 },
          goto: 'renewal',
        }),
      },
      renewal: {
        after: 2,
        build: () => ({
          title: '📖 The renewal call',
          body: 'Their procurement asks for 40% off "given the macro environment". Everyone cites the macro environment now. It is a very useful environment.',
          choices: [
            {
              label: 'Grant a temporary discount',
              resultText: 'You protect the relationship and eat the margin. They remember — CFOs keep ledgers of favors too.',
              effects: { cash: -20_000 },
              arcSet: { kept: 1 },
              arcGoto: 'thaw',
            },
            {
              label: 'Hold the price',
              resultText: 'You bet they need you more than they need the discount. The line goes quiet for a long moment.',
              effects: {},
              arcSet: { kept: -1 },
              arcGoto: 'thaw',
            },
          ],
        }),
      },
      thaw: {
        after: 5,
        build: (s, arc) => {
          if (arc.data.kept === 1)
            return {
              title: '📖 The whale returns, bigger',
              body: 'The freeze lifts and their CFO remembers who bent when it mattered. The renewal comes back with an expansion attached.',
              autoEffects: { cash: 70_000, reputation: 4 },
            }
          const held = s.pmf >= 70
          return held
            ? {
                title: '📖 The whale blinks',
                body: 'They renewed at full price. Turns out ripping out a product the whole team depends on costs more than a discount. PMF is leverage.',
                autoEffects: { reputation: 3, morale: 3 },
              }
            : {
                title: '📖 The whale swims off',
                body: 'They churned to a cheaper rival "for this phase of the journey". The revenue hole announces itself on next week\'s dashboard.',
                autoEffects: { users: -0.06, reputation: -2 },
              }
        },
      },
    },
  },
  // ---------- the open-source clone ----------
  {
    id: 'oss-clone',
    weight: 8,
    cond: (s) => (s.sector === 'devtools' || s.sector === 'saas') && s.features > 50,
    start: 'trending',
    stages: {
      trending: {
        after: 0,
        build: () => ({
          title: '📖 An open-source clone is trending',
          body: '"LibreYou" hit the front page: your core feature set, reimplemented, free, with a README that name-checks you as "the proprietary alternative".',
          autoEffects: { hype: -5 },
          goto: 'response',
        }),
      },
      response: {
        after: 3,
        build: () => ({
          title: '📖 The clone: pick your posture',
          body: 'The clone gains stars daily. Your community manager drafts two very different blog posts.',
          choices: [
            {
              label: 'Embrace: open-source your non-core layers',
              resultText: 'The post lands as confident, not cornered. Half the clone\'s contributors show up in your repo within a week.',
              effects: { reputation: 6, hype: 8, features: -3 },
              arcSet: { embraced: 1 },
              arcGoto: 'aftermath',
            },
            {
              label: 'Fight: legal pressure on the lookalikes',
              resultText: 'The DMCA letters go out. Hacker News has opinions. All of them, simultaneously.',
              effects: { reputation: -5 },
              arcSet: { embraced: 0 },
              arcGoto: 'aftermath',
            },
          ],
        }),
      },
      aftermath: {
        after: 5,
        build: (_s, arc) =>
          arc.data.embraced === 1
            ? {
                title: '📖 The community pays dividends',
                body: 'External contributors are fixing bugs you hadn\'t triaged and building integrations you hadn\'t planned. The clone still exists; it just stopped mattering.',
                autoEffects: { bugs: -8, features: 4, reputation: 3 },
              }
            : {
                title: '📖 The clone forks ahead',
                body: 'Martyrdom is rocket fuel for open source. The clone\'s community doubled, and their changelog now moves faster than yours.',
                autoEffects: { users: -0.04, hype: -4 },
              },
      },
    },
  },
]
