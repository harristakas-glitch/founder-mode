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
ok(career.storyArcs, 'Career keeps the shared narrative systems')
ok(career.detailedPMF && career.customerSegments && career.hypothesisBoard, 'Career enables PMF Discovery 2.0')
ok(!quick.detailedPMF && !arena.detailedPMF && !dailyCaps.detailedPMF, 'Quick Play, Daily and Arena keep the simple PMF model')

console.log('— Unimplemented capabilities must stay off —')
// Still unbuilt. detailedPMF/customerSegments/customerResearch/hypothesisBoard/decisionJournal
// moved off this list when Career Phase 1 shipped them for real.
const PLANNED = ['founderAttention', 'founderDependency', 'cofounders', 'executives', 'delegation', 'boardPolitics', 'sharedTalentMarket', 'negotiations', 'livingWorld'] as const
ok(
  PLANNED.every((k) => !career[k] && !quick[k] && !arena[k]),
  'no mode claims a Career/Arena system that does not exist yet',
)

// A capability must never understate what is running. The Director and the media voice have no
// switch of their own — they execute whenever proceduralNarrative does — so their flags have to
// track it, or the capability table lies about the shape of the game.
for (const [name, caps] of [['Quick', quick], ['Career', career], ['Arena', arena]] as const)
  ok(
    caps.narrativeDirector === caps.proceduralNarrative && caps.proceduralMedia === caps.proceduralNarrative,
    `${name}: narrativeDirector and proceduralMedia track proceduralNarrative — no flag claims a running system is off`,
  )

console.log('— Override layering —')
const forced = resolveGameRules(cfg({ mode: 'arena', overrides: { storyArcs: true, pvpActions: false } })).capabilities
ok(forced.storyArcs && !forced.pvpActions, 'explicit overrides win over mode + format')
ok(Object.keys(sanitizeCapabilities({ storyArcs: true, nonsense: 1, pvpActions: 'yes' })).length === 1, 'sanitize keeps only known boolean keys')
// `> 20` on a key count was satisfied by any enum of a reasonable size, including one holding 21
// duplicates. The property that matters is that the list IS the interface: no duplicates, and every
// entry actually resolves.
const quickCaps = defaultCapabilities('quick')
ok(
  ALL_CAPABILITY_KEYS.length === new Set(ALL_CAPABILITY_KEYS).size &&
    ALL_CAPABILITY_KEYS.every((k) => typeof quickCaps[k] === 'boolean') &&
    Object.keys(quickCaps).length === ALL_CAPABILITY_KEYS.length,
  `ALL_CAPABILITY_KEYS is exactly the capability surface, no gaps or repeats (${ALL_CAPABILITY_KEYS.length} keys)`,
)

console.log('— Games build from config —')
for (const m of MODES) {
  const g = newGame('T', 'saas', 'technical', { config: cfg({ mode: m, seed: 7 }) })
  ok(g.config.mode === m, `${m} game carries its config`)
  ok(hasCapability(g, m === 'arena' ? 'pvpActions' : 'storyArcs'), `${m} game resolved its capabilities`)
}
const careerGame = newGame('C', 'saas', 'technical', { config: cfg({ mode: 'career' }) })
// `!!advanceWeek(...)` was `!!{}` — advanceWeek always returns a GameState, so the only thing that
// could fail was the mode check already made above.
const careerNext = advanceWeek(careerGame)
ok(
  careerNext.week === careerGame.week + 1 && !!careerNext.career && careerNext.career.cohorts.length >= 0 && !careerNext.gameOver,
  'a Career run advances a week like any other, and keeps its PMF subsystem',
)

console.log('— Determinism: config decides the world —')
const a1 = newGame('A', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
const a2 = newGame('B', 'saas', 'technical', { config: cfg({ seed: 4242 }) })
ok(
  JSON.stringify(a1.rivals.map((r) => [r.name, r.stage, r.users])) === JSON.stringify(a2.rivals.map((r) => [r.name, r.stage, r.users])),
  'same seed + config deals the identical world',
)

/**
 * GOLDEN TRACE. The RNG draw order inside advanceWeekInner is the thing most likely to break
 * silently: reorder or add a single draw and every seeded run changes, while nothing else in the
 * suite notices. Replays, daily challenges and Arena all depend on it.
 *
 * These are RECORDED hashes, not a self-comparison. Asserting `trace() === trace()` — which is what
 * this test did first — only proves a run is consistent with itself: insert an extra RNG.next() and
 * BOTH traces shift together and it still passes. That is the same class of assertion this test
 * file was just rewritten to remove.
 *
 * If one of these fails you changed the draw order. That is allowed — but it must be a DECISION.
 * Re-record the hash in the same commit as the change, never separately.
 */
const GOLDEN_TRACES: Record<number, number> = {
  // Re-recorded twice in the balance pass, both value changes with the draw order untouched
  // (advanceWeek reseeds on (seed, week); every change was a pure term or multiplier, no new
  // branch and no new draw):
  //   1. `arpuWeekly`/`careerArpu` collapsed into one `arpuPerCustomer` (finding 1) — revenue moved.
  //   2. P2: research saturates on `researchSignal`, quality earns fit as a stock, PMF decay is
  //      proportional, churn reads the craft terms at full weight (finding 2) — pmf/users moved.
  // 2026-08-21 — the cross-mode PMF rebalance (test/pmf-mode-probe.ts): quick play's gain
  //      coefficients lifted so PMF 60 is reachable (it was mathematically unreachable — the
  //      equilibrium capped at 44), decay 0.012→0.008; Career's evidence ramp gained the
  //      maturity term. The pmf trajectory moved by design, so every trace moved.
  7: 0xb33ceae6,
  4242: 0x54446ff3,
  31337: 0xdfea5503,
}

for (const [seedKey, expected] of Object.entries(GOLDEN_TRACES)) {
  const seed = Number(seedKey)
  let g = newGame('Trace', 'saas', 'technical', { seed, aiRivals: true })
  const out: string[] = []
  for (let w = 0; w < 12; w++) {
    g = advanceWeek(g)
    out.push(
      `${g.week}|${g.users}|${Math.round(g.cash)}|${g.pmf.toFixed(4)}|${g.hype.toFixed(4)}|` +
        `${g.quality.toFixed(4)}|${g.bugs.toFixed(4)}|${g.rivals.map((r) => r.users).join(',')}|${g.candidates.length}`,
    )
  }
  const trace = out.join(';')
  let h = 2166136261 >>> 0
  for (let i = 0; i < trace.length; i++) {
    h ^= trace.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  ok(h === expected, `seed ${seed}: twelve weeks match the recorded trace (0x${h.toString(16)})`)
}

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
