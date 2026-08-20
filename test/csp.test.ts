// Security tests for the shipped Content-Security-Policy (src/csp.ts) and the render-crash
// boundary (src/ErrorBoundary.tsx).
// Run: npx tsx test/csp.test.ts
//
// Every case asserts BOTH directions: the dangerous source is refused AND the source the app
// genuinely needs is still allowed. That rule is not stylistic here. This project has shipped a
// control that blocked attackers and every real user at once three times (leaderboard policy v3,
// v4, and latently v5), and a CSP is exactly the kind of control that does it: a policy missing
// one origin does not warn anybody, it just silently severs multiplayer.
import assert from 'node:assert'

const { buildContentSecurityPolicy } = await import('../src/csp')
const { safeErrorText, MAX_ERROR_TEXT, SAVE_KEYS } = await import('../src/ErrorBoundary')
const { SUPABASE_URL } = await import('../src/net/config')
const { POSTHOG_HOST, POSTHOG_KEY, analyticsConfigured } = await import('../src/analytics/config')

let passed = 0
const ok = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

/** Pull one directive's source list out of a policy string. */
const directive = (policy: string, name: string): string => {
  const found = policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `))
  assert.ok(found !== undefined, `policy is missing the ${name} directive entirely`)
  return found
}

// The policy actually shipped, built from the actual Supabase URL — not a fixture. A test that
// asserts against its own copy of the policy proves only that copying works.
const policy = buildContentSecurityPolicy(SUPABASE_URL, POSTHOG_HOST)

console.log('\n--- 1. the policy is well-formed and complete ---')
await ok('every directive the app relies on is present', () => {
  for (const d of [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'connect-src',
    'font-src',
    'manifest-src',
    'worker-src',
    'object-src',
    'frame-src',
    'media-src',
    'base-uri',
    'form-action',
  ]) {
    directive(policy, d)
  }
})
await ok('it parses as a single-line header value (no newlines, no empty directives)', () => {
  assert.ok(!/[\n\r]/.test(policy), 'a newline in a meta content attribute truncates the policy')
  for (const d of policy.split(';')) assert.ok(d.trim().length > 0, `empty directive in: ${policy}`)
})

console.log('\n--- 2. script execution is closed, and stays closed ---')
// This is the directive that carries the whole point of the policy. If it ever widens, the CSP
// stops being defence in depth and becomes decoration.
await ok("script-src is exactly 'self' — no inline, no eval, no wildcard", () => {
  assert.strictEqual(directive(policy, 'script-src'), "script-src 'self'")
})
await ok('no directive anywhere permits unsafe-eval', () => {
  assert.ok(!policy.includes('unsafe-eval'), policy)
})
await ok("'unsafe-inline' appears for style only, never for script", () => {
  assert.ok(directive(policy, 'style-src').includes("'unsafe-inline'"), 'style needs it')
  assert.ok(!directive(policy, 'script-src').includes("'unsafe-inline'"), 'script must not')
})
// ADDED WITH PRODUCT ANALYTICS (2026-08). The usual way a site installs PostHog is a snippet that
// pulls the SDK from a vendor CDN, and the usual way a CSP then "supports" it is by adding that
// CDN to script-src — at which point this directive is decoration and the policy's whole point is
// gone. This project installs posthog-js from npm so Vite bundles it into our own JS, and uses the
// `no-external` build so its optional extensions have no script-injection path either. That is a
// property worth pinning by NAME, so that the next person who tries the snippet has to delete a
// test called this rather than quietly widen a source list.
await ok('no analytics vendor may ever appear in script-src', () => {
  const script = directive(policy, 'script-src')
  assert.strictEqual(script, "script-src 'self'")
  for (const vendor of ['posthog', 'i.posthog.com', 'cdn', 'unpkg', 'jsdelivr']) {
    assert.ok(!script.includes(vendor), `script-src names ${vendor}: the SDK must be bundled, not fetched`)
  }
})
await ok('the injection sinks are shut: object, frame, base-uri, form-action', () => {
  assert.strictEqual(directive(policy, 'object-src'), "object-src 'none'")
  assert.strictEqual(directive(policy, 'frame-src'), "frame-src 'none'")
  assert.strictEqual(directive(policy, 'base-uri'), "base-uri 'none'")
  assert.strictEqual(directive(policy, 'form-action'), "form-action 'none'")
})

console.log('\n--- 3. ...and the honest path still works (the half that gets forgotten) ---')
// A policy that blocks everything passes section 2 perfectly and takes multiplayer down.
const host = new URL(SUPABASE_URL).host
await ok('connect-src reaches Supabase over https — the leaderboard and auth', () => {
  assert.ok(directive(policy, 'connect-src').includes(`https://${host}`), directive(policy, 'connect-src'))
})
await ok('connect-src reaches Supabase over wss — Realtime, i.e. the whole Arena', () => {
  assert.ok(directive(policy, 'connect-src').includes(`wss://${host}`), directive(policy, 'connect-src'))
})
await ok('connect-src reaches the PostHog EU ingest host — the analytics half of the app', () => {
  // Named unconditionally, and now genuinely dialled — see docs/analytics.md:
  // a policy whose shape depends on a feature flag is one nobody can review, and the flag flip
  // (replacing one placeholder string) must not silently change the security posture too.
  assert.ok(directive(policy, 'connect-src').includes(new URL(POSTHOG_HOST).origin), directive(policy, 'connect-src'))
  assert.ok(POSTHOG_HOST.startsWith('https://eu.'), `analytics must stay in the EU, got ${POSTHOG_HOST}`)
})
await ok('the app can load its own bundle, stylesheet, worker and manifest', () => {
  assert.ok(directive(policy, 'script-src').includes("'self'"))
  assert.ok(directive(policy, 'style-src').includes("'self'"))
  assert.ok(directive(policy, 'worker-src').includes("'self'"), 'public/sw.js would not register')
  assert.ok(directive(policy, 'manifest-src').includes("'self'"), 'the PWA would not install')
})
await ok('OAuth avatars and the canvas share card can still render', () => {
  const img = directive(policy, 'img-src')
  assert.ok(img.includes('https:'), 'provider avatars are arbitrary https URLs')
  assert.ok(img.includes('blob:') && img.includes('data:'), 'the share card is a canvas blob')
})

console.log('\n--- 4. the policy follows the Supabase project, rather than being retyped ---')
// A hard-coded origin is how this breaks silently: migrate the project, and every network call
// is refused by a policy still naming the old host.
await ok('a different project URL moves connect-src with it', () => {
  const other = buildContentSecurityPolicy('https://example-project.supabase.co', POSTHOG_HOST)
  const c = directive(other, 'connect-src')
  assert.ok(c.includes('https://example-project.supabase.co'), c)
  assert.ok(c.includes('wss://example-project.supabase.co'), c)
  assert.ok(!c.includes(host), 'the real host must not be baked in anywhere')
})
await ok('a different analytics host moves connect-src with it too', () => {
  const other = buildContentSecurityPolicy(SUPABASE_URL, 'https://eu2.i.posthog.example')
  const c = directive(other, 'connect-src')
  assert.ok(c.includes('https://eu2.i.posthog.example'), c)
  assert.ok(!c.includes(new URL(POSTHOG_HOST).origin), 'the real ingest host must not be baked in')
})
await ok('an unrelated origin is not reachable under the shipped policy', () => {
  assert.ok(!policy.includes('evil.test'))
  // The sources have to be compared as TOKENS, not as substrings: `https://host` contains the
  // text "https:", so a substring check here passes while a bare `https:` wildcard — which would
  // let the game talk to every host on the web — sails straight through.
  const sources = directive(policy, 'connect-src').split(/\s+/).slice(1)
  for (const wildcard of ['*', 'https:', 'http:', 'ws:', 'wss:', 'data:']) {
    assert.ok(!sources.includes(wildcard), `connect-src is too wide, it allows ${wildcard}`)
  }
  // CHANGED 2026-08, DELIBERATELY, AND THIS IS THE ONLY LINE PRODUCT ANALYTICS WAS ALLOWED TO MOVE.
  //
  // The exact-list assertion is the strongest one in this file — it is what kills a mutant that
  // adds a fourth destination — so widening it is exactly the change that must never happen by
  // reflex. It gained ONE entry: the PostHog EU ingest origin, which is where events go. It did
  // not gain a CDN (the SDK is bundled from npm — see the script-src case above), it did not gain
  // an assets host (the `no-external` build loads no remote asset), and no other directive changed
  // at all. The list stays exact so that a fifth entry still fails here.
  assert.deepStrictEqual(sources, ["'self'", `https://${host}`, `wss://${host}`, new URL(POSTHOG_HOST).origin])
})
await ok('the committed key is a PUBLISHABLE project key, never a personal one', () => {
  // This assertion was inverted on purpose, 2026-08-20. It used to read `analyticsConfigured ===
  // false` — a tripwire saying "switching analytics on is a decision, make it deliberately". The
  // decision was made, so the tripwire now guards the thing that is actually dangerous.
  //
  // `phc_` is a PROJECT key: publishable, write-only, meant to be readable by every visitor, and
  // exactly as safe to commit as the Supabase anon key next to it. `phx_` is a PERSONAL API key —
  // it can READ the whole project and administer it, and committing one to a public repo is a
  // credential leak, not a configuration choice. They differ by one character and they sit next to
  // each other in the PostHog UI, which is precisely why a machine checks rather than a human.
  assert.strictEqual(analyticsConfigured, true, 'analytics is switched on — see docs/analytics.md')
  assert.ok(POSTHOG_KEY.startsWith('phc_'), 'a PostHog project key starts with phc_')
  assert.ok(!POSTHOG_KEY.startsWith('phx_'), 'phx_ is a PERSONAL API key and must never be committed')
  assert.ok(!/\s/.test(POSTHOG_KEY) && POSTHOG_KEY.length > 20, 'malformed key')
})

console.log('\n--- 5. a render crash is recoverable, and does not leak the stack ---')
await ok('a real error message survives, so a bug report is actionable', () => {
  assert.strictEqual(safeErrorText(new Error('Cannot read properties of undefined')),
    'Cannot read properties of undefined')
})
await ok('the stack never reaches the DOM, even glued onto the message', () => {
  const e = new Error('boom\n    at Object.<anonymous> (/Users/someone/secret/path/App.tsx:1:1)')
  const text = safeErrorText(e)
  assert.strictEqual(text, 'boom')
  assert.ok(!text.includes('at Object'), text)
  assert.ok(!text.includes('/Users/'), 'a filesystem path must never be shown to a player')
})
await ok('a real Error object never contributes its .stack property', () => {
  const e = new Error('plain')
  assert.ok(typeof e.stack === 'string' && e.stack.length > 0, 'precondition: the stack exists')
  assert.ok(!safeErrorText(e).includes('ErrorBoundary'), 'stack frames must not appear')
})
await ok('an overlong message is truncated rather than flooding the page', () => {
  const text = safeErrorText(new Error('x'.repeat(5000)))
  assert.ok(text.length <= MAX_ERROR_TEXT + 1, `${text.length} > ${MAX_ERROR_TEXT}`)
  // MUTATION SURVIVOR, first pass: the assertion above measures the output against the very
  // constant that decides it, so raising MAX_ERROR_TEXT to 100000 moved the goalposts with the
  // code and the test still passed. A cap is only a cap if something independent pins its size.
  assert.ok(MAX_ERROR_TEXT <= 1000, `a ${MAX_ERROR_TEXT}-char error is a wall of text, not a message`)
  assert.ok(MAX_ERROR_TEXT >= 80, 'and too small a cap truncates real messages into uselessness')
})
await ok('a thrown non-Error does not crash the boundary itself', () => {
  assert.strictEqual(safeErrorText('just a string'), 'just a string')
  assert.strictEqual(safeErrorText(null), 'null')
  assert.strictEqual(safeErrorText(undefined), 'undefined')
  assert.strictEqual(safeErrorText({ a: 1 }), '[object Object]')
  assert.strictEqual(safeErrorText(new Error('   ')), 'An unknown error occurred.')
})
await ok('"start fresh" clears the save keys — and nothing that is not ours', () => {
  assert.deepStrictEqual([...SAVE_KEYS], ['founder-mode-save', 'founder-mode-hall'])
  // the per-device leaderboard secret and player id are NOT wiped: deleting them would strand
  // the player's existing leaderboard rows, which is a bigger loss than the crash it fixes
  assert.ok(!SAVE_KEYS.includes('founder-mode-score-secret' as never))
  assert.ok(!SAVE_KEYS.includes('founder-mode-player-id' as never))
})

console.log(`\n${passed} assertions passed`)
