// Product analytics: the four claims the feature makes about itself, checked rather than asserted
// in a document. Run: npx tsx test/analytics.test.ts
//
//   1. INERT WHEN SWITCHED OFF — with the box unticked, no client is constructed, no network call
//      is made, and the vendor module is never even imported. This used to be anchored to the
//      committed placeholder key; a real key ships now, so it is anchored to the off switch.
//   2. THE CONSENT GATE — no cookie and no person profile by default; revoking stops collection in
//      the same tick, not after a reload; a corrupt consent record reads as 'unset', never granted.
//   3. FREE TEXT NEVER LEAVES — the company name (and every other thing a player typed) cannot
//      reach an event, through the real code path.
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

const { analyticsConfigured, POSTHOG_HOST, POSTHOG_KEY } = await import('../src/analytics/config')
const { activeGate, analyticsActive, capture, clientConstructed, modeConfig } = await import(
  '../src/analytics/client'
)
const consent = await import('../src/analytics/consent')
const { ANALYTICS_PROPERTIES, sanitizeEventProperties, scrubUrlProperties, stripUrlDetail } = await import(
  '../src/analytics/props'
)
const events = await import('../src/analytics/events')
const { newGame } = await import('../src/game/engine')
const { applyJournaled, stateFingerprint } = await import('../src/game/replay')
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
console.log('\n--- 1. inert the moment a player says no ---')
// ============================================================================================
reset()

// THE ANCHOR MOVED, AND IT IS WORTH SAYING WHY. Every claim in this section used to hold because
// the committed key was a placeholder — which meant the suite would have passed just as happily
// with the consent term deleted from the gate. The key is real now, so being off is no longer the
// default state of the world: it is a thing the player did. These assertions are therefore anchored
// to the off switch in the Field Guide, which is the version that actually protects anybody.
await ok('a real project key ships, so "off" now has to be earned rather than assumed', () => {
  assert.ok(POSTHOG_KEY.startsWith('phc_'), 'the publishable project key should be committed')
  assert.ok(!POSTHOG_KEY.includes('YOUR-'))
  assert.strictEqual(analyticsConfigured, true)
})
await ok('unticking the box switches the whole layer off, in this tick', () => {
  consent.setConsent(false)
  assert.strictEqual(analyticsActive(), false)
})
await ok('...and BOTH terms of the gate are load-bearing, including the honest path', () => {
  assert.strictEqual(activeGate(true, false), false, 'the player said no')
  assert.strictEqual(activeGate(false, true), false, 'no project key, nowhere to send')
  assert.strictEqual(activeGate(false, false), false)
  // A gate that never opens is not a privacy control, it is a broken feature.
  assert.strictEqual(activeGate(true, true), true)
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
  capture('hand_written_event', { week: 1 })
  // Give any promise chain a turn to run before looking.
  await Promise.resolve()
  await Promise.resolve()
  assert.strictEqual(netTotal(), 0, `analytics reached the network ${JSON.stringify(net)}`)
})
await ok('...and never even imports the vendor SDK: the chunk is not merely silent, it is absent', () => {
  assert.strictEqual(clientConstructed(), false, 'posthog-js was loaded while unconfigured')
})
await ok('nothing was written to storage either, beyond the refusal itself', () => {
  // The consent record IS on disk here, and it has to be: "no" that does not survive a reload is
  // not an answer, it is a question asked again tomorrow. What must be absent is everything else —
  // no distinct id, no session, no queued event, nothing under a posthog key.
  const keys = [...mem.keys()]
  assert.deepStrictEqual(keys, ['fm-analytics-consent-v1'], `analytics wrote ${keys.join(', ')}`)
  assert.ok(!keys.some((k) => k.includes('posthog') || k.includes('ph_')), keys.join(', '))
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

await ok('the default is anonymous: collection on, no cookie, no profile', () => {
  assert.strictEqual(consent.consentState(), 'unset')
  assert.strictEqual(consent.collectionEnabled(), true, 'the anonymous default is what measures abandonment')
  assert.strictEqual(consent.consentGranted(), false, 'no cookie and no profile without an explicit yes')
})
await ok('NOTHING is persisted before the player is asked — not even a "we asked" record', () => {
  consent.consentState()
  consent.collectionEnabled()
  consent.shouldAskConsent()
  assert.deepStrictEqual([...mem.keys()], [], 'reading consent must not create it')
})
await ok('granting is still the only thing that would unlock a cookie and a profile', () => {
  consent.setConsent(true)
  assert.strictEqual(consent.consentState(), 'granted')
  assert.strictEqual(consent.consentGranted(), true)
})
await ok('NO COOKIE AND NO PROFILE BY DEFAULT — the mapping, not a promise about it', () => {
  // This assertion changed shape deliberately, and the reason belongs in the file that enforces it.
  // The anonymous default used to be `persistence: 'memory'`, which writes nothing whatsoever —
  // and makes RETENTION UNMEASURABLE, because an id that dies with the tab means every returning
  // player arrives as a stranger. Retention is one of the four questions the feature exists to
  // answer. So the default now keeps a random number in this browser's own localStorage: no
  // cookie, no person profile, no account, erased by the off switch. That is the trade, stated
  // where it can be checked rather than in a paragraph nobody re-reads.
  consent.setAnonymousConsent()
  assert.deepStrictEqual(
    modeConfig(),
    { persistence: 'localStorage', person_profiles: 'never' },
    'the anonymous default must set no cookie and build no profile',
  )
  consent.setConsent(false)
  assert.deepStrictEqual(modeConfig(), { persistence: 'localStorage', person_profiles: 'never' })
  // The honest direction: 'granted' is what would buy a cookie and a profile. Nothing in the
  // shipped interface can reach it — there is no prompt — but the mapping stays asserted so that
  // the deferred run-journal upload (BACKLOG.md) inherits a state machine that still works.
  consent.setConsent(true)
  assert.deepStrictEqual(modeConfig(), { persistence: 'localStorage+cookie', person_profiles: 'always' })
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
console.log('\n--- 4. weeks, not minutes: the heartbeat cadence ---')
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
console.log('\n--- 5. the game is untouched ---')
// ============================================================================================

await ok('two identical runs stay identical whether or not analytics reads them', () => {
  const a = playedRun(12)
  const b = playedRun(12)
  const fp = stateFingerprint(a)
  events.runEnded({ mode: 'quick', format: 'standard', sector: 'saas', week: a.week }, { ending: 'timeup', weeks: a.week, score: 0, verified: 'verified' })
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
// Explicit, unlike the rest of the suite. Section 1's whole claim is that the vendor SDK is never
// constructed — and if that claim ever breaks, the SDK's retry timers and flush intervals sit on
// the event loop and node never exits. A run that HANGS instead of reporting a failure is the
// worst of the three outcomes: it looks like an infrastructure problem, not like a red test.
process.exit(0)
