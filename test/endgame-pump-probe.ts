// The endgame marketing pump — the marginal return on a dollar of ad spend at the end of a run.
// Not part of `npm test`. Run: npx tsx test/endgame-pump-probe.ts [sector...]
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS MEASURES, AND WHY THE OBVIOUS VERSION OF IT IS WRONG
//
// A Founder Mode run ends on a fixed week and the score is a SNAPSHOT: `gameOver.payout ??
// founderStanding(s)`, and `founderStanding` is `valuation(s) × founderEquity + tokens + banked`.
// So the only question a player faces in the last few weeks is "what does a dollar do to
// `valuation()` right now", and the answer had better not be "far more than the dollar bought".
//
// The first version of this measurement compared *spend to the cap* against *spend nothing* over
// the closing weeks. That number is 28-36x and it is not the exploit: a company that switches its
// marketing off loses users to churn and its growth rate goes negative, so most of the gap is a
// collapse being avoided, not a premium being bought. The honest counterfactual is the policy the
// player was ALREADY running — `cash × 2%`, the calibrated Quick Play budget from
// test/deep-balance-probe.ts. This file deviates from that policy for the last K weeks and prices
// the deviation:
//
//     marginal return = Δ founder standing / Δ marketing dollars
//
// A number near 1x means the endgame is priced like the rest of the game. A large number means the
// closing weeks are worth more than the eighty before them, and the correct play is to hoard cash
// and dump it at the horizon — which is not a strategy, it is a clock exploit.
//
// Harness rules, as everywhere else in this repo: budgets clamp to `marketingMax` so this is a game
// a player could actually play, `gameOver` is not failure, and the score comes off
// `gameOver.payout ?? founderStanding(s)` rather than a re-derived valuation × equity.

import { advanceWeek, marketingMax, newGame, resolveChoiceOnState, growthRate } from '../src/game/engine'
import { founderStanding } from '../src/game/token/scoring'
import type { Allocation, GameState, SectorId } from '../src/game/types'

/** The calibrated Quick Play split — see the `alloc` section of test/deep-balance-probe.ts. */
const CALIBRATED: Allocation = { features: 36, quality: 27, bugs: 17, research: 20, bet: 0 }
const SEEDS = Array.from({ length: 24 }, (_, i) => 11 * (i + 1))
const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml']
const WEEKS = 90
/** How many weeks the deviation covers. */
const TAILS = [1, 2, 4, 8]
/**
 * WHEN the deviation happens, as weeks before the end. `0` is the buzzer. The others are the
 * control: the SAME deviation, made earlier, with the rest of the run still to play out.
 *
 * This is the property that decides whether the endgame is exploitable. Marketing is Quick Play's
 * main growth lever and it is allowed to be a good investment — what must not be true is that the
 * same dollar is worth more the later it is spent, because that turns "hold cash, dump at the
 * horizon" into the correct line for anyone who can read a week counter.
 */
const OFFSETS = [0, 25, 50]

const q = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const M = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}k`)
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const score = (s: GameState) => s.gameOver?.payout ?? founderStanding(s)

function step(s: GameState, budget: 'pct2' | 'cap'): { next: GameState; spent: number } {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
  s.allocation = CALIBRATED
  const want = budget === 'cap' ? Infinity : s.cash * 0.02
  s.marketingSpend = Math.max(0, Math.min(want, marketingMax(s), s.cash))
  const spent = s.marketingSpend
  return { next: advanceWeek(s), spent }
}

function run(seed: number, sector: SectorId, tail: number, offset: number) {
  let s = newGame('Pump', sector, 'technical', {
    config: { mode: 'quick', format: 'standard', sector, seed },
    aiRivals: true,
  })
  const start = WEEKS - offset - tail
  for (let w = 0; w < start && !s.gameOver; w++) s = step(s, 'pct2').next
  if (s.gameOver) return null // the run was already decided; there is nothing left to price
  let a = structuredClone(s)
  let b = structuredClone(s)
  let sa = 0
  let sb = 0
  for (let w = 0; w < tail && !a.gameOver; w++) { const r = step(a, 'pct2'); a = r.next; sa += r.spent }
  for (let w = 0; w < tail && !b.gameOver; w++) { const r = step(b, 'cap'); b = r.next; sb += r.spent }
  // …and then both arms play the reference policy out to the horizon on the same rules.
  for (let w = 0; w < offset && !a.gameOver; w++) { const r = step(a, 'pct2'); a = r.next; sa += r.spent }
  for (let w = 0; w < offset && !b.gameOver; w++) { const r = step(b, 'pct2'); b = r.next; sb += r.spent }
  return { held: score(a), pumped: score(b), spentHeld: sa, spentPumped: sb, gHeld: growthRate(a), gPumped: growthRate(b) }
}

const args = process.argv.slice(2)
const sectors = ALL.filter((x) => args.includes(x))
console.log(`Endgame pump · ${SEEDS.length} seeds × ${WEEKS} weeks · K weeks at marketingMax, ending "at" weeks before the horizon`)
console.log(`  ${pad('sector', 11)}${padL('K', 3)}${padL('at', 4)}${padL('n', 4)}${padL('held', 10)}${padL('pumped', 10)}${padL('extra $', 9)}${padL('median x', 10)}${padL('p90 x', 8)}  growth held→pumped`)
for (const sector of sectors.length ? sectors : ALL) {
  for (const tail of TAILS) {
   for (const offset of OFFSETS) {
    const rows = SEEDS.map((seed) => run(seed, sector, tail, offset)).filter((x): x is NonNullable<ReturnType<typeof run>> => !!x)
    const extra = rows.map((r) => r.spentPumped - r.spentHeld)
    const gain = rows.map((r) => r.pumped - r.held)
    const ratios = rows.map((_, i) => (extra[i] > 0 ? gain[i] / extra[i] : 0)).filter((x) => x !== 0)
    console.log(
      `  ${pad(sector, 11)}${padL(String(tail), 3)}${padL(String(offset), 4)}${padL(String(rows.length), 4)}` +
        `${padL(M(q(rows.map((x) => x.held), 0.5)), 10)}${padL(M(q(rows.map((x) => x.pumped), 0.5)), 10)}` +
        `${padL(M(q(extra, 0.5)), 9)}${padL(`${q(ratios, 0.5).toFixed(1)}x`, 10)}${padL(`${q(ratios, 0.9).toFixed(1)}x`, 8)}` +
        `  ${q(rows.map((x) => x.gHeld), 0.5).toFixed(4)} → ${q(rows.map((x) => x.gPumped), 0.5).toFixed(4)}`,
    )
   }
  }
}
