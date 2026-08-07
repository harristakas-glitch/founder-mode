// Arena's shared hiring market. The whole feature rests on two guarantees:
//   1. every client renders the IDENTICAL five candidates, or there is nothing to contest;
//   2. every client resolves a contested hire to the SAME winner, with no server refereeing it.
// Both are pure functions of (seed, week), so they are testable without a socket.
import { pickHiringWinner, sharedCandidates, type HiringBid } from '../src/game/engine'
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

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
