// Living World Phase 7 — Promises (brief §34-§35, §77; tests §84).
//
// What carries the phase: the choices that ARE promises get NOTED at the moment of the saying,
// TRACKED against their own deadlines, SETTLED from verdicts the simulation already computed
// (never by narrative fiat), FELT through the memory and relationship systems Phases 1-6 built,
// and SURFACED on panels the simulation never reads — because the simulation DOES read the inbox
// (event windows, 1:1 dedupe), and one extra message there would break bot byte-identity.
//
// MUTATION LEDGER — each entry was verified by making the named break and watching the named
// assertion fail, then reverting. An assertion that cannot fail is not a test. First-pass
// survivors are recorded, because they are the ledger's whole point.
//   1. engine.ts drops the board-defy hook            → "defying the board IS a promise" fails
//      (plus the deadline, the quoted number, and the board-person assertions with it).
//   2. settleWeeklyPromises flips the defiance verdict (kept↔broken)
//                                                     → "a cleared review settles it kept" and
//                                                       "still-defied past due settles it broken" fail.
//   3. settleWeeklyPromises stops emitting relationship facts (add() gutted)
//                                                     → "a broken promise costs real trust vs
//                                                       keeping it" fails: kept 36.41 vs broken
//                                                       36.41, byte-equal. SURVIVOR NOTE: the
//                                                       first draft asserted only "trust dropped
//                                                       vs before the promise", and baseline decay
//                                                       alone (41.24 → 36.41 over 13 quiet weeks)
//                                                       satisfied that — the kept-vs-broken
//                                                       comparison on the same seed is what
//                                                       actually pins the consequence.
//   4. noteRaiseOutcome loses the comp-bands dueWeek   → "the deadline is tracked on the record"
//                                                       and "holding the line settles it kept" fail.
//   5. commitmentAdvisorFacts returns []              → "§35: the panel warns before the deadline",
//                                                       "the verdict is voiced", and the unit fact
//                                                       assertion all fail.
//   6. capability-gate removal — RECORDED SURVIVORS: removing the gate in memory.ts's notePromise
//      alone SURVIVES (every caller gates first), and removing noteRaiseOutcome's gate alone also
//      SURVIVES (notePromise's own gate catches it). The gates are deliberate defense in depth —
//      the hook gate also protects ensureCounterpart from growing the cast — so no single-line
//      assertion can see one of them. Removing BOTH → "a frozen pre-phase ruleset never grows a
//      ledger" and "the run without it grew none" fail, which is the behavior the pair exists for.
//   7. resolvePromise stops souring the broken memory → "the memory sours: negative, blamed,
//                                                       resolved", "the board remembers it,
//                                                       soured" and the check-in callback fail.
//   8. persistence normalizePromise drops resolvedWeek → "the ledger survives a JSON round-trip
//                                                       verbatim" fails.
//   9. breakCompDiscipline removed                    → "the next exception breaks it" fails,
//                                                       and with it the sour memory, the trust
//                                                       drop and the check-in callback.
//  10. tick.ts stops passing commitmentAdvisorFacts   → both §35 panel assertions fail while the
//                                                       unit fact still passes — integration IS
//                                                       the deliverable, so both layers are pinned.
//  11. commitmentLedger 'at_risk' branch removed      → "§77: off-track reads At risk" fails.
//  12. supersedeBoardPromises removed                 → "a new round supersedes the old target"
//                                                       and "closes as expired" fail (two open
//                                                       board promises at once).
import { acceptTermSheet, advanceWeek, migrateLegacySave, newGame, resolveChoiceOnState } from '../src/game/engine'
import { tickLivingWorld } from '../src/game/world/tick'
import {
  COMP_DISCIPLINE_WINDOW_WEEKS,
  commitmentAdvisorFacts,
  commitmentLedger,
  settleWeeklyPromises,
} from '../src/game/world/promises'
import { openPromises } from '../src/game/world/memory'
import { PROMISE_KEYS } from '../src/game/world/content/memory-cues'
import { composeNarrative, createNarrativeUsage, validateFragmentLibrary } from '../src/game/world/composer'
import { migrateLivingWorldSlice } from '../src/game/world/persistence'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

// ---------- fixtures ----------

const cfg = (seed: number, mode: 'quick' | 'career' | 'arena' = 'career', overrides?: Record<string, boolean>) =>
  ({ mode, format: 'standard', sector: 'saas' as SectorId, seed, overrides }) as never

function play(seed: number, weeks: number, mode: 'quick' | 'career' | 'arena' = 'career', overrides?: Record<string, boolean>): GameState {
  let s = newGame('Northwind', 'saas', 'technical', { config: cfg(seed, mode, overrides) })
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 4 && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== best.id)
      s.offersOut.push(best)
    }
    s = advanceWeek(s)
  }
  return s
}

let msgIds = 0
/** Resolve a synthetic inbox choice through the real engine path — the same seeded entry the UI and bots use. */
function choose(s: GameState, special: 'grant-raise' | 'refuse-raise' | 'board-defy' | 'cola-raise'): void {
  const id = `t-msg-${msgIds++}`
  s.inbox.unshift({
    id,
    week: s.week,
    kind: 'choice',
    title: 't',
    body: 't',
    choices: [{ label: 't', resultText: 't', effects: { special } }],
  })
  resolveChoiceOnState(s, id, 0)
}

/** A star who qualifies for the raise-demand event (skill≥7, weeks≥20, morale<68). */
function plantStar(s: GameState, name = 'Test Star'): void {
  s.employees.push({ id: `e-${name}`, name, role: 'engineer', skill: 9, salary: 150_000, morale: 55, weeks: 30 })
}

const starId = (name = 'Test Star') => `emp:${name.toLowerCase().replace(/\s+/g, '_')}:engineer`
const trustOf = (s: GameState, characterId: string) =>
  s.world?.characters[characterId]?.relationships.find((r) => r.characterId === 'founder')?.trust

/** Seed 4242's real walkthrough: term sheet at week 21 installs a board due for review at week 33. */
function playToFunding(): GameState {
  const s = play(4242, 20)
  s.termSheets.push({ id: 'ts-1', investor: 'Granite Peak', amount: 1_200_000, equity: 0.18, weeksLeft: 2 })
  acceptTermSheet(s, 'ts-1')
  return s
}

console.log('— Content is lintable before it is judgeable —')
{
  const problems = validateFragmentLibrary()
  ok(problems.length === 0, `commitment fragments pass the library lint (${problems.length === 0 ? 'clean' : problems.join('; ')})`)
}

console.log('\n— §34: the choices that ARE promises get noted at the moment of the saying —')
{
  let s = play(4242, 6)
  plantStar(s)
  s = advanceWeek(s) // the cast picks the star up

  // Grant the raise: a commitment made and paid in the same breath — noted AND settled kept.
  const trustBefore = trustOf(s, starId())!
  choose(s, 'grant-raise')
  const raise = s.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.raise)
  ok(raise?.status === 'kept' && raise.resolvedWeek === s.week, `granting the raise is a promise kept the same week (${raise?.status})`)
  ok(raise?.characterId === starId(), 'made to the person who asked, keyed like the rest of the cast')
  const raiseMem = s.world?.characters[starId()]?.memories.find((m) => m.type === 'promise')
  ok(!!raiseMem && raiseMem.resolved === true && raiseMem.emotionalImpact > 0, 'the character remembers a kept promise, warm')
  ok(trustOf(s, starId())! > trustBefore, `trust moved through promise_made + promise_kept (${trustBefore} → ${trustOf(s, starId())})`)

  // Refuse the raise: "the comp bands are the comp bands" is a commitment with a window.
  plantStar(s, 'Second Star')
  s = advanceWeek(s)
  choose(s, 'refuse-raise')
  const bands = s.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.compDiscipline)
  ok(bands?.status === 'open', 'refusing on the bands is an open promise')
  ok(bands?.dueWeek === s.week + COMP_DISCIPLINE_WINDOW_WEEKS, `the deadline is tracked on the record (due w${bands?.dueWeek})`)

  // The next exception breaks it — for the person who was told the bands were the bands.
  const holder = bands!.characterId
  const trustHeld = trustOf(s, holder)!
  choose(s, 'grant-raise')
  ok(s.world?.promises.find((p) => p.id === bands!.id)?.status === 'broken', 'the next exception breaks it')
  const souredMem = s.world?.characters[holder]?.memories.find((m) => m.sourceId === bands!.id)
  ok(!!souredMem && souredMem.resolved === true && souredMem.emotionalImpact < 0 && souredMem.tags.includes('blame'), 'the memory sours: negative, blamed, resolved')
  ok(trustOf(s, holder)! < trustHeld, `a broken promise is a trust event for the person who heard it (${trustHeld} → ${trustOf(s, holder)})`)

  // Held for the whole window, the stance settles kept — the fact is the absence of an exception.
  let held = play(4242, 6)
  // The 2026-08-21 PMF rebalance made early career revenue leaner; unfunded, this run now dies at
  // week 14, inside its own promise window. Cash is orthogonal to promise mechanics — fund the
  // fixture so the window it exists to test can actually elapse.
  held.cash += 400_000
  plantStar(held)
  held = advanceWeek(held)
  choose(held, 'refuse-raise')
  for (let w = 0; w <= COMP_DISCIPLINE_WINDOW_WEEKS && !held.gameOver; w++) {
    held.marketingSpend = 3000
    held = advanceWeek(held)
  }
  ok(
    held.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.compDiscipline)?.status === 'kept',
    'holding the line for the whole window settles it kept',
  )

  // Cola: promised and paid company-wide, recorded against the delegation's spokesperson.
  choose(s, 'cola-raise')
  const cola = s.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.cola)
  ok(cola?.status === 'kept' && !!s.world?.characters[cola.characterId], 'the cost-of-living adjustment is a kept promise to a real person')
}

console.log('\n— §34: defying the board IS a promise, and the ultimatum names its terms —')
{
  let s = play(7, 10)
  s.board = { targetGrowth: 0.035, nextReview: s.week + 10, strikes: 3, defied: false }
  choose(s, 'board-defy')
  const defiance = s.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.boardGrowth)
  ok(!!defiance && defiance.status === 'open', 'defying the board IS a promise')
  ok(defiance?.dueWeek === s.board!.nextReview, `due exactly at the next review (w${defiance?.dueWeek})`)
  ok(typeof defiance?.facts?.target === 'number' && defiance.facts.target > 0, 'the record carries the number the ultimatum quoted')
  ok(!!s.world?.characters['adv:board'], 'the board became a person the moment a promise was made to them')

  // Settlement is the review's own verdict, read as facts — three futures, one function.
  const at = (mut: (x: GameState) => void): GameState => {
    const x = structuredClone(s)
    x.week = defiance!.dueWeek!
    mut(x)
    return x
  }
  const cleared = at((x) => (x.board!.defied = false))
  const feltKept = settleWeeklyPromises(cleared, cleared.world!)
  ok(cleared.world!.promises.find((p) => p.id === defiance!.id)?.status === 'kept', 'a cleared review settles it kept')
  ok(feltKept['adv:board']?.some((f) => f.kind === 'promise_kept'), 'and the board feels promise_kept through the weekly tick')

  const missed = at((x) => (x.board!.defied = true))
  const feltBroken = settleWeeklyPromises(missed, missed.world!)
  ok(missed.world!.promises.find((p) => p.id === defiance!.id)?.status === 'broken', 'still-defied past due settles it broken')
  ok(feltBroken['adv:board']?.some((f) => f.kind === 'promise_broken'), 'and the board feels promise_broken')

  const dissolved = at((x) => (x.board = null))
  settleWeeklyPromises(dissolved, dissolved.world!)
  ok(dissolved.world!.promises.find((p) => p.id === defiance!.id)?.status === 'expired', 'a board that no longer exists moots the promise — expired, not broken')

  // A settled promise is closed: a second pass over the same week changes nothing.
  const again = JSON.stringify(cleared.world)
  settleWeeklyPromises(cleared, cleared.world!)
  ok(JSON.stringify(cleared.world) === again, 'settlement is idempotent — the catch-up loop cannot double-settle')
}

console.log('\n— The real seed: a term sheet at w21, judged by its own first review at w33 —')
{
  // KEPT: seed 4242 keeps growing, the review passes without a strike.
  let s = playToFunding()
  const promise = s.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.fundingGrowth)
  ok(promise?.status === 'open' && promise.characterId === 'adv:board', 'accepting the term sheet notes the growth expectation to the board')
  ok(promise?.dueWeek === s.board?.nextReview, `due at the first review (w${promise?.dueWeek})`)
  ok(promise?.facts?.investor === 'Granite Peak', 'the record names the investor whose money set the target')

  let warned = false
  let verdictSpoken = false
  for (let w = 0; w < 14 && !s.gameOver; w++) {
    s.marketingSpend = 3000
    s = advanceWeek(s)
    const commit = s.world?.advisorPanel?.opinions.find((o) => o.topic === 'commitment')
    if (commit && s.week < promise!.dueWeek!) warned = true
    if (commit && s.week === promise!.dueWeek) verdictSpoken = true
  }
  const settledKept = s.world?.promises.find((p) => p.id === promise!.id)
  ok(settledKept?.status === 'kept' && settledKept.resolvedWeek === promise!.dueWeek, `the review passed and the promise settled kept at w${settledKept?.resolvedWeek}`)
  ok(warned, '§35: the panel warns before the deadline ("the commitment lands in N weeks")')
  ok(verdictSpoken, '§35: the verdict is voiced the week it lands')

  // BROKEN: same seed, same sheet — the founder just stops buying growth. The review strikes.
  let b = playToFunding()
  const before = trustOf(b, 'adv:board')!
  for (let w = 0; w < 14 && !b.gameOver; w++) {
    b.marketingSpend = 0
    b = advanceWeek(b)
  }
  const settledBroken = b.world?.promises.find((p) => p.summaryKey === PROMISE_KEYS.fundingGrowth)
  ok(settledBroken?.status === 'broken', `the same commitment, unfed, settles broken (strike ${b.board?.strikes})`)
  ok((b.board?.strikes ?? 0) >= 1, 'and the verdict came from the review itself — the strike is the fact')
  ok(trustOf(b, 'adv:board')! < before, `the board's trust in the founder drops (${before} → ${trustOf(b, 'adv:board')})`)
  // Against the KEPT variant, not just against time: baseline decay alone moves trust a point or
  // two, so "it dropped" would survive the settlement facts being dropped entirely. The gap
  // between keeping and breaking the same promise on the same seed is the consequence.
  ok(
    trustOf(b, 'adv:board')! < trustOf(s, 'adv:board')! - 10,
    `a broken promise costs real trust vs keeping it (kept ${trustOf(s, 'adv:board')} vs broken ${trustOf(b, 'adv:board')})`,
  )
  const boardMem = b.world?.characters['adv:board']?.memories.find((m) => m.sourceId === settledBroken?.id)
  ok(!!boardMem && boardMem.emotionalImpact < 0 && boardMem.tags.includes('blame'), 'the board remembers it, soured')

  // §77: the panel the player sees, in the brief's own shape.
  const rows = commitmentLedger(b)
  const row = rows.find((r) => r.id === settledBroken?.id)
  ok(!!row && row.status === 'broken' && /3\.5%\/wk growth/.test(row.title) && row.dueWeek === settledBroken?.dueWeek, `§77: "${row?.title}" · lands week ${row?.dueWeek} · ${row?.status}`)

  // At-risk is a fact read, not a mood: mid-window with no growth the open promise reads at_risk.
  let mid = playToFunding()
  for (let w = 0; w < 8 && !mid.gameOver; w++) {
    mid.marketingSpend = 0
    mid = advanceWeek(mid)
  }
  const midRow = commitmentLedger(mid).find((r) => r.title.includes('Granite Peak'))
  ok(midRow?.status === 'at_risk', `§77: off-track reads At risk before the deadline (${midRow?.status})`)
  const dueFact = commitmentAdvisorFacts(mid, mid.world!)
  ok(dueFact.length === 1 && dueFact[0].direction === -1 && (dueFact[0].tags?.includes('due') ?? false), 'the advisor fact agrees: bad news, still due')

  // A new round supersedes the old target — the board itself reset the clock.
  const re = playToFunding()
  re.termSheets.push({ id: 'ts-2', investor: 'Second Fund', amount: 4_000_000, equity: 0.2, weeksLeft: 2 })
  acceptTermSheet(re, 'ts-2')
  const open = openPromises(re.world!).filter((p) => p.summaryKey === PROMISE_KEYS.fundingGrowth)
  ok(open.length === 1 && open[0].facts?.investor === 'Second Fund', 'a new round supersedes the old target — one open board promise at a time')
  ok(re.world!.promises.some((p) => p.summaryKey === PROMISE_KEYS.fundingGrowth && p.status === 'expired'), 'the superseded record closes as expired, not broken')
}

console.log('\n— The broken promise resurfaces where Phases 1-5 already speak —')
{
  let s = play(4242, 6)
  plantStar(s)
  s = advanceWeek(s)
  choose(s, 'refuse-raise')
  const bands = s.world!.promises.find((p) => p.summaryKey === PROMISE_KEYS.compDiscipline)!
  choose(s, 'grant-raise') // the exception that breaks it
  const holder = s.world!.characters[bands.characterId]!
  const broken = holder.memories.find((m) => m.sourceId === bands.id)!
  const composed = composeNarrative({
    seed: 4242,
    week: s.week + 6,
    surface: 'inbox',
    beatKey: 'team_request',
    audience: 'employee',
    character: holder,
    tags: ['team'],
    usage: createNarrativeUsage(),
  })
  ok(!!composed && composed.memoryIds.includes(broken.id), 'the check-in beat picks the broken promise as its callback — week 48 remembers week 18')
}

console.log('\n— Interpretation only: flipping the capability moves no simulation byte —')
{
  const trace = (s: GameState) => `${s.users}|${s.pmf.toFixed(6)}|${Math.round(s.cash)}|${s.quality.toFixed(4)}|${s.bugs.toFixed(4)}|${s.inbox.length}`
  const playChoosing = (overrides?: Record<string, boolean>) => {
    let s = newGame('Northwind', 'saas', 'technical', { config: cfg(11, 'career', overrides) })
    for (let w = 0; w < 26 && !s.gameOver; w++) {
      s.marketingSpend = 3000
      if (s.week === 6) plantStar(s)
      // A granted raise lifts the star's morale out of raiseDemandTarget's filter, exactly as it
      // does in a real game — so the refusal needs a second star still unhappy enough to ask.
      if (s.week === 9) plantStar(s, 'Second Star')
      if (s.week === 8) choose(s, 'grant-raise')
      if (s.week === 10) choose(s, 'refuse-raise')
      if (s.week === 12) choose(s, 'cola-raise')
      for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
      s = advanceWeek(s)
    }
    return s
  }
  const withP = playChoosing()
  const withoutP = playChoosing({ promises: false })
  ok((withP.world?.promises.length ?? 0) >= 3, `the run with the capability grew a ledger (${withP.world?.promises.length} records)`)
  ok((withoutP.world?.promises.length ?? 0) === 0, 'the run without it grew none')
  ok(trace(withP) === trace(withoutP), 'and the simulation is byte-identical either way — promises interpret, never decide')
  // Message ids come from uid() (wall clock + Math.random), so identity is week|kind|title.
  const inboxShape = (s: GameState) => s.inbox.map((m) => `${m.week}|${m.kind}|${m.title}`).join('\n')
  ok(
    inboxShape(withP) === inboxShape(withoutP),
    'the inbox is untouched: not one message added, dropped or reordered (the sim READS inbox windows)',
  )
  // Tracks livingWorldActive(): Phase 8 added the three structured-interaction switches to it.
  const OFF = { proceduralNarrative: false, persistentCharacters: false, characterMemory: false, companyMemory: false, relationships: false, advisorOpinions: false, promises: false, structuredInterviews: false, structuredEmployeeConversations: false, proceduralBoardMeetings: false }
  ok(play(7, 12, 'career', OFF).world === undefined, 'with every living-world capability off, no world is created at all')
}

console.log('\n— Determinism and idempotency (the Arena catch-up contract) —')
{
  const a = playToFunding()
  const b = playToFunding()
  ok(JSON.stringify(a.world?.promises) === JSON.stringify(b.world?.promises), 'same seed, same actions — byte-identical ledger')
  let c = playToFunding()
  for (let w = 0; w < 13 && !c.gameOver; w++) {
    c.marketingSpend = 3000
    c = advanceWeek(c)
  }
  const before = JSON.stringify(c.world)
  tickLivingWorld(c) // the catch-up loop calling the same week again
  ok(JSON.stringify(c.world) === before, 'a second tick over a settled week changes nothing (shouldGenerateForWeek)')
}

console.log('\n— Legacy saves: frozen rulesets stay frozen (the Slice 5 precedent) —')
{
  // An in-flight Career save from before this phase carries advisorOpinions (Phase 6) but not
  // promises — its world EXISTS, so the capability gate is the only thing between a choice and a
  // ledger. It must never grow one.
  let inFlight = newGame('Frozen', 'saas', 'technical', { config: cfg(5) })
  inFlight.capabilities = { ...inFlight.capabilities, promises: false } // as an older build stored it
  for (let w = 0; w < 8; w++) inFlight = advanceWeek(inFlight)
  plantStar(inFlight)
  inFlight = advanceWeek(inFlight)
  choose(inFlight, 'grant-raise')
  ok(!!inFlight.world, 'the pre-phase world still exists and still runs')
  ok((inFlight.world?.promises.length ?? 0) === 0, 'a frozen pre-phase ruleset never grows a ledger, even through the same choices')
  ok(commitmentLedger(inFlight).length === 0, 'and the §77 panel renders nothing for it')

  const preConfig = { ...newGame('Ancient', 'saas', 'technical', { config: cfg(5, 'quick') }), config: undefined, capabilities: undefined } as never as GameState
  const migrated = migrateLegacySave(preConfig)
  ok(migrated.capabilities.promises === false, 'a pre-config save migrates to Quick Play and gains no promises retroactively')
}

console.log('\n— Persistence (§68/§88): the ledger must survive exactly —')
{
  let s = playToFunding()
  for (let w = 0; w < 13 && !s.gameOver; w++) {
    s.marketingSpend = 0
    s = advanceWeek(s)
  }
  const revived = migrateLivingWorldSlice(JSON.parse(JSON.stringify(s.world)))
  // Canonical form: the normalizer rebuilds records in its own key order, which JSON.stringify
  // would misread as a content change. Values and their meaning are what must survive.
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v
  ok(
    JSON.stringify(canon(revived?.promises)) === JSON.stringify(canon(s.world?.promises)),
    'the ledger survives a JSON round-trip verbatim, verdicts and all',
  )
  const garbage = migrateLivingWorldSlice({
    ...JSON.parse(JSON.stringify(s.world)),
    promises: [
      { id: 'p1', characterId: 'adv:board', summaryKey: 'promised_growth_target', week: 3, status: 'astrology', importance: 900 },
      { id: 'p2', summaryKey: 'orphaned' },
      'nonsense',
      ...JSON.parse(JSON.stringify(s.world!.promises)),
    ],
  })
  ok(
    garbage!.promises.find((p) => p.id === 'p1')?.status === 'open' && garbage!.promises.find((p) => p.id === 'p1')?.importance === 100,
    'an unknown status coerces to open and importance clamps — never guessed at, never crashed on',
  )
  ok(!garbage!.promises.some((p) => p.id === 'p2') && garbage!.promises.length === s.world!.promises.length + 1, 'a promise with no counterparty is dropped')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
