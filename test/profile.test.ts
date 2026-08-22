// Profiles: the nickname rule, the hostile-row coercer, and the SQL↔client drift guard.
// Run: npx tsx test/profile.test.ts
import { readFileSync } from 'node:fs'
import { NICKNAME_RULE, coerceProfileRow, nicknameProblem } from '../src/net/profile'

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
ok(!('company' in (p.bests.quick as object)), 'company names never round-trip through the public row')
ok(p.bests.career === undefined, 'NaN score drops the entry')
ok(!('invented_mode' in p.bests), 'unknown modes are ignored')
ok(p.createdAt === '', 'non-string created_at coerces to empty')

console.log('— Privacy: the profile surface has no field for a real name or email —')
const profileCode = readFileSync('src/net/profile.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
ok(!/email/i.test(profileCode), 'profile.ts CODE never touches email (comments may explain why)')
ok(!sql.includes('full_name') || sql.includes('REAL NAME MUST NOT APPEAR'), 'the SQL touches full_name only inside the self-test that asserts it is never copied')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
