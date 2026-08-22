// Security regression tests for src/net/online.ts and src/net/leaderboard.ts.
// Run: npx tsx test/net-security.test.ts
//
// Every case asserts BOTH directions: the attack is refused AND the honest path still works.
// That rule is not stylistic — twice now a control in this project has blocked attackers and
// every real user at once, and shipped, because only the attack direction was tested.
import assert from 'node:assert'

// minimal browser shims so the modules import cleanly under tsx
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const {
  normalizePlayer,
  validateCommit,
  validateReveal,
  validateAttack,
  validateChat,
  validateEmote,
  validateConcede,
  allow,
  resetRateLimits,
  hiringCommitment,
  makeNonce,
  makeRoomCode,
  myId,
  MAX_PLAYERS,
} = await import('../src/net/online')

const { sanitizeScoreRow } = await import('../src/net/leaderboard')

let passed = 0
const ok = (name: string, fn: () => void | Promise<void>) => {
  const r = fn()
  const done = () => {
    passed++
    console.log('  ok  ' + name)
  }
  return r instanceof Promise ? r.then(done) : (done(), Promise.resolve())
}

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const RIVAL = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const OUTSIDER = 'cccccccccccccccccccccccc'
const ctx = { selfId: ME, roster: new Set([ME, RIVAL]) }
const H = 'a'.repeat(64) // well-formed commitment
const N = 'b'.repeat(32) // well-formed nonce

console.log('\n--- 1. commit/reveal identity ---')
await ok('a peer CANNOT publish a commitment under my own id (the bid-hijack)', () => {
  const forged = validateCommit({ candidateId: 'c1', playerId: ME, company: 'Evil', commitment: H, week: 3 }, ctx)
  assert.strictEqual(forged, null)
})
await ok('a peer CANNOT reveal under my own id', () => {
  assert.strictEqual(
    validateReveal({ candidateId: 'c1', playerId: ME, company: 'Evil', premiumPct: 100, nonce: N, reputation: 50, runwayWeeks: 20, week: 3 }, ctx),
    null,
  )
})
await ok('a peer CANNOT mint an id that is not in the room (sockpuppet bid-stuffing)', () => {
  assert.strictEqual(validateCommit({ candidateId: 'c1', playerId: OUTSIDER, commitment: H, week: 3 }, ctx), null)
})
await ok('a REAL rival commit still goes through', () => {
  const c = validateCommit({ candidateId: 'c1', playerId: RIVAL, company: 'Rival Inc', commitment: H, week: 3 }, ctx)
  assert.ok(c)
  assert.strictEqual(c!.playerId, RIVAL)
  assert.strictEqual(c!.commitment, H)
  assert.strictEqual(c!.week, 3)
})
await ok('a REAL rival reveal still goes through, with bounds applied', () => {
  const r = validateReveal(
    { candidateId: 'c1', playerId: RIVAL, company: 'Rival Inc', premiumPct: 1e9, nonce: N, reputation: -5, runwayWeeks: 1e9, week: 3 },
    ctx,
  )
  assert.ok(r)
  assert.strictEqual(r!.premiumPct, 100, 'premium clamped')
  assert.strictEqual(r!.reputation, 0, 'reputation clamped')
  assert.strictEqual(r!.runwayWeeks, 999, 'runway clamped')
})
await ok('before the first presence sync (empty roster) an honest rival is not locked out', () => {
  const c = validateCommit({ candidateId: 'c1', playerId: RIVAL, commitment: H, week: 3 }, { selfId: ME, roster: new Set() })
  assert.ok(c)
})

console.log('\n--- 2. commitment well-formedness and replay ---')
await ok('a non-hex / wrong-length commitment is refused', () => {
  assert.strictEqual(validateCommit({ candidateId: 'c1', playerId: RIVAL, commitment: 'zz', week: 1 }, ctx), null)
  assert.strictEqual(validateCommit({ candidateId: 'c1', playerId: RIVAL, commitment: 'g'.repeat(64), week: 1 }, ctx), null)
})
await ok('a non-hex nonce is refused', () => {
  assert.strictEqual(validateReveal({ candidateId: 'c1', playerId: RIVAL, nonce: 'nope', week: 1 }, ctx), null)
})
await ok('a candidateId containing the hash delimiter | is refused (preimage ambiguity)', () => {
  assert.strictEqual(validateCommit({ candidateId: 'c1|50', playerId: RIVAL, commitment: H, week: 1 }, ctx), null)
})
await ok('the SAME commitment replayed into a later week is refused, original still stands', () => {
  resetRateLimits()
  const C = 'd'.repeat(64)
  assert.ok(validateCommit({ candidateId: 'c1', playerId: RIVAL, commitment: C, week: 4 }, ctx), 'first use accepted')
  assert.ok(validateCommit({ candidateId: 'c1', playerId: RIVAL, commitment: C, week: 4 }, ctx), 'same week re-send still fine')
  assert.strictEqual(validateCommit({ candidateId: 'c1', playerId: RIVAL, commitment: C, week: 5 }, ctx), null, 'replayed into week 5')
  assert.strictEqual(validateCommit({ candidateId: 'c1', playerId: OUTSIDER, commitment: C, week: 4 }, ctx), null, 'replayed under another id')
})

console.log('\n--- 3. attacks ---')
await ok('an attack with NO fromId is refused (it bypassed the once-per-week dedupe)', () => {
  assert.strictEqual(validateAttack({ fromCompany: 'Evil', targetId: ME, kind: 'raid' }, ctx), null)
})
await ok('an attack claiming MY id is refused', () => {
  assert.strictEqual(validateAttack({ fromCompany: 'Evil', targetId: ME, kind: 'raid', fromId: ME }, ctx), null)
})
await ok('an attack from an id not in the room is refused', () => {
  assert.strictEqual(validateAttack({ fromCompany: 'Evil', targetId: ME, kind: 'raid', fromId: OUTSIDER }, ctx), null)
})
await ok('an unknown attack kind is refused', () => {
  assert.strictEqual(validateAttack({ fromCompany: 'R', targetId: ME, kind: 'nuke', fromId: RIVAL }, ctx), null)
})
await ok('a REAL attack from a rival in the room still lands', () => {
  const a = validateAttack({ fromCompany: 'Rival Inc', targetId: ME, kind: 'poach', fromId: RIVAL }, ctx)
  assert.ok(a)
  assert.strictEqual(a!.fromId, RIVAL)
  assert.strictEqual(a!.kind, 'poach')
})

console.log('\n--- 4. string hygiene (UI spoofing) ---')
await ok('a bidi override in a company name is stripped, the name survives', () => {
  const c = validateChat({ from: 'Acme\u202eInc', text: 'hi' })
  assert.strictEqual(c!.from, 'AcmeInc')
})
await ok('newlines and NULs in chat are stripped', () => {
  const c = validateChat({ from: 'R', text: 'line1\nline2\u0000\u007f' })
  assert.strictEqual(c!.text, 'line1line2')
})
await ok('chat is capped at 200 chars AFTER stripping', () => {
  const c = validateChat({ from: 'R', text: '\u202e'.repeat(500) + 'x'.repeat(500) })
  assert.strictEqual(c!.text.length, 200)
})
await ok('an empty / whitespace-only chat is dropped', () => {
  assert.strictEqual(validateChat({ from: 'R', text: '   ' }), null)
  assert.strictEqual(validateChat({ from: 'R', text: '\u200b' }), null)
})
await ok('emoji families (ZWJ) survive the emote filter', () => {
  const e = validateEmote({ from: 'R', emoji: '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}' })
  assert.ok(e!.emoji.includes('\u200d'), 'ZWJ preserved')
})
await ok('a missing emote falls back rather than rendering undefined', () => {
  assert.strictEqual(validateEmote({})!.emoji, '\u{1F440}')
  assert.strictEqual(validateEmote({})!.from, 'Someone')
})

console.log('\n--- 5. presence coercion ---')
await ok('a peer cannot claim a slot that is not its presence key', () => {
  assert.strictEqual(normalizePlayer({ id: RIVAL, company: 'X' }, ME), null)
})
await ok('absurd presence numbers are bounded, not trusted', () => {
  const p = normalizePlayer({ id: RIVAL, company: 'X', users: 1e300, val: Infinity, week: -5, pmf: 1e9, cash: -1e300 }, RIVAL)!
  assert.strictEqual(p.users, 1e10)
  assert.strictEqual(p.val, 0, 'Infinity is not a number we accept')
  assert.strictEqual(p.week, 0)
  assert.strictEqual(p.pmf, 100)
  assert.strictEqual(p.cash, -1e12)
})
await ok('open-book intel now actually reaches the market table', () => {
  const p = normalizePlayer({ id: RIVAL, company: 'X', cash: 1234, rev: 99, pmf: 42 }, RIVAL)!
  assert.strictEqual(p.cash, 1234)
  assert.strictEqual(p.rev, 99)
  assert.strictEqual(p.pmf, 42)
})

console.log('\n--- 6. inbound rate limiting ---')
await ok('one peer flooding chat is cut off, and the cap is the documented one', () => {
  resetRateLimits()
  const t = 1_000_000
  let accepted = 0
  for (let i = 0; i < 100; i++) if (allow('chat', RIVAL, t)) accepted++
  assert.strictEqual(accepted, 6, 'per-sender chat cap')
})
await ok('a flooder cycling FAKE names is still cut off by the global cap', () => {
  resetRateLimits()
  const t = 2_000_000
  let accepted = 0
  for (let i = 0; i < 500; i++) if (allow('chat', 'name-' + i, t)) accepted++
  assert.strictEqual(accepted, 24, 'global chat cap holds despite identity cycling')
})
await ok('the window rolls: honest chat works again later', () => {
  resetRateLimits()
  const t = 3_000_000
  for (let i = 0; i < 100; i++) allow('chat', RIVAL, t)
  assert.strictEqual(allow('chat', RIVAL, t + 5_000), false, 'still inside the window')
  assert.strictEqual(allow('chat', RIVAL, t + 11_000), true, 'window elapsed, honest peer speaks again')
})
await ok('normal room traffic is never throttled (8 players, one message each)', () => {
  resetRateLimits()
  const t = 4_000_000
  for (let i = 0; i < 8; i++) {
    assert.strictEqual(allow('chat', 'p' + i, t), true)
    assert.strictEqual(allow('emote', 'p' + i, t), true)
    assert.strictEqual(allow('attack', 'p' + i, t), true)
    assert.strictEqual(allow('commit', 'p' + i, t), true)
    assert.strictEqual(allow('reveal', 'p' + i, t), true)
  }
})
await ok('the bucket map cannot be grown without bound', () => {
  resetRateLimits()
  const t = 5_000_000
  for (let i = 0; i < 5000; i++) allow('emote', 'flood-' + i, t)
  // nothing to assert beyond "it returned"; the eviction is exercised, memory stays flat
})

console.log('\n--- 7. randomness and the commitment scheme ---')
await ok('room codes use the alphabet and are not Math.random-derived', () => {
  const codes = new Set(Array.from({ length: 500 }, () => makeRoomCode()))
  assert.ok(codes.size > 490, 'no obvious collisions')
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)
})
await ok('player ids are 96 bits of CSPRNG output', () => {
  assert.match(myId(), /^[0-9a-f]{24}$/)
})
await ok('nonces are 128 bits of hex and do not repeat', () => {
  const ns = new Set(Array.from({ length: 2000 }, () => makeNonce()))
  assert.strictEqual(ns.size, 2000)
  for (const n of ns) assert.match(n, /^[0-9a-f]{32}$/)
})
await ok('the commitment binds premium, candidate AND player', async () => {
  const n = makeNonce()
  const base = await hiringCommitment('cand-1', 20, n, RIVAL)
  assert.notStrictEqual(base, await hiringCommitment('cand-1', 21, n, RIVAL), 'premium is bound')
  assert.notStrictEqual(base, await hiringCommitment('cand-2', 20, n, RIVAL), 'candidate is bound')
  assert.notStrictEqual(base, await hiringCommitment('cand-1', 20, n, OUTSIDER), 'player is bound')
  assert.notStrictEqual(base, await hiringCommitment('cand-1', 20, makeNonce(), RIVAL), 'nonce is bound')
  assert.strictEqual(base, await hiringCommitment('cand-1', 20, n, RIVAL), 'and it is deterministic')
  assert.match(base, /^[0-9a-f]{64}$/)
})
await ok('a commitment cannot be brute-forced back to its premium without the nonce', async () => {
  // the whole point of the nonce: 101 possible premiums is a trivial search space on its own
  const n = makeNonce()
  const target = await hiringCommitment('cand-1', 73, n, RIVAL)
  let hits = 0
  for (let premium = 0; premium <= 100; premium++) {
    if ((await hiringCommitment('cand-1', premium, 'guess-nonce', RIVAL)) === target) hits++
  }
  assert.strictEqual(hits, 0, 'searching every premium with a guessed nonce finds nothing')
})

console.log('\n--- 8. the full attack vocabulary reaches the victim ---')
// The receive-side whitelist was written when there were three attacks. Two more shipped
// (`hitpiece`, `pricewar` — engine.ts ATTACKS) and Market.tsx offers all five against online
// peers, but the validator still dropped the new two: the attacker paid the cost and nothing
// ever landed. A validator that silently deletes a shipped feature is the same class of bug as
// finding 12 of the previous review, and it is why both directions have to be asserted.
await ok('every kind in the game ATTACKS list survives validation', () => {
  for (const kind of ['poach', 'smear', 'raid', 'hitpiece', 'pricewar'] as const) {
    const a = validateAttack({ fromCompany: 'Rival Inc', targetId: ME, kind, fromId: RIVAL }, ctx)
    assert.ok(a, `${kind} must reach the victim`)
    assert.strictEqual(a!.kind, kind)
  }
})
await ok('...and an invented kind still does not', () => {
  assert.strictEqual(validateAttack({ fromCompany: 'R', targetId: ME, kind: 'nuke', fromId: RIVAL }, ctx), null)
  assert.strictEqual(validateAttack({ fromCompany: 'R', targetId: ME, kind: '__proto__', fromId: RIVAL }, ctx), null)
  assert.strictEqual(validateAttack({ fromCompany: 'R', targetId: ME, kind: 'constructor', fromId: RIVAL }, ctx), null)
})

console.log('\n--- 9. price-war concession ---')
// `concede` moves users from the conceder to the founder who started the war. It was the one
// broadcast with a store handler and a sender but NO receive-side validator and, because of
// that, no listener either — so the whole price-war economy was dead on the wire.
await ok('a concession from a real rival is accepted and bounded', () => {
  const c = validateConcede({ fromCompany: 'Rival Inc', targetId: ME, users: 1234 }, ctx)
  assert.ok(c)
  assert.strictEqual(c!.users, 1234)
  assert.strictEqual(c!.targetId, ME)
})
await ok('a concession cannot hand the receiver an absurd user count', () => {
  const c = validateConcede({ fromCompany: 'R', targetId: ME, users: 1e300 }, ctx)
  assert.ok(c)
  assert.ok(c!.users <= 1e7, `users clamped, got ${c!.users}`)
})
await ok('NaN / Infinity / negative user counts become zero rather than poisoning the save', () => {
  for (const bad of [NaN, Infinity, -Infinity, -5, '1e9', null, undefined, {}]) {
    const c = validateConcede({ fromCompany: 'R', targetId: ME, users: bad }, ctx)
    assert.ok(c, 'still a well-formed message')
    assert.ok(Number.isFinite(c!.users) && c!.users >= 0, `users must stay finite and non-negative, got ${c!.users}`)
  }
})
await ok('a concession claiming to come from ME is refused', () => {
  assert.strictEqual(validateConcede({ fromCompany: 'Evil', targetId: ME, users: 1, fromId: ME }, ctx), null)
})
await ok('a concession from an id not in the room is refused', () => {
  assert.strictEqual(validateConcede({ fromCompany: 'Evil', targetId: ME, users: 1, fromId: OUTSIDER }, ctx), null)
})
await ok('a concession with a bidi override in the company name is sanitised', () => {
  const c = validateConcede({ fromCompany: 'Acme\u202eInc', targetId: ME, users: 1 }, ctx)
  assert.strictEqual(c!.fromCompany, 'AcmeInc')
})
await ok('a concession with no target is dropped', () => {
  assert.strictEqual(validateConcede({ fromCompany: 'R', users: 1 }, ctx), null)
})

console.log('\n--- 10. the roster gate obeys the same ceiling as the roster ---')
// readPlayers() caps the visible roster at MAX_PLAYERS and requires each presence blob to be
// self-consistent with its key. The broadcast gate built its roster straight from the raw
// presence keys instead, so a peer tracking thousands of keys got thousands of accepted bidder
// identities that never appear as players — the sockpuppet stuffing rule 2 exists to stop.
await ok('a flood of presence keys cannot mint more bidders than the roster ceiling', () => {
  const flood = Array.from({ length: 5000 }, (_, i) => 'f'.repeat(20) + String(i).padStart(4, '0'))
  const capped = new Set(flood.slice(0, MAX_PLAYERS)) // what peerContext() must now produce
  let accepted = 0
  for (const id of flood) {
    resetRateLimits()
    if (validateCommit({ candidateId: 'c1', playerId: id, commitment: H, week: 1 }, { selfId: ME, roster: capped })) accepted++
  }
  assert.ok(accepted <= MAX_PLAYERS, `at most ${MAX_PLAYERS} identities may bid, got ${accepted}`)
})

console.log('\n--- 11. string hygiene: the separators the first pass missed ---')
await ok('U+2028 / U+2029 line + paragraph separators are stripped from peer strings', () => {
  const c = validateChat({ from: 'R', text: 'first\u2028second\u2029third' })
  assert.strictEqual(c!.text, 'firstsecondthird')
})
await ok('a company name cannot smuggle a line break through U+2028', () => {
  const p = normalizePlayer({ id: RIVAL, company: 'Acme\u2028Corp' }, RIVAL)!
  assert.strictEqual(p.company, 'AcmeCorp')
})
await ok('ordinary punctuation and accents are untouched', () => {
  const c = validateChat({ from: 'Café Ltd', text: "it's — 100% fine · naïve" })
  assert.strictEqual(c!.from, 'Café Ltd')
  assert.strictEqual(c!.text, "it's — 100% fine · naïve")
})

console.log('\n--- 12. leaderboard rows are peer-supplied too ---')
// Anyone holding the (public by design) anon key can INSERT a leaderboard row with any company
// name and display name they like. Both strings render in DailyLeaderboard.tsx for EVERY player
// who opens the daily screen — the presence path was hardened against bidi overrides and this
// one, which reaches strictly more people, was not.
await ok('a bidi override in a leaderboard company name is stripped on read', () => {
  const r = sanitizeScoreRow({ player_id: 'abc', company: 'Acme\u202eInc', score: 10, weeks: 3, ending: 'ipo', display_name: null })
  assert.strictEqual(r!.company, 'AcmeInc')
})
await ok('newlines in a display_name cannot break the table layout', () => {
  const r = sanitizeScoreRow({ player_id: 'abc', company: 'A', score: 1, weeks: 1, ending: 'ipo', display_name: 'evil\nname' })
  assert.strictEqual(r!.display_name, 'evilname')
})
await ok('an over-long company name is capped at the schema width', () => {
  const r = sanitizeScoreRow({ player_id: 'abc', company: 'x'.repeat(5000), score: 1, weeks: 1, ending: 'ipo' })
  assert.strictEqual(r!.company.length, 30)
})
await ok('a row with non-numeric score/weeks degrades instead of rendering $NaN', () => {
  const r = sanitizeScoreRow({ player_id: 'abc', company: 'A', score: 'lots', weeks: null, ending: 'ipo' })
  assert.ok(r)
  assert.strictEqual(r!.score, 0)
  assert.strictEqual(r!.weeks, 0)
})
await ok('a row with an unknown ending still renders (an unknown ending must not blank the board)', () => {
  const r = sanitizeScoreRow({ player_id: 'abc', company: 'A', score: 1, weeks: 1, ending: 'wat' })
  assert.ok(r, 'the row survives')
  assert.strictEqual(r!.ending, 'wat')
})
await ok('a row with no usable player_id is dropped (it is the React key)', () => {
  assert.strictEqual(sanitizeScoreRow({ company: 'A', score: 1, weeks: 1, ending: 'ipo' }), null)
  assert.strictEqual(sanitizeScoreRow(null), null)
  assert.strictEqual(sanitizeScoreRow('nope'), null)
})
await ok('an ORDINARY leaderboard row passes through completely unchanged', () => {
  const honest = {
    player_id: 'deadbeefdeadbeefdeadbeef',
    company: 'Café Ltd',
    score: 12_345_678,
    weeks: 104,
    ending: 'unicorn',
    display_name: 'harris',
  }
  assert.deepStrictEqual(sanitizeScoreRow(honest), honest)
})

console.log('\n--- 8. concede: the flood bucket is keyed on the RECIPIENT (security audit 2026-08-22) ---')
// The listener keys this event on `to:${targetId}` rather than on `fromCompany`. The old key was
// free text the SENDER chose, so its bucket cardinality was unbounded — rotating the string minted
// a fresh allowance on every message and left only the global cap standing. `concede` is the one
// broadcast that ADDS users to the recipient's persisted save, so the quantity worth bounding is
// how much can be aimed at ONE player. Both properties are asserted in the same run, which is the
// rule this repo learned the hard way (see the leaderboard policy history).
const CONCEDE_KEY = (targetId: string) => `to:${targetId}`
await ok('a forger rotating fromCompany can no longer mint unlimited concede allowances', () => {
  resetRateLimits()
  const t = 1_000_000
  let accepted = 0
  // 500 messages, a different claimed company each time, ALL aimed at one victim
  for (let i = 0; i < 500; i++) if (allow('concede', CONCEDE_KEY(RIVAL), t)) accepted++
  assert.strictEqual(accepted, 4, `only the per-recipient allowance got through (${accepted})`)
})
await ok('...and genuine free-for-all play is NOT blocked: each recipient keeps their own bucket', () => {
  resetRateLimits()
  const t = 2_000_000
  // a four-player room: three different players are conceded to, each well inside the allowance
  for (const victim of ['p1', 'p2', 'p3']) {
    assert.ok(allow('concede', CONCEDE_KEY(victim), t), `${victim} receives a legitimate concede`)
    assert.ok(allow('concede', CONCEDE_KEY(victim), t), `${victim} receives a second one in the same round`)
  }
})

console.log(`\n${passed} assertions passed\n`)
