// Daily Challenge ladder — is today's shared seed a contest of skill or a dice roll?
//
// Daily is Quick Play on a fixed seed with a capped run: every player gets the same world, so
// its balance question is SKILL SEPARATION, not difficulty. The bot ladder plays the same seed;
// if casual and expert scores land within noise the day rewards nothing but variance.
//
//   npx tsx test/daily-ladder.ts [dayCount] [--assert]
//
// Measures the last N daily seeds (deterministic derivation, same as the game's dailyInfo).
// --assert gates the AGGREGATE across days: expert must beat casual on median score in at
// least 60% of days measured — single weird days are allowed, a flat format is not.

import { advanceWeek, newGame, valuation } from '../src/game/engine'
import { BOTS } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { SectorId } from '../src/game/types'

const args = process.argv.slice(2).filter((a) => a !== '--assert')
const ASSERT = process.argv.includes('--assert')
const DAYS = Number(args[0]) || 6
const CAP = 104 // MATCH_CAP — capped-run length for daily
const TIERS = ['casual', 'active', 'expert'] as const

// deterministic stand-in for dailyInfo(): day index -> seed + sector, stable across runs
const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce', 'aiml']
const daySeed = (day: number) => 700_001 + day * 86_017
const daySector = (day: number) => SECTORS[day % SECTORS.length]

const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)

let expertWins = 0
console.log(`Daily ladder — ${DAYS} synthetic days × ${TIERS.join(' / ')} (capped ${CAP}wk quick)\n`)
console.log('day  sector    |  casual      active      expert     | separation')
for (let day = 0; day < DAYS; day++) {
  const sector = daySector(day)
  const scores: number[] = []
  for (const tier of TIERS) {
    const bot = BOTS[tier]
    const cfg = { mode: 'quick', format: 'daily_challenge', sector, seed: daySeed(day), engine: 'v2' } as GameConfig
    let s = newGame(`${tier}D`, sector, bot.founderKind, { config: cfg })
    s.challenge = { label: `Daily #${day}`, cap: CAP }
    for (let w = 0; w < CAP && !s.gameOver; w++) {
      bot.play(s)
      if (s.gameOver) break
      s = advanceWeek(s)
    }
    scores.push(s.gameOver ? (s.gameOver.payout ?? 0) : Math.round(s.founderEquity * valuation(s)))
  }
  const separated = scores[2] > scores[0]
  if (separated) expertWins++
  console.log(
    `#${String(day).padEnd(3)} ${sector.padEnd(9)} | ${scores.map((x) => money(x).padEnd(11)).join(' ')}| ${separated ? 'expert > casual ✓' : 'flat/inverted'}`,
  )
}

const rate = expertWins / DAYS
console.log(`\nexpert beat casual on ${expertWins}/${DAYS} days (${Math.round(rate * 100)}%)`)
if (ASSERT) {
  const pass = rate >= 0.6
  console.log(pass ? 'DAILY LADDER: PASS' : 'DAILY LADDER: FAIL — the daily format does not separate skill')
  process.exit(pass ? 0 : 1)
}
