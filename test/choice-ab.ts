// The choice A/B harness — every choice the game offers must be a real decision.
//
// Forks the run at every unresolved choice message, resolves each option on its own copy,
// advances both 8 weeks, and compares. Two failure classes:
//   NO-OP:      two options land in bit-identical outcome metrics (the audit found a literal
//               one: price-war "Match the cut" with a touched dial — 39/39 identical).
//   DOMINANCE:  reported, not gated — one option beating its siblings on EVERY probe metric
//               across most seeds is design-review material, not automatically a bug (some
//               choices are honest tests of judgement with a right answer).
//
//   npx tsx test/choice-ab.ts [seeds] [--assert]     (nightly; --assert gates NO-OPs only)

import { advanceWeek, newGame, resolveChoiceOnState, valuation } from '../src/game/engine'
import { BOTS } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const args = process.argv.slice(2).filter((a) => a !== '--assert')
const ASSERT = process.argv.includes('--assert')
const SEEDS = Number(args[0]) || 8
const WEEKS = 110
const HORIZON = 8
const SECTORS: SectorId[] = ['saas', 'fintech', 'ecommerce']

interface Metrics {
  cash: number
  users: number
  revenue: number
  val: number
  reputation: number
  morale: number
  /** endings are outcomes too: selling at $40M vs countering to $50M must not read as equal */
  over: string
}
const metrics = (s: GameState): Metrics => ({
  cash: Math.round(s.cash),
  users: s.users,
  revenue: Math.round(s.lastRevenue),
  val: valuation(s),
  reputation: s.reputation,
  morale: Math.round(s.employees.reduce((a, e) => a + e.morale, 0)),
  over: s.gameOver ? `${s.gameOver.type}:${s.gameOver.payout ?? 0}` : '',
})
const identical = (a: Metrics, b: Metrics) => JSON.stringify(a) === JSON.stringify(b)

/** advance a branch with the casual bot standing in for the player, choice under test excluded */
function branch(base: GameState, msgId: string, pick: number): Metrics {
  let s = structuredClone(base)
  resolveChoiceOnState(s, msgId, pick)
  for (let w = 0; w < HORIZON && !s.gameOver; w++) {
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
    s.marketingSpend = Math.min(5_000, s.marketingSpend || 5_000)
    if (s.gameOver) break
    s = advanceWeek(s)
  }
  return metrics(s)
}

const noops: string[] = []
const dominance = new Map<string, { wins: number; trials: number }>()
let choicesTested = 0

for (const sector of SECTORS) {
  for (let i = 0; i < SEEDS; i++) {
    const cfg = { mode: 'career', format: 'standard', sector, seed: 1000 + i * 97, engine: 'v2' } as GameConfig
    const bot = BOTS.casual
    let s = newGame('AB', sector, bot.founderKind, { config: cfg })
    const seen = new Set<string>()
    for (let w = 0; w < WEEKS && !s.gameOver; w++) {
      // test each NEW multi-option choice before the bot's turn resolves it
      for (const m of s.inbox) {
        if (m.kind !== 'choice' || m.resolved || !m.choices || m.choices.length < 2) continue
        const kind = m.title.replace(/[0-9$,.]+/g, '#') // one test per choice KIND per run
        if (seen.has(kind)) continue
        seen.add(kind)
        choicesTested++
        const outcomes = m.choices.map((_, idx) => branch(s, m.id, idx))
        for (let a = 0; a < outcomes.length; a++)
          for (let b = a + 1; b < outcomes.length; b++)
            if (identical(outcomes[a], outcomes[b]))
              noops.push(`[${sector} s${cfg.seed} wk${s.week}] "${m.title.slice(0, 48)}" options ${a} and ${b} are bit-identical ${HORIZON} weeks on`)
        // dominance bookkeeping: option 0's val vs the field
        const best = outcomes.reduce((bi, o, idx) => (o.val > outcomes[bi].val ? idx : bi), 0)
        const d = dominance.get(kind) ?? { wins: 0, trials: 0 }
        d.trials++
        if (best === 0) d.wins++
        dominance.set(kind, d)
      }
      bot.play(s)
      if (s.gameOver) break
      s = advanceWeek(s)
    }
  }
}

console.log(`Choice A/B — ${choicesTested} choice-kind instances forked across ${SEEDS} seeds × ${SECTORS.join('/')}\n`)
if (noops.length) {
  console.log(`NO-OP choices (${noops.length}):`)
  for (const n of noops.slice(0, 12)) console.log('  ✗ ' + n)
} else {
  console.log('no bit-identical option pairs — every choice does something ✓')
}
const suspicious = [...dominance.entries()].filter(([, d]) => d.trials >= 6 && (d.wins / d.trials > 0.85 || d.wins / d.trials < 0.15))
if (suspicious.length) {
  console.log('\nDominance watch (option 0 win-rate extreme — design review, not gated):')
  for (const [kind, d] of suspicious) console.log(`  ~ ${kind.slice(0, 56)} — option 0 best in ${d.wins}/${d.trials}`)
}

if (ASSERT) {
  console.log(noops.length === 0 ? '\nCHOICE A/B: PASS' : '\nCHOICE A/B: FAIL — no-op choices exist')
  process.exit(noops.length === 0 ? 0 : 1)
}
