// Arena proxy tournament — strategy diversity on the Arena ruleset, measured headless.
//
// True Arena is a live lobby: sealed-bid hiring, PvP attacks, shared candidate market. Those
// cross-player systems need a server and are NOT measured here (recorded limitation — a real
// lobby harness is the instrument gap). What IS measurable headless is the part every Arena
// player experiences alone: the lean-format economy under MATCH_CAP time pressure. This proxy
// runs each archetype on identical seeds under Arena rules ("time-trial" Arena) and asks the
// PvP balance question in its weakest useful form: does any one strategy's score run away?
//
//   npx tsx test/arena-proxy.ts [seeds] [--assert]
//
// --assert gates on spread: the best archetype's median score must stay under 3x the second
// best (a runaway dominant strategy would be the Arena meta by week one).

import { advanceWeek, newGame, valuation } from '../src/game/engine'
import { BOTS } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { SectorId } from '../src/game/types'

const args = process.argv.slice(2).filter((a) => a !== '--assert')
const ASSERT = process.argv.includes('--assert')
const SEEDS = Number(args[0]) || 8
const CAP = 104
const SECTORS: SectorId[] = ['saas', 'social']
const FIELD = ['casual', 'active', 'expert', 'acquisitive'] as const

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)

let failures = 0
console.log(`Arena proxy — ${FIELD.join('/')} on identical seeds, Arena rules, ${CAP}wk cap\n`)
for (const sector of SECTORS) {
  const meds: { name: string; m: number }[] = []
  for (const name of FIELD) {
    const bot = BOTS[name]
    const scores: number[] = []
    for (let i = 0; i < SEEDS; i++) {
      const cfg = { mode: 'arena', format: 'standard', sector, seed: 4000 + i * 113 } as GameConfig
      let s = newGame(`${name}A`, sector, bot.founderKind, { config: cfg })
      s.challenge = { label: 'Arena proxy', cap: CAP }
      for (let w = 0; w < CAP && !s.gameOver; w++) {
        bot.play(s)
        if (s.gameOver) break
        s = advanceWeek(s)
      }
      scores.push(s.gameOver ? (s.gameOver.payout ?? 0) : Math.round(s.founderEquity * valuation(s)))
    }
    meds.push({ name, m: med(scores) })
  }
  const sorted = [...meds].sort((a, b) => b.m - a.m)
  const runaway = sorted[1].m > 0 && sorted[0].m / sorted[1].m > 3
  if (runaway) failures++
  console.log(
    `${sector.padEnd(7)} | ${meds.map((x) => `${x.name} ${money(x.m)}`.padEnd(20)).join(' ')} | ${runaway ? `RUNAWAY: ${sorted[0].name} ✗` : 'contested ✓'}`,
  )
}

if (ASSERT) {
  console.log(failures === 0 ? '\nARENA PROXY: PASS' : '\nARENA PROXY: FAIL — a strategy runs away with the format')
  process.exit(failures === 0 ? 0 : 1)
}
