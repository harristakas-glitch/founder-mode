// Lever coverage — a lever no bot pulls is unmeasured by definition.
//
// Two checks: (1) every lever in LEVER_PREDICATES is DECLARED by at least one archetype, so
// the population as a whole measures the whole control surface; (2) every declaration is TRUE —
// the bot, run headlessly, actually leaves the lever's fingerprint on the state. A bot that
// claims a lever it never pulls is lying to the balance apparatus (this is exactly how the
// price-war no-op and the research trap stayed invisible: no runtime proof anyone pulled them).
//
//   npx tsx test/lever-coverage.ts

import { advanceWeek, newGame } from '../src/game/engine'
import { BOTS, LEVER_PREDICATES } from './bots/archetypes'
import type { GameConfig } from '../src/game/modes'
import type { GameState } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

// (1) population covers the surface
const declared = new Set(Object.values(BOTS).flatMap((b) => b.levers))
for (const lever of Object.keys(LEVER_PREDICATES)) {
  if (lever === 'debt') continue // exercised by the invariant fuzzer's random policies, not an archetype (yet)
  ok(declared.has(lever), `lever "${lever}" is played by at least one archetype`)
}

// (2) every declaration is true at runtime — career V2 is the richest surface; the acquisitive
// bot gets quick V1 and a long run because M&A gates (1.5x size, deal-fits-inside-you) take
// time to open, and possibly never do on a given seed — any of three seeds fingerprinting counts.
function fingerprint(botName: string, s: GameState, virgin: GameState): Set<string> {
  const hit = new Set<string>()
  for (const lever of BOTS[botName].levers) {
    const pred = LEVER_PREDICATES[lever]
    if (pred && pred(s, virgin)) hit.add(lever)
  }
  return hit
}

for (const bot of Object.values(BOTS)) {
  const wantQuick = bot.name === 'acquisitive'
  const weeks = wantQuick ? 110 : 50
  const hit = new Set<string>()
  for (const seed of [7, 104, 201]) {
    const cfg = wantQuick
      ? ({ mode: 'quick', format: 'standard', sector: 'saas', seed } as GameConfig)
      : ({ mode: 'career', format: 'standard', sector: 'saas', seed, engine: 'v2' } as GameConfig)
    const virgin = newGame('V', cfg.sector, bot.founderKind, { config: cfg })
    let s = newGame(`${bot.name}C`, cfg.sector, bot.founderKind, { config: cfg })
    for (let w = 0; w < weeks && !s.gameOver; w++) {
      bot.play(s)
      if (s.gameOver) break
      s = advanceWeek(s)
    }
    for (const l of fingerprint(bot.name, s, virgin)) hit.add(l)
  }
  const missing = bot.levers.filter((l) => !hit.has(l))
  ok(missing.length === 0, `${bot.name}: every declared lever fingerprints at runtime${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
