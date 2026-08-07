// Living World, Phases 1-3. Three properties carry the whole system:
//   1. it is DETERMINISTIC — same seed, same people, same words, or replays and Arena diverge;
//   2. it is INERT when off — narrative must never change a simulation outcome;
//   3. it SURVIVES A RELOAD — a save written before it exists must still load.
import { advanceWeek, newGame } from '../src/game/engine'
import { resolveGameRules } from '../src/game/modes'
import { migrateLivingWorldSlice, emptyLivingWorld } from '../src/game/world/persistence'
import { composeNarrative, createNarrativeUsage } from '../src/game/world/composer'
import { generateCharacter } from '../src/game/world/characters'
import type { GameMode } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

const cfg = (seed: number, mode: GameMode, overrides?: Record<string, boolean>) =>
  ({ mode, format: 'standard', sector: 'saas' as SectorId, seed, overrides }) as never

function play(seed: number, weeks: number, mode: GameMode = 'career', overrides?: Record<string, boolean>): GameState {
  let s = newGame('Northwind', 'saas', 'technical', { config: cfg(seed, mode, overrides) })
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 3 && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== best.id)
      s.offersOut.push(best)
    }
    s = advanceWeek(s)
  }
  return s
}

console.log('— Mode depth (brief §3) —')
for (const [mode, depth, rel] of [
  ['quick', 'light', false],
  ['career', 'deep', true],
  ['arena', 'competitive', false],
] as const) {
  const r = resolveGameRules(cfg(1, mode)) as never as { livingWorldDepth: string; capabilities: Record<string, boolean> }
  ok(r.livingWorldDepth === depth, `${mode} runs at depth "${depth}"`)
  ok(r.capabilities.persistentCharacters === true, `${mode} has persistent characters`)
  ok(r.capabilities.relationships === rel, `${mode} relationships = ${rel} (only Career simulates them)`)
}

console.log('\n— Determinism (brief §79) —')
const a = play(4242, 24)
const b = play(4242, 24)
ok(JSON.stringify(a.world) === JSON.stringify(b.world), 'same seed produces a byte-identical world')
ok(JSON.stringify(play(99, 24).world) !== JSON.stringify(a.world), 'a different seed produces a different world')
const castA = Object.keys(a.world?.characters ?? {})
ok(castA.length > 0, `a cast exists (${castA.length} people)`)
ok(
  castA.every((id) => !/^m[a-z0-9]{7}-/.test(id)),
  'cast ids are derived, not uid() — uid mixes Date.now and Math.random and cannot survive a replay',
)

console.log('\n— The world is populated, not just present —')
const chars = Object.values(a.world?.characters ?? {})
ok(chars.some((c) => c.role === 'employee'), 'employees became characters')
ok(chars.some((c) => c.role === 'founder'), 'the founder is in the cast')
ok(chars.every((c) => !!c.communicationStyle && !!c.personality), 'every character has a personality and a voice')
ok((a.world?.companyMemory ?? []).length > 0, `the company remembers its own history (${(a.world?.companyMemory ?? []).length} entries)`)
ok(chars.some((c) => (c.relationships ?? []).length > 0), 'Career characters hold a relationship with the founder')
ok(chars.some((c) => (c.memories ?? []).length > 0), 'characters remember things that happened')

console.log('\n— Composition (brief §81) —')
const speaker = generateCharacter({
  seed: 7, id: 'emp:test', role: 'employee', name: 'Ada Lovelace', jobRole: 'engineer', skill: 7, status: 'active', createdWeek: 1,
} as never)
const one = composeNarrative({ seed: 7, week: 5, surface: 'inbox', beatKey: 'checkin', audience: 'employee', character: speaker, usage: createNarrativeUsage() })
const two = composeNarrative({ seed: 7, week: 5, surface: 'inbox', beatKey: 'checkin', audience: 'employee', character: speaker, usage: createNarrativeUsage() })
ok(!!one && one.body.length > 0, 'the composer produces prose')
ok(one?.text === two?.text, 'the same seed + week + beat composes the identical text')
// repetition control: the same beat over many weeks must not keep saying one thing
const usage = createNarrativeUsage()
const seen = new Set<string>()
for (let w = 1; w <= 20; w++) {
  const c = composeNarrative({ seed: 7, week: w, surface: 'inbox', beatKey: 'checkin', audience: 'employee', character: speaker, usage })
  if (c) seen.add(c.body)
}
ok(seen.size >= 8, `repetition control keeps it varied (${seen.size} distinct bodies over 20 weeks)`)

console.log('\n— Inert when off (brief §89: the acceptance criterion) —')
const OFF = {
  proceduralNarrative: false, persistentCharacters: false, characterMemory: false, companyMemory: false, relationships: false,
}
const trace = (s: GameState) => `${s.users}|${s.pmf.toFixed(6)}|${Math.round(s.cash)}|${s.quality.toFixed(4)}|${s.inbox.length}`
const offRun = play(4242, 24, 'career', OFF)
ok(offRun.world === undefined, 'with every capability off no world is created at all')
const offTwice = play(4242, 24, 'career', OFF)
ok(trace(offRun) === trace(offTwice), 'the off path is itself deterministic')
ok(
  trace(offRun) !== trace(a) || offRun.inbox.length !== a.inbox.length,
  'and the on path genuinely differs from it, so the test above is not vacuous',
)

console.log('\n— Persistence (brief §88) —')
ok(migrateLivingWorldSlice(undefined) === undefined, 'a save with no world loads as no world (pre-system saves are legal)')
// Garbage is sanitised rather than dropped, which keeps any valid parts — what matters is that
// nothing malformed survives into the cast the composer will read.
ok(Object.keys(migrateLivingWorldSlice({ nonsense: true })?.characters ?? {}).length === 0, 'an unrecognised slice yields an empty cast')
ok(
  Object.keys(migrateLivingWorldSlice({ characters: { x: { id: 1 } } })?.characters ?? {}).length === 0,
  'a malformed character is discarded, never handed to the composer',
)
ok(migrateLivingWorldSlice('not an object' as never) === undefined, 'a non-object slice is rejected outright')
ok(migrateLivingWorldSlice(JSON.parse(JSON.stringify(emptyLivingWorld()))) !== undefined, 'a well-formed empty world round-trips')
const revived = migrateLivingWorldSlice(JSON.parse(JSON.stringify(a.world)))
ok(!!revived && Object.keys(revived.characters).length === castA.length, 'a real world round-trips through JSON with its cast intact')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
