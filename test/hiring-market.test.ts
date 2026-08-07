// Arena's shared hiring market. The whole feature rests on two guarantees:
//   1. every client renders the IDENTICAL five candidates, or there is nothing to contest;
//   2. every client resolves a contested hire to the SAME winner, with no server refereeing it.
// Both are pure functions of (seed, week), so they are testable without a socket.
import { pickHiringWinner, recruiterFee, sharedCandidates, type HiringBid } from '../src/game/engine'
import type { Candidate } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

console.log('— Shared candidate pool —')
const a = sharedCandidates(12345, 7)
const b = sharedCandidates(12345, 7)
ok(a.length === 5, 'the market is five people')
ok(JSON.stringify(a) === JSON.stringify(b), 'same seed + same week ⇒ byte-identical pool on every client')
ok(
  a.every((c) => c.id === `mk-7-${a.indexOf(c)}`),
  'ids are derived, not uid() — the id is the thing being contested',
)
ok(JSON.stringify(sharedCandidates(12345, 8)) !== JSON.stringify(a), 'the pool turns over week to week')
ok(JSON.stringify(sharedCandidates(999, 7)) !== JSON.stringify(a), 'a different match gets a different market')

console.log('\n— Contested hire: the candidate chooses —')
const cand: Candidate = a[0]
const bid = (playerId: string, premiumPct: number, reputation = 50, runwayWeeks = 30): HiringBid => ({
  playerId,
  company: playerId,
  premiumPct,
  reputation,
  runwayWeeks,
})

const solo = pickHiringWinner(cand, [bid('alice', 0)], 1, 3)
ok(solo?.playerId === 'alice', 'an uncontested bid is simply accepted')
ok(pickHiringWinner(cand, [], 1, 3) === null, 'nobody bidding ⇒ nobody hired')

// determinism is the whole ballgame: two clients must not disagree about who got the hire
const bids = [bid('alice', 10), bid('bob', 25), bid('carol', 0, 80)]
const first = pickHiringWinner(cand, bids, 42, 9)
ok(
  [...Array(20)].every(() => pickHiringWinner(cand, bids, 42, 9)?.playerId === first?.playerId),
  `repeated resolution is stable (${first?.playerId})`,
)
ok(
  pickHiringWinner(cand, [...bids].reverse(), 42, 9)?.playerId === first?.playerId,
  'message ARRIVAL ORDER cannot change the winner — clients receive bids in different orders',
)

// money matters...
let moneyWins = 0
for (let w = 0; w < 40; w++) if (pickHiringWinner(cand, [bid('rich', 50), bid('poor', 0)], 7, w)?.playerId === 'rich') moneyWins++
ok(moneyWins >= 36, `a big premium usually beats asking price (${moneyWins}/40)`)

// ...but it is not the only thing
let repWins = 0
for (let w = 0; w < 40; w++)
  if (pickHiringWinner(cand, [bid('flashy', 10, 20), bid('beloved', 0, 95)], 7, w)?.playerId === 'beloved') repWins++
ok(repWins >= 30, `a strong reputation outweighs a small premium (${repWins}/40)`)

let doomedWins = 0
for (let w = 0; w < 40; w++)
  if (pickHiringWinner(cand, [bid('doomed', 25, 50, 4), bid('safe', 0, 50, 60)], 7, w)?.playerId === 'doomed') doomedWins++
ok(doomedWins <= 12, `nobody joins a company with four weeks of runway unless paid a lot (${doomedWins}/40)`)

console.log('\n— Sealed bids: the commitment binds —')
const { hiringCommitment, makeNonce } = await import('../src/net/online')

const nonce = makeNonce()
const c1 = await hiringCommitment('mk-3-0', 25, nonce, 'alice')
ok(nonce.length === 32, 'nonce is 128 bits of randomness, not brute-forceable from the hash')
ok(c1.length === 64 && /^[0-9a-f]+$/.test(c1), 'commitment is a sha-256 hex digest')
ok((await hiringCommitment('mk-3-0', 25, nonce, 'alice')) === c1, 'the same sealed bid always hashes the same — a valid reveal verifies')
ok((await hiringCommitment('mk-3-0', 26, nonce, 'alice')) !== c1, 'changing the PREMIUM after seeing a rival breaks the commitment')
ok((await hiringCommitment('mk-3-1', 25, nonce, 'alice')) !== c1, 'a commitment cannot be moved to a different candidate')
ok((await hiringCommitment('mk-3-0', 25, nonce, 'bob')) !== c1, 'a commitment cannot be replayed by another founder')
ok((await hiringCommitment('mk-3-0', 25, makeNonce(), 'alice')) !== c1, 'a fresh nonce gives a fresh commitment')
// the whole point: the amount is not recoverable from what goes over the wire
const guesses = await Promise.all([0, 10, 25, 50].map((p) => hiringCommitment('mk-3-0', p, 'guessed-nonce', 'alice')))
ok(!guesses.includes(c1), 'enumerating every possible premium does not reveal the bid without the nonce')

console.log('\n— No bid always wins, and no bid is free —')
// The premium is clamped to [0,100] in the store and again on the wire, so the money term tops out
// at 59–100 score points while reputation + runway + jitter top out at 39. A max bid therefore
// beats an indifferent rival every time, but reputation still beats money when money is equal.
const pool200: Candidate[] = []
for (let w = 1; w <= 200; w++) pool200.push(...sharedCandidates(12345, w))
const rate = (x: HiringBid, y: HiringBid, filter?: (c: Candidate) => boolean) => {
  let wins = 0
  let n = 0
  pool200.forEach((c, i) => {
    if (filter && !filter(c)) return
    n++
    if (pickHiringWinner(c, [x, y], 12345, i)?.playerId === x.playerId) wins++
  })
  return n ? wins / n : 0
}
ok(rate(bid('rich', 100), bid('cheap', 0)) === 1, 'a maxed bid beats an asking-price bid at equal reputation — money does talk')
ok(
  rate(bid('rich', 100, 0, 5), bid('beloved', 0, 100, 60)) < 0.5,
  'but a maxed bid from a disreputable, doomed company LOSES to a great company at asking price',
)
ok(
  rate(bid('poor-name', 100, 0), bid('good-name', 100, 100)) === 0,
  'with money equal, reputation decides — there is no bid that always wins',
)
// and the premium binds: settleHiring pushes the boosted salary, so the recruiter fee scales too
const skilled = pool200.find((c) => c.skill >= 8)!
const boosted = Math.round((skilled.salary * 2) / 1000) * 1000
ok(boosted > skilled.salary, 'winning at +100% doubles the salary that lands in offersOut')
ok(
  recruiterFee({ ...skilled, salary: boosted }) > recruiterFee(skilled),
  'and the recruiter fee scales with it — a contested hire is never free',
)

console.log('\n— Winning the auction has to move the candidate —')
// Regression: acceptChance ignored the premium entirely, so a founder could commit +100% to win a
// sealed bid and still be declined a quarter of the time for reasons unrelated to the bid.
const accept = (rep: number, runway: number, salary: number, c: Candidate, climate = 0) => {
  const marketRate = ROLE_BASE_TEST[c.role] + c.skill * 13_000
  const overPay = Math.min(1, Math.max(-0.2, (salary - marketRate) / Math.max(1, marketRate)))
  return Math.min(0.97, Math.max(0.05, 0.72 + rep / 400 + overPay * 0.18 - (runway < 10 ? 0.25 : 0) + (climate < -0.2 ? 0.08 : 0)))
}
const ROLE_BASE_TEST: Record<string, number> = { engineer: 62_000, designer: 55_000, marketer: 50_000, sales: 52_000 }
const atAsking = accept(10, 30, skilled.salary, skilled)
const atMax = accept(10, 30, boosted, skilled)
ok(atMax > atAsking + 0.1, `paying over the odds materially improves acceptance (${(atAsking * 100).toFixed(0)}% → ${(atMax * 100).toFixed(0)}%)`)
ok(
  Math.abs(accept(10, 30, ROLE_BASE_TEST[skilled.role] + skilled.skill * 13_000, skilled) - 0.745) < 0.01,
  'an offer at the market rate is unchanged from before the fix — Quick Play balance is untouched',
)
ok(
  accept(10, -3, skilled.salary, skilled) < accept(10, 30, skilled.salary, skilled),
  'a company already out of cash scares candidates off — negative runway is the worst case, not an exempt one',
)

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
