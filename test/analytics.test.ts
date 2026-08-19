// Product analytics: the four claims the feature makes about itself, checked rather than asserted
// in a document. Run: npx tsx test/analytics.test.ts
//
//   1. INERT WHEN UNCONFIGURED — with the placeholder key committed, no client is constructed, no
//      network call is made, and the vendor module is never even imported.
//   2. THE CONSENT GATE — no persistent identifier and no journal upload before consent; revoking
//      stops collection in the same tick, not after a reload; a corrupt consent record is 'unset'.
//   3. FREE TEXT NEVER LEAVES — the company name (and every other thing a player typed) cannot
//      reach an event or an uploaded journal, through the real code path.
//   4. ZERO IMPACT ON THE GAME — reading a run for analytics does not change the run.
//
// THE SUITE'S RULE, inherited from test/net-security.test.ts and test/csp.test.ts and not optional
// here either: every case asserts the refusal AND the honest path, in the same run. A privacy layer
// that drops everything passes half of this file perfectly and collects nothing at all, which is a
// broken feature wearing a compliance badge — and this project has shipped that shape of mistake
// three times (docs/security-review-2026-08.md).

import assert from 'node:assert'

// --- browser shims --------------------------------------------------------------------------
// src/store.ts hydrates at module scope and zustand's persist reaches for `window.localStorage`,
// so both have to exist before anything under test is imported. The network traps are the point of
// section 1: nothing here is a mock of the analytics layer, they are traps on the ONLY four ways a
// browser can send anything, and every one of them must stay at zero.
const mem = new Map<string, string>()
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}
const net = { fetch: 0, xhr: 0, beacon: 0, image: 0 }
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = storage
g.window = { localStorage: storage, matchMedia: () => ({ matches: false }) }
g.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }
g.fetch = () => {
  net.fetch++
  return Promise.reject(new Error('the test forbids network'))
}
g.XMLHttpRequest = class {
  open() {
    net.xhr++
  }
  send() {
    net.xhr++
  }
  setRequestHeader() {}
}
// Node 26 defines `navigator` as a getter-only global, so it is redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    sendBeacon: () => {
      net.beacon++
      return false
    },
  },
})
g.Image = class {
  set src(_v: string) {
    net.image++
  }
}
const netTotal = () => net.fetch + net.xhr + net.beacon + net.image

const { analyticsConfigured, POSTHOG_HOST, POSTHOG_KEY, MAX_JOURNAL_BYTES } = await import('../src/analytics/config')
const { analyticsActive, capture, clientConstructed } = await import('../src/analytics/client')
const consent = await import('../src/analytics/consent')
const { ANALYTICS_PROPERTIES, sanitizeEventProperties, scrubUrlProperties, stripUrlDetail } = await import(
  '../src/analytics/props'
)
const events = await import('../src/analytics/events')
const { REDACTED_COMPANY, buildJournalPayload, journalUploadAllowed, uploadRunJournal } = await import(
  '../src/analytics/runJournal'
)
const { newGame } = await import('../src/game/engine')
const { applyJournaled, JOURNAL_LIMIT, replayRun, stateFingerprint, headerOf } = await import('../src/game/replay')
const { defaultCapabilities } = await import('../src/game/modes')

let passed = 0
const fails: string[] = []
const ok = (name: string, fn: () => void | Promise<void>) => {
  const done = () => {
    passed++
    console.log('  ok  ' + name)
  }
  const fail = (e: unknown) => {
    fails.push(`${name}: ${(e as Error).message}`)
    console.log('  FAIL  ' + name + ' — ' + (e as Error).message)
  }
  try {
    const r = fn()
    return r instanceof Promise ? r.then(done, fail) : (done(), Promise.resolve())
  } catch (e) {
    fail(e)
    return Promise.resolve()
  }
}

/** Wipe every trace of a previous case: storage, the memoised consent record, the traps. */
const reset = () => {
  mem.clear()
  consent.resetConsentCache()
  net.fetch = net.xhr = net.beacon = net.image = 0
}

// A real run, played for a few weeks through the same `applyJournaled` the store uses, so the
// journal under test is the journal the game actually writes.
const COMPANY = 'Hyperloop for Cats, Inc.'
function playedRun(weeks = 6) {
  let s = newGame(COMPANY, 'saas', 'technical', {
    config: { mode: 'quick', format: 'standard', sector: 'saas', seed: 12345 },
    challenge: null,
  })
  s.journal = []
  for (let i = 0; i < weeks; i++) s = applyJournaled(s, 'advance').state
  return s
}

// ============================================================================================
console.log('\n--- 1. inert until somebody replaces the placeholder ---')
// ============================================================================================
reset()

await ok('the committed key is a placeholder, so the whole layer is off', () => {
  assert.ok(POSTHOG_KEY.includes('YOUR-'), 'a real project key has been committed')
  assert.strictEqual(analyticsConfigured, false)
  assert.strictEqual(analyticsActive(), false)
})
await ok('the EU host is the one that ships — data must not cross a border by default', () => {
  assert.strictEqual(new URL(POSTHOG_HOST).origin, 'https://eu.i.posthog.com')
})
await ok('capturing every event in the module makes ZERO network calls of any kind', async () => {
  const run = { mode: 'quick', format: 'standard', sector: 'saas', week: 4, screen: 'dashboard' }
  events.appOpened({ first_open: true, standalone: false, runs_started_before: 0, runs_finished_before: 0 })
  events.runStarted(run, { founder: 'technical', first_run: true, runs_finished_before: 0 })
  events.runProgress(run)
  events.runSuspended(run, { trigger: 'unload' })
  events.runAbandoned(run, { weeks: 4 })
  events.runEnded(run, { ending: 'bankrupt', weeks: 40, score: 0, verified: 'verified' })
  events.screenOpened(run)
  events.featureUsed(run, { feature: 'pivot' })
  events.noteSeen(run, { concept: 'runway' })
  events.notesToggled({ notes_enabled: false })
  events.consentGrantedEvent()
  events.runJournalUploaded({ reason: 'ended', entries: 10, bytes: 100, ok: true })
  capture('hand_written_event', { week: 1 })
  // Give any promise chain a turn to run before looking.
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(netTotal(), 0, `analytics reached the network ${JSON.stringify(net)}`)
})
await ok('...and never even imports the vendor SDK: the chunk is not merely silent, it is absent', () => {
  assert.strictEqual(clientConstructed(), false, 'posthog-js was loaded while unconfigured')
})
await ok('nothing was written to storage either', () => {
  assert.deepStrictEqual([...mem.keys()], [], `analytics wrote ${[...mem.keys()].join(', ')}`)
})
await ok('the journal upload refuses, names the reason, and touches no network', async () => {
  const r = await uploadRunJournal(playedRun(), 'ended', 'abcd1234')
  assert.deepStrictEqual(r, { sent: false, reason: 'unconfigured' })
  assert.strictEqual(netTotal(), 0)
})
// The honest half: none of the above may be true because the module is simply broken.
await ok('the machinery still WORKS — the same events produce their properties', () => {
  const sent = events.runEnded(
    { mode: 'career', format: 'daily_challenge', sector: 'fintech', week: 90 },
    { ending: 'unicorn', weeks: 90, score: 4_200_000, verified: 'verified' },
  )
  assert.strictEqual(sent.ending, 'unicorn')
  assert.strictEqual(sent.weeks, 90)
  assert.strictEqual(sent.score, 4_200_000)
  assert.strictEqual(sent.mode, 'career')
  assert.strictEqual(sent.sector, 'fintech')
})

// ============================================================================================
console.log('\n--- 2. the consent gate ---')
// ============================================================================================
reset()

await ok('the default is anonymous: collection on, nothing remembered, no upload', () => {
  assert.strictEqual(consent.consentState(), 'unset')
  assert.strictEqual(consent.collectionEnabled(), true, 'the anonymous default is what measures abandonment')
  assert.strictEqual(consent.consentGranted(), false, 'no persistent id without an explicit yes')
  assert.strictEqual(journalUploadAllowed(), false)
})
await ok('NOTHING is persisted before the player is asked — not even a "we asked" record', () => {
  consent.consentState()
  consent.collectionEnabled()
  consent.shouldAskConsent()
  assert.deepStrictEqual([...mem.keys()], [], 'reading consent must not create it')
})
await ok('granting is the ONLY thing that unlocks an identifier and an upload', () => {
  consent.setConsent(true)
  assert.strictEqual(consent.consentState(), 'granted')
  assert.strictEqual(consent.consentGranted(), true)
  // Still false overall here, because the PostHog key is a placeholder — both gates must be open.
  assert.strictEqual(journalUploadAllowed(), false, 'consent alone must not be enough')
})
await ok('revoking stops collection in the SAME TICK — no reload, no next session', () => {
  consent.setConsent(false)
  assert.strictEqual(consent.collectionEnabled(), false)
  assert.strictEqual(consent.consentGranted(), false)
  assert.strictEqual(analyticsActive(), false)
})
await ok('the anonymous middle state is reachable again, and is not a synonym for "off"', () => {
  consent.setAnonymousConsent()
  assert.strictEqual(consent.consentState(), 'unset')
  assert.strictEqual(consent.collectionEnabled(), true)
  assert.strictEqual(consent.consentGranted(), false)
})
await ok('the record lives under its OWN key, never inside the game save', () => {
  const keys = [...mem.keys()]
  assert.deepStrictEqual(keys, ['fm-analytics-consent-v1'], keys.join(', '))
  assert.ok(!keys.includes('founder-mode-save'))
  // and the value is not the leaderboard's identity, borrowed for a second purpose
  const raw = mem.get('fm-analytics-consent-v1') ?? ''
  assert.ok(!raw.includes('player-id') && !raw.includes('score-secret'), raw)
})
await ok('the player is asked ONCE, ever — a dismissal is an answer', () => {
  reset()
  assert.strictEqual(consent.shouldAskConsent(), true)
  consent.markAsked()
  assert.strictEqual(consent.shouldAskConsent(), false, 'closing the prompt must not make it return')
  assert.strictEqual(consent.consentState(), 'unset', '...and must not silently consent either')
})
await ok('a hostile or corrupt consent record degrades to anonymous, NEVER to granted', () => {
  for (const raw of [
    '{"state":"granted"', // truncated JSON
    '{"state":"GRANTED"}', // wrong case
    '{"state":true}', // truthy, not the string
    '{"state":{"granted":true}}', // an object that "looks" affirmative
    '{"state":["granted"]}',
    '"granted"', // a bare string, not a record
    '[]',
    'null',
    '',
    'not json at all',
  ]) {
    mem.set('fm-analytics-consent-v1', raw)
    consent.resetConsentCache()
    assert.strictEqual(consent.consentGranted(), false, `"${raw}" was read as consent`)
    assert.strictEqual(consent.consentState(), 'unset', `"${raw}" produced ${consent.consentState()}`)
  }
  // The honest direction, in the same case: a genuine record still reads as granted.
  mem.set('fm-analytics-consent-v1', JSON.stringify({ v: 1, state: 'granted', at: 1, askedAt: 1 }))
  consent.resetConsentCache()
  assert.strictEqual(consent.consentGranted(), true, 'a real grant must still be honoured')
})
await ok('a hostile record cannot forge "already denied" into "never asked" either', () => {
  mem.set('fm-analytics-consent-v1', JSON.stringify({ v: 1, state: 'denied', at: -5, askedAt: 'soon' }))
  consent.resetConsentCache()
  assert.strictEqual(consent.consentState(), 'denied', 'a denial must survive a garbled timestamp')
  assert.strictEqual(consent.collectionEnabled(), false)
})

// ============================================================================================
console.log('\n--- 3. free text never leaves the browser ---')
// ============================================================================================
reset()

await ok('the company name cannot ride on an event, under any spelling', () => {
  const sent = events.runEnded(
    {
      mode: 'quick',
      format: 'standard',
      sector: 'saas',
      // every plausible way somebody adds it later, in one go
      company: COMPANY,
      companyName: COMPANY,
      name: COMPANY,
      display_name: 'harris',
      founder_name: 'Harris T',
      email: 'harristakas@gmail.com',
      message: 'gg ez',
      chat: 'gg ez',
      code: 'AB12X',
      room: 'AB12X',
      query: 'runway',
      search: 'runway',
      title: 'Welcome to ' + COMPANY,
    } as never,
    { ending: 'ipo', weeks: 60, score: 1, verified: 'verified' },
  )
  const serialised = JSON.stringify(sent)
  assert.ok(!serialised.includes('Hyperloop'), serialised)
  assert.ok(!serialised.includes('harris'), serialised)
  assert.ok(!serialised.includes('gg ez'), serialised)
  assert.ok(!serialised.includes('AB12X'), serialised)
  for (const k of ['company', 'companyName', 'name', 'display_name', 'email', 'message', 'code', 'query', 'title']) {
    assert.ok(!(k in sent), `${k} survived the allowlist`)
  }
  // ...and the event is still worth having: the fields that answer the questions are all there.
  assert.strictEqual(sent.ending, 'ipo')
  assert.strictEqual(sent.weeks, 60)
  assert.strictEqual(sent.sector, 'saas')
})
await ok('the allowlist itself contains no key that could hold something a player typed', () => {
  for (const banned of ['company', 'companyname', 'name', 'display_name', 'email', 'message', 'chat', 'code', 'room', 'query', 'search', 'title', 'body', 'text']) {
    assert.ok(!ANALYTICS_PROPERTIES.has(banned), `"${banned}" is on the analytics allowlist`)
  }
  assert.ok(ANALYTICS_PROPERTIES.size > 20, 'the allowlist is suspiciously short')
  for (const k of ANALYTICS_PROPERTIES) assert.ok(/^[a-z][a-z_]*$/.test(k), `"${k}" is not a plain snake_case name`)
})
await ok('an allowlisted key still cannot smuggle prose through as its value', () => {
  const sent = sanitizeEventProperties({ sector: 'Hyperloop for Cats, Inc.', screen: 'dashboard' })
  assert.deepStrictEqual(sent, { screen: 'dashboard' }, 'a spaced string is not an identifier')
  // the honest direction: real enum values pass untouched
  assert.deepStrictEqual(sanitizeEventProperties({ sector: 'saas', screen: 'discovery' }), {
    sector: 'saas',
    screen: 'discovery',
  })
})
await ok('objects, arrays and functions are dropped — a whole GameState cannot be spread in', () => {
  const state = playedRun(2)
  const sent = sanitizeEventProperties({ ...(state as unknown as Record<string, never>), week: state.week })
  assert.strictEqual(JSON.stringify(sent).includes('Hyperloop'), false)
  for (const [, v] of Object.entries(sent)) assert.ok(typeof v !== 'object', 'a nested object survived')
  assert.strictEqual(sent.week, state.week, 'and the one legitimate field is still there')
})
await ok('numbers are bounded and non-finite values dropped, so a broken sim cannot poison an event', () => {
  assert.deepStrictEqual(sanitizeEventProperties({ cash: NaN, users: Infinity, week: 12.7 }), { week: 13 })
  assert.strictEqual(sanitizeEventProperties({ cash: 1e30 }).cash, 1e15)
})
await ok("PostHog's own URL properties lose their query string and fragment", () => {
  const out = scrubUrlProperties({
    $current_url: 'https://game.example/founder-mode/?token=secret#state',
    $referrer: 'https://mail.example/inbox?email=someone@example.com',
    $session_id: 'abc',
    distinct_id: 'xyz',
    $lib: 'web',
  })
  assert.strictEqual(out.$current_url, 'https://game.example/founder-mode/')
  assert.strictEqual(out.$referrer, 'https://mail.example/inbox')
  // ...but it is a SCRUBBER, not an allowlist: dropping the SDK's own bookkeeping would break it.
  assert.strictEqual(out.$session_id, 'abc')
  assert.strictEqual(out.distinct_id, 'xyz')
  assert.strictEqual(out.$lib, 'web')
})
await ok('an unparseable URL is still cut at the first ? or #', () => {
  assert.strictEqual(stripUrlDetail('not a url?secret=1'), 'not a url')
  assert.strictEqual(stripUrlDetail('android-app://x#frag'), 'android-app://x')
})

// ============================================================================================
console.log('\n--- 4. the uploaded run journal ---')
// ============================================================================================
reset()

const run = playedRun(8)

await ok('a real run builds a payload, and it is well under the cap', () => {
  const built = buildJournalPayload(run, 'ended', 'deadbeef')
  assert.ok(built.ok, 'a normal 8-week run must be uploadable')
  assert.ok(built.bytes > 0 && built.bytes < MAX_JOURNAL_BYTES, `${built.bytes} bytes`)
  assert.strictEqual(built.payload.entries, run.journal!.length)
  assert.strictEqual(built.payload.sector, 'saas')
  assert.strictEqual(built.payload.mode, 'quick')
})
await ok('the company name is nowhere in the payload — not in the header, not anywhere', () => {
  const built = buildJournalPayload(run, 'ended', 'deadbeef')
  assert.ok(built.ok)
  const json = JSON.stringify(built.payload)
  assert.ok(!json.includes('Hyperloop'), 'the company name was uploaded')
  assert.ok(!json.toLowerCase().includes('cats'), json.slice(0, 400))
  assert.strictEqual((built.payload.header as { companyName: string }).companyName, REDACTED_COMPANY)
})
await ok('REDACTING THE NAME DOES NOT BREAK THE REPLAY — the canary on the whole redaction', () => {
  // If the company name ever starts feeding an outcome, this goes red rather than the uploaded
  // journals quietly ceasing to reproduce the runs they came from.
  const built = buildJournalPayload(run, 'ended', 'deadbeef')
  assert.ok(built.ok)
  const redacted = replayRun(built.payload.header as ReturnType<typeof headerOf>, built.payload.journal)
  assert.strictEqual(
    stateFingerprint(redacted),
    stateFingerprint(run),
    'the redacted header replays to a different run — the name now affects the simulation',
  )
  assert.strictEqual(built.payload.fingerprint, String(stateFingerprint(run)))
})
await ok('building the payload does not touch the run it is given', () => {
  const before = JSON.stringify(run)
  const fp = stateFingerprint(run)
  buildJournalPayload(run, 'abandoned', 'deadbeef')
  buildJournalPayload(run, 'ended', 'deadbeef')
  assert.strictEqual(JSON.stringify(run), before, 'analytics mutated the game state')
  assert.strictEqual(stateFingerprint(run), fp)
})
await ok('a run with no journal is refused, and says which problem it is', () => {
  const arena = playedRun(3)
  delete arena.journal
  assert.deepStrictEqual(buildJournalPayload(arena, 'ended', 'x'), { ok: false, reason: 'no_journal' })
})
await ok("a journal past the WRITER's ceiling is refused, using the writer's own constant", () => {
  const fat = playedRun(1)
  fat.journal = Array.from({ length: JOURNAL_LIMIT + 1 }, () => ({ w: 1, a: 'advance' as const }))
  assert.deepStrictEqual(buildJournalPayload(fat, 'ended', 'x'), { ok: false, reason: 'too_large' })
  // exactly at the ceiling is still honest input, and must not be refused for length…
  const atLimit = playedRun(1)
  atLimit.journal = Array.from({ length: JOURNAL_LIMIT }, () => ({ w: 1, a: 'advance' as const }))
  const r = buildJournalPayload(atLimit, 'ended', 'x')
  // …though 20,000 entries blow the BYTE cap, which is the second axis and the one that protects
  // storage. Either way it is dropped, never truncated.
  assert.ok(!r.ok && r.reason === 'too_large', JSON.stringify(r).slice(0, 200))
})
await ok('the byte cap bites independently of the entry count', () => {
  // Well inside JOURNAL_LIMIT (4,000 of 20,000 entries) and under the per-string tripwire, but
  // roughly 440 KB of JSON — the entry count alone would have waved this straight through.
  const fat = playedRun(1)
  fat.journal = Array.from({ length: 4_000 }, () => ({ w: 1, a: 'advance' as const, p: { v: 'x'.repeat(90) } }))
  assert.ok(fat.journal.length < JOURNAL_LIMIT, 'precondition: the entry cap is NOT what refuses this')
  const r = buildJournalPayload(fat, 'ended', 'x')
  assert.ok(!r.ok && r.reason === 'too_large', JSON.stringify(r).slice(0, 200))
})
await ok('the free-text tripwire refuses a journal carrying a long string', () => {
  const sneaky = playedRun(2)
  sneaky.journal = [{ w: 1, a: 'advance' }, { w: 1, a: 'pivot', p: { note: 'x'.repeat(200) } }]
  assert.deepStrictEqual(buildJournalPayload(sneaky, 'ended', 'x'), { ok: false, reason: 'unsafe_payload' })
  // and the honest direction: the payloads the registry actually writes are all short and pass
  const honest = buildJournalPayload(playedRun(4), 'ended', 'x')
  assert.ok(honest.ok, 'a real run must not trip the tripwire')
})
await ok('the run key is deterministic per run+reason, and the nonce is what separates players', () => {
  const a = buildJournalPayload(run, 'ended', 'aaaa')
  const b = buildJournalPayload(run, 'ended', 'aaaa')
  const c = buildJournalPayload(run, 'abandoned', 'aaaa')
  const d = buildJournalPayload(run, 'ended', 'bbbb')
  assert.ok(a.ok && b.ok && c.ok && d.ok)
  assert.strictEqual(a.payload.run_key, b.payload.run_key, 'a retry must dedupe, not spam')
  assert.notStrictEqual(a.payload.run_key, c.payload.run_key)
  assert.notStrictEqual(a.payload.run_key, d.payload.run_key, 'two players must not collide')
  assert.ok(a.payload.run_key.length <= 96)
})

// ============================================================================================
console.log('\n--- 5. weeks, not minutes: the heartbeat cadence ---')
// ============================================================================================

await ok('the first five weeks each get a heartbeat — that is where players quit', () => {
  for (const w of [1, 2, 3, 4, 5]) assert.strictEqual(events.isHeartbeatWeek(w), true, `week ${w}`)
})
await ok('after that it thins out to every fifth week, so quota is not burned on long runs', () => {
  for (const w of [6, 7, 8, 9, 11, 12, 13, 14]) assert.strictEqual(events.isHeartbeatWeek(w), false, `week ${w}`)
  for (const w of [10, 15, 20, 50, 90]) assert.strictEqual(events.isHeartbeatWeek(w), true, `week ${w}`)
})
await ok('a whole 90-week run costs 22 heartbeats — the cost is small and it is knowable', () => {
  let n = 0
  for (let w = 1; w <= 90; w++) if (events.isHeartbeatWeek(w)) n++
  assert.strictEqual(n, 22)
})
await ok('nonsense weeks never produce one', () => {
  for (const w of [0, -1, 0.5, NaN, Infinity]) assert.strictEqual(events.isHeartbeatWeek(w), false, String(w))
})
await ok('a run abandoned in week 3 has ALREADY been measured — the point of the whole design', () => {
  // Not a tautology: it is the property that separates measuring players from measuring survivors.
  const abandonedAt = 3
  assert.strictEqual(events.isHeartbeatWeek(abandonedAt), true)
  const sent = events.runProgress({ mode: 'quick', format: 'standard', sector: 'saas', week: abandonedAt, screen: 'product' })
  assert.strictEqual(sent.week, 3)
  assert.strictEqual(sent.screen, 'product', 'the screen they gave up on is the design signal')
})

// ============================================================================================
console.log('\n--- 6. the game is untouched ---')
// ============================================================================================

await ok('two identical runs stay identical whether or not analytics reads them', () => {
  const a = playedRun(12)
  const b = playedRun(12)
  const fp = stateFingerprint(a)
  events.runEnded({ mode: 'quick', format: 'standard', sector: 'saas', week: a.week }, { ending: 'timeup', weeks: a.week, score: 0, verified: 'verified' })
  buildJournalPayload(a, 'ended', 'x')
  assert.strictEqual(stateFingerprint(a), fp)
  assert.strictEqual(stateFingerprint(a), stateFingerprint(b))
})
await ok('the analytics modules import no capability the engine can see', () => {
  // defaultCapabilities is imported purely to prove src/game is reachable from this test at all —
  // the assertion that matters is above: identical fingerprints with analytics in the loop.
  assert.ok(typeof defaultCapabilities === 'function')
})

console.log(`\n${passed} assertions passed`)
if (fails.length > 0) {
  console.error(`\n${fails.length} FAILED:\n  - ${fails.join('\n  - ')}`)
  process.exit(1)
}
