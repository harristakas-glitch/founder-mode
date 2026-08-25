// The inbox lens — the highest-value single piece of onboarding in this game, and the one that is
// entirely post-hoc.
//
// The audit finding it exists for: every inbox decision is a two-sentence dilemma with two buttons,
// and a first-time player has no idea what KIND of thing is being traded, let alone which way. The
// week-6 accelerator offer costs 7% of the company and nothing on screen relates that to the
// valuation the player is looking at. So they click, the week moves on, and they learn nothing —
// which is how thirty hand-written events end up feeling like a coin flip.
//
// The fix is split deliberately down the middle:
//
//   BEFORE you answer, the lens names only WHAT IS AT STAKE — which resources each option touches,
//   unsigned. That is the vocabulary gap ("reputation and my own energy are things that exist and
//   press decisions spend them"), and it is information a real founder obviously has. It is not the
//   answer: the direction and the size stay hidden, so the decision is still a decision.
//
//   AFTER you answer, it prints the exact ledger. `Choice.effects` is fully resolved at the moment
//   the message is created and stored in the save, so this is not a model of the engine — it is the
//   engine's own numbers, read back. Nothing is spoiled, because the choice is already locked, and
//   this is where the player actually learns what these events are made of.
//
// Reads `game.inbox` and nothing else. Writes nothing.

import { useStore } from '../store'
import { valuation } from '../game/engine'
import type { Choice, Effects, GameState, Message } from '../game/types'
import { money } from '../format'
import { openGuide } from './guide'
import { useProgress } from './useOnboarding'

/**
 * After this many decisions the player has met the whole vocabulary several times over and the lens
 * retires itself. "Show them all again" in the field guide does not bring it back — resolved
 * decisions are experience, not a lesson — but turning notes off silences it immediately.
 */
const RETIRE_AFTER_DECISIONS = 20

interface Axis {
  key: string
  label: string
  /** Field guide term, when the word is one the game never defines elsewhere. */
  term?: string
  /** Sign, for the post-hoc ledger only. */
  amount?: number
  format?: (n: number) => string
}

const AXIS_META: Record<keyof Omit<Effects, 'special'>, { label: string; term?: string; format?: (n: number) => string }> = {
  cash: { label: 'Cash', term: 'burn', format: (n) => `${n > 0 ? '+' : '−'}${money(Math.abs(n))}` },
  hype: { label: 'Hype', term: 'hype' },
  reputation: { label: 'Reputation', term: 'reputation' },
  morale: { label: 'Team morale', term: 'morale' },
  energy: { label: 'Your energy', term: 'energy' },
  users: { label: 'Users' },
  bugs: { label: 'Bugs', term: 'bugs' },
  quality: { label: 'Quality' },
  features: { label: 'Features' },
  pmf: { label: 'PMF', term: 'pmf' },
}

/**
 * The specials that take a slice of the company, and how much — mirroring `applyEffects`, where
 * both are RELATIVE cuts of what the founder still holds rather than absolute points.
 *
 * This is the one place the lens converts a percentage into money. The audit case that demanded it:
 * the week-6 accelerator asks for 7% and the player is looking at a valuation in the header, but
 * nothing on the screen connects the two, so "7%" lands as a word rather than a price. After the
 * fact — the choice already locked, nothing spoiled — naming what it cost at today's valuation is
 * the difference between a coin flip and a lesson about dilution.
 */
const EQUITY_SPECIAL: Partial<Record<NonNullable<Effects['special']>, number>> = {
  accelerator: 0.07,
  angel: 0.08,
}

/** What each `special` actually does, in one phrase. Kept in step with `applyEffects`. */
const SPECIAL_LABEL: Record<NonNullable<Effects['special']>, string> = {
  'v2-price-match': 'drops your pricing to LOW — share protected, margin sacrificed',
  'v2-stability-sprint': 'shifts allocation hard toward bugs & stability for the crunch',
  'v2-cut-marketing': 'halves the growth budget — the pipeline thins, the runway slows',
  'v2-emergency-layoffs': 'cuts the bottom 20% of the team; morale takes the hit',
  'v2-reforecast': 're-cuts every live commitment to a deliverable bar — honesty buys back some board trust',
  'v2-differentiate': 'shifts the weekly build hard toward features & quality',
  'v2-harden': 'spends \$25k and shifts the build toward quality — a real hardening sprint',
  'v2-credit-customers': 'refunds every customer half a week — expensive, public, remembered',
  'v2-counter-acquisition': 'asks 25% more — strong momentum gets it, a shaky story watches them walk',
  'v2-exec-departs': 'They leave — team morale dips as the room watches',
  'v2-ignore-outage': 'Service quality and reputation take the hit; some customers walk',
  'v2-quiet-patch': 'Cheap now — the next incident comes sooner, and reads worse',
  acquired: 'ends the run — the company is sold',
  'lose-best': 'your strongest employee walks',
  accelerator: 'gives up 7% of the company',
  'grant-raise': 'a raise for the person who asked, and their morale with it',
  'refuse-raise': 'that person takes the refusal badly',
  angel: 'gives up 8% of the company',
  acquihire: 'two engineers join from a company that just died',
  'poach-rival': 'you take somebody off a rival',
  'board-layoffs': 'the board cuts about 30% of the team, and issues a strike',
  'board-defy': 'you tell the board no, on the record',
  refinance: 'reprices your existing debt at today’s rates',
  'rate-hike-debt': 'the bank passes a rate rise through to your APR',
  'cola-raise': 'every salary rises 5%',
  'talent-influx': 'two strong candidates appear in the hiring pool',
  'bet-insight': 'your active new bet gains PMF and research signal',
  'line-surge': 'every launched product line gains users',
  'lose-mercenary': 'a mercenary hire leaves',
  'network-exit': 'ends the run — you step back and hand over the network',
}

/**
 * What a relative equity cut was worth, in money, at today's valuation.
 *
 * Deliberately approximate and said so: it is priced at the CURRENT valuation, not the one at the
 * moment of the deal, because the honest question a founder asks later is "what is that slice worth
 * now". Returns null rather than guessing when the company has no meaningful valuation yet.
 */
function equityCost(g: GameState, special: NonNullable<Effects['special']>): string | null {
  const share = EQUITY_SPECIAL[special]
  if (share === undefined) return null
  const val = valuation(g)
  if (!Number.isFinite(val) || val <= 0) return null
  return `${Math.round(share * 100)}% of the company — about ${money(val * share)} at today's ${money(val)} valuation`
}

function axesOf(fx: Effects, signed: boolean): Axis[] {
  const out: Axis[] = []
  // The save is user-writable localStorage, and the module's own rule is that malformed data
  // degrades to silence, never to a crash. A choice with no effects ledger simply has no axes —
  // found the hard way: a hand-injected test message took the whole HQ down with it.
  if (!fx || typeof fx !== 'object') return out
  for (const [k, meta] of Object.entries(AXIS_META) as [keyof typeof AXIS_META, (typeof AXIS_META)[keyof typeof AXIS_META]][]) {
    const v = fx[k]
    if (typeof v !== 'number' || v === 0) continue
    out.push({ key: k, label: meta.label, term: meta.term, amount: signed ? v : undefined, format: meta.format })
  }
  if (fx.special) out.push({ key: 'special', label: SPECIAL_LABEL[fx.special] ?? fx.special })
  return out
}

/** `users` is "percent of current users" below 1 and an absolute count at or above it. */
function amountText(a: Axis): string {
  if (a.amount === undefined) return ''
  if (a.format) return a.format(a.amount)
  if (a.key === 'users' && Math.abs(a.amount) < 1) return `${a.amount > 0 ? '+' : '−'}${Math.round(Math.abs(a.amount) * 100)}%`
  return `${a.amount > 0 ? '+' : '−'}${Math.round(Math.abs(a.amount))}`
}

function Chip({ a, signed }: { a: Axis; signed: boolean }) {
  const tone = !signed || a.amount === undefined ? 'text-mut' : a.amount > 0 ? 'text-good' : 'text-bad'
  // Bugs are the one axis where "more" is worse, so the colour has to be inverted or it lies.
  const inverted = a.key === 'bugs'
  const cls = !signed || a.amount === undefined ? 'text-mut' : inverted ? (a.amount > 0 ? 'text-bad' : 'text-good') : tone
  const body = (
    <>
      {a.label}
      {signed && a.amount !== undefined && <b className={`ml-1 tnum ${cls}`}>{amountText(a)}</b>}
    </>
  )
  if (!a.term) return <span className="rounded-md border border-line/70 px-1.5 py-0.5 text-[11.5px] text-mut">{body}</span>
  return (
    <button
      onClick={() => openGuide(a.term)}
      title="What is this? — opens the field guide"
      className="rounded-md border border-line/70 px-1.5 py-0.5 text-[11.5px] text-mut transition-colors hover:border-accent hover:text-ink"
    >
      {body}
    </button>
  )
}

/**
 * Recover which option was taken. The engine stores the chosen option's `resultText` on the message
 * and not its index, so this matches on that — and gives up rather than guessing when two options
 * share the same result line, because a ledger attributed to the wrong button is worse than none.
 */
function takenChoice(m: Message): Choice | null {
  if (!m.choices || !m.resultText) return null
  const hits = m.choices.filter((c) => c.resultText === m.resultText)
  return hits.length === 1 ? hits[0] : null
}

export function DecisionLens({ message }: { message: Message }) {
  const game = useStore((s) => s.game)
  const progress = useProgress()
  if (!game || message.kind !== 'choice' || !message.choices) return null
  if (!progress.enabled) return null
  if ((progress.skills.decide ?? 0) >= RETIRE_AFTER_DECISIONS) return null

  // ---- after: the exact ledger ----
  if (message.resolved) {
    const taken = takenChoice(message)
    if (!taken) return null
    const axes = axesOf(taken.effects, true)
    const equity = taken.effects.special ? equityCost(game, taken.effects.special) : null
    if (axes.length === 0 && !equity)
      return (
        <div className="mt-1.5 text-[12px] text-mut">
          What it did: <b className="text-ink">nothing measurable</b> — declining was free this time.
        </div>
      )
    return (
      <div className="mt-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-mut">What it did</span>
          {axes.map((a) => (
            <Chip key={a.key} a={a} signed />
          ))}
        </div>
        {equity && (
          <div className="mt-1 text-[12px] leading-snug text-mut">
            <button
              onClick={() => openGuide('dilution')}
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
              title="What is this? — opens the field guide"
            >
              Dilution
            </button>
            : <b className="text-ink">{equity}</b>. That share is gone for good — it does not come back when the company grows.
          </div>
        )}
      </div>
    )
  }

  // ---- before: what is at stake, unsigned ----
  const perOption = message.choices.map((c) => axesOf(c.effects, false))
  if (perOption.every((a) => a.length === 0)) return null
  return (
    <div className="mt-2 rounded-xl border border-line/50 bg-surface2 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-mut">What is at stake</div>
      <div className="mt-1 space-y-1">
        {message.choices.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[12px] text-mut">{c.label} —</span>
            {perOption[i].length === 0 ? (
              <span className="text-[11.5px] text-mut">nothing at all</span>
            ) : (
              perOption[i].map((a) => <Chip key={a.key} a={a} signed={false} />)
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-mut/75">
        Which way each one moves, and by how much, is the part you are deciding. Once you answer, the exact figures appear here.
      </div>
    </div>
  )
}
