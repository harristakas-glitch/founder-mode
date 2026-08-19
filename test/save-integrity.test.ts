// localStorage is attacker-controlled input. Run: npx tsx test/save-integrity.test.ts
//
// Every save the game loads comes out of a store the game does not control: the player can edit
// it, and on GitHub Pages the origin (`<user>.github.io`) is shared with every other project the
// same account publishes there, so a script on any of them can write these keys. The migration
// paths CLAIM tolerance ("a malformed slice is DROPPED, NOT REPAIRED", "a save can never crash
// the app"); this suite checks the claim instead of believing it.
//
// The rule is the same as the wire suite's: assert the hostile save degrades AND that an honest
// save still loads completely, in the same run. A loader that refuses everything is not safe,
// it is broken.
import assert from 'node:assert'

// --- browser shims -----------------------------------------------------------------------
// zustand's persist middleware reaches for `window.localStorage`, not the bare global, so both
// have to exist before src/store.ts is imported (the store hydrates at module scope).
const mem = new Map<string, string>()
const shim = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}
const globals = globalThis as unknown as { localStorage: unknown; window: unknown }
globals.localStorage = shim
globals.window = { localStorage: shim }

const { useStore, readHall } = await import('../src/store')
const { newGame } = await import('../src/game/engine')
const { sanitizeJournal, JOURNAL_LIMIT } = await import('../src/game/replay')
const { migrateLivingWorldSlice } = await import('../src/game/world/persistence')
const { migrateTokenSlice } = await import('../src/game/token/persistence')
const { storedReplayProofs } = await import('../src/net/replayProof')
const { normalizePlayer } = await import('../src/net/online')

const persist = (useStore as unknown as { persist: { rehydrate: () => void } }).persist

let passed = 0
const fails: string[] = []
const ok = (name: string, fn: () => void) => {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`)
    console.log('  FAIL  ' + name + ' — ' + (e as Error).message)
  }
}

const SAVE_KEY = 'founder-mode-save'

/**
 * Load a raw save string exactly the way a page load does, and report what survived.
 *
 * `screen: 'market'` is the tracer: the store's `merge` sets every default it needs and only
 * then spreads the persisted slice, so seeing 'market' afterwards proves the merge ran to
 * completion. 'dashboard' means it threw somewhere inside and zustand's own catch dropped the
 * whole save on the floor — which is a degrade, not a crash, and is what we want to see.
 */
function loadSave(raw: string): { merge: 'completed' | 'abandoned'; threw: string | null } {
  // Reset FIRST: persist subscribes to state changes and writes them straight back, so setting
  // state after seeding storage would overwrite the payload under test.
  useStore.setState({ game: null, screen: 'dashboard' })
  mem.set(SAVE_KEY, raw)
  try {
    persist.rehydrate()
  } catch (e) {
    return { merge: 'abandoned', threw: (e as Error).message }
  }
  return { merge: useStore.getState().screen === 'market' ? 'completed' : 'abandoned', threw: null }
}

const save = (game: unknown) => JSON.stringify({ state: { game, screen: 'market' }, version: 9 })

// An honest save to poison, and the control that proves the harness itself works.
const honest = newGame('Honest Inc', 'saas', 'technical', { challenge: { label: 'Daily #7', cap: 104 } })
const poison = (mutate: (g: Record<string, unknown>) => void): string => {
  const g = JSON.parse(JSON.stringify(honest)) as Record<string, unknown>
  mutate(g)
  return save(g)
}

console.log('\n--- 1. the control: an honest save still loads completely ---')
ok('an untouched real save round-trips through localStorage', () => {
  const r = loadSave(poison(() => {}))
  assert.strictEqual(r.merge, 'completed')
  const g = useStore.getState().game
  assert.ok(g, 'the game is live')
  assert.strictEqual(g!.companyName, 'Honest Inc')
  assert.strictEqual(g!.sector, 'saas')
  assert.ok(Number.isFinite(g!.cash) && g!.cash > 0, 'cash survived intact')
})

console.log('\n--- 2. structurally impossible saves degrade to a fresh start ---')
for (const [name, game] of [
  ['an empty object', {}],
  ['a string', 'pwn'],
  ['an array', [1, 2, 3]],
  ['a number', 42],
  ['true', true],
] as [string, unknown][]) {
  ok(`game as ${name} loses the save instead of crashing`, () => {
    const r = loadSave(save(game))
    assert.strictEqual(r.threw, null, 'rehydrate must never throw out to the caller')
    assert.strictEqual(useStore.getState().game, null, 'and must not leave a half-built game live')
  })
}
ok('a save that is not JSON at all is ignored', () => {
  const r = loadSave('{{{ not json')
  assert.strictEqual(r.threw, null)
  assert.strictEqual(useStore.getState().game, null)
})
ok('an empty save is ignored', () => {
  const r = loadSave('')
  assert.strictEqual(r.threw, null)
  assert.strictEqual(useStore.getState().game, null)
})

console.log('\n--- 3. hostile VALUES inside a structurally valid save ---')
// These load — the shape is right — so what matters is that nothing downstream sees a NaN, an
// Infinity or a negative user count it will happily persist back.
for (const [field, value] of [
  ['cash', NaN],
  ['cash', Infinity],
  ['cash', -Infinity],
  ['cash', 1e308],
  ['cash', 'lots'],
  ['users', -1e300],
  ['users', NaN],
  ['week', -5],
  ['valuation', Infinity],
] as [string, unknown][]) {
  ok(`${field} = ${String(value)} does not throw on load`, () => {
    const r = loadSave(poison((g) => void (g[field] = value)))
    assert.strictEqual(r.threw, null)
  })
}

console.log('\n--- 4. prototype pollution ---')
ok('a save cannot reach Object.prototype through __proto__', () => {
  loadSave('{"state":{"game":{"__proto__":{"pwned":"yes"},"allocation":{}},"screen":"market"},"version":9}')
  assert.strictEqual((Object.prototype as unknown as { pwned?: unknown }).pwned, undefined)
  assert.strictEqual(({} as unknown as { pwned?: unknown }).pwned, undefined)
})
ok('a save cannot reach Object.prototype through constructor.prototype', () => {
  loadSave('{"state":{"game":{"constructor":{"prototype":{"pwned2":"yes"}},"allocation":{}},"screen":"market"},"version":9}')
  assert.strictEqual((Object.prototype as unknown as { pwned2?: unknown }).pwned2, undefined)
})
ok('a hostile capability set cannot switch features on', () => {
  const r = loadSave(poison((g) => void (g.capabilities = { pvpActions: 'yes', leaderboard: 1, __proto__: { x: 1 } })))
  assert.strictEqual(r.threw, null)
})

console.log('\n--- 5. the slices that claim to drop rather than repair ---')
// The property that matters for security is not "dropped" versus "repaired" — it is that the
// function never hands back a HALF-valid slice. A garbage slice may come back as `undefined`
// (dropped) or as a structurally complete empty world (rebuilt); both are states the composer
// can survive. What must never happen is `characters` coming back as the string it was given.
const worldIsSafe = (v: unknown): boolean =>
  v === undefined || (!!v && typeof v === 'object' && typeof (v as { characters?: unknown }).characters === 'object')
ok('a malformed living-world slice never survives as itself', () => {
  for (const bad of ['nope', 42, true, [], { characters: 'not an array' }, { characters: 42, promises: 'x' }]) {
    assert.ok(worldIsSafe(migrateLivingWorldSlice(bad as never)), `world slice from ${JSON.stringify(bad)}`)
  }
})
ok('...and an absent one stays absent (absence is a legal state)', () => {
  assert.strictEqual(migrateLivingWorldSlice(undefined), undefined)
})
ok('a malformed token slice is dropped, not repaired', () => {
  assert.strictEqual(migrateTokenSlice('nope' as never), undefined)
  assert.strictEqual(migrateTokenSlice({ supply: 'nope' } as never), undefined)
})
ok('...and an absent one stays absent — that is what "institutional" means', () => {
  assert.strictEqual(migrateTokenSlice(undefined), undefined)
})

console.log('\n--- 6. the replay journal is a work multiplier, so its length is a weapon ---')
// App.tsx renders a finished run through `useMemo(() => verifyRun(game))` — synchronously, on
// the main thread. Every `advance` entry in the journal costs a full simulated week (~1.4ms
// measured), so journal length converts directly into tab freeze. recordJournal already refuses
// to keep a journal past JOURNAL_LIMIT; sanitizeJournal accepted ten times that on the way back
// in, which is the whole of the bug — the writer's ceiling was not the reader's.
ok('a journal longer than the writer could ever have produced is refused', () => {
  const bomb = Array.from({ length: JOURNAL_LIMIT + 1 }, () => ({ a: 'advance', w: 0 }))
  // deliberately not assert.strictEqual: on failure it would render a 20001-element diff and
  // hang the suite harder than the bug under test
  assert.ok(sanitizeJournal(bomb) === undefined, `a ${JOURNAL_LIMIT + 1}-entry journal must not load`)
})
ok('a much larger bomb is refused just as flatly', () => {
  const bomb = Array.from({ length: JOURNAL_LIMIT * 10 }, () => ({ a: 'advance', w: 0 }))
  assert.ok(sanitizeJournal(bomb) === undefined, 'a 200k-entry journal must not load')
})
ok('a journal AT the writer’s ceiling still loads (the honest maximum must survive)', () => {
  const max = Array.from({ length: JOURNAL_LIMIT }, () => ({ a: 'advance', w: 0 }))
  assert.ok(sanitizeJournal(max)?.length === JOURNAL_LIMIT, 'the legal maximum must not be refused')
})
ok('an ordinary journal is untouched', () => {
  const real = [
    { w: 1, a: 'advance' },
    { w: 1, a: 'marketing', p: { v: 5000 } },
    { w: 2, a: 'advance' },
  ]
  assert.deepStrictEqual(sanitizeJournal(real), real)
})
ok('a journal with one malformed entry refuses the WHOLE log rather than silently editing it', () => {
  assert.strictEqual(sanitizeJournal([{ w: 1, a: 'advance' }, { a: 1 }]), undefined)
  assert.strictEqual(sanitizeJournal([{ w: 1, a: 'advance' }, null]), undefined)
})
ok('a journal that is not an array at all is refused', () => {
  assert.strictEqual(sanitizeJournal('advance'), undefined)
  assert.strictEqual(sanitizeJournal({ 0: { w: 1, a: 'advance' }, length: 1 }), undefined)
})

console.log('\n--- 7. the other localStorage keys ---')
ok('a corrupt hall of fame degrades to empty rather than throwing', () => {
  for (const bad of ['{{{', '"a string"', '42', 'null', '{"not":"an array"}']) {
    mem.set('founder-mode-hall', bad)
    assert.deepStrictEqual(readHall(), [], `hall value ${bad}`)
  }
})
ok('...and a real hall of fame still reads back', () => {
  const runs = [{ company: 'A', sector: 'B2B SaaS', ending: 'ipo', weeks: 10, score: 5 }]
  mem.set('founder-mode-hall', JSON.stringify(runs))
  assert.deepStrictEqual(readHall(), runs)
})
ok('corrupt replay proofs degrade to empty rather than throwing', () => {
  for (const bad of ['{{{', '"str"', '{"a":1}', 'null']) {
    mem.set('founder-mode-replay-proofs', bad)
    assert.deepStrictEqual(storedReplayProofs(), [])
  }
})

console.log('\n--- 8. a poisoned player id must not become someone else’s ---')
// myId() returns whatever is in localStorage. normalizePlayer used to TRUNCATE the id to 64
// chars while checking it against the untruncated presence key, so two different presence keys
// sharing a 64-char prefix collapsed to one NetPlayer.id — defeating the one guarantee presence
// actually offers ("the key is the identity of record") and, now that the broadcast roster is
// built from readPlayers(), letting a forged id into the bid gate.
ok('an over-long presence id is refused, not silently truncated into a collision', () => {
  const victim = 'a'.repeat(64)
  const attacker = victim + 'PADDING'
  assert.strictEqual(normalizePlayer({ id: attacker, company: 'Evil' }, attacker), null)
})
ok('two over-long keys sharing a prefix cannot collapse onto one identity', () => {
  const a = 'b'.repeat(64) + '1'
  const b = 'b'.repeat(64) + '2'
  assert.strictEqual(normalizePlayer({ id: a, company: 'A' }, a), null)
  assert.strictEqual(normalizePlayer({ id: b, company: 'B' }, b), null)
})
ok('an id carrying the commitment delimiter is refused', () => {
  assert.strictEqual(normalizePlayer({ id: 'abc|def', company: 'X' }, 'abc|def'), null)
})
ok('a REAL id (96 bits of hex) is accepted unchanged', () => {
  const real = 'deadbeefdeadbeefdeadbeef'
  const p = normalizePlayer({ id: real, company: 'Rival Inc' }, real)
  assert.ok(p)
  assert.strictEqual(p!.id, real)
})
ok('an id at exactly the 64-char ceiling still works', () => {
  const edge = 'c'.repeat(64)
  assert.ok(normalizePlayer({ id: edge, company: 'X' }, edge))
})

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log(`\n${passed} assertions passed\n`)
process.exit(0)
