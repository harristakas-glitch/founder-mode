// Arena sealed-bid hiring auction: is there a bid that always wins, or a free hire?
// Run: npx tsx test/arena-auction-probe.ts

import { pickHiringWinner, sharedCandidates, recruiterFee, type HiringBid } from '../src/game/engine'
import type { Candidate } from '../src/game/types'

const bid = (playerId: string, premiumPct: number, reputation = 50, runwayWeeks = 30): HiringBid => ({
  playerId,
  company: playerId,
  premiumPct,
  reputation,
  runwayWeeks,
})

const WEEKS = 200
const pool: Candidate[] = []
for (let w = 1; w <= WEEKS; w++) pool.push(...sharedCandidates(12345, w))

function winRate(a: HiringBid, b: HiringBid, filter?: (c: Candidate) => boolean) {
  let wins = 0
  let n = 0
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i]
    if (filter && !filter(c)) continue
    n++
    if (pickHiringWinner(c, [a, b], 12345, i)?.playerId === a.playerId) wins++
  }
  return { pct: n ? (wins / n) * 100 : 0, n }
}

const show = (label: string, r: { pct: number; n: number }) =>
  console.log(`  ${label.padEnd(58)} ${r.pct.toFixed(1).padStart(5)}%  (n=${r.n})`)

console.log('— Is there a bid that always wins? (A vs B, % of contests A takes) —')
// The score is: premiumPct*moneyWeight + (rep-50)/2 + runwayTerm + rand(-6,6).
// premiumPct is clamped to [0,100] in the store AND in the wire validator.
show('max premium (100, rep 50) vs asking price (0, rep 50)', winRate(bid('a', 100), bid('b', 0)))
show('max premium, awful rep 0, doomed runway 5  vs  0%, rep 100, runway 60', winRate(bid('a', 100, 0, 5), bid('b', 0, 100, 60)))
show('max premium vs max premium (rep 0 vs rep 100)', winRate(bid('a', 100, 0), bid('b', 100, 100)))
show('max premium vs max premium (identical)', winRate(bid('a', 100), bid('b', 100)))
show('  ...restricted to skill>=8 (moneyWeight lowest)', winRate(bid('a', 100, 0, 5), bid('b', 0, 100, 60), (c) => c.skill >= 8))
show('rep 100 + runway 60, no premium  vs  premium 60, rep 50', winRate(bid('a', 0, 100, 60), bid('b', 60, 50)))

console.log('\n— What does the winning bid actually cost? —')
const skills = [2, 5, 8]
for (const sk of skills) {
  const c = pool.find((x) => x.skill === sk)
  if (!c) continue
  const boosted = Math.round((c.salary * 2) / 1000) * 1000
  console.log(
    `  skill ${sk}: asking $${c.salary.toLocaleString()}/yr (fee $${recruiterFee(c).toLocaleString()})` +
      ` → at +100%: $${boosted.toLocaleString()}/yr (fee $${recruiterFee({ ...c, salary: boosted }).toLocaleString()})` +
      `, extra payroll $${Math.round((boosted - c.salary) / 52).toLocaleString()}/wk`,
  )
}

console.log('\n— Does winning the auction get you the hire? —')
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const before = (rep: number, runway: number, _over = 0, climate = 0) =>
  0.72 + rep / 400 - (runway > 0 && runway < 10 ? 0.25 : 0) + (climate < -0.2 ? 0.08 : 0)
const after = (rep: number, runway: number, over = 0, climate = 0) =>
  clamp(0.72 + rep / 400 + clamp(over, -0.2, 1) * 0.18 - (runway < 10 ? 0.25 : 0) + (climate < -0.2 ? 0.08 : 0), 0.05, 0.97)
const cases: [string, number, number, number][] = [
  ['rep 10, healthy runway, offer at asking price', 10, 30, 0],
  ['rep 10, healthy runway, WON AUCTION at +100%', 10, 30, 1],
  ['rep 10, healthy runway, WON AUCTION at +50%', 10, 30, 0.5],
  ['rep 60, healthy runway, asking price', 60, 30, 0],
  ['rep 10, 9 weeks of runway', 10, 9, 0],
  ['rep 10, BANKRUPT next week (runway -3)', 10, -3, 0],
]
for (const [label, rep, runway, over] of cases) {
  console.log(
    `  ${label.padEnd(50)} before ${(before(rep, runway, over) * 100).toFixed(1).padStart(5)}%` +
      `  →  after ${(after(rep, runway, over) * 100).toFixed(1).padStart(5)}%`,
  )
}
