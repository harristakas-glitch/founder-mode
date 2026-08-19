// End-to-end tests for src/net/leaderboard.ts against the REAL production Supabase project.
// Uses day=10001, which the currently-deployed v4 policy accepts, so the honest path is
// exercisable before leaderboard-v6.sql is applied.
import assert from 'node:assert'

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const U = 'https://rgxwsffpfsvcpqgvogkl.supabase.co'
const K = 'sb_publishable_Z7TmXookH7bLzesT4ohNLA_6DWmmU_r'
const DAY = 10001
const tag = Math.random().toString(36).slice(2, 8)

const warnings: string[] = []
const realWarn = console.warn
console.warn = (...a: unknown[]) => {
  warnings.push(a.join(' '))
  realWarn('      >', ...a)
}

const { submitDailyScore, fetchDailyTop } = await import('/Users/charilaostakas/Claude/game/src/net/leaderboard.ts')
const { myId } = await import('/Users/charilaostakas/Claude/game/src/net/online.ts')

const rest = async (path: string, init: RequestInit & { secret?: string } = {}) => {
  const h: Record<string, string> = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
  if (init.secret) h['x-player-secret'] = init.secret
  const r = await fetch(`${U}/rest/v1/${path}`, { ...init, headers: h })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

let passed = 0
const ok = (name: string) => {
  passed++
  console.log('  ok  ' + name)
}

console.log('\n--- A. client-side validation refuses malformed rows before the network ---')
{
  warnings.length = 0
  store.set('founder-mode-player-id', `SECTEST-val-${tag}`)
  await submitDailyScore(DAY, { company: 'X', score: 1, weeks: 1, ending: 'exploded' })
  assert.ok(warnings.some((w) => w.includes('unknown ending')), 'bad ending is refused locally')
  ok('an ending the database would reject never leaves the client')

  warnings.length = 0
  await submitDailyScore(0, { company: 'X', score: 1, weeks: 1, ending: 'ipo' })
  assert.ok(warnings.some((w) => w.includes('nonsense day')), 'day 0 is refused locally')
  ok('a nonsense day never leaves the client')

  const none = await rest(`daily_scores?select=player_id&player_id=eq.SECTEST-val-${tag}`)
  assert.deepStrictEqual(none.body, [], 'nothing was written')
  ok('and nothing reached the database')
}

console.log('\n--- B. failures are reported instead of swallowed ---')
{
  // day 7 is what the game really sends today; the live v4 policy rejects it. This is the
  // outage, reproduced through the actual client code path.
  warnings.length = 0
  store.set('founder-mode-player-id', `SECTEST-outage-${tag}`)
  store.set('founder-mode-score-secret', `outage-secret-${tag}-0000000000000`)
  await submitDailyScore(7, { company: 'Real Co', score: 4200, weeks: 40, ending: 'unicorn' })
  assert.ok(
    warnings.some((w) => w.includes('rejected') && w.includes('42501')),
    `expected an RLS rejection to be logged, got: ${JSON.stringify(warnings)}`,
  )
  ok("today's real challenge number is rejected by the live policy, and now says so out loud")

  assert.ok(!warnings.some((w) => w.includes('fresh identity')), 'a policy refusal must NOT rotate the identity')
  ok('a generic policy refusal does not destroy the player identity (regression)')
}

console.log('\n--- C. the honest path still works ---')
{
  warnings.length = 0
  const id = `SECTEST-honest-${tag}`
  store.set('founder-mode-player-id', id)
  store.set('founder-mode-score-secret', `honest-secret-${tag}-00000000000000`)

  await submitDailyScore(DAY, { company: 'Honest Inc', score: 1000, weeks: 20, ending: 'unicorn' })
  let row = (await rest(`daily_scores?select=score,company&day=eq.${DAY}&player_id=eq.${id}`)).body
  assert.strictEqual(row.length, 1, 'the row was written')
  assert.strictEqual(row[0].score, 1000)
  ok('a first submission is stored')

  await submitDailyScore(DAY, { company: 'Honest Inc', score: 5000, weeks: 22, ending: 'unicorn' })
  row = (await rest(`daily_scores?select=score&day=eq.${DAY}&player_id=eq.${id}`)).body
  assert.strictEqual(row[0].score, 5000, 'the better score replaced it')
  ok('the same device can improve its own score')

  await submitDailyScore(DAY, { company: 'Honest Inc', score: 12, weeks: 2, ending: 'bankrupt' })
  row = (await rest(`daily_scores?select=score&day=eq.${DAY}&player_id=eq.${id}`)).body
  assert.strictEqual(row[0].score, 5000, 'a worse score did not overwrite it')
  ok('a worse score is kept out')

  assert.deepStrictEqual(warnings, [], `honest path logged nothing: ${JSON.stringify(warnings)}`)
  ok('and the honest path produced no errors at all — no rotation, no refusal')

  const top = await fetchDailyTop(DAY, 50)
  assert.ok(top.some((t) => t.player_id === id && t.score === 5000), 'it shows on the leaderboard')
  ok('the score is readable back through fetchDailyTop')
}

console.log('\n--- D. squatting: the live vulnerability, and the v5 recovery ---')
{
  warnings.length = 0
  const squatted = `SECTEST-squat-${tag}`
  store.set('founder-mode-player-id', squatted)
  store.set('founder-mode-score-secret', `victim-secret-${tag}-00000000000000`)

  // an attacker gets there first, under a secret the victim does not have
  const squat = await rest('daily_scores', {
    method: 'POST',
    secret: `attacker-secret-${tag}-000000000000`,
    body: JSON.stringify({
      day: DAY,
      player_id: squatted,
      company: 'Squatter',
      score: 5,
      weeks: 1,
      ending: 'bankrupt',
      display_name: null,
      secret: `attacker-secret-${tag}-000000000000`,
    }),
  })
  assert.strictEqual(squat.status, 201, 'the squat itself succeeds against the live v4 policy')
  ok('LIVE: an attacker can take an id it does not own (the vulnerability v5 closes)')

  await submitDailyScore(DAY, { company: 'Victim Inc', score: 9000, weeks: 30, ending: 'unicorn' })
  const mine = (await rest(`daily_scores?select=company&day=eq.${DAY}&player_id=eq.${squatted}`)).body
  assert.strictEqual(mine[0].company, 'Squatter', 'the victim is locked out of their own id')
  ok('LIVE: the victim is locked out, and the client now logs it instead of failing silently')

  // Simulate what leaderboard-v6.sql returns for this case, and check the client recovers.
  warnings.length = 0
  const before = myId()
  const realFetch = globalThis.fetch
  let injected = false
  globalThis.fetch = (async (url: any, init: any) => {
    if (!injected && String(init?.method).toUpperCase() === 'POST') {
      injected = true
      return new Response(JSON.stringify({ code: '42501', message: 'daily_scores: player_id is registered to another device' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return realFetch(url, init)
  }) as typeof fetch
  try {
    await submitDailyScore(DAY, { company: 'Victim Inc', score: 9100, weeks: 31, ending: 'unicorn' })
  } finally {
    globalThis.fetch = realFetch
  }

  assert.ok(injected, 'the v5 error was actually delivered')
  assert.ok(warnings.some((w) => w.includes('fresh identity')), `expected a recovery, got ${JSON.stringify(warnings)}`)
  const fresh = myId()
  assert.notStrictEqual(fresh, before, 'a new id was minted')
  const retry = (await rest(`daily_scores?select=score,company&day=eq.${DAY}&player_id=eq.${fresh}`)).body
  assert.strictEqual(retry.length, 1, 'the retry landed under the new identity')
  assert.strictEqual(retry[0].score, 9100)
  ok('v5 SIMULATED: the client rotates its identity and the player still gets on the board')

  const stolen = (await rest(`daily_scores?select=company,score&day=eq.${DAY}&player_id=eq.${squatted}`)).body
  assert.strictEqual(stolen[0].company, 'Squatter', "the attacker's row was NOT overwritten")
  assert.strictEqual(stolen[0].score, 5)
  ok("and never tampers with the other row on its way out")
}

console.log('\n--- E. the anon key cannot destroy anything ---')
{
  const before = (await rest(`daily_scores?select=player_id&day=eq.${DAY}`)).body.length
  assert.ok(before > 0, 'there is something to try to destroy')
  // PostgREST answers 204/200 with an empty body even when RLS matched no rows, so the status
  // proves nothing. Only the row count does.
  const del = await rest(`daily_scores?day=eq.${DAY}`, { method: 'DELETE', headers: {} as any })
  const after = (await rest(`daily_scores?select=player_id&day=eq.${DAY}`)).body
  assert.strictEqual(after.length, before, `anon DELETE removed rows (status ${del.status})`)
  ok(`anon DELETE of the whole day removes nothing — all ${before} rows survive`)

  const wipe = await rest('daily_scores?player_id=neq.__none__', { method: 'DELETE' })
  const total = (await rest('daily_scores?select=count', {})).body
  assert.ok(total[0].count >= before, `a table-wide wipe removed rows (status ${wipe.status})`)
  ok('and a table-wide wipe attempt removes nothing either')
}

console.log(`\n${passed} assertions passed`)
console.log(`\nNOTE: test rows tagged SECTEST-*${tag} remain on day ${DAY}; supabase/leaderboard-v6.sql §0 removes them.\n`)
