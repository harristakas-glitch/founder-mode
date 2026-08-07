// Architecture tests for the three-mode model. Run: npx tsx test/modes.test.ts
import {
  ALL_CAPABILITY_KEYS,
  MODE_META,
  defaultCapabilities,
  hasCapability,
  resolveGameRules,
  sanitizeCapabilities,
  type GameConfig,
  type GameMode,
} from '../src/game/modes'
import { advanceWeek, capabilitiesFromLegacyRules, migrateLegacySave, newGame, pitchInvestors, pivot } from '../src/game/engine'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}
const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ mode: 'quick', format: 'standard', sector: 'saas', seed: 42, ...over })

console.log('— Modes —')
const MODES: GameMode[] = ['quick', 'career', 'arena']
ok(MODES.every((m) => !!MODE_META[m]), 'quick, career and arena all exist with presentation metadata')
ok(!(MODE_META as Record<string, unknown>).daily, 'there is no top-level "daily" mode')
for (const m of MODES) ok(resolveGameRules(cfg({ mode: m })).mode === m, `${m} resolves to its own rules`)

console.log('— Formats —')
ok(resolveGameRules(cfg()).format === 'standard', 'quick + standard')
ok(resolveGameRules(cfg({ format: 'daily_challenge' })).format === 'daily_challenge', 'quick + daily_challenge')
ok(resolveGameRules(cfg({ format: 'scenario', scenario: 'winter' })).format === 'scenario', 'quick + scenario')
ok(resolveGameRules(cfg({ mode: 'career' })).format === 'standard', 'career + standard')
ok(resolveGameRules(cfg({ mode: 'arena' })).format === 'standard', 'arena + standard')

console.log('— Capability resolution —')
const quick = resolveGameRules(cfg()).capabilities
const dailyCaps = resolveGameRules(cfg({ format: 'daily_challenge' })).capabilities
const career = resolveGameRules(cfg({ mode: 'career' })).capabilities
const arena = resolveGameRules(cfg({ mode: 'arena' })).capabilities

ok(quick.aiRivals && quick.storyArcs && quick.boardReviews && quick.ipoEndgame, 'Quick Play keeps every shipped single-player system')
ok(!quick.leaderboard && !quick.seededWorld && !quick.singleAttempt, 'a standard Quick run is not a scored challenge')
ok(dailyCaps.leaderboard && dailyCaps.seededWorld && dailyCaps.singleAttempt, 'Daily adds leaderboard + seeded world + one attempt')
ok(dailyCaps.storyArcs === quick.storyArcs && dailyCaps.aiRivals === quick.aiRivals, 'Daily INHERITS Quick mechanics rather than redefining them')
ok(resolveGameRules(cfg({ format: 'daily_challenge' })).maxTurns === 104, 'Daily is capped at 104 turns')
ok(resolveGameRules(cfg()).maxTurns === undefined, 'a standard Quick run is open-ended')
ok(arena.humanRivals && arena.pvpActions && !arena.aiRivals, 'Arena is human rivals with PvP, no AI competitors')
ok(!arena.storyArcs && !arena.founderEnergy && !arena.boardReviews, 'Arena drops the slow narrative systems')
ok(career.storyArcs, 'Career currently runs the Quick simulation')

console.log('— Unimplemented capabilities must stay off —')
const PLANNED = ['detailedPMF', 'customerSegments', 'hypothesisBoard', 'founderAttention', 'executives', 'boardPolitics', 'sharedTalentMarket', 'negotiations'] as const
ok(
  PLANNED.every((k) => !career[k] && !quick[k] && !arena[k]),
  'no mode claims a Career/Arena system that does not exist yet',
)

console.log('— Override layering —')
const forced = resolveGameRules(cfg({ mode: 'arena', overrides: { storyArcs: true, pvpActions: false } })).capabilities
ok(forced.storyArcs && !forced.pvpActions, 'explicit overrides win over mode + format')
ok(Object.keys(sanitizeCapabilities({ storyArcs: true, nonsense: 1, pvpActions: 'yes' })).length === 1, 'sanitize keeps only known boolean keys')
ok(ALL_CAPABILITY_KEYS.length > 20, `capability surface is enumerable (${ALL_CAPABILITY_KEYS.length} keys)`)

console.log('— Games build from config —')
for (const m of MODES) {
  const g = newGame('T', 'saas', 'technical', { config: cfg({ mode: m, seed: 7 }) })
  ok(g.config.mode === m, `${m} game carries its config`)
  ok(hasCapability(g, m === 'arena' ? 'pvpActions' : 'storyArcs'), `${m} game resolved its capabilities`)
}
const careerGame = newGame('C', 'saas', 'technical', { config: cfg({ mode: 'career' }) })
ok(careerGame.config.mode === 'career' && !!advanceWeek(careerGame), 'a Career run advances a week like any other')

console.log('— Determinism: config decides the world —')
const a1 = newGame('A', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
const a2 = newGame('B', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
ok(
  JSON.stringify(a1.rivals.map((r) => [r.name, r.stage, r.users])) === JSON.stringify(a2.rivals.map((r) => [r.name, r.stage, r.users])),
  'same seed + config deals the identical world',
)
const a3 = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9999 }) })
ok(JSON.stringify(a1.rivals.map((r) => r.name)) !== JSON.stringify(a3.rivals.map((r) => r.name)), 'a different seed deals a different world')

console.log('— Legacy save migration —')
const legacy = capabilitiesFromLegacyRules({
  arcs: true, oneOnOnes: false, catastrophes: true, energy: false, board: true,
  debt: true, ventures: false, ipo: true, macroShocks: true, pvp: true,
})
ok(legacy.storyArcs === true && legacy.oneOnOnes === false, 'legacy arcs/oneOnOnes map across')
ok(legacy.founderEnergy === false && legacy.boardReviews === true, 'legacy energy/board map across')
ok(legacy.multipleVerticals === false && legacy.pvpActions === true, 'legacy ventures/pvp map across')
ok(Object.keys(capabilitiesFromLegacyRules(undefined)).length === 0, 'a save with no rules migrates to nothing forced')

console.log('— defaultCapabilities helper —')
ok(defaultCapabilities('quick').aiRivals && !defaultCapabilities('arena').aiRivals, 'defaults differ per mode')


console.log('— Persistence: legacy saves migrate (brief §31/§41) —')
const legacySave = (over: Record<string, unknown>) =>
  migrateLegacySave({
    ...newGame('Legacy', 'saas', 'technical', { config: cfg() }),
    config: undefined as never,
    capabilities: undefined as never,
    ...over,
  } as never)

const solo = legacySave({ challenge: null, scenario: null })
ok(solo.config.mode === 'quick' && solo.config.format === 'standard', 'legacy solo -> quick / standard')
const legacyDaily = legacySave({ challenge: { label: 'Daily #12', cap: 104 }, scenario: null })
ok(legacyDaily.config.mode === 'quick' && legacyDaily.config.format === 'daily_challenge', 'legacy Daily -> quick / daily_challenge')
ok(legacyDaily.capabilities.leaderboard && legacyDaily.capabilities.singleAttempt, 'migrated Daily regains its challenge capabilities')
const legacyMp = legacySave({ challenge: { label: 'Online match', cap: 52 }, scenario: null })
ok(legacyMp.config.mode === 'arena' && legacyMp.config.format === 'standard', 'legacy multiplayer -> arena / standard')
const legacyScenario = legacySave({ challenge: null, scenario: 'winter' })
ok(legacyScenario.config.format === 'scenario' && legacyScenario.config.scenario === 'winter', 'scenario saves keep their scenario')
ok([solo, legacyDaily, legacyMp, legacyScenario].every((g) => g.config.mode !== 'career'), 'no legacy save is ever silently turned into Career')
const careerSave = newGame('C', 'saas', 'technical', { config: cfg({ mode: 'career' }) })
ok(migrateLegacySave(structuredClone(careerSave)).config.mode === 'career', 'a Career save restores as Career')
const legacyRules = legacySave({ challenge: { label: 'Online match', cap: 52 }, scenario: null, rules: { arcs: false, oneOnOnes: false, catastrophes: false, energy: false, board: false, debt: true, ventures: true, ipo: true, macroShocks: true, pvp: true } })
ok(!legacyRules.capabilities.storyArcs && legacyRules.capabilities.pvpActions, 'old Ruleset toggles survive the migration')

console.log('— Determinism with decisions (brief §39/§41) —')
function play(seed: number, mode: 'quick' | 'career' = 'quick', format: 'standard' | 'daily_challenge' = 'standard') {
  let s = newGame('D', 'saas', 'technical', { config: cfg({ mode, format, seed }) })
  for (let w = 0; w < 25 && !s.gameOver; w++) {
    // a fixed decision script: same actions every replay
    if (w === 3) pivot(s)
    if (w === 6) pitchInvestors(s)
    if (w === 9 && s.candidates[0]) {
      const c = s.candidates[0]
      s.candidates = s.candidates.filter((x) => x.id !== c.id)
      s.offersOut.push(c)
    }
    s = advanceWeek(s)
  }
  return [s.week, Math.round(s.cash), Math.round(s.users), Math.round(s.pmf * 100), Math.round(s.hype * 100), s.employees.length].join('|')
}
const runA = play(31337)
const runB = play(31337)
ok(runA === runB, `same seed + same decisions reproduce exactly (${runA})`)
ok(play(31337) !== play(4242), 'a different seed produces a different run')
const dailyA = play(20260807, 'quick', 'daily_challenge')
const dailyB = play(20260807, 'quick', 'daily_challenge')
ok(dailyA === dailyB, 'Daily Challenge is reproducible for the same seed and decisions')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
