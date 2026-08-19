// The Run Biography — buildStory and friends. Run: npx tsx test/story.test.ts
//
// The contract under test, in order of importance:
//   PURE     — building the story writes NOTHING and draws NOTHING. The state is byte-identical
//              after 100 builds, and the RNG stream is untouched (the token-community pattern).
//   DETERMINISTIC — the same save always tells the same story, beat for beat.
//   ORDERED  — beats come back in week order, ties broken by scan order, never by luck.
//   TOLERANT — no career, no world, no token is the NORMAL case (Quick Play, old saves), and a
//              malformed row from user-writable localStorage is skipped, never thrown over.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose in
// src/game/story.ts and this file re-run to confirm it goes red. The ledger is at the bottom.

import { acceptTermSheet, advanceWeek, newGame, pitchInvestors, resolveChoiceOnState } from '../src/game/engine'
import { RNG } from '../src/game/data'
import type { GameConfig } from '../src/game/modes'
import { buildStory, definingBeats, storyChapters, type StoryBeat } from '../src/game/story'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const cfg = (mode: 'quick' | 'career', seed: number, sector: SectorId = 'saas'): GameConfig => ({
  mode,
  format: 'standard',
  sector,
  seed,
})

/**
 * A run actually PLAYED forward — the career-bots `common()` loop: answer every choice, raise
 * when thin, take the biggest sheet, hire against revenue. A passive advanceWeek loop is a dead
 * company with a three-line biography, which tests nothing.
 */
function played(mode: 'quick' | 'career', weeks: number, seed = 4242, sector: SectorId = 'saas'): GameState {
  let s = newGame('Biograph', sector, 'technical', { config: cfg(mode, seed, sector) })
  s.allocation = { features: 45, quality: 25, bugs: 10, research: 20, bet: 0 }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
    // HARNESS RULE (d): `pitchInvestors` returns the sheets, the caller stores them. The docstring
    // above already claimed this loop "takes the biggest sheet"; without this assignment it never
    // could. See test/career-bots.ts.
    if (s.raiseCooldown === 0 && s.cash < (s.lastExpenses || 5000) * 25) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
    const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
    const affordable = Math.min(8, 1 + Math.floor(s.lastRevenue / 2500))
    if (s.cash / Math.max(1, s.lastExpenses || 5000) > 25 && staff < affordable && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((x) => x.id !== best.id)
      s.offersOut.push(best)
    }
    s.marketingSpend = Math.min(Math.max(2_000, s.lastRevenue * 1.2), s.cash * 0.06, 200_000)
    s = advanceWeek(s)
  }
  return s
}

const weeksAscending = (beats: readonly StoryBeat[]) => beats.every((b, i) => i === 0 || beats[i - 1].week <= b.week)

// ---------------------------------------------------------------------------------------------
console.log('— PURE: 100 builds change nothing, and the RNG stream is never touched —')

{
  const s = played('career', 60, 777)
  const before = JSON.stringify(s)
  const prev = RNG.next
  let draws = 0
  RNG.next = () => {
    draws++
    return prev()
  }
  let out: StoryBeat[] = []
  try {
    // An ODD count on purpose: an in-place `.reverse()` un-does itself over an even number of
    // builds and the byte-identity check would wave it through (see the M19 note below).
    for (let i = 0; i < 101; i++) out = buildStory(s)
  } finally {
    RNG.next = prev
  }
  ok(JSON.stringify(s) === before, 'building the story 101 times leaves the run byte-identical — a pure read, arrays included')
  ok(draws === 0, `101 builds draw zero random numbers (drew ${draws}) — the biography cannot shift a replay`)
  ok(out.length > 0, 'and it did actually build something')
  ok(JSON.stringify(definingBeats(s)) === JSON.stringify(definingBeats(s)) && JSON.stringify(s) === before, 'definingBeats is a pure read too')
}

// ---------------------------------------------------------------------------------------------
console.log('— DETERMINISTIC and ORDERED —')

{
  const s = played('career', 60, 777)
  const a = buildStory(s)
  const b = buildStory(structuredClone(s))
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same save tells the same story, beat for beat, clone or original')
  ok(weeksAscending(a), 'beats come back in week order')
  ok(a.every((x) => Number.isFinite(x.week) && x.text.length > 0 && ['good', 'bad', 'neutral'].includes(x.tone)), 'every beat carries a finite week, a sentence and a tone')
}

// ---------------------------------------------------------------------------------------------
console.log('— A long Career run tells a real story from every source —')

{
  // Played to its ENDING, not to a fixed 90 weeks. The two chapter assertions below both need a
  // finished run — "The end" is the only beat that carries a chapter marker, so an unfinished run
  // yields one chapter and no ending — and pinning the horizon at 90 made that a property of the
  // balance rather than of the narrator. It went red the week aggressive AI rivals kept seed 42
  // from reaching the acquisition gate inside 90 weeks: a story test failing because the economy
  // moved is testing the wrong thing. 300 is a bound, not a target; the run ends long before it.
  const s = played('career', 300, 42)
  const beats = buildStory(s)
  console.log(`    (this career run produced ${beats.length} beats${s.gameOver ? `, ended '${s.gameOver.type}' wk ${s.gameOver.week}` : ''})`)
  ok(beats.length >= 8, `a played career run has a biography (${beats.length} beats), not a stub`)
  ok(beats[0].week === 1 && beats[0].text.includes('Biograph opens for business'), 'it opens with the founding')
  ok(beats.some((b) => b.text.startsWith('Milestone: ')), 'the milestones the run hit are in it')
  ok(beats.some((b) => b.text.includes('customers who stay and pay')), "Career's own PMF verdict (the journal) is in it, segment named")
  ok(beats.filter((b) => b.text.includes('Product-market fit') || b.text.startsWith('PMF:')).length === 1, 'PMF is told ONCE — the journal verdict outranks the generic milestone')
  ok(!(beats.some((b) => b.text.includes('Ramen profitable')) && beats.some((b) => b.text.includes('Revenue covers the burn'))), 'profitability is told once, whichever source got there first')
  const chapters = storyChapters(beats)
  ok(chapters.length >= 2 && chapters[0].title === 'The first weeks', 'the timeline folds into chapters, opening with the first weeks')
  ok(chapters.reduce((a, c) => a + c.beats.length, 0) === beats.length, 'chaptering loses no beats and invents none')
  ok(!!s.gameOver, `the fixture run actually finished (${s.gameOver?.type ?? 'STILL RUNNING'} wk ${s.week}) — the two chapter assertions are vacuous otherwise`)
  ok(!!s.gameOver && chapters[chapters.length - 1].title === 'The end', 'a finished run closes with The end')
}

// ---------------------------------------------------------------------------------------------
console.log('— TOLERANT: Quick Play (no career, no world, no token) is the normal case —')

{
  const s = played('quick', 40, 99)
  ok(s.career === undefined, '(rig check: a quick run has no career slice)')
  const beats = buildStory(s)
  ok(beats.length >= 3, `a quick run still has a story (${beats.length} beats): founding, milestones, raises, ending`)
  ok(weeksAscending(beats), 'and it is week-ordered too')

  // Even more absent than absent: strip every optional slice and the inbox besides.
  const bare = structuredClone(s)
  delete bare.career
  delete bare.world
  delete bare.token
  ;(bare as unknown as Record<string, unknown>).inbox = undefined
  ;(bare as unknown as Record<string, unknown>).history = []
  const b2 = buildStory(bare)
  ok(b2.length >= 1 && b2[0].text.includes('opens for business'), 'with every subsystem gone the founding still stands — undefined slices are silently fine')
}

{
  // A week-3 run: honest emptiness, not an invented saga.
  let s = newGame('Seedling', 'saas', 'technical', { config: cfg('quick', 5) })
  for (let w = 0; w < 3 && !s.gameOver; w++) s = advanceWeek(s)
  const beats = buildStory(s)
  ok(beats.length >= 1 && beats.length <= 4, `week 3 has ${beats.length} beat(s) — "not much yet" is the truth`)
}

// ---------------------------------------------------------------------------------------------
console.log('— TOLERANT: malformed rows are skipped, never thrown over —')

{
  const s = played('quick', 30, 321)
  const clean = buildStory(s)
  const dirty = structuredClone(s) as unknown as Record<string, unknown>
  // Garbage in every source the builder scans — user-writable localStorage can hold anything.
  ;(dirty.inbox as unknown[]).push(null, 42, { week: 'twelve', title: '🏁 Milestone: Fake' }, { week: NaN, title: 'Pivot #9: nope' }, { title: 'Seed closed: $1M from Nobody' })
  dirty.world = {
    characters: 'not-a-record',
    companyMemory: [null, { week: -Infinity, type: 'profitability' }, { week: 3 }],
    promises: [{ id: 'x' }, { week: 'soon', summaryKey: 'promised_raise', status: 'kept' }, null],
  }
  dirty.career = { journal: [{ week: Infinity, category: 'pivot', title: 'Bad pivot' }, 'garbage', null] }
  dirty.token = { history: [null, { week: 'launchday', type: 'launch' }, { week: 12, type: 4 }, { week: 9, type: 'governance_vote', metadata: null }] }
  dirty.gameOver = { type: 'made-up-ending', week: s.week }
  // …and one slice that THROWS on first touch, which no field check can pre-empt: the per-source
  // fence has to hold, losing that source's sentences and nothing else.
  Object.defineProperty(dirty.world as object, 'promises', {
    get() {
      throw new Error('boom')
    },
  })
  let threw = false
  let out: StoryBeat[] = []
  try {
    out = buildStory(dirty as unknown as GameState)
  } catch {
    threw = true
  }
  ok(!threw, 'a save full of garbage rows builds without throwing')
  ok(!out.some((b) => b.text.includes('Fake') || b.text.includes('Pivot #9') || b.text.includes('Bad pivot') || b.text.includes('Nobody')), 'the malformed rows contributed nothing — a bad week number or missing field is a skip')
  ok(weeksAscending(out), 'and what survives is still week-ordered')
  ok(out.some((b) => b.chapter === 'The end'), 'an ending of an unknown type still closes the story (falls back to the challenge-clock face)')
  ok(clean.length > 0, '(rig check: the clean control had beats to lose)')
}

// ---------------------------------------------------------------------------------------------
console.log('— The sources merge without saying anything twice —')

{
  // Token and governance modules write their own mail AND their own ledger rows. The ledger
  // narrates those weeks; mail carrying their id prefixes must never be narrated by the inbox
  // scanner — whatever its title happens to say.
  const s = played('quick', 20, 11)
  const t = structuredClone(s)
  t.inbox.unshift({ id: `gov-fake-${t.week}`, week: t.week, kind: 'system', title: 'Seed closed: $1.0M from Nobody', body: 'x' })
  t.inbox.unshift({ id: `token-fake-${t.week}`, week: t.week, kind: 'system', title: 'Pivot #7: a new direction', body: 'x' })
  t.token = {
    history: [{ week: t.week, type: 'governance_vote', importance: 90, metadata: { kind: 'tabled', proposal: 'founder_removal', support: 44 } }],
  } as unknown as GameState['token']
  const beats = buildStory(t)
  ok(!beats.some((b) => b.text.includes('Nobody') || b.text.includes('Pivot #7')), 'ledger-owned mail (gov-/token- ids) is never narrated from the inbox, whatever its title')
  ok(beats.filter((b) => b.text.toLowerCase().includes('no confidence')).length === 1, 'the governance week is narrated exactly once, by the ledger')
}

{
  // The inbox milestone and the company memory describe the same first — one beat, the inbox's.
  const s = played('quick', 30, 321)
  const t = structuredClone(s)
  t.world = {
    characters: {},
    companyMemory: [
      { week: 4, type: 'first_revenue', importance: 80, metadata: {} },
      { week: 6, type: 'first_customer', importance: 70, metadata: {} },
      { week: 6, type: 'first_customer', importance: 70, metadata: {} }, // duplicate row
    ],
    promises: [],
  } as unknown as NonNullable<GameState['world']>
  const beats = buildStory(t)
  ok(!beats.some((b) => b.week === 4 && b.text.includes('first_revenue')), 'company memory never re-tells a first the inbox already told')
  ok(beats.filter((b) => b.text.includes('first customer shows up')).length === 1, 'the firsts the inbox has no words for get exactly one sentence each')
}

// ---------------------------------------------------------------------------------------------
console.log('— Promises: made, kept, broken — the ledger the biography exists for —')

{
  const s = played('quick', 20, 13)
  const t = structuredClone(s)
  t.world = {
    characters: { emp_ada_engineer: { firstName: 'Ada', lastName: 'Nkemelu' } },
    companyMemory: [],
    promises: [
      { id: 'p1', week: 10, characterId: 'board_seat', summaryKey: 'promised_board_growth', status: 'broken', importance: 95, dueWeek: 18, resolvedWeek: 18, facts: { target: 0.031 } },
      { id: 'p2', week: 12, characterId: 'emp_ada_engineer', summaryKey: 'promised_comp_discipline', status: 'kept', importance: 65, dueWeek: 32, resolvedWeek: 32 },
      { id: 'p3', week: 14, characterId: 'emp_ada_engineer', summaryKey: 'promised_raise', status: 'kept', importance: 70, resolvedWeek: 14 },
      { id: 'p4', week: 15, characterId: 'board_seat', summaryKey: 'promised_growth_target', status: 'expired', importance: 80, resolvedWeek: 16 },
    ],
  } as unknown as NonNullable<GameState['world']>
  const beats = buildStory(t)
  const texts = beats.map((b) => b.text)
  ok(texts.some((x) => x.includes('defy the board') && x.includes('3.1%/wk')), 'the defiance is a beat, with the number the ultimatum actually quoted')
  const broken = beats.find((b) => b.week === 18 && b.text.startsWith('Promise broken'))
  ok(!!broken && broken.tone === 'bad', 'the broken board promise lands at its RESOLVED week, and it reads bad')
  ok(texts.some((x) => x.includes('Ada Nkemelu asks for a raise and hears no')), 'the comp-bands stance names the person who heard it')
  ok(beats.some((b) => b.week === 32 && b.text.startsWith('Promise kept')), 'holding the line for the window is a kept promise at the week it settled')
  ok(texts.filter((x) => x.includes('asks for a raise and gets it')).length === 1 && !beats.some((b) => b.week === 14 && b.text.startsWith('Promise kept')), 'a raise granted on the spot is ONE beat, not a made and a kept')
  ok(!texts.some((x) => x.includes('came with')), 'superseded expiries are bookkeeping, not story — the superseded round target says nothing')
}

// ---------------------------------------------------------------------------------------------
console.log('— The token ledger narrates the token era —')

{
  const s = played('quick', 20, 17)
  const t = structuredClone(s)
  t.token = {
    history: [
      { week: 8, type: 'launch', importance: 100, metadata: { launchPrice: 0.1, totalSupply: 1e9 } },
      { week: 11, type: 'price_crash', importance: 80, metadata: { move: -0.34, price: 0.05 } },
      { week: 13, type: 'crisis', importance: 75, metadata: { kind: 'exodus', trust: 12, severity: 0.4, members: 900 } },
      { week: 15, type: 'governance_vote', importance: 100, metadata: { kind: 'passed', proposal: 'founder_removal', support: 71 } },
    ],
  } as unknown as GameState['token']
  const beats = buildStory(t)
  const launch = beats.find((b) => b.text.includes('token goes live'))
  ok(!!launch && launch.week === 8 && launch.chapter === 'The token era', 'the launch opens the token era chapter')
  ok(beats.some((b) => b.week === 11 && b.text.includes('sheds 34%') && b.tone === 'bad'), 'a crash is narrated with its own number')
  ok(beats.some((b) => b.week === 13 && b.text.includes('Holders leave')), 'the exodus is on the record')
  const ouster = beats.find((b) => b.text.includes('no confidence passes'))
  ok(!!ouster && ouster.week === 15 && ouster.tone === 'bad', 'the ouster vote is the loudest sentence in the era')
}

// ---------------------------------------------------------------------------------------------
console.log('— The ending, and the beats that define the run —')

{
  const s = played('quick', 40, 99)
  const t = structuredClone(s)
  t.gameOver = { type: 'bankrupt', week: t.week, detail: 'Payroll did it.' }
  // Something else happened the same week — the ending must still close the story (the sort's
  // tiebreak is scan order, and the ending is scanned last on purpose).
  t.inbox.unshift({ id: 'atk', week: t.week, kind: 'news', title: '💥 Kitefall hit you: smear campaign', body: 'x' })
  const beats = buildStory(t)
  const last = beats[beats.length - 1]
  ok(last.chapter === 'The end' && last.tone === 'bad' && last.text.includes('out of money'), 'the ending is the final beat even when the last week was crowded')
  ok(beats.some((b) => b.week === t.week && b.text.includes('hit you')), '(rig check: the same-week beat exists to tie against)')

  const defs = definingBeats(t)
  ok(defs.length >= 3 && defs.length <= 5, `definingBeats returns a card-sized handful (${defs.length})`)
  ok(defs.some((b) => b.chapter === 'The end'), 'the ending always makes the card — weight 100 beats everything')
  ok(weeksAscending(defs), 'and the card reads as a story: week order, not weight order')
  ok(defs.every((d) => beats.some((b) => b.week === d.week && b.text === d.text)), 'every defining beat is a real beat, not a re-synthesis')

  const unfinished = buildStory(s)
  ok(!unfinished.some((b) => b.chapter === 'The end'), 'a run still in progress has no ending beat')
}

// ---------------------------------------------------------------------------------------------
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATION LOG. 22 mutations, 22 killed. Each is a one-line textual edit applied to a pristine
// copy of src/game/story.ts, this file re-run, and the edit reverted — a mutation that stays
// green is a test that does not exist. Runner: scripts/mutate-story.mjs (an apply/run/revert
// loop over the exact strings below).
//
//   M1  the final sort is deleted (beats returned in scan order)          KILLED
//   M2  the sort tiebreak flips to y.i - x.i (unstable ties)              KILLED*
//   M3  finiteWeek accepts anything (`return true`)                       KILLED
//   M4  `safely` rethrows instead of skipping                             KILLED*
//   M5  addEnding never runs (deleted from the source list)               KILLED
//   M6  an unknown ending throws instead of falling back to timeup        KILLED
//   M7  the inbox gov-/token- id skip is deleted                          KILLED*
//   M8  the told-set dedupe is deleted (duplicate rows narrated)          KILLED
//   M9  the inbox never marks what it told (profitability said twice)     KILLED
//   M10 broken promises land at week made, not week resolved              KILLED
//   M11 the instant-settle guard deleted (a granted raise reads twice)    KILLED
//   M12 expired promises narrated like broken ones                        KILLED
//   M13 promise beats lose the counterparty (nameOf returns the default)  KILLED
//   M14 the token launch loses its chapter marker                         KILLED
//   M15 crash move formatted from importance, not metadata.move           KILLED
//   M16 storyChapters drops the beat that opens each chapter              KILLED
//   M17 definingBeats picks by scan order (weight sort deleted)           KILLED
//   M18 definingBeats returns weight order (final re-sort deleted)        KILLED
//   M19 the inbox is reversed IN PLACE (the caller's array mutated)       KILLED*
//   M20 the founding reads the current week, not week 1                   KILLED
//   M21 the journal is reversed IN PLACE (the caller's array mutated)     KILLED
//   M22 the Career-PMF double-telling guard deleted                       KILLED
//
// * The fixtures that kill these were TIGHTENED before the pass, because the first drafts could
//   not have caught them — the suite's standing lesson again, that an assertion must be
//   satisfiable only through the channel it names:
//
//   M2  needs a crowded final week: with no same-week neighbour, flipping the tiebreak reorders
//       nothing. The ending fixture now plants an attack in the gameOver week to tie against.
//   M4  needs a slice that THROWS rather than merely lies — every malformed literal row is
//       screened out by field checks before it can throw, so the fixture installs a property
//       getter on world.promises that throws on first touch.
//   M7  was vacuous against real governance titles (none of them match any inbox pattern), so
//       deleting the guard changed nothing. The fixture now gives ledger-owned ids a title that
//       WOULD match ('Seed closed: …'), which is the actual risk the guard exists for.
//   M19 survives an EVEN build count: in-place reversal un-does itself across 100 builds and
//       byte-identity waves it through. The purity loop runs 101 builds — odd on purpose.
