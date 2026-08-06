// Run AFTER applying supabase/leaderboard-secure.sql.
// Replays the exact attack that defeated v2, plus the legit flows, and reports pass/fail.
import { createClient } from '@supabase/supabase-js'
const URL = 'https://rgxwsffpfsvcpqgvogkl.supabase.co'
const KEY = 'sb_publishable_Z7TmXookH7bLzesT4ohNLA_6DWmmU_r'
const DAY = 30777
const ME = 'v3-owner-' + Date.now().toString(36)
const MY_SECRET = 'owner-secret-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)

const results = []
const check = (n, pass, d = '') => { results.push({ n, pass }); console.log(`  ${pass ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`) }

const owner = createClient(URL, KEY, { global: { headers: { 'x-player-secret': MY_SECRET } } })
const anon = createClient(URL, KEY)

// legit: insert
const ins = await owner.from('daily_scores').insert({ day: DAY, player_id: ME, company: 'HonestCo', score: 500, weeks: 52, ending: 'unicorn', display_name: 'honest', secret: MY_SECRET })
check('owner can submit a score', !ins.error, ins.error?.message ?? '')

// the secret must be unreadable
const leak = await anon.from('daily_scores').select('player_id, secret').eq('day', DAY)
check('secret column is NOT readable', !!leak.error || !leak.data?.[0]?.secret, leak.error ? 'blocked: ' + leak.error.message.slice(0, 50) : 'LEAKED: ' + JSON.stringify(leak.data?.[0]))

// the v2 attack: read the public id, echo it back, edit the row
const { data: board } = await anon.from('daily_scores').select('player_id, company, score').eq('day', DAY)
const stolenId = board?.[0]?.player_id
const attacker = createClient(URL, KEY, { global: { headers: { 'x-player-id': stolenId, 'x-player-secret': stolenId } } })
await attacker.from('daily_scores').update({ score: 0, company: 'PWNED' }).eq('day', DAY).eq('player_id', stolenId)
const a1 = await anon.from('daily_scores').select('company, score').eq('day', DAY).eq('player_id', stolenId).maybeSingle()
check('knowing player_id no longer grants edit rights', a1.data?.score === 500 && a1.data?.company === 'HonestCo', `score=${a1.data?.score} company=${a1.data?.company}`)

// pseudo-delete attempt
await attacker.from('daily_scores').update({ day: 39997 }).eq('day', DAY).eq('player_id', stolenId)
const a2 = await anon.from('daily_scores').select('player_id').eq('day', DAY)
check('row cannot be moved off its leaderboard', (a2.data?.length ?? 0) === 1, `rows on day ${DAY}: ${a2.data?.length}`)

// owner lowering own score (trigger should block)
const low = await owner.from('daily_scores').update({ score: 1 }).eq('day', DAY).eq('player_id', ME)
const a3 = await anon.from('daily_scores').select('score').eq('day', DAY).eq('player_id', ME).maybeSingle()
check('score cannot be lowered even by the owner', a3.data?.score === 500, `score=${a3.data?.score}${low.error ? ' (rejected: ' + low.error.message.slice(0, 40) + ')' : ''}`)

// legit: owner raises own score
const up = await owner.from('daily_scores').update({ score: 900 }).eq('day', DAY).eq('player_id', ME)
const a4 = await anon.from('daily_scores').select('score').eq('day', DAY).eq('player_id', ME).maybeSingle()
check('owner CAN still improve their score', a4.data?.score === 900, `score=${a4.data?.score}${up.error ? ' err=' + up.error.message.slice(0, 40) : ''}`)

// absurd score
const absurd = await owner.from('daily_scores').insert({ day: DAY, player_id: 'v3-cheat-' + Date.now(), company: 'Cheat', score: 999999999999999, weeks: 52, ending: 'unicorn', secret: MY_SECRET })
check('absurd score rejected', !!absurd.error, absurd.error?.message?.slice(0, 50) ?? 'ACCEPTED')

// insert without a secret
const noSecret = await anon.from('daily_scores').insert({ day: DAY, player_id: 'v3-nosecret-' + Date.now(), company: 'NoSecret', score: 10, weeks: 5, ending: 'timeup' })
check('insert without a secret rejected', !!noSecret.error, noSecret.error?.message?.slice(0, 50) ?? 'ACCEPTED')

// oversized player_id
const big = await owner.from('daily_scores').insert({ day: DAY, player_id: 'X'.repeat(5000), company: 'Big', score: 10, weeks: 5, ending: 'timeup', secret: MY_SECRET })
check('oversized player_id rejected', !!big.error, big.error?.message?.slice(0, 50) ?? 'ACCEPTED')

const failed = results.filter((r) => !r.pass)
console.log(`\n  test rows left on day ${DAY} — clean up with:`)
console.log(`  delete from public.daily_scores where day >= 30000;`)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
