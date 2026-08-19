# Founder Mode — architecture / structure audit

**Date:** 2026-08-19 · **Scope:** `src/game/**`, `src/store.ts`, `src/*.ts(x)` support modules, the
import graph, dead code, and type structure. **Out of scope by instruction:** `src/net/**` and
`supabase/**` (security agent), any game constant / formula / balance number (balance agent), and —
per a mid-task scope amendment — `src/App.tsx`, `src/screens/**`, `src/CareerUI.tsx`, `src/Coach.tsx`
and `src/index.css` (a UI / onboarding workstream is live on those files).

This is a **behaviour-preserving** refactor. The gate on every change was:

- `npm run bots` and `npm run bots -- all` **byte-identical** to a baseline captured before the first
  edit (`diff` exit 0).
- `npm test` (22 suites, including the RNG-draw-order golden traces in `test/modes.test.ts`) green.
- `npm run build` / `tsc -b` (which type-checks `test/` too, and enforces `noUnusedLocals`) green.

Predecessor review: `docs/architecture-review.md` (2026-08-08, base `e963294`). That review predates
the tokenisation/ICO slices, so its line numbers and its finding A (`pvp.ts` untracked) are stale —
`src/game/pvp.ts` is now committed and fully wired into `advanceWeekInner` (`tickPvpEffects`,
`prBackfired`, …). Where its analysis still holds it is cited rather than repeated.

---

## 1. What was changed (landed, each verified byte-identical)

| Commit | What | Lines | Proof |
|---|---|---|---|
| `Remove dead scored-recall engine from world/memory.ts` | Deleted the unused character- and company-side memory **relevance/recall scoring engine** | −197 | bots default + all clean; 22 suites pass; `tsc -b` (noUnusedLocals) green |
| `Stop tracking *.tsbuildinfo incremental build caches` | `.gitignore` + `git rm --cached` the three `tsconfig.*.tsbuildinfo` | build hygiene | no source change |
| `Export a canonical Allocation type from game/types.ts` | Named `GameState['allocation']` as an exported `Allocation` type | type-only | bots byte-identical; `tsc -b` green |

Full commit messages carry the per-change proof. None of the three touches a constant, a formula, or
the RNG draw order.

### 1a. Dead code removed — the proof it was dead

`src/game/world/memory.ts` carried two solutions to "which memory does a character bring up now": a
**scored recall engine** (`scoreMemoryRelevance`, `recallMemories`, `topMemory`,
`charactersWithRelevantMemory`, `resolveCue`, `scoreCompanyMemoryRelevance`, `recallCompanyMemories`,
plus helpers `tagScore` / `relationshipScore` / `memoryRecency`, the weighting constants
`W`/`*_BONUS`/`*_PENALTY`/`RECENCY_HALF_LIFE`, and the `MemoryCue` / `ScoredMemory` / `RecallOptions`
types), and the simpler selector `selectMemoryCallback` in `world/composer.ts`. The composer's is on
the live path (`composer.ts` → `tick.ts`); the scored engine won nothing and was reachable from
nothing.

Method: a reachability BFS (`scratchpad/reach.mjs`) from the **eight** symbols that other modules
actually import from `memory.ts` — `noteCompanyEvent`, `noteCharacterEvent`, `notePromise`,
`sortedCharacterIds`, `expireDuePromises`, `openPromises`, `settlePromise`, `recordCompanyMemory`
(these are the *complete* external surface: five importing files, verified by grep). None of the
deleted symbols is reachable from those roots, and `grep -rn` across `src/` and `test/` finds zero
references to any of them (the only near-matches are the unrelated `MemoryCueDef` / `MEMORY_CUES` in
`content/memory-cues.ts`). No test referenced them. `noUnusedLocals` then forced the matching import
and constant cleanups, so the compiler confirmed the block was self-contained.

**Deliberately *not* deleted** (left for the living-world owner): `memory.ts` still exports a further
~15 symbols with no current caller — `normalizeMemoryState`, `tickMemory`, `noteSharedEvent`,
`pruneMemory`, `promisesComingDue`, `resolveMemory`, `companyRecord`, `hasCompanyMemory`,
`lastCompanyMemory`, `currentEra`. Unlike the recall engine (a *superseded* duplicate), these read as
the phase-4–7 scaffolding that `docs/procedural-living-world-system.md` describes and that the
predecessor review (finding I) explicitly said to **mark, not delete**. Removing a save-normaliser or
a weekly-tick entry point that *should* be wired would paper over an integration gap rather than
remove dead weight. Recommendation: the owner confirms each as wire-or-remove. The same caution
applies to the ~40 other single-occurrence exports across `world/**` (catalogued in §5).

---

## 2. Import-graph findings

Built by hand with `scratchpad/analyze.mjs` (Tarjan SCC over resolved relative imports of `src/**`).
Two cycles exist.

### 2a. `modes.ts` ↔ `world/types.ts` — **type-only, benign**

`modes.ts` imports `type LivingWorldDepth` from `world/types`; `world/types` imports
`type CapabilityKey` from `modes`. Both are `import type`, erased before emit, so there is **no runtime
cycle** and nothing to fix. Noted only so a future reader does not "fix" it into a worse shape.

### 2b. `engine.ts` ↔ `token/**` — a real 14-file strongly-connected component

`engine.ts` imports ~30 symbols from eleven `token/*` modules (it drives the ICO subsystem), and the
SCC closes because **five token modules reach back into `engine.ts` for exactly two functions**:

```
token/endings.ts   → import { valuation }      from '../engine'
token/treasury.ts  → import { valuation }      from '../engine'
token/launch.ts    → import { valuation }      from '../engine'
token/scoring.ts   → import { valuation }      from '../engine'
token/incentives.ts→ import { weeklyPayroll }  from '../engine'
```

`valuation` and `weeklyPayroll` are **pure, read-only calculators** over `GameState` (no RNG, no
mutation) that happen to be declared inside the 3,651-line `engine.ts`. Because they are hoisted
function declarations the cycle is runtime-safe today, but it is the single reason a dependency-order
tool reports one giant tangle instead of a clean `engine → token` layering.

**Recommended fix (see §4):** move the pure metric readers (`valuation`, `weeklyPayroll`, and their
siblings `growthRate`, `productScore`, `weeklyBurn`, `runwayWeeks`, `effectiveTam`,
`marketSaturation`, …) into a leaf `src/game/metrics.ts` that both `engine.ts` and `token/**` import
from. That **breaks the entire SCC** — token stops importing engine, and the graph becomes a DAG. It
is behaviour-neutral (pure code move) but was **not done now** because it edits `engine.ts` (see the
concurrency note in §4).

Smaller intra-token cycles (`market ↔ users`, `governance ↔ incentives`, `founder → community/market/…`)
are cohesive and internal to the subsystem; not worth disturbing.

---

## 3. File-size hotspots (in scope)

| File | Lines | Note |
|---|---|---|
| `src/game/engine.ts` | 3,651 | The god-file. 26 labelled sections; ~600-line `advanceWeekInner` at its core. §4. |
| `src/store.ts` | 1,343 | Zustand store + online session/round plumbing. Splittable; low-ish risk. §4. |
| `src/game/token/types.ts` | 1,321 | Type + constant module for the ICO subsystem. Mostly declarations; cohesive. |
| `src/game/data.ts` | 1,295 | Content/constants (EVENTS, INVESTORS, sectors, event bodies). §4 — balance-agent territory. |
| `src/game/world/interactions.ts` | 1,097 | Interview/board interaction content + logic. |
| `src/game/world/memory.ts` | 676 | was 873; −197 this pass. |

(`App.tsx` 1,187 and `screens/Fundraising.tsx` 1,132 are larger still but are out of scope under the
UI amendment.)

---

## 4. Recommended, NOT done — prioritised, with reasons

### R1 (top priority). Split `engine.ts` — analysis banked, ready to execute in one sitting

**Status: started, verified byte-identical, then reverted uncommitted at the coordinator's request**
because a balance agent is concurrently editing `engine.ts` constants/formulas and a file-split
(delete-here / add-there) against concurrent in-file edits produces delete-modify conflicts that are
error-prone to resolve by hand. The split is mechanical and cheap to redo; their measured balance work
is not. **Do this as a dedicated pass when no one else is editing `engine.ts`.**

What was proven out before reverting: a `src/game/engine/core.ts` extracting the foundational
primitives — `uid`, `clamp`, `rand`, `mulberry32`, `withSeed`, `mixSeed`, `seeded`, `can`,
`drainEnergy` (≈70 lines, imports only `data`/`modes`/`types`, so **zero new cycles**), re-exported
from `engine.ts` to preserve the public surface — passed `tsc -b`, `npm test`, and **both** bots
diffs byte-identical. The saved module is in `scratchpad/engine-core-proposed.ts`.

**The seam map** (from `scratchpad/sectiondeps.mjs`, which lists each section's engine-internal
dependencies). Two layers matter:

*Leave together — the coupled core (~1,000 lines):* `newGame`/`buildGame`/`sanitize`,
valuation/finances/market readers, `applyEffects` (the write-funnel — it pulls in the people/hiring
helpers `ROLE_BASE`/`marketSalary`/`makeCandidate`), and above all **`advanceWeek` / `advanceWeekInner`
(≈600 lines)**. That function's correctness *is* the order of its RNG draws; do not extract `tickHype`
/ `tickMorale` / etc. out of it — the failure mode is silent (tests pass, bots numbers move). The
`seeded()` / `livingWorldActive` guards exist precisely to protect that order.

*Safe to extract as leaf modules re-exported from `engine.ts`* — each is called at most once from the
tick and never interleaves with it:

| Proposed module | Section (2026-08-19 lines) | Beyond core primitives, depends on |
|---|---|---|
| `engine/core.ts` | primitives 65–188 | (nothing — pure leaf) |
| `engine/ipo.ts` | 2022–2147 | `valuation`, `growthRate`, `applyEffects` |
| `engine/debt.ts` | 2192–2317 | `valuation`, `applyEffects` |
| `engine/one_on_ones.ts` | 2318–2453 | (core only — **cycle-free**) |
| `engine/macro.ts` | 2148–2191 | (core only — **cycle-free**) |
| `engine/pvp.ts` | 2498–2840 | `valuation`, `applyEffects`, `rivalStance` |
| `engine/pitch.ts` | 2841–2933 | `growthRate`, `runwayWeeks`, `applyEffects` |
| `engine/ma.ts` | 2934–3003 | `valuation`, `productScore`, `rivalValuation`, `applyEffects` |
| `engine/board.ts` | 3004–3120 | `growthRate`, `marketSaturation`, `applyEffects` |
| `engine/rival_aggression.ts` | 3121–3415 | mutually coupled with the PvP block (`raidMagnitude`, `applyAttackIncoming`) — extract **with** `engine/pvp.ts` |
| `engine/story_arcs.ts` | 3510–3652 | `applyEffects`, `boardEffectiveTarget` |

**The one real design decision** in the split: most leaves call `applyEffects` and the metric readers,
which stay in the coupled core. Two clean ways to keep the graph honest:

- **(preferred)** also extract `src/game/metrics.ts` (the pure readers — see R2). Then leaves import
  primitives from `engine/core`, readers from `metrics`, and only `applyEffects` back from `engine.ts`.
- **(minimal)** let each leaf import what it needs back from `engine.ts`. Because `applyEffects` /
  `valuation` are hoisted function declarations, this back-edge is runtime-safe even inside the import
  cycle — the pattern the whole `token/**` subsystem already uses. It adds cycle edges, so prefer the
  first option if R2 is done in the same sitting.

Expected result: `engine.ts` drops from ~3,650 to ~1,700 lines with **no** change to any import
elsewhere (everything re-exported from the `engine.ts` barrel) and no change to draw order. Redo cost
after the analysis above: a few focused hours, one bots-diff per extracted module.

### R2. Extract `src/game/metrics.ts` (pure readers) — breaks the engine↔token cycle

Move `valuation`, `growthRate`, `productScore`, `demandSignal`, `resonanceEstimate`, `weeklyPayroll`/
`Office`/`Infra`, `totalUsers`, `operatingProfit`, `marketingMax`, `estimatedCac`, `paidUsersPerWeek`,
`weeklyBurn`, `runwayWeeks`, `effectiveTam`, `marketSaturation`, `rivalValuation` into a leaf module.
This is the highest-leverage structural fix in the codebase: it both shrinks `engine.ts` and
**collapses the 14-file SCC of §2b into a DAG**. Behaviour-neutral (pure reads), but it edits
`engine.ts`, so it belongs in the same "engine is quiet" window as R1. Watch `committedCosts` /
`operatingProfit`, which reference `recruiterFee` / `acceptTermSheet` / `weeklyInterest` — either move
those readers' small dependencies too or keep those three in the core.

### R3. `data.ts` (1,295 lines) — split content from constants

`data.ts` mixes tuning constants (`STAGES`, `INVESTORS`, `RIVAL_NAMES`, thresholds) with a large body
of event/choice **content** (`EVENTS` and prose bodies). A `data/events.ts` + `data/constants.ts`
split would help, but **this is exactly the file the balance agent tunes**, so a structural move now
would collide with their number changes. Defer to the same quiet-window discipline as R1/R2.

### R4. `store.ts` (1,343 lines) — extract the online/session slice

`store.ts` is in scope (not in the UI amendment). It carries the Zustand game store *and* the online
match/session/round lifecycle (`OnlineSession`, `OnlineResume`, rate-limit/round-deadline plumbing,
`EmoteToast` / `ChatMessage`). Those online pieces are a cohesive ~400-line slice that could move to
`src/store/online.ts` and be re-exported. Lower risk than the engine split (no RNG on this path), but
it borders `src/net/**` (security agent) and the UI store hooks (UI agent), so coordinate before
starting.

### R5. Consolidate the PRNG / `clamp` copies — **only with a bots-diff between each step**

Five copies of `mulberry32`, three of FNV-1a, ~10 of `clamp` (in two incompatible signatures —
`clamp(v,lo,hi)` vs `clamp(v,lo=0,hi=100)`) remain across `engine`, `world/**`, `career/**`. The
predecessor review (finding J) verified the PRNG copies are currently bit-identical. Consolidation is
a genuine footgun: one wrong bit changes every number in the game and **no test would tell you** —
only a bots diff. Do it one file at a time, diffing bots between each, and give the defaulted `clamp`
a different name (`clamp100`) so `clamp(x, 5)` can never mean two things. Medium risk, modest payoff.
Left undone deliberately.

### R6. Determinism holes that cannot be closed without changing numbers (do not "fix" silently)

Carried from the predecessor review and re-confirmed present:

- `engine.ts` `pitchInvestorsInner`: `[...INVESTORS].sort(() => RNG.next() - 0.5)` is a
  V8-implementation-dependent non-shuffle. The correct Fisher-Yates draws a different number of values
  in a different order and **changes which investors appear for every existing seed** — a balance
  reset, not a refactor. `makeRivals` already does splice-based selection correctly six hundred lines
  away; copy that pattern only when a balance reset is acceptable.
- `uid()` uses `Date.now()` + `Math.random()`, so ids do not replay even though numbers do (hence the
  `stableCastId` / `mk-{week}-{i}` workarounds). Deriving `uid` from `(seed, week, counter)` is a save
  migration, not a refactor. Both are prerequisites for replay-based leaderboard verification and
  should be scheduled as their own project.

---

## 5. Catalogued, not acted on

- **~40 single-occurrence exports across `world/**`** (per `scratchpad/analyze.mjs`): `characters.ts`
  (the six `characterFrom*` constructors superseded by the `*Spec` + `ensureCast` path), `composer.ts`
  (`validateFragmentLibrary`, a content checker nothing runs), `persistence.ts` (`compactLivingWorld` /
  `livingWorldFootprint` / `LIVING_WORLD_BUDGET_BYTES` — a budget path that never executes;
  `enforceLivingWorldLimits` is what runs), `relationships.ts`. Treat as phase-gated scaffolding: add a
  `// PHASE N — not yet wired` banner naming the capability that will switch each on, converting "is
  this dead?" from an investigation into a glance. Deleting is a living-world-owner decision.
- **`pvp.ts`** exports four unused helpers (`PR_DECOY_WEEKS`, `prWeeklyDamage`, `priceWarMultiplier`,
  `marginOf`); small, and adjacent to balance-tuned combat numbers — leave for the combat owner.
- The `store.ts:572` / `store.ts:388` security one-liners from `docs/security-review.md` remain
  unapplied; they are the security agent's to land with `leaderboard-v6.sql`. **Not touched** (out of
  scope), flagged so they are not lost.

---

## 6. Byte-identity confirmation (landed work)

```
baseline:  npm run bots         > bots-before.txt          (captured pre-edit)
           npm run bots -- all  > bots-all-before.txt

after each landed commit:
           diff bots-before.txt      bots-after.txt      → exit 0
           diff bots-all-before.txt  bots-all-after.txt  → exit 0
           npm test  → ALL PASS (22 suites, golden traces unchanged)
           tsc -b    → clean (noUnusedLocals enforced)
```

The reverted `engine/core.ts` experiment (R1) was also confirmed byte-identical on both bots runs and
all 22 suites before being backed out — evidence the split is mechanical, not risky, and worth
completing in a quiet window.
