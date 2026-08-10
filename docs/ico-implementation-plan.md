# Tokenisation / ICO — multi-agent implementation plan

Companion to `docs/tokenisation-ico.md` (the brief). This is *how* we build it, not *what* it is.

Full scope is the target. Four constraints from the design cross-check are folded in as
requirements, not as cuts:

1. **The scoring question is decided before any code.** See Slice 0.
2. **Every reflexive loop ships with an explicit restoring force.** No "add safeguards later".
3. **Quick Play comes after Career proves out**, not alongside it (Slice 7, not Slice 1).
4. **Governance lands late** (Slice 6) because it is the least novel part for the most machinery.

---

## What today taught us about running agents

This plan is shaped by failures from the Living World build, not by theory.

- **A workflow died silently mid-build.** Seven agents started, five returned, integration never
  ran. Five modules sat on disk, typechecked cleanly, and did not work. *Therefore: every slice
  ends with an integrator whose job is to make it actually run, and no slice is "done" on the
  strength of a green typecheck.*
- **Parallel agents produce plausible modules that do not meet.** Cast identity keyed on
  `uid()`, relationships discarded on the tick that created them, a memory type that did not
  exist. *Therefore: fan out only across genuinely disjoint files, and never more than the seams
  allow.*
- **Agents wrote tests that passed while the game was visibly broken** — one pasted the engine
  formula into the test file. *Therefore: every slice's tests must be mutation-verified. Break the
  thing on purpose; if the suite stays green, the test is worthless.*
- **An agent ran destructive commands against production.** *Therefore: no agent touches Supabase,
  deploys, commits, or pushes. Ever. The owner's session does that.*

---

## Slice 0 — Architecture. ONE agent, alone, nothing parallel

Nothing else starts until this lands. Its output is the contract every later agent builds against,
and a wrong contract here is a rewrite at Slice 4.

**Must decide, with a written rationale:**

- **The scoring question.** The entire ending system runs off one `valuation(s)`: the $1B unicorn
  threshold, IPO eligibility, founder payout, leaderboard score, Arena ranking. The brief wants
  `companyEnterpriseValue` and `tokenNetworkValue` tracked separately (§49/§50). Decide which one
  *scores a run*, what a tokenised founder's payout is, and what `valuation()` returns for them.
  This is the single highest-risk decision in the feature.
- **Where token state hangs off `GameState`**, and how it stays absent on every save that predates
  it (follow the `career` and `world` precedents).
- **The capability set**, honouring the rule that a capability is only `true` when the feature
  exists (`src/game/modes.ts` ENFORCED vs DESCRIPTIVE).
- **The restoring force for each reflexive loop.** Treasury = tokens × price → spending → growth →
  price is an absorbing state waiting to happen. We shipped exactly that bug in the funding climate
  and it stuck runs at frozen for 49 of 104 weeks. Specify the damping now.
- **The seam with Career PMF.** Brief §52 is non-negotiable: incentivised acquisition must not
  create Strong PMF. Decide precisely where organic/incentivised splits and what
  `derivePmfForSegment` sees.

**Output:** `docs/ico-architecture.md` + the type surface in `src/game/token/types.ts`, capability
wiring, and the `GameState` slice. No behaviour.

**Gate:** owner reads and approves the scoring decision before Slice 1 starts.

---

## Slices 1–8

Each slice: agents in parallel only where files are disjoint, then **one integrator**, then a gate.
No slice starts until the previous one is committed and green.

| # | Slice | Agents | Ends when |
|---|---|---|---|
| 1 | **Capital fork** — CapitalPath, eligibility, sector suitability, irreversibility, fundraising + IPO restriction, save migration | 2 + integrator | You can tokenise, and VC/IPO are visibly and explainably closed |
| 2 | **Token economy core** — price, supply, treasury, utility, community, speculation, volatility | 2 + integrator | Bot-proven: no runaway, no absorbing state, over 24 seeds × 104 weeks |
| 3 | **User composition** — organic vs incentivised, split retention, PMF protection, the §53 warning | 2 + integrator | Incentivised growth provably cannot manufacture Strong PMF |
| 4 | **Tokenomics + incentives** — allocation, vesting, founder share, the six incentive categories | 3 + integrator | Each allocation has a measured, distinct effect |
| 5 | **Community + decentralisation** — sentiment, trust, founder influence | 2 + integrator | Community reacts to founder behaviour, measurably |
| 6 | **Governance** — proposals, outcomes derived from state | 1 + integrator | Votes resolve from state, never randomly |
| 7 | **Narrative, endings, Quick Play** — Director candidates, media, company memory, postmortem, token endings, then the simplified Quick Play flow | 3 + integrator | A tokenised run produces a readable story and its own ending |
| 8 | **Bots + balance** — Traditional / Early Token / Utility-First | 2 | No path dominates across 24 seeds × 5 sectors |

**Slice 3 is the one that matters.** If "growth is high but most of it is bought" is not compelling
there, stop and reconsider before building 4–8.

---

## Rules every agent gets

- **File ownership is explicit and non-overlapping.** New work lives in `src/game/token/`. The
  handful of integration points (`modes.ts`, `types.ts`, `engine.ts`, `store.ts`) belong to the
  **integrator only** — build agents report needed changes, they do not make them.
- **Determinism.** All randomness through `seeded()`/`withSeed()`. `Math.random`, `Date.now()` and
  `new Date()` are forbidden in simulation paths. The golden traces in `test/modes.test.ts` must
  still pass — if they fail you changed the RNG draw order, and that must be a decision.
- **Capability-gated.** Branch on `hasCapability(state, key)`, never `mode === '...'`.
- **The acceptance test, every integration:** with tokenisation capabilities off, `npm run bots`
  must be byte-identical to before the slice. Capture before, compare after, report the diff.
- **Mutation-verify your tests.** Break the feature deliberately; if the suite stays green, the test
  does not exist.
- **No commits, no pushes, no deploys, no Supabase.**
- `npm run build` (which is `tsc -b`, stricter than `tsc --noEmit`) and `npm test` must pass.

---

## Slice -1 — Balance baseline. BLOCKING, before Slice 0

The owner's standing principle: **neither path may dominate — we build a balanced game.** That makes
the existing imbalances a prerequisite, not a parallel concern.

"Does tokenisation dominate?" is unanswerable against a skewed baseline. A token path that measures
well might only be beating a broken traditional path; one that measures badly might be losing to an
exploit. Either way Slice 8 returns a number and teaches nothing.

Three known problems, all from `docs/gameplay-review.md`, all measured:

1. **`low` pricing is dominated** — last on founder net in all five sectors by 2–3x, and buys no
   survival. A pricing choice that is never correct is not a choice.
2. **Coasting survives 24/24 while active play survives 5–21/24.** The game currently rewards not
   playing it. This is the most serious of the three: it inverts the premise.
3. **The Social / E-commerce gap is not diagnosed.** E-commerce was shown to be the bots
   overspending; Social was not, and separating "structurally harder" from "bot artifact" needs a
   margin-denominated bot that does not exist yet.

**Done when:** no pricing strategy is dominated, active play beats coasting on the measure the game
scores, and the Social verdict is established either way. Then the traditional path is a baseline
worth comparing against.

---

## Sequencing against the rest of the backlog

The gameplay review left three open balance problems: `low` pricing is dominated in all five
sectors, coasting survives more often than active play, and the Social/E-commerce gap is not
separated from a bot artifact.

Slice 8 cannot answer "does tokenisation dominate?" while those are open — it would be measuring a
second economy against a first one we already know is skewed. **Either fix them before Slice 8, or
accept that Slice 8's verdict is provisional and say so.** Do not let it read as a clean result.

---

## Estimate, honestly

Slice 0 is one agent and a decision. Slices 1–3 are the real feature and the part worth doing even
if we stop there. Slices 4–8 are roughly the same size again.

For calibration: the Living World brief is comparable in size, consumed a full day with multiple
agents, and reached phase 5 of 16 — and that one was mostly presentational. This one changes the
economy.
