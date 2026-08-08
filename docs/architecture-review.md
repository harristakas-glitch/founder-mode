# Founder Mode — structural review

**Date:** 2026-08-08 · **Base commit:** `e963294` · **Scope:** everything except `src/net/**` and
`supabase/**`, which were treated as read-only (they hold the security agent's uncommitted fixes
awaiting the v5 migration and were not touched — `git diff` confirms the only changes to
`src/net/**` in the tree are the ones that were already there when this review started).

Third of three reviewers. Findings the security review (`docs/security-review.md`) and the gameplay
review (`docs/gameplay-review.md`) already made are not repeated; where one of them is load-bearing
for a structural conclusion it is cited rather than restated.

---

## Behaviour proof

`npm run bots` (24 seeds × 90 weeks × B2B SaaS and Fintech × 3 strategies) was captured before the
first edit and after the last.

```
$ diff bots-before.txt bots-after.txt
$ echo $?
0
```

**Byte-identical.** Every median, every survival count, every PMF histogram. The run was also
re-diffed at two intermediate points (after the engine changes, and again after the capability-table
changes) and was identical at each. `npm run build` (`tsc -b` + vite) and `npm test` (7 suites) pass.

---

## Summary

| | Finding | Status |
|---|---|---|
| **A** | An unreferenced 6KB module, `src/game/pvp.ts`, appeared in the tree during this review | **Flagged — do not lose it** |
| **B** | Three separate implementations of `hasCapability`; one direct `s.capabilities?.x` read | Fixed |
| **C** | Two capabilities describe running systems as absent (`narrativeDirector`, `proceduralMedia`) | Fixed |
| **D** | `hiring-market.test.ts` tested a copy of the source pasted into the test file | Fixed — mutation-verified |
| **E** | Six more assertions that could not fail, or passed on an empty array | Fixed |
| **F** | Seven presentation tables duplicated across five files; one carried a latent crash | Fixed |
| **G** | `TimelineChart`'s area fill did not retint with the sector accent | Fixed |
| **H** | `engine.ts` at 2,599 lines | **Proposed — partial split only** |
| **I** | `src/game/world/**`: 6,821 lines, 41 unused exports, ~35% reachable | **Proposed** |
| **J** | Five copies of mulberry32, three of FNV-1a, ten of `clamp` | **Proposed** |
| **K** | `INVESTORS` shuffled with a random sort comparator — engine-dependent determinism | **Proposed — cannot fix without changing numbers** |
| **L** | `RNG` is a mutable global with no guard against unseeded draws | **Proposed** |
| **M** | Two `store.ts` security patches from the previous review are still unapplied | **Flagged** |
| **N** | ~30 further UI duplications and drifts | Catalogued, not fixed |

---

# A. Something wrote `src/game/pvp.ts` during this review

**This is the first thing to deal with, because it is the only finding with a risk of data loss.**

`src/game/pvp.ts` (6,155 bytes, 195 lines, mtime today 19:40) was **not present** in the file
inventory taken at the start of this session and **not present** in the git status snapshot the
session began with. It is untracked. Nothing in `src/` or `test/` imports it.

It is not a stub. It is a finished, commented implementation of two new Arena attacks —
a multi-week hit-piece campaign with an escalating backfire chance
(`backfireChance(n) = min(0.75, 0.18 + n × 0.19)`), and a price war that cuts the attacker's own
revenue for its duration. It stores state in `s.flags` specifically so no save migration is needed.
It exports `PR_CAMPAIGN_WEEKS`, `PR_DECOY_WEEKS`, `PR_BASE_COST`, `backfireChance`, `prBackfired`,
`prSourceHidden`, `PRICE_WAR_WEEKS`, `PRICE_WAR_COST`, `CONCEDE_USER_SHARE` and `tickPvpEffects` —
and **every one of them is unused**, because the call into `tickPvpEffects` was never added to
`advanceWeek` and no UI reaches it.

I did not write it and I have not touched it. Given the brief describes several parallel agents, the
likely explanation is another session working the same checkout. What matters is:

- It is **untracked**, so `git clean` or a fresh clone destroys it.
- It is invisible to `npm test` and `npm run bots`, and `tsc -b` compiles it without complaint
  because it has no type errors — so nothing will tell you it is half-landed.
- If a second agent is live in this checkout, my commits and theirs will interleave.

**Action for the owner:** decide whether that work is wanted. If yes, `git add src/game/pvp.ts` now
so it cannot be lost, then wire `tickPvpEffects` into `advanceWeek` and the attack UI. If no, delete
it deliberately. Leaving it untracked and unreferenced is the one option that costs you the work
without telling you.

---

# B. The capability rule — every violation found, all fixed

The stated rule is: branch on `hasCapability(state, key)`, never on `mode === '...'`.

The rule held better than expected on the `mode ===` half. It had failed on a subtler axis: **three
separate re-implementations of `hasCapability` itself**, none of which was a *use* of a mode check
but all of which were second definitions of what "on" means.

### B1. `src/game/engine.ts:95` — the engine's private copy

```ts
const can = (s: GameState, k: CapabilityKey): boolean => s.capabilities?.[k] ?? false
```

`can()` is used ~30 times through the engine and is exactly the right shorthand — but it was a
*copy* of `hasCapability`, not a call to it. Identical today; silently divergent the first time
`hasCapability` gains a default, a legacy fallback or a dev warning. `engine.ts` did not even import
`hasCapability`.

**Fixed** — `can` now delegates: `const can = (s, k) => hasCapability(s, k)`, with the reason in a
comment so nobody "optimises" it back.

### B2. `src/store.ts:120` — the React hook's copy

```ts
export function useGameCapability(key) { return useStore((s) => s.game?.capabilities?.[key] ?? false) }
```

Third copy, in the file that already imported `hasCapability`. **Fixed** —
`useStore((s) => hasCapability(s.game, key))`.

### B3. `src/game/world/tick.ts:291` — the one you already knew about

```ts
const depth = s.capabilities?.relationships ? 'deep' : hasCapability(s, 'pvpActions') ? 'competitive' : 'light'
```

Both styles in a single ternary. **Fixed** — `hasCapability(s, 'relationships')`.

### B4. `mode === ` checks — audited, all legitimate, none changed

Four remain and none should be removed:

| Site | Verdict |
|---|---|
| `src/App.tsx:914,921,927` | Result-screen cross-promotion copy ("Try Career", "Play a Quick run"). This is *about* the modes; there is no capability that means "suggest the other product". Correct as written. |
| `src/game/engine.ts:2474` (`e.modes.includes(...)`) | Documented as brief §33: an event card may opt into a mode. A second axis, deliberate, and it sits alongside `e.requiresCapabilities` which is checked on the same line. |
| `src/game/achievements.ts:20` (`a.modes`) | Same pattern for achievements. |
| `src/game/modes.ts` | The resolver itself. |

**Recommendation, not applied:** the deck has zero cards using `e.modes` and zero using
`e.formats` today (`grep` finds no `modes:` or `formats:` key in `src/game/data.ts`). Both fields are
dead capability-shaped API. If a card ever needs mode gating, prefer a capability — otherwise the two
axes will diverge and "which one wins" becomes a real question.

---

# C. Two capabilities describe running systems as absent — fixed

This is the reverse of the failure mode `modes.ts` guards against. Its stated rule is *"a capability
is never on before the code that honours it exists."* Two flags had failed the mirror rule: **the
code exists, runs in every mode, and the flag says it does not.**

- **`narrativeDirector: false`** everywhere — yet `directWeek()` is called unconditionally from
  `composeWeeklyBeat` (`src/game/world/tick.ts:292`) and scores every narrated week. It has its own
  176-line module and its own test suite.
- **`proceduralMedia: false`** everywhere — yet `emit()` composes with `audience: 'media'` for every
  company-level fact (`src/game/world/tick.ts:240`), drawing from `content/composer-media.ts`.

Both run whenever `proceduralNarrative` runs, because neither has a switch of its own.

**Fixed** by making the declaration true where the system runs (Quick and Arena; Career inherits
Quick). This is behaviour-neutral — verified by the byte-identical bots run — because *nothing
branches on either flag*. It is a correction to the register, not a feature flip. A regression test
now pins it:

```ts
// test/modes.test.ts
ok(caps.narrativeDirector === caps.proceduralNarrative && caps.proceduralMedia === caps.proceduralNarrative, ...)
```

### C2. The ENFORCED / DESCRIPTIVE comment block had drifted — fixed

The header comment in `modes.ts` is the map people read before assuming a flag does something. It
was wrong in three directions, verified key-by-key with `grep -rn "'<key>'" src`:

- **Listed as ENFORCED, but nothing branches on them:** `customerSegments`, `decisionJournal`. Both
  are implied by `detailedPMF` — the segment model and the journal are inside the Career subsystem,
  so `game.career` existing *is* the switch. Turning either off alone does nothing.
- **Enforced but missing from the list entirely:** `sharedHiringPool` (7 call sites) and the whole
  living-world set — `persistentCharacters`, `characterMemory`, `companyMemory`, `relationships`,
  `proceduralNarrative`, `promises`.
- **Not classified at all:** `narrativeDirector`, `proceduralMedia` (see above).

The comment is now accurate and says how to re-check it.

### C3. Capabilities that are declared but honoured by nothing — inventory

29 of the 61 keys have **zero** references outside `modes.ts`. All are `false` in every mode, so none
is a lie — this is the roadmap surface working as designed. Recorded so the count is known:
`advancedCohorts, advisorOpinions, deepDistribution, deepEmployees, detailedDebt, detailedFundraising,
detailedIPO, educationalPostmortem, emergentCulture, founderCareer, investorPersonalities,
longTermCallbacks, managementCapacity, playerAcquisitions, proceduralBoardMeetings,
proceduralPostmortem, productPortfolio, rivalArchetypes, rivalNarrative, sharedCustomerMarket,
sharedInvestorMarket, simultaneousResolution, structuredEmployeeConversations, structuredInterviews,
technicalDebt, boardPolitics, cofounders, delegation, executives, founderAttention,
founderDependency, humanRivals, livingWorld, negotiations, sharedTalentMarket`.

The one worth naming: **`promises` is honoured** (`src/game/world/memory.ts:856,861,871`) and is
`false` in every mode, so a ~120-line promise subsystem — `recordPromise`, `resolvePromise`,
`expireDuePromises`, `openPromises`, `promisesComingDue`, `evictPromises` — is built, correct and
completely unreachable. See §I.

---

# D & E. Test quality — the two failures you described, found and fixed

You said twice today a test passed while the live game was visibly broken. Both mechanisms are
present in the suite. Every fix below was **verified by mutation**: break the source, confirm the
test now fails, restore.

### D. `test/hiring-market.test.ts:118-137` — a test that tested a copy of itself

This is the worst thing in the suite and the direct cause of the class of failure you described.

The block carried a **character-for-character transcription** of `acceptChance` from
`engine.ts` and of the `ROLE_BASE` table, then asserted against its own copy. Five green ✓ lines,
zero engine code executed. The most striking:

```ts
ok(Math.abs(accept(10, 30, ROLE_BASE_TEST[skilled.role] + skilled.skill * 13_000, skilled) - 0.745) < 0.01,
   'an offer at the market rate is unchanged from before the fix — Quick Play balance is untouched')
```

At the market rate `overPay === 0`, so this reduces to `|0.745 − 0.745| < 0.01`. It claims to guard
Quick Play balance. It guards nothing.

**Fixed.** Extracted `offerAcceptChance(s, c, runwayNow)` and `marketSalary(role, skill)` as exports
from `engine.ts` (`src/game/engine.ts:449-473` and `:359-368`), replaced the inline block in
`advanceWeekInner` with a call, and rewrote the test to drive the real function against a real
`newGame` state. `marketSalary` also absorbed the same `ROLE_BASE[role] + skill * 13_000` expression
that was written out four times in the engine.

**Mutation evidence:**

| Mutation to `engine.ts` | Before | After |
|---|---|---|
| `overPay * 0.18` → `overPay * 0.0` (delete the premium term) | ALL PASS | ✗ ×2 — `paying over the odds materially improves acceptance (75% → 75%)` |
| `runwayNow < 10` → `runwayNow > 0 && runwayNow < 10` (restore the original bankruptcy-exemption bug) | ALL PASS | ✗ — `nine weeks of runway and already-bankrupt both cost the full 25 points (49.5% / 74.5%)` |

Both are now caught. Neither was before. The acceptance values are pinned to `1e-9`, not `0.01`.

### E. Assertions that could not fail, or passed on an empty array

| Where | Was | Now |
|---|---|---|
| `world-director.test.ts:84-93` | Three assertions (`maxRun <= 1`, distinctness, seed determinism) **all pass on an empty `titles` array** — `0 <= 1`, `0 >= 0`, `"[]" === "[]"`. `titles` only fills while `world.narrative.emitted` is keyed by inbox message id, which is exactly the coupling a refactor breaks. | `ok(titles.length >= 5, ...)` guard added first, converting all three from vacuous-tolerant to real. |
| `world-director.test.ts:55` | `twins.secondary.every(...)` over a provably empty array. Passes if `secondary` is hardwired to `[]`. | `ok(twins.secondary.length === 0)` plus a positive control proving the dedupe is per-*type*, not a blanket drop. |
| `world-director.test.ts:42` | The "quiet week" scored 0.11 against a 0.12 floor and the candidate was, by `directWeek`'s own novelty fill-in, **maximally novel**. Passed by 0.01; one weight tweak from silent failure. | `lastSeen` supplied so novelty is genuinely 0, plus a paired assertion that dropping `minScore` makes the same candidate lead — proving the *floor* is doing the work, not an empty pipeline. |
| `world-director.test.ts:34` | `mid > 0 && mid < 1` on a value that is exactly `8/16`. Admits a curve that recovers in one week or in a century. | `mid === 8 / NOVELTY_MEMORY_WEEKS`, derived from the exported constant. |
| `world-director.test.ts:50, 59` | `secondary.length <= 2` (structurally guaranteed by the budget) and `?.id === ?.id` (`undefined === undefined` if the floor filtered both out). | Exact identities (`'mid,small'`, `'a'`), plus a fourth-candidate case proving the cap actually cuts. |
| `modes.test.ts:74` | `!!advanceWeek(careerGame)` — `advanceWeek` always returns an object. | `week + 1`, career subsystem preserved, not game-over. |
| `modes.test.ts:64` | `ALL_CAPABILITY_KEYS.length > 20` — satisfied by any enum, including one with 21 duplicates. | No duplicates, every key resolves to a boolean, and the list length equals the resolved capability object's — i.e. the list **is** the surface. |
| `rules.test.ts:59` | `a.users >= 3_200`. Written before the `leverage` term existed; the real value is 9,600. Deleting leverage entirely left it passing at a third of the truth. | `a.users === Math.round(raidMagnitude(100_000) * 0.8 * 3)` — exact, leverage included. |
| `rules.test.ts:72` | `v.users < 50_000`. **This is the assertion that let the player-reported raid bug ship** — a raid moving 5 users satisfied it for the defect's entire life. | `v.users === 50_000 - raidMagnitude(50_000)`. |
| `rules.test.ts:116` | `raidMagnitude(40) <= 40 * 0.16` — asserting 16% to guard a 15% cap. | `=== Math.round(40 * 0.15)`, plus a sweep across the small-company range. |
| `rules.test.ts:80,83,87` | `40_000` / `480_000` / `120_000` hardcoded beside exported constants, hiding that attacks and shields scale by *different rules*. | Derived from `ATTACKS`, `SHIELD_BASE_COST` and `STAGES`; `buyShield` is now asserted to charge what `shieldCost` says. |
| `career-pmf.test.ts:176` | `blaster.cash < patient.cash` after spending $250k/wk vs $15k/wk. True by subtraction; passes if marketing acquires **zero** users. | Cost per surviving customer — the efficiency claim the section header actually makes. |
| `career-pmf.test.ts:307` | `Object.values(...).some(v => typeof v === 'number')` on a `Record<_, number>`. Passes if every segment is 0. | `some(v => v > 0 && v <= 1)`, with the values in the message. |
| `career-pmf.test.ts:259` | `!second \|\| ...` — passes if `suggestedExperiment` regressed to returning null whenever anything is in flight, which is a *worse* bug than the one guarded. | Split into two assertions. |
| `career-pmf.test.ts:363` | `< 28_000` where the comment's own arithmetic says the answer is a few thousand. A bug charging $27k in bogus fees passed cleanly. | Derived from `weeklyOffice(rich) * 20 * 1.5` **and** `< experimentDef('pilot').cashCost`. A single spurious renewal now fails it. |
| `career-pmf.test.ts:248` | Message said "never twice running", bound said `<= 2`. Direct contradiction; the bound had clearly been relaxed to match observed output. | Bound kept (it is the honest one — a suggestion legitimately persists for the week it is acted on), **message corrected** to state what is actually enforced. |

### E2. The suite had almost no positive controls — one added, one shown to be impossible

Six assertions verified a system is *suppressed* with no paired assertion that it *fires*. If story
arcs were broken in every mode, `rules.test.ts:41` would still be green.

**Added** to `rules.test.ts`: a Quick Play control run that actually hires, asserting arcs do start
(2 in 120 weeks) and 1:1 asks do arrive.

**Recorded rather than faked:** the two board assertions in the PvP block
(`no board strikes accrued`, `no board review messages`) are vacuous in *both* modes. `s.board` is
only created by `acceptTermSheet`, neither fixture ever raises a round, so `boardReview` returns on
its first guard regardless of the capability. Making them real needs a fixture that accepts a term
sheet. Noted in the test file rather than papered over.

### E3. A code/comment mismatch the strengthened test surfaced

Writing the energy assertion honestly required measuring what the system does, and it does not match
its own comment. `advanceWeek` applies:

```ts
s.energy = clamp(s.energy + 3 - (s.ipo ? 4 : 0) - (stressed ? 3 : 0), 0, 100)
```

so cash stress **exactly cancels** the weekly recharge and can never push the tank down. Measured
over 12 weeks with runway pinned under 8: energy is flat at 80.00, never lower. The comment above it
says *"slow recovery, faster erosion under stress"*, which overstates the second half — only founder
*actions* (`drainEnergy`: pivot −12, roadshow −10, IPO −10, all-hands −8, M&A −8, attack −4) reduce
it. The old assertion `std.energy !== 80 || std.week < 10` passed on a run where energy only ever
went **up** (83→100).

I did **not** change the formula — that is a balance decision. The test now pins the real behaviour
in three parts (recovery to 100 when unstressed; exactly flat under stress; −12 on a pivot) so a
future change to either half is a visible diff. **Owner decision:** make stress erode, or fix the
comment.

---

# F & G. Duplication across the boundary — fixed

### F. Seven presentation tables lived in five files

The one you named was the smaller half of it.

| Table | Copies | State |
|---|---|---|
| `SECTOR_ACCENTS` | `App.tsx:51`, `NewGame.tsx:37` | byte-identical |
| `MODE_ACCENTS` | `NewGame.tsx:29` | re-states three `SECTOR_ACCENTS` rows verbatim |
| ending → emoji | `App.tsx:74` (`ENDING_EMOJI`), `NewGame.tsx:23` (`ENDING_ICON`), `DailyLeaderboard.tsx:11` (`ENDING_EMOJI`) | same values, **three names** |
| ending → label | `Career.tsx:6` (`ENDING_META`, field `.name`), `shareImage.ts:6` (`ENDING_META`, field `.title`) | **same identifier, two different types, two label vocabularies** |
| `GAME_URL` | `App.tsx:73`, `shareImage.ts:147` | agree in substance, drifted in form |

Fallback handling had drifted five ways across the six emoji call sites: no fallback, `?? ''`,
`?? '🏁'` — and `shareImage.ts:42-43` dereferenced the lookup directly:

```ts
const e = ENDING_META[g.gameOver.type]
add(g.gameOver.week, e.emoji, e.title)   // throws on an unrecognised ending
```

That is a latent crash in the share-card path, reachable from any save or wire value carrying an
ending the table does not know.

**Fixed** — new `src/theme.ts` (73 lines, no imports beyond a type, deliberately React-free so
`shareImage.ts` can use it without pulling in React) holding `SECTOR_ACCENTS`, `sectorAccent()`,
`MODE_ACCENTS` (now *derived from* `SECTOR_ACCENTS`, so the two cannot drift), `ENDINGS` keyed on
`GameOver['type']` with `{emoji, name, title}` — **both** label vocabularies preserved exactly —
plus `endingEmoji()` which never throws, and `GAME_URL`. All five consumer files updated; `grep`
confirms no copies remain.

A new file is justified here: `App.tsx` cannot own it (screens importing from `App` is a cycle) and
`components.tsx` cannot (it imports React, and `shareImage.ts` draws to a canvas).

### G. `TimelineChart`'s area fill did not retint with the sector — fixed

`src/components.tsx:382`:

```tsx
<polygon ... fill="rgba(124,154,255,0.15)" />                       {/* literal SaaS blue */}
<polyline ... stroke="var(--color-accent)" />                       {/* retints per sector */}
```

`App.tsx` rebinds `--color-accent` per sector, so on a fintech, social or ecommerce run the line
retinted and the area under it stayed blue. **Fixed** — `fill="var(--color-accent)"` +
`fillOpacity="0.15"`, exactly equivalent when the accent is the SaaS blue.

### G2. Two unused exports in `components.tsx` — made local

`useTicker` and `CARD` were exported with zero consumers outside the file. Both are now
module-private, with a comment saying what to use instead (`Ticker`, `Panel`).

---

# H. `engine.ts` at 2,599 lines — split the leaves, keep the tick whole

**Honest answer: it is mostly cohesive, and a full split would move complexity rather than remove
it. A partial split is worth doing. Splitting `advanceWeekInner` is not.**

The file has 25 labelled sections and reads well. The question is which of them are genuinely
entangled. Measuring by what reads or writes `GameState` mid-tick:

**The genuinely coupled core (~1,050 lines) — leave together:**

| Lines | What |
|---|---|
| 34-158 | `uid`, `mulberry32`, `withSeed`, `mixSeed`, `seeded`, `can`, legacy migration |
| 159-354 | `newGame` / `buildGame` / `sanitize` / `applyScenario` |
| 499-636 | valuation, growth, finances, market — read by ten other sections |
| 637-745 | `applyEffects` — the write-side funnel for every system |
| 1103-1564 | **`advanceWeek` / `advanceWeekInner`, 461 lines** |

`advanceWeekInner` is one long function and it should stay one long function. Its correctness is the
**order of the RNG draws**: macro, then engineering, then bet, then ventures, then hype, then
acquisition, then revenue, then offers, then morale, then rivals, then events, then arcs. Every
number the game produces depends on that sequence. Extracting `tickHype(s)` and `tickMorale(s)` into
another file buys you shorter functions and costs you the one property the whole simulation rests
on — and the failure mode is silent: the tests pass, `npm run bots` produces different numbers, and
nobody knows which extraction did it. The `seeded()` guard around `tickLivingWorld` at line 1561
exists for exactly this reason and its comment says so.

**The leaves (~1,100 lines) — safe to move, because `advanceWeekInner` calls into them at most once
and never interleaves with them:**

| Proposed module | Lines today | Entry points from the tick |
|---|---|---|
| `engine/pvp.ts` | 1979-2130 | none (only three `s.flags` decrements) |
| `engine/ma.ts` | 2225-2293 | none |
| `engine/pitch.ts` | 2132-2223 | none |
| `engine/debt.ts` | 1728-1815 | `covenantCheck(s)` ×1 |
| `engine/ipo.ts` | 1566-1682 | `tickIPO(s)` ×1 |
| `engine/board.ts` | 2295-2406 | `boardReview(s)` ×1 |
| `engine/people.ts` | 355-497, 1817-1933 | `maybeOneOnOne(s)` ×1 |
| `engine/milestones.ts` | 746-858 | `checkMilestones(s)` ×1 |
| `engine/ventures.ts` | 860-984 | none |

`engine.ts` becomes a barrel re-exporting all of them, so no import in `src/store.ts` (33 named
imports from `engine`) or any test changes.

**Risk assessment:** low but non-zero. Each moved section is pure-ish (mutates `s`, reads
`RNG.next()`), and moving code cannot change draw order as long as call sites stay in place. The
real hazards are (1) circular imports — `pvp.ts` needs `applyEffects` and `attackCost` needs
`STAGES`, so the core must not import back from the leaves; (2) an accidental reordering of two
adjacent statements during the move. Both are caught by the byte-identical bots run, which is the
same gate this review used.

**Expected benefit:** `engine.ts` drops to ~1,500 lines. That is real but modest, and it does not
touch the 461-line function that is the actual reading difficulty. **My recommendation: do it when
you next need to change one of those systems, not as a standalone refactor.** A large refactor that
breaks a working, deployed game is a worse outcome than a large file.

---

# I. `src/game/world/**` — the five-agent seams

6,821 lines across 13 modules. The external surface is **five symbols**: `livingWorldActive`,
`tickLivingWorld`, `migrateLivingWorldSlice`, `LivingWorldState`, `LivingWorldDepth`. Everything else
is internal — or unused.

**41 exports have exactly one occurrence in the entire codebase: their own declaration.**

| Module | Lines | Unused exports | Assessment |
|---|---|---|---|
| `memory.ts` | 873 | 13 | **Pulls the least weight.** `tick.ts` uses two functions: `recordCompanyMemory` and `sortedCharacterIds`. |
| `characters.ts` | 698 | 8 | Six `characterFrom*` / `create*Character` constructors superseded by the `*Spec` + `ensureCast` path `tick.ts` actually uses. |
| `composer.ts` | 680 | 7 | Includes `validateFragmentLibrary` — a content-integrity checker nothing runs. |
| `persistence.ts` | 760 | 2 | `compactLivingWorld` + `livingWorldFootprint` are a whole budget-enforcement path (`LIVING_WORLD_BUDGET_BYTES`) that never executes; `enforceLivingWorldLimits` is what actually runs. |
| `relationships.ts` | 594 | 2 | |
| `director.ts` | 175 | 0 | **The one module that is exactly the right size for its job.** |

### The two seams that will actually cost you

**I1. Two independent memory-selection engines.** `memory.ts` has a scored recall system —
`resolveCue`, `scoreMemoryRelevance`, `recallMemories`, `topMemory`,
`charactersWithRelevantMemory`, with tag scoring, relationship weighting and half-life decay
(~200 lines). None of it is called. `composer.ts:333` has its own, simpler
`selectMemoryCallback` — and *that* is the one on the live path (`composer.ts:464`). Two agents
solved the same problem against the same contract, and the winner was decided by which one
`tick.ts` happened to import. When someone next tunes memory recall they will find the wrong one
first, because it is the bigger and more thorough of the two.

**I2. `characterMemory` is half-honoured.** The capability is `true` in Quick Play and Career.
Memories *are* written (`recordCompanyMemory`'s `remember` path) and *are* read — but only through
`composer.ts`'s callback selector, never through the recall engine built for it. So the write side
runs at full cost in every Quick Play run and roughly a quarter of the read side exists.

**Proposal — do not delete, but mark and cap.** Most of this is deliberate scaffolding written to
`docs/procedural-living-world-system.md` for phases 4-7, and deleting it throws away correct work.
Concretely:

1. Add a `// PHASE N — not yet wired` banner to each unused export block, naming the capability that
   will switch it on. Cheap, and it converts "is this dead?" from an investigation into a glance.
2. Pick one memory selector. My recommendation is to keep `memory.ts`'s scored engine (it is the more
   complete one and it is what the design document describes) and make `composer.ts` call it, deleting
   `selectMemoryCallback`. That **would** change narrative wording, so it needs its own before/after —
   which is why it is a proposal and not a fix.
3. `memory.ts` at 873 lines is doing four jobs: character memory, company memory, promises, and
   normalisation/migration. Splitting on those lines is low-risk because nothing outside `tick.ts` and
   `persistence.ts` imports it.

**Risk:** the banners are zero-risk. Unifying the selectors is medium — it changes text, not
numbers, so `npm run bots` will not catch a mistake. Do it with a saved corpus of composed messages.

---

# J. Five copies of the PRNG, three of the hash, ten of `clamp`

The clearest fingerprint of the parallel-agent build.

**mulberry32 — five copies:** `engine.ts:41`, `world/composer.ts` (both using `| 0`),
`world/characters.ts:106`, `career/segments.ts:198`, `career/pmf.ts:590` (all using `>>> 0`).

I verified the two variants are **bit-identical** — `>>>` coerces to uint32 before shifting and
`Math.imul`/`^`/`|` all coerce to int32, so the signed and unsigned accumulators produce the same
stream. That they *happen* to agree is luck, not design: they were written independently and nothing
tests that they agree.

**FNV-1a — three copies:** `career/segments.ts:208`, `world/characters.ts:95`,
`world/composer.ts:75`. The first two use `2166136261` / `16777619`; the third uses `0x811c9dc5` /
`0x01000193`. Same constants, different notation, and `composer.ts`'s omits an intermediate `>>> 0`
that the other two have — harmless because `Math.imul` returns int32 and the final `>>> 0` fixes it,
but you have to work that out to know.

**`clamp` — ten copies** in two incompatible signatures: `clamp(v, lo, hi)` in `engine.ts`,
`world/memory.ts`, `world/persistence.ts`, `world/relationships.ts`; `clamp(v, lo = 0, hi = 100)` in
`career/pmf.ts`, `career/segments.ts`, `world/characters.ts`. Plus three of `clamp01`. **Reading
`clamp(x, 5)` means different things in different files** — that is the drift that will bite.

**Proposal:** one `src/game/rand.ts` exporting `mulberry32`, `fnv1a`, `stream(key, aspect)`; one
`src/game/num.ts` exporting `clamp(v, lo, hi)` and `clamp01(v)`, with the defaulted variant given a
different name (`clamp100`) so a reader can never mistake one for the other.

**Risk: medium, and higher than it looks.** The PRNG consolidation is a *behaviour* change if I get
one bit wrong, and the failure is silent — every number in the game moves. `npm run bots` catches it,
but only if the mutation reaches a Career or Quick path (`world/characters.ts`'s stream does not
affect bots at all). Do this one change-at-a-time with a bots diff between each. **I did not do it
here** precisely because the payoff (removing ~60 lines) does not justify the class of risk when a
green test suite would not tell you it went wrong.

---

# K. Determinism — one real hole, and it cannot be closed without changing numbers

The rule holds nearly everywhere. `Math.random` and `Date.now` appear only in `src/store.ts` (seed
minting, round deadlines — outside the simulation), `src/sound.ts`, `src/net/**` (CSPRNG, correctly
per the security review), and `engine.ts:212` (`opts.seed ?? Math.floor(Math.random() * 2**31)` —
the seed itself, which is correct). `career/**` takes its RNG by dependency injection and never
touches the global. `world/**` derives every stream from `(seed, id)`. Nine mutating engine entry
points are wrapped in `seeded()`; `advanceWeek` reseeds from `(seed, week, 0)`. All correct.

### K1. `uid()` uses `Date.now()` and `Math.random()` — benign, but only by accident

```ts
export const uid = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
```

This does **not** perturb the seeded stream, because `withSeed` swaps `RNG.next` and leaves
`Math.random` alone. So the *numbers* replay. The *ids* do not, which is why `world/tick.ts` had to
invent `stableCastId()` and why `sharedCandidates` uses `mk-{week}-{i}` instead. Three separate
workarounds for one function. Consequence: a save cannot be replayed byte-for-byte, so
replay-based leaderboard verification (security review, Owner decision 2) is currently impossible
without changing `uid`.

**Proposal:** make `uid` derive from `(seed, week, counter)`. This changes every id in every save and
needs a migration. Not a fix, a project.

### K2. `[...INVESTORS].sort(() => RNG.next() - 0.5)` — `engine.ts:1043`

**This is the one determinism hole that is actually a hole.** A random sort comparator is not a
shuffle: it is non-uniform (some investor orderings are far more likely than others), and — the part
that matters — **its output depends on V8's sort implementation.** `Array.prototype.sort` is only
specified to be stable; the comparison *sequence* for an inconsistent comparator is an implementation
detail. A Node or browser upgrade that changes TimSort's run detection changes which investors your
players see for a given seed.

Today the game and the bot harness both run V8, so this is invisible. It becomes visible the moment
you have a saved run replayed on a different engine version — which is exactly the leaderboard-
verification use case.

**I did not fix it**, because the correct fix (Fisher-Yates over `RNG.next()`) draws a different
number of values in a different order and **changes which investors appear for every existing seed**.
That fails the behaviour gate. It is a one-line change whenever you are willing to accept a balance
reset:

```ts
const pool = [...INVESTORS]
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(RNG.next() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
const investors = pool.slice(0, n)
```

Note `makeRivals` (`engine.ts:379`) already does it correctly with splice-based selection — so the
right pattern exists in the same file, six hundred lines away.

### K3. `RNG` is a mutable global with no guard

`src/game/data.ts:135` — `export const RNG = { next: () => Math.random() }`. Any code path that draws
outside `withSeed` silently gets true randomness and nothing complains. That is the hole
`resolveChoiceOnState` fell into (fixed, per its comment) and the reason the `livingWorldActive`
guard at `engine.ts:1561` has a four-line comment explaining that calling it unconditionally would
shift the stream for every mode.

**Proposal, low risk:** in dev builds only, have the unseeded `RNG.next` count its calls and warn
once. Something like:

```ts
export const RNG = { next: () => { if (import.meta.env?.DEV) warnUnseeded(); return Math.random() } }
```

with `withSeed` clearing the flag. Turns "a future entry point forgets `seeded()`" from a silent
replay divergence into a console warning during the first playtest.

---

# L, M. Two things that are somebody else's to land

**M1.** The security review left two `store.ts` patches explicitly unapplied because that file was
outside its ownership. They are still unapplied and they are in my scope, but they are security
changes with their own deployment order (they expect `leaderboard-v5.sql` to land first), so I have
not applied them either — landing half of a sequenced deployment is worse than landing none. Both are
one-liners:

- `src/store.ts:572` — `` `${p.fromId ?? p.fromCompany}@${g.week}` `` should be `` `${p.fromId}@${g.week}` ``. Company names are attacker-chosen, so the fallback gives an attacker unlimited free hits.
- `src/store.ts:388` — `if (host && p.hostId && p.hostId !== host.id) return null` should fail closed: `if (!host || !p.hostId || p.hostId !== host.id) return null`. Omitting `hostId` skips the check entirely.

**M2.** `tsconfig.app.tsbuildinfo` and `tsconfig.node.tsbuildinfo` are tracked in git and change on
every build, so every commit carries a spurious diff. Add both to `.gitignore` and `git rm --cached`
them.

---

# N. UI duplication not fixed — the catalogue

A full inventory was taken; the highest-value items are below. None was fixed because each either
changes a displayed number (which is a behaviour change needing your call) or is a broad mechanical
sweep better done as its own pass.

**Numbers that currently contradict each other on screen:**

1. **`App.tsx:231` re-derives the growth rate and disagrees with `engine.growthRate`.** The topbar's
   `usersTrend` returns `0` for a short history where the engine returns `0.05`, `0` where the engine
   returns `0.2`, and does not clamp. So the topbar Users trend badge and the Dashboard's
   "+X%/wk avg" (which calls `growthRate`) show different numbers for the same week — most visibly in
   weeks 1-4. **Your call which is right:** the engine's `0.05` floor is a synthetic placeholder that
   would be misleading in a topbar, so the drift may be deliberate. If it is, name it
   (`displayGrowthRate`) rather than leaving two anonymous copies.
2. **Six different runway-danger thresholds.** The engine's own gate is `runwayNow < 10`
   (`engine.ts`, offer acceptance). `App.tsx:476` matches it; `Dashboard.tsx:118,254`,
   `Finance.tsx:192` and `Hiring.tsx:140,199` all use 12. Export `RUNWAY_DANGER` / `RUNWAY_THIN`.
3. **Three answers to "is the cash position dangerous?"** — `cash < max(burn*8, 40_000)`
   (`App.tsx:472`), `cash < 40_000 && week > 6` (`Dashboard.tsx:245`), and
   `cash < committedCosts(g).recommended` (`Dashboard.tsx:83`, `Finance.tsx:157`). Only the third is
   backed by the engine. All three are visible within one click of each other.
4. **Runway is formatted at 8 sites with 4 different words for "infinite"** (`∞`, `Profitable`,
   `Profitable 🎉`, `profitable`) and **two sites forget the negative clamp** (`Dashboard.tsx:79`,
   `Hiring.tsx:86`), so they can print `-3 wk` where every other site prints `0 wk`.
5. **`Market.tsx:105` computes market share from `game.users`** while `Dashboard.tsx:259` uses
   `totalUsers(game)`. A company with a launched second product line reports a share that excludes
   those users.
6. **`Market.tsx:170` invents the player's own momentum bar** as `40 + pmf/2` while every rival's bar
   is `r.product` — which the engine computes as `productScore`. The two bars are not on the same
   scale, and the panel's caption claims they are. `productScore(game)` is already imported two
   screens away for exactly this comparison.
7. **`Coach.tsx:69` normalises the allocation with a formula that has drifted** from
   `engine.ts:1118` and `Product.tsx:169` — it includes `research` and `bet` unconditionally, so it
   mis-measures once a venture is running.

**Structural, mechanical:**

8. `ROLE_COLORS` / `ROLE_LABEL` / `ROLE_HELP` — same four keys, three files, three names, no shared
   type. `Hiring.tsx` renders `{c.role}` raw (lowercase) where `Team.tsx` renders `ROLE_LABEL[e.role]`.
9. `tone` means four different value sets across five components (`'up'|'down'`,
   `'good'|'bad'|'warn'`, …), and the tone→class ternary is re-inlined at ~12 sites. Two of them are
   byte-identical (`App.tsx:368` and `Team.tsx:93`, the founder-energy ramp).
10. `BarRow` is reimplemented byte-for-byte in `Career.tsx:74-83`; `Bar` three more times;
    `Th`/`Td` hand-written in `CareerUI.tsx:170-200` with drifted padding, so the Career segment
    table's header sits half a pixel off every other table in the game; `EmptyState` bypassed three
    times, once *inside the file that defines it*.
11. `text-[20px] font-extrabold tracking-tight` + a `text-[13px] text-mut` subtitle is copy-pasted as
    a screen header in **12 files**. There is no `ScreenHeader`.
12. The share sentence is rebuilt from scratch four times inside `App.tsx` (`:736, :946, :949, :959`).

---

# What will break first, ranked by what it will cost you

**1. The RNG draw order inside `advanceWeekInner`.** Nothing protects it. Every number the game
produces, every leaderboard score and every Arena client's agreement with every other depends on 460
lines of statements staying in exactly the order they are in. `npm test` will not notice a
reordering; only `npm run bots` will, and only if someone thinks to run it and has a baseline to
diff. The `seeded()` guard around `tickLivingWorld` shows you already hit this once. **Cheapest
insurance available:** add a golden-trace assertion to `npm test` — `modes.test.ts:138` already does
exactly this for one fixture (`'26|110909|47|2498|1668|1'`), so extend it to three seeds × 60 weeks
and a Career run. That converts the silent failure into a red test in five seconds instead of a
ten-minute bots sweep.

**2. Tests that restate their subject instead of exercising it.** The single fixed instance in
`hiring-market.test.ts` produced five green ✓ lines while executing no engine code, and the pattern
recurs in weaker form wherever a magic constant is copied out of `engine.ts` into an assertion. This
is the mechanism behind both of the failures you described this morning, and its cost is not the bug
— it is that you stopped trusting green output, which is far more expensive. **The habit that
prevents it:** when a test needs a number from the source, import the number. If it cannot be
imported, that is the finding.

**3. `src/game/world/**` growing while only a third of it is reachable.** 6,821 lines, 41 unused
exports, and two competing implementations of memory recall. This will not break — it will make every
future living-world change take three times as long, because the first hour goes on working out
which of two plausible systems is the live one. The five-agent build produced good code; what it did
not produce is a statement of which parts are load-bearing. **Cheapest fix:** the phase banners in
§I. An hour of work that saves a day per future phase.

**4. The UI recomputing simulation numbers.** Seven separate cases (§N1-7) where a screen re-derives
something `engine.ts` already computes, and in at least three the copies have already drifted enough
that the player can see two different numbers for the same fact. This is the failure that reaches
players fastest, because it does not crash and no test covers presentation. Every new screen adds
more. **Cheapest fix:** export the four or five missing helpers (`churnRate`, `allocationShares`,
`expectedPmf`, `capturedUsers`, `RUNWAY_DANGER`) so the screens have something to import — the drift
exists because there was nothing to reuse, not because anyone preferred a copy.

**5. `engine.ts`'s size — but genuinely last.** It is the most *nameable* problem and the least
expensive one. The file is well-sectioned, the comments are excellent, and the coupling is real. Do
the leaf split opportunistically. Do not do it as a project, and do not split `advanceWeekInner` —
see finding 1 for why that is the same risk wearing a different hat.

**Wildcard, above all of these if it is real:** `src/game/pvp.ts` (§A). An untracked, unreferenced,
finished feature module is a race condition between two agents working the same checkout, and the
loser is whoever runs `git clean` first.

---

## Files changed

**Source:** `src/game/engine.ts`, `src/game/modes.ts`, `src/game/world/tick.ts`, `src/store.ts`,
`src/App.tsx`, `src/components.tsx`, `src/shareImage.ts`, `src/screens/NewGame.tsx`,
`src/screens/Career.tsx`, `src/screens/DailyLeaderboard.tsx`, **new** `src/theme.ts`.

**Tests:** `test/hiring-market.test.ts`, `test/rules.test.ts`, `test/world-director.test.ts`,
`test/modes.test.ts`, `test/career-pmf.test.ts`.

**Untouched, as instructed:** `src/net/**`, `supabase/**`. Also untouched: `src/game/pvp.ts` (§A).

Nothing was committed or pushed.
