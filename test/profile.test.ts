// Profiles: the nickname rule, the hostile-row coercer, and the SQL↔client drift guard.
// Run: npx tsx test/profile.test.ts
import { readFileSync } from 'node:fs'
import { HALL_LIMIT, NICKNAME_RULE, coerceProfileRow, mergeHalls, nextRunCount, nicknameProblem } from '../src/net/profile'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

console.log('— The nickname rule is ONE rule, defined twice, asserted identical —')
// The client mirrors the server CHECK so the player is told before the database is. Two copies
// of a rule drift — this repo shipped a leaderboard policy that rejected every real player three
// times — so the copies are asserted character-identical against the actual SQL file.
const sql = readFileSync('supabase/profiles-v1.sql', 'utf8')
const sqlRegex = sql.match(/nickname ~ '([^']+)'/)?.[1]
ok(!!sqlRegex, 'the SQL file declares the nickname CHECK regex')
ok(sqlRegex === NICKNAME_RULE.source, `client regex matches the SQL CHECK exactly (${NICKNAME_RULE.source})`)
// the second half of the rule: consecutive spaces render collapsed in HTML, so a doubled-space
// name IS a visual impersonation — both sides must ban it, and both are asserted here
ok(sql.includes("nickname !~ '  '"), 'the SQL CHECK bans consecutive spaces')
ok(nicknameProblem('Quiet  Falcon 42') !== null, 'the client bans consecutive spaces too')

console.log('— Nickname validation —')
for (const good of ['Quiet Falcon 42', 'abc', 'A_B-C.99', 'x'.repeat(24), 'Harris']) {
  ok(nicknameProblem(good) === null && NICKNAME_RULE.test(good), `accepts ${JSON.stringify(good)}`)
}
for (const bad of ['ab', 'x'.repeat(25), ' leading', 'trailing ', '<script>', 'naïve', 'emoji 🦄', 'semi;colon', 'a\nb', '', 'two  spaces']) {
  ok(nicknameProblem(bad) !== null, `refuses ${JSON.stringify(bad)}`)
}

console.log('— The coercer treats server rows as hostile —')
ok(coerceProfileRow(null) === null, 'null row → null')
ok(coerceProfileRow({ user_id: 42 as never, nickname: 'x' }) === null, 'non-string user_id → null')
const p = coerceProfileRow({
  user_id: 'u1',
  nickname: 'x'.repeat(500),
  avatar_url: 'javascript:alert(1)',
  achievements: ['ok-badge', 42, 'x'.repeat(500), { evil: true }],
  bests: {
    quick: { score: '1e6', weeks: -5, ending: 'x'.repeat(200), company: 'y'.repeat(200), at: 'NaN' },
    career: { score: Number.NaN },
    invented_mode: { score: 999 },
  },
  created_at: 12345,
})!
ok(p.nickname.length <= 24, 'oversize nickname is truncated')
ok(p.avatar === null, 'javascript: avatar is dropped')
ok(p.achievements.length === 1 && p.achievements[0] === 'ok-badge', 'badge list keeps only sane string ids')
ok(!!p.bests.quick && p.bests.quick.score === 1e6 && p.bests.quick.weeks === 0, 'numeric strings coerce, negatives clamp')
ok(p.bests.quick!.ending.length <= 24, 'best strings are bounded')
// owner decision 2026-08-23 (profiles-v2): history belongs to the profile, company names are
// the history — they now travel, scrubbed and bounded like every leaderboard string
ok(p.bests.quick!.company!.length === 40, 'company names round-trip, truncated to 40')
ok(p.bests.career === undefined, 'NaN score drops the entry')
ok(!('invented_mode' in p.bests), 'unknown modes are ignored')
ok(p.createdAt === '', 'non-string created_at coerces to empty')
ok(p.hall.length === 0 && p.runCount === 0, 'a v1 row (no hall/run_count columns) coerces to empty history')

console.log('— The hall coercer treats server rows as hostile —')
const h = coerceProfileRow({
  user_id: 'u1',
  nickname: 'ok',
  hall: [
    { company: 'Honest Co', sector: 'B2B SaaS', ending: 'acquired', weeks: 80, score: 5e6, at: 1755800000000 },
    { company: 'evil‮name', sector: 'x'.repeat(200), ending: 'unicorn', weeks: -3, score: '2e6', at: 'NaN' },
    { company: 'Too Rich', score: 1e30 }, // absurd score → dropped entirely
    { company: 'No Score' },
    'not an object',
    null,
  ],
  run_count: '17.9',
})!
ok(h.hall.length === 2, 'junk hall entries are dropped, sane ones survive')
ok(h.hall[0].company === 'Honest Co' && h.hall[0].score === 5e6, 'hall sorts by score desc')
ok(!h.hall[1].company.includes('‮'), 'bidi overrides are scrubbed from company names')
ok(h.hall[1].sector.length <= 24 && h.hall[1].weeks === 0 && h.hall[1].score === 2e6, 'hall strings bounded, numbers clamped and coerced')
ok(h.runCount === 18, 'run_count coerces to a bounded integer')
ok(coerceProfileRow({ user_id: 'u1', nickname: 'ok', run_count: 1e12 })!.runCount === 1_000_000, 'absurd run_count clamps to the cap')

console.log('— The hall merge: union by run identity, nothing lost, nothing doubled —')
const runA = { company: 'Alpha', sector: 'Fintech', ending: 'ipo', weeks: 60, score: 9e6, at: 100 }
const runB = { company: 'Beta', sector: 'Social App', ending: 'bankrupt', weeks: 12, score: 0, at: 200 }
const m1 = mergeHalls([runA], [runB, runA]) // A known remotely arrives again locally
ok(m1.length === 2, 'the same run on both sides counts once')
const m2 = mergeHalls([{ ...runA, at: 0 }], [runA]) // pre-v2 remote copy has no timestamp
ok(m2.length === 1 && m2[0].at === 100, 'a run with and without a timestamp is ONE run, and the timestamp wins')
// review fix 2026-08-23: stats alone are NOT identity — every bankruptcy scores 0 and players
// reuse names, so two same-stats runs finished at different times are two runs
const m2b = mergeHalls([runB], [{ ...runB, at: 300 }])
ok(m2b.length === 2, 'two stat-twin runs with different timestamps BOTH survive')
ok(mergeHalls([], [{ ...runB, at: 0 }, { ...runB, at: 0 }]).length === 1, 'two timestampless stat-twins collapse (pre-v2 data cannot tell them apart)')
const many = Array.from({ length: 15 }, (_, i) => ({ ...runA, company: `Co ${i}`, score: i * 1000 }))
const m3 = mergeHalls([], many)
ok(m3.length === HALL_LIMIT && m3[0].score === 14000, `an overfull merge keeps the best ${HALL_LIMIT}`)
ok(mergeHalls([runA], ['garbage', { score: -5 }]).length === 1, 'local garbage cannot poison the merged hall')

console.log('— The run counter: deltas, not max() — concurrent devices all count —')
ok(nextRunCount(5, 3, null) === 5, 'first sync ever: high-water fallback (overlap unknowable)')
ok(nextRunCount(8, 6, 5) === 9, "a run recorded while the other device pushed 3 still counts (server 8 + phone's 1)")
ok(nextRunCount(20, 1, 0) === 21, 'a fresh device with base 0 adds its run to the shared 20')
ok(nextRunCount(5, 5, 5) === 5, 'nothing new locally adds nothing')
ok(nextRunCount(5, 3, 9) === 5, 'a local count BELOW its own base never subtracts')
ok(nextRunCount(999_999_999, 1, 0) === 1_000_000, 'the counter clamps to the same cap the server enforces')

console.log('— SQL↔client drift guard, v2 —')
const sqlV2 = readFileSync('supabase/profiles-v2-history.sql', 'utf8')
ok(sqlV2.includes("jsonb_typeof(hall) = 'array'") && sqlV2.includes('pg_column_size(hall) <= 8192'), 'the v2 SQL bounds the hall blob')
ok(sqlV2.includes('run_count >= 0 and run_count <= 1000000'), 'the v2 SQL bounds the counter to the same cap the client clamps to')
ok(sqlV2.includes('grant update (hall, run_count)'), 'the v2 SQL grants updates on exactly the new columns')

console.log('— Privacy: the profile surface has no field for a real name or email —')
const profileCode = readFileSync('src/net/profile.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
ok(!/email/i.test(profileCode), 'profile.ts CODE never touches email (comments may explain why)')
ok(!sql.includes('full_name') || sql.includes('REAL NAME MUST NOT APPEAR'), 'the SQL touches full_name only inside the self-test that asserts it is never copied')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
