// Mutation runner for src/game/story.ts — apply one-line edit, run test/story.test.ts, revert.
// A mutation that stays green is a test that does not exist. Used to write the ledger at the
// bottom of test/story.test.ts; not part of any npm script.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const FILE = 'src/game/story.ts'
const pristine = readFileSync(FILE, 'utf8')

const mutations = [
  ['M1  the final sort is deleted (beats returned in scan order)',
    ".sort((x, y) => x.b.week - y.b.week || x.i - y.i)", ".sort(() => 0)"],
  ['M2  the sort tiebreak flips (unstable ties)',
    "x.b.week - y.b.week || x.i - y.i", "x.b.week - y.b.week || y.i - x.i"],
  ['M3  finiteWeek accepts anything',
    "const finiteWeek = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0",
    "const finiteWeek = (v: unknown): v is number => true"],
  ['M4  `safely` rethrows instead of skipping',
    "    } catch {\n      /* a malformed slice is skipped, never thrown over */\n    }",
    "    } catch (e) {\n      throw e\n    }"],
  ['M5  addEnding never runs',
    "  safely(() => addEnding(s, add))", "  "],
  ['M6  an unknown ending throws instead of falling back',
    "const def = ENDING_TEXT[str(go.type) as EndingType] ?? ENDING_TEXT.timeup",
    "const def = ENDING_TEXT[str(go.type) as EndingType]"],
  ['M7  the gov-/token- mail skip is deleted',
    "    if (id.startsWith('gov-') || id.startsWith('token-')) continue", "    "],
  ['M8  the told-set dedupe is deleted (duplicates narrated)',
    "    if (told.has(type)) continue", "    "],
  ['M9  the inbox never marks what it told',
    "      if (MILESTONE_COVERS[title]) told.add(MILESTONE_COVERS[title])", "      "],
  ['M10 broken promises land at week made, not week resolved',
    "      if (status === 'kept') add(raw.resolvedWeek, `Promise kept: ${promisePhrase(key, facts)} was delivered.`, 'good', 52)\n      else add(raw.resolvedWeek, `Promise broken: ${promisePhrase(key, facts)} — and ${who} remembers.`, 'bad', 64)",
    "      if (status === 'kept') add(raw.resolvedWeek, `Promise kept: ${promisePhrase(key, facts)} was delivered.`, 'good', 52)\n      else add(raw.week, `Promise broken: ${promisePhrase(key, facts)} — and ${who} remembers.`, 'bad', 64)"],
  ['M11 the instant-settle guard deleted (a granted raise reads twice)',
    "      if (raw.resolvedWeek === raw.week) continue", "      "],
  ['M12 expired promises narrated like broken ones',
    "    if ((status === 'kept' || status === 'broken') && finiteWeek(raw.resolvedWeek)) {",
    "    if ((status === 'kept' || status === 'broken' || status === 'expired') && finiteWeek(raw.resolvedWeek)) {"],
  ['M13 promise beats lose the counterparty',
    "    return full || 'the board'", "    return 'the board'"],
  ['M14 the token launch loses its chapter marker',
    "'good', 85, 'The token era')", "'good', 85)"],
  ['M15 crash move read from importance, not metadata.move',
    "      const move = Math.abs(Math.round(numOr(md.move, 0) * 100))",
    "      const move = Math.abs(Math.round(importance))"],
  ['M16 storyChapters drops the beat that opens each chapter',
    "      current = { title: b.chapter, beats: [] }\n    }\n    current.beats.push(b)",
    "      current = { title: b.chapter, beats: [] }\n      continue\n    }\n    current.beats.push(b)"],
  ['M17 definingBeats picks by scan order (weight sort deleted)',
    ".sort((x, y) => y.b.weight - x.b.weight || x.i - y.i)", ""],
  ['M18 definingBeats returns weight order (final re-sort deleted)',
    "    .slice(0, n)\n    .sort((x, y) => x.i - y.i)", "    .slice(0, n)"],
  ['M19 the inbox is reversed IN PLACE (caller array mutated)',
    "  for (const raw of [...inbox].reverse()) {", "  for (const raw of inbox.reverse()) {"],
  ['M20 the founding reads the current week, not week 1',
    "  add(1, `${name} opens for business in ${sector}", "  add(s.week, `${name} opens for business in ${sector}"],
  ['M21 the journal is reversed IN PLACE (caller array mutated)',
    "  for (const raw of [...journal].reverse()) {", "  for (const raw of (journal as unknown[]).reverse()) {"],
  ['M22 the PMF double-telling guard deleted',
    "      if (pmf && careerTellsPmf) continue", "      "],
]

const results = []
for (const [name, from, to] of mutations) {
  if (!pristine.includes(from)) {
    results.push(`${name}  ✗ PATTERN NOT FOUND`)
    console.log(results[results.length - 1])
    continue
  }
  writeFileSync(FILE, pristine.replace(from, to))
  let killed = false
  try {
    execSync('npx tsx test/story.test.ts', { stdio: 'pipe', timeout: 600000 })
  } catch {
    killed = true
  }
  writeFileSync(FILE, pristine)
  results.push(`${name}  ${killed ? 'KILLED' : '⚠ SURVIVED'}`)
  console.log(results[results.length - 1])
}
writeFileSync(FILE, pristine)
console.log('\n--- summary ---')
for (const r of results) console.log(r)
