# Tokenisation / ICO — architecture

**Slice 0** of `docs/ico-implementation-plan.md`. Companion to `docs/tokenisation-ico.md` (the brief).

This document is the contract. Every later slice builds against it. Where it disagrees with the
brief, it says so and says why — see [§7, What the brief gets wrong](#7-what-the-brief-gets-wrong).

**Shipped in this slice:** `src/game/token/types.ts` (the full type surface), seven capabilities in
`src/game/modes.ts` (all `false`), `tokenDepth` on `GameRules`, and `GameState.token?`. No
behaviour. `npm run build` and `npm test` pass; the golden traces in `test/modes.test.ts` are
byte-identical (`0x7edba86d` / `0x7401e275` / `0xe4a66ca2`), which is the only honest proof that
nothing was added to a simulation path.

---

## 1. What scores a tokenised run

> The highest-risk decision in the feature. Everything else is recoverable.

### 1.1 What the code actually does today

`valuation(s)` (`src/game/engine.ts:502`) is not the score. It is the **company's enterprise
value**, and it is consumed in fourteen places:

| Consumer | What it uses valuation for |
|---|---|
| `engine.ts:826` | `centaur` milestone at $100M |
| `engine.ts:1009` | term-sheet sizing when you pitch |
| `engine.ts:1482` | the week's `HistoryPoint.valuation`, and the endings block below it |
| `engine.ts:1562` | **the $1B unicorn ending** |
| `engine.ts:1592/1602` | `ipoChecklist` ($500M) and `ipoVisible` |
| `engine.ts:1663` | `priceIPO` — the payout base |
| `engine.ts:1969` | `secondaryProceeds` — 2% at a 30% discount |
| `engine.ts:2316` | `canAcquire` — you must be 1.5× the rival |
| `engine.ts:2351` | stock-funded M&A dilution |
| `engine.ts:2449` | the `fired` payout, at 0.5× |
| `App.tsx:215`, `Dashboard.tsx:220`, `Fundraising.tsx:116`, `Market.tsx:300` | display |
| `App.tsx:717` | **MatchOver ranking for a founder still trading** |
| `store.ts:331`, `store.ts:807` | `NetPlayer.val` on the Arena wire |
| `Coach.tsx:97`, `achievements.ts:49` | goals and achievements |
| `test/balance-probe.ts:304`, `test/career-bots.ts:218`, `test/exploit-probe.ts:207` | `founderNet` fallback |

`gameOver.payout` is the score. It is consumed in:

| Consumer | What it does |
|---|---|
| `store.ts:169` `recordRun` | Hall of Fame `RunRecord.score`, sorted, top 10 |
| `store.ts:176` → `submitDailyScore` | the **global leaderboard** score |
| `store.ts:334`, `store.ts:808` | `NetPlayer.payout` on the Arena wire |
| `App.tsx:191` | `targetToBeat` — what a surviving Arena founder is playing against |
| `App.tsx:717` | **MatchOver ranking for a founder who exited** |
| `achievements.ts:25/38/39/42` | `won()`, and the $50M / $10M thresholds |
| `shareImage.ts:51` | the number on the share card |
| `Career.tsx:57` | best payout, total founder earnings |
| all three bot harnesses | fitness |

And it is produced in exactly five places, all in `engine.ts`:

```
unicorn   1564   val * founderEquity + bankedPayout
timeup    1566   val * founderEquity + bankedPayout
ipo       1670   val * mult * founderEquity + bankedPayout      mult 0.95–1.80
fired     2449   val * founderEquity * 0.5 + bankedPayout
acquired  2640   offer * founderEquity + bankedPayout           offer median 2.05x val
bankrupt  1555   bankedPayout only
```

**The game is denominated in founder dollars.** One currency, everywhere. That is the fact the
whole decision turns on.

### 1.2 The decision

**`valuation()` returns `companyEnterpriseValue` and gains no token term. Ever.**

Not "mostly". Never. It is used to size term sheets, to price M&A ratios, to compute stock-funded
dilution, and to decide who is the bigger company. The moment it absorbs token market cap, a
founder with a speculative float buys rivals with inflated paper and sells secondaries against a
bubble. That is precisely the double-count §49 warns about, and it would arrive through the side
door rather than the front.

**Network value is a second, separate function.** `networkValue(s) = price × circulatingSupply`
(§50). It is an ecosystem metric. It is never realised company value.

**They meet in exactly one place — the founder's own dollars — through two disjoint legs:**

```ts
founderStanding(s) =
    valuation(s) * s.founderEquity     // equity leg — reads enterprise value ONLY
  + realisableTokenValue(s)            // token leg  — reads network value ONLY
  + s.bankedPayout                     // already realised
```

Disjoint legs is what makes "avoid double-counting" structural rather than a matter of care. There
is no expression anywhere in which a dollar of token demand and a dollar of enterprise value can be
the same dollar.

When `s.token` is absent, `realisableTokenValue(s) === 0` and `founderStanding` is *character for
character* today's expression. Every existing payout formula becomes `founderStanding` with its
multiplier applied to the equity leg only, and every existing run pays out to the byte. The bot
harnesses' `founderNet` fallback (`valuation(s) * founderEquity + bankedPayout`) becomes a call to
`founderStanding` and is identical for every traditional run.

### 1.3 The token leg, and why it is the balance dial

```ts
realisableTokenValue(s) = founderVestedTokens * price * liquidityDiscount(s)

liquidityDiscount(s) = lerp(MIN, MAX, marketQuality) * (1 - exitImpact)
  marketQuality  ← depth, utility, community — the things a real business produces
  exitImpact     ← (founderVestedTokens / circulatingSupply) ^ exitImpactExponent
```

Constants live in `TOKEN_SCORING`: `liquidityDiscountMin 0.20`, `liquidityDiscountMax 0.85`,
`exitImpactExponent 0.85`.

This is §51 taken seriously: **token holdings are not cash-equivalent**, and a founder holding 30%
of the float cannot sell 30% of the market cap.

It is also where the token path's exit multiple lives. Look at what tokenisation closes:

* IPO — gone (§45, §48). That is the `0.95–1.80×` multiplier.
* Acquisition — rarer and cheaper (see §7.5 below). That is the `2.05×` median.
* Unicorn / timeup — still available at `1.0×`.

If nothing replaced them, tokenisation would be **strictly dominated**: you give up both premium
exits and keep the flat ones. The liquidity discount is the replacement, and its spread —
`0.20 → 0.85`, a factor of 4.25 — is the same order as the traditional path's `1.0× → 2.05×`
exit spread. The difference is that the traditional premium is partly *rolled* (`rand(0.7, 1.25)`
on the offer, `rand(-0.08, 0.12)` on IPO pricing) while the token premium is entirely **earned**:
build real utility into a deep market and you realise your position; sit on a speculative float and
you do not.

**That is the whole design argument in one term.** §92 asks "does this create a meaningful
difference between community capital and institutional capital?" — this does. Institutional capital
sells the *company*, once, at a negotiated premium. Community capital sells *into a market you
built*, continuously, at a price the market's own health sets.

#### Worked comparison, so the claim is falsifiable

Roughly, at week 104, a company that reaches ~$1B of activity either way:

| | Traditional, acquired | Token |
|---|---|---|
| enterprise value | $1.0B | $400M (VC-starved, slower) |
| founder equity | 35% (post-B dilution) | 62% (no rounds) |
| equity leg | $350M × 2.05 = **$718M** | $400M × 0.62 = **$248M** |
| network value | — | $1.5B |
| founder tokens | — | 12% of supply = $180M gross |
| liquidity discount | — | 0.45 typical / 0.75 utility-led |
| token leg | — | **$81M** / **$135M** |
| **founder standing** | **$718M** | **$329M** / **$383M** |

The token path is *behind* on this sketch, which is the correct starting point: it must be behind
on the median and ahead in the tail, or "no path dominates" is unreachable. Slice 8 tunes
`liquidityDiscountMax`, the founder allocation band and the network-unicorn threshold against
24 seeds × 5 sectors. **These numbers are a hypothesis, not a result.** They are recorded here so
Slice 8 has something specific to falsify.

### 1.4 The unicorn threshold and the token endings

`valuation(s) >= 1_000_000_000` stays exactly as it is. A tokenised company that builds a real
business can still reach it, and should.

**Network Unicorn is a separate ending with a separate gate:**

```
networkValue(s) >= 1_000_000_000
  AND market.utility >= 55
  AND organicShare(s) >= 0.5
```

The last two clauses are not decoration. Without them a pure speculative bubble prints the game's
best ending, and §53's central lesson — *growth is high but most of it is bought* — would be
undone by the game's own scoreboard. A bubble must be able to reach $1B of market cap and still
**not** be a win. Constants: `TOKEN_SCORING.networkUnicornMinUtility`,
`.networkUnicornMinOrganicShare`.

**One new `GameOver['type']`: `'network'`.** Brief §44 lists five success states; they share this
one type and are distinguished by `TokenEndingKind` in `gameOver.detail`. Five ending types would
mean five new entries in `theme.ts ENDINGS`, `store.ts RunRecord.ending`, `Career.tsx`
`ENDING_ORDER`/`WIN_ENDINGS`, `sound.ts` and the leaderboard's ending whitelist — for four cosmetic
variants of the same dollar score.

**No new failure type.** §43's failures route through what exists: a treasury collapse that empties
the account *is* `bankrupt`; a community revolt that removes the founder *is* `fired` (the payout
formula already halves the equity leg, which is the right shape for being ousted). Mercenary Growth
is a warning, not an ending, exactly as §43 says.

Payout for `network`: `founderStanding(s)`. Equity leg at 1.0×, token leg at its earned discount.

> **Owner action required.** `src/net/leaderboard.ts:55` holds
> `const ENDINGS = new Set(['bankrupt','unicorn','acquired','fired','timeup','ipo'])` and
> `submitDailyScore` silently refuses anything not in it. `src/net/**` is off-limits to build
> agents, so `'network'` must be added there by the owner in the same commit as Slice 7.
> `theme.ts ENDINGS` is a typed `Record<EndingType, …>`, so the compiler will catch that one.

### 1.5 The one token-aware change `valuation()` does get

Incentivised users are still users: they sit in `s.users`, they generate revenue, and `valuation()`
reads both. So a mercenary-growth company would show an inflated enterprise value — the exact
inflation §53 exists to expose.

The fix is a **discount, never an addition**: the user term counts incentivised users at
`TOKEN_SCORING.incentivisedUserValuationDiscount` (0.35) of `perUserVal`, because a rented user is
worth less to an acquirer. `valuation()` stays a pure enterprise-value function; the factor is 1
when there is no token economy, so the formula and the golden traces are untouched.

Land it in **Slice 3**, with the user split, not before.

### 1.6 Arena

`App.tsx:717` ranks a still-trading founder on `valuation(game)` and an exited one on `p.payout`.
For a tokenised founder that understates them by the entire token leg — and they cannot take an
acquisition or an IPO, so *all* of their upside is in that leg.

The fix is one line — `figure` switches to `founderStanding(game)`, which is identical for
institutional runs — but it must not be made now. `NetPlayer.val` also feeds `Market.tsx`'s
"how big is that company" readout, where enterprise value is the right number, so the wire format
needs a second field. `NetPlayer` lives in `src/net/online.ts`, off-limits.

**Arena tokenisation stays `off` for this entire feature (§58).** The compatibility requirement is
recorded here so that whoever builds Arena tokens starts from it rather than rediscovering it.

---

## 2. Where token state lives

```ts
// src/game/types.ts
token?: import('./token/types').TokenState
```

Optional, following `career` and `world`. Three properties that matter:

**Absence IS `institutional`.** There is deliberately no `capitalPath` field on `GameState`. Brief
§74 wants legacy saves to default to institutional; making absence mean it achieves that with
**zero migration writes**, which is the strongest available form of "absent on every save that
predates it". Read it through `capitalPath(s) => s.token?.capitalPath ?? 'institutional'`
(Slice 1, `src/game/token/state.ts`). Two ways to say the same thing is one way to desync.

**Created whole, once.** `createTokenState(plan, s, rng)` at a successful launch produces every
sub-object present and zeroed. Optionality lives at exactly **one** level. No consumer ever writes
`s.token?.market?.price ?? 0`; they write `s.token` and then `t.market.price`. This follows
`CareerPMFState` (flat, required once present) rather than `LivingWorldState` (nested optionals),
because the plan's own post-mortem — *"five modules sat on disk, typechecked cleanly, and did not
work"* — is what a forest of optional sub-slices produces.

A sub-slice a later phase owns (`governance.proposals`, `incentives`) exists but stays empty until
its capability is on. **No reader creates a sub-slice it does not own.**

**Pre-launch state does not exist.** Eligibility is computed pure from `GameState`
(`tokenisationEligibility(s)`), stored nowhere. The tokenomics setup screen's draft
(`TokenLaunchPlan`) is React-local until the player confirms. That keeps "absent = institutional"
airtight — there is no half-tokenised state to reason about.

### 2.1 Migration

Follows `migrateLivingWorldSlice` exactly. In `src/store.ts`'s `merge`, alongside the existing
`g.world = migrateLivingWorldSlice(g.world)`:

```ts
g.token = migrateTokenSlice(g.token)   // src/game/token/persistence.ts, Slice 1
```

Rules:

1. `undefined` in → `undefined` out. **Never fabricate a slice.** A save with no token slice is a
   traditional run and must stay one; §74's "do not automatically tokenise any legacy saves" is
   satisfied by the function refusing to construct.
2. A malformed slice is **dropped, not repaired** — same call as the living world. localStorage is
   user-writable and a half-valid economy must not reach the price model. The cost of dropping is a
   run that reverts to institutional, which is a legible outcome; the cost of repairing badly is a
   corrupted economy nobody can debug.
3. A well-formed slice is back-filled to `TOKEN_STATE_VERSION` and re-bounded: every array truncated
   to `TOKEN_LIMITS`, every 0–100 scalar clamped, every count finite and non-negative, and the
   supply identity re-asserted (see §4.6).
4. **No global persist version bump.** `TOKEN_STATE_VERSION` handles in-slice shape changes, which
   is why it exists (`LIVING_WORLD_STATE_VERSION` precedent). `store.ts`'s `version: 9` stays 9
   unless something outside this slice changes.

`migrateLegacySave` in `engine.ts` needs **no** token clause. That function assigns Career's `career`
slice because `detailedPMF` implies it must exist; no capability implies a token slice, because
tokenising is a decision the player made, not a mode they are in.

---

## 3. The capability set

Brief §113 suggests six: `tokenisation`, `tokenEconomy`, `tokenGovernance`, `tokenTreasury`,
`communityCapital`, `tokenNarrative`. That list does not survive contact with the slice plan.

* **`tokenTreasury` is not separable from `tokenEconomy`.** A treasury with no price is a number
  with no meaning; they are one weekly tick. A capability that can never be false while another is
  true is a lie, and this codebase already fixed that class of drift once (`modes.ts`'s
  ENFORCED/DESCRIPTIVE audit).
* **`communityCapital` is not separable either.** §6's sources — initial sale, treasury sales,
  protocol revenue — are all treasury mechanics.
* **Nothing gates the two slices that matter most.** User composition (Slice 3) and incentives
  (Slice 4) have no switch in the brief's list, and Slice 3 is the one the plan says to stop at if
  it does not work.

**The set, seven keys, one per slice:**

| Capability | Slice | What it gates |
|---|---|---|
| `tokenisation` | 1 | the fork itself: eligibility, sector suitability, the decision, `capitalPath`, VC/IPO restrictions |
| `tokenEconomy` | 2 | price, supply, treasury, utility, speculation, volatility, community capital |
| `tokenUserComposition` | 3 | organic vs incentivised, split retention, PMF protection, the §53 warning |
| `tokenIncentives` | 4 | the six allocation categories, vesting, unlocks, employee token comp |
| `tokenCommunity` | 5 | sentiment, trust, decentralisation, founder influence |
| `tokenGovernance` | 6 | proposals and votes, resolved from state |
| `tokenNarrative` | 7 | Director candidates, media, company memory, postmortem sections |

All seven are **ENFORCED** (each will have a `hasCapability` call) and all seven are **`false` in
every mode today**, per `modes.ts`'s standing rule: *a capability is only `true` when the feature
actually exists.*

One capability per slice makes the set a **rollout ratchet**: each slice turns on exactly one, and
the plan's acceptance test — *"with tokenisation capabilities off, `npm run bots` must be
byte-identical"* — is checkable per slice rather than once at the end.

### 3.1 Depth is not a capability

The brief wants Quick Play `tokenEconomy = light` and Career `= deep`. That is not a boolean, so it
goes where `pmfDepth`, `employeeDepth` and `livingWorldDepth` already live:

```ts
tokenDepth: 'off' | 'light' | 'deep'   // on GameRules
quick: 'light'   career: 'deep'   arena: 'off'
```

`GameRules` is never persisted, so this adds nothing to the save format. It is **DESCRIPTIVE** and
recorded as such in `modes.ts`: depth declares the shape of the experience, the seven capabilities
decide what runs. **Branch on the capabilities, never on the depth string** — the same rule the
living world already carries.

### 3.2 The hard determinism requirement, stated once

`tickToken(s)` will run inside `advanceWeekInner` and will consume RNG draws. Consuming a single
draw shifts the stream for **every** seeded run in the game — daily challenges, Arena, replays and
all three golden traces. The gate is not optional and it is not a style preference:

```ts
if (tokenActive(s)) seeded(s, () => tickToken(s))
```

exactly as `livingWorldActive(s)` gates `tickLivingWorld` at `engine.ts:1575`, and for the reason
recorded in the comment above that line. `tokenActive(s)` returns false when `s.token` is absent
**or** when no token capability is on, so a run without the feature draws zero times.

This is the single most likely way to break the whole game silently. Any slice that calls into the
token subsystem outside that gate has a bug, whatever the tests say.

---

## 4. The restoring force for every reflexive loop

We shipped an absorbing state this week. `climate` was a random walk against a hard clamp; over
40 seeds × 104 weeks, 8 runs sat 20+ consecutive weeks in the frozen band and the worst sat there
for 49, with fundraising 70% blocked throughout. The fix was one line
(`reversion = -s.climate * 0.07`, `engine.ts:1142`) and the lesson is general:

> **A clamp is an absorbing boundary, not a bound.** What makes a value bounded is a restoring force
> that grows with distance. The clamp is a backstop for arithmetic, and if it is ever load-bearing,
> the model is wrong.

And one more, which is the specific shape of the danger here:

> **Every reflexive edge must cross a one-week lag or an EMA.** Same-tick self-reference is what
> produces algebraic blow-up. Nothing in this subsystem reads a value it wrote this tick.

Constants below live in `TOKEN_BOUNDS` (`src/game/token/types.ts`). Slice 2 may **retune** them
against bot runs. It may not **delete** a term: each one closes a named loop.

### Loop A — Treasury reflexivity (§29, §31). The named one.

```
price ↑ → treasuryValue ↑ → incentive spend ↑ → incentivised users ↑ → demand ↑ → price ↑
```

Three restoring forces, because one is not enough:

1. **Spend is capped in TOKENS, not dollars.**
   `weeklyCommit ≤ treasurySpendCapPerWeek (0.02) × supply.treasury`. A doubling price does not
   double what you may spend; it doubles what a fixed token budget buys. That converts the loop's
   gain from compounding to linear, which is the difference between a feedback loop and an
   explosion.

2. **Spending is its own negative feedback.** Every token committed to incentives reaches the float:
   `supplyPressure += supplyPressurePerFloatPct (1.1) × tokensSpent / circulating`. The coefficient
   is deliberately > 1: selling 1% of the float must cost *more* price than the demand 1% of float
   buys, once speculation is above neutral. **Slice 2 must measure and assert this**, not assume it —
   it is the inequality that makes the loop's per-cycle gain < 1.

3. **Incentivised demand decays.** `incentiveDecayPerWeek 0.09`. Absent fresh spend, incentivised
   users leave at ~9%/wk. Sustaining the loop therefore needs *accelerating* spend against a
   *shrinking* token balance — superlinear demand against a finite, depleting resource.

**Bounds:** `treasury ∈ [0, total]`. `treasuryValue` is **derived, never stored** — see §7.4.

### Loop B — Price ↔ speculation (§26, §27). The dangerous one.

```
price ↑ → speculation ↑ → speculative demand ↑ → price ↑
```

1. **Speculation mean-reverts to a utility anchor.**
   `speculation += (utility − speculation) × speculationReversion (0.08) + shock`.
   Same form and roughly the same rate as the climate fix that cured the 49-week freeze. The clamp
   to 0–100 exists but is never the mechanism, because the pull scales with distance.

2. **Speculative demand reads MOMENTUM, never the price level.**
   `speculativeDemand = f(price / emaPrice − 1)`, `priceEmaAlpha 0.18`.
   This is the single most load-bearing damper in the subsystem. A level term (`demand ∝ price`) is
   literally the absorbing-state bug written in a new file. A difference term against a moving
   anchor decays to zero as the anchor catches up: a price that keeps rising raises its own
   baseline and stops being news.

3. **Gravity toward fundamentals, superlinear in deviation.**
   `d = ln(price / fairValue)`; `gravity = −gravityPull (0.12) × sign(d) × |d|^gravityExponent (1.5)`.
   Because the exponent exceeds 1, the restoring force grows **faster than any linear demand term**.
   That is the mathematical guarantee — not an empirical hope — that no configuration of the demand
   side produces a runaway. A 10× dislocation deflates far faster than a 1.2× one.
   `fairValue` is built from utility, protocol revenue and **organic** users, so the anchor cannot be
   bought.

**Bounds:** `maxWeeklyPriceMove 0.45` as an arithmetic backstop, and
`price ≥ launchPrice × priceFloorFraction (0.01)`. **The floor is not cosmetic.** Zero is absorbing:
`0 × anything = 0`, the treasury is dead forever and there is no recovery path — which would make
§43's *"this does not have to instantly end the company"* false. A 99% drawdown is a catastrophe you
can narrate and might survive.

### Loop C — The death spiral (§31 negative, §43)

```
price ↓ → treasury ↓ → incentives cut → users leave → sentiment ↓ → price ↓
```

1. **Organic users do not respond to token price at all.** They respond to product, retention and
   price-fit — the existing Career machinery, untouched. The negative loop can therefore only strip
   the incentivised fraction, which is bounded by construction. **A company with real PMF has a
   floor under it that the token economy cannot reach.** That is decision 5 paying for itself twice:
   once as the §52 guarantee, once as this loop's terminator.
2. **The player's brake is inside the loop.** Incentive spend goes to zero, not negative, and
   cutting it *stops* the sell pressure. Retrenchment is a real strategy, which is what makes §43's
   "severe turnaround challenge" playable rather than a countdown.
3. **Loop B's gravity is symmetric.** Price below fair value pulls up with the same superlinear
   force. Undervaluation self-corrects exactly as fast as overvaluation.
4. **Sentiment reverts** toward a baseline set by trust and delivered product, at
   `sentimentReversion 0.06`.

### Loop D — Employee token compensation (§16)

```
price ↓ → morale ↓ → output ↓ → product ↓ → price ↓
```

* Token comp is capped at `tokenCompMaxShare 0.4` of a package.
* The token-attributable morale move is clamped at `tokenCompMoraleClamp ±3`/week, so it can bias
  morale but never dominate the existing drivers.
* Self-limiting branch: employees whose tokens are underwater leave through the existing attrition
  path, which removes the payroll and the morale drag together.

### Loop E — Decentralisation ↔ founder influence (§34, §35)

```
decentralisation ↑ → trust ↑ → sentiment ↑ → price ↑ → more decentralisation demanded
```

* **Concave benefit, linear cost.** `trustFromDecentralisation = decentralisationTrustGain (28) ×
  sqrt(d)` against a linear loss of control over treasury and roadmap. Concave-versus-linear
  guarantees an **interior optimum**: past a point, more decentralisation is strictly worse for the
  founder. No corner solution, so §35's trade-off is a real decision at every level.
* Decentralisation is **monotone non-decreasing** (§35 — control given away is not taken back), which
  makes the loop a ratchet with a ceiling rather than an oscillator.
* `founderInfluence` reverts toward `(100 − decentralisation)` at `founderInfluenceReversion 0.1`.
  It never jumps.

### Loop F — Mercenary growth → valuation → capacity

Incentivised users inflate `s.users` → `valuation()` rises → but VC and IPO are closed, so it buys
only M&A ratios and secondaries. Damped by the incentivised-user valuation discount (§1.5).

**Worth flagging now:** `canSellSecondary` requires Series B, which a tokenised company usually
never reaches — no rounds, no stage progression. So `bankedPayout` is **unreachable on the token
path** through the existing mechanic. Founder token sales (§42) are the token path's secondary and
**must credit `bankedPayout`**, or a token founder has no way to take money off the table at all.
`FounderTokenPosition.realisedProceeds` exists for this. Slice 4.

### 4.6 Invariants — assertable every tick, and Slice 2 must assert them

```
supply.circulating + supply.treasury + supply.locked === supply.total     (exact, integer)
organicUsers + incentivisedUsers === s.users                             (exact)
price >= launchPrice * priceFloorFraction  >  0
every 0–100 scalar has a reversion term; no clamp is load-bearing
no state variable is both input and output of the same tick without an EMA or a lag
allocation fractions sum to 1 ± allocationEpsilon
```

Per the plan's rule, these tests must be **mutation-verified**: break the damping on purpose and the
suite must go red. A test that passes with `speculationReversion = 0` does not exist.

---

## 5. The seam with Career PMF

> §52 is non-negotiable: incentivised acquisition must not create Strong PMF.

### 5.1 Where the split happens

`resolveSegmentAcquisition` (`pmf.ts:412`) has three demand terms: `spendEffect` (marketing),
`organic` (hype), and `referral` (added recently). The referral term is the one that matters:

```ts
const referral = currentCustomers * (truth.acquisitionAccessibility / 100) * REFERRAL_RATE * (...)
```

**It scales with `currentCustomers`.** If incentivised customers feed it, bought growth compounds
into growth that *looks* organic — the §52 violation would arrive through a term nobody was
watching. So:

**`resolveSegmentAcquisition` keeps its exact current signature and behaviour.** The call site in
`career/tick.ts:231` changes one argument's value:

```ts
currentCustomers: organicCustomers(career, target)   // was totalCustomers(career, target)
```

Because `organicCustomers === totalCustomers` whenever no incentivised cohort exists, this is a
**no-op for every non-token run** — `pmf.ts` is untouched, and the acceptance test ("bots
byte-identical with tokenisation off") holds by construction rather than by measurement.

`room` / `ceiling` keep using the **total**: the market is full either way.

Incentivised acquisition is a **separate additive term** in the token module,
`resolveIncentivisedAcquisition(...)` (Slice 3). Two functions, two populations, no shared
coefficients.

### 5.2 How cohorts carry the distinction

`CustomerCohort` gains **one optional field**:

```ts
origin?: 'organic' | 'incentivised'   // absent === 'organic'
```

Absent means organic, which is what every existing cohort and every existing save is — no migration
write, same trick as `capitalPath`.

**One list, not two.** A parallel `incentivisedCohorts` array would desync against the reconciliation
block at the top of `tickCareerPMF` (lines 82–106), which round-trips `s.users` against
`totalCustomers(career)` every week and absorbs stray users into a cohort. One list keeps one
invariant. Event-awarded and viral users continue to land in the target **organic** cohort, which is
correct: an arc did not pay them.

Per-cohort retention already runs in a loop, so incentivised cohorts get their own keep rate with no
restructuring at all.

### 5.3 Retention, and the number that tells the truth

`resolveCohortRetention` gains no argument. The token module supplies the incentivised keep rate:

```ts
keepIncentivised = keepOrganic * (1 - incentiveDependence)
                 + incentiveStrength * incentiveDependence
```

`incentiveDependence 0.62`; `incentiveStrength ∈ [0,1]` from this week's customer-rewards spend per
incentivised user.

Two consequences, and they are the entire point:

* While incentives run, incentivised retention can **exceed** organic retention — §12's 81% against
  63%. Growth genuinely looks better.
* The moment spend stops, `incentiveStrength → 0` and the keep rate collapses to
  `keepOrganic × 0.38` — §12's 31%.

And because that is a pure function, it can be **shown before it happens**:

```ts
expectedRetentionWithoutIncentives(career, token, segmentId): number
```

No simulation, no lookahead. That single exported function is what makes §53's warning — *"most
recent growth appears incentive-driven"* — an honest forecast rather than a mood. It is the primary
educational insight of the feature and it is one pure function; later slices import it, the UI shows
it, the postmortem quotes it.

### 5.4 What `derivePmfForSegment` sees

> **Organic customers and organic retention only. Exclusion, not weighting.**

`customers` ← `organicCustomers(career, segmentId)`.
`retention4wk` ← measured over organic cohorts only.

Not a discount. Not a weight. **Exclusion.**

The reasoning is short. `pmf.ts:496` already states the rule this subsystem was built on: *"PMF is
an OUTPUT, never an input… Research alone can never manufacture it, which is the single most
important rule in this system."* A user who stays because they are paid to stay is not evidence of
fit, at any weight. Any weighting scheme means that **enough** incentive spend still buys Strong
PMF, and §52 forbids that in absolute terms.

Exclusion also makes the guarantee **testable as an invariant** rather than as a threshold:

> For any incentive spend, with the organic cohorts held fixed, `derivePmfForSegment` returns a
> bit-identical result.

That is mutation-verifiable — change the exclusion to a 0.1 weight and the test must go red — which
is exactly what the plan demands of Slice 3's tests. A threshold test ("PMF stayed under 66") would
pass for the wrong reasons and is the class of test this project has already been burned by.

`retentionBySegment` splits:

```ts
retentionBySegment              // ORGANIC. Existing key, existing meaning, feeds PMF. Unchanged.
retentionBySegmentIncentivised? // optional, token-only. Display and warnings. Never feeds PMF.
```

Keeping the existing key pointed at the PMF-feeding number means every existing reader stays correct
without being visited.

### 5.5 Where incentivised users DO count

| Counts | Does not count |
|---|---|
| `s.users` | PMF (`derivePmfForSegment`) |
| revenue (they pay, possibly discounted) | the referral term |
| infra cost (they cost servers) | `retentionBySegment` |
| hype, community size, token demand | `fairValue`'s organic-user input |
| `valuation()`, at 0.35× per-user value | the network-unicorn organic-share gate |

They are real users with real costs and real revenue. They are simply not **evidence**.

### 5.6 Quick Play

Quick Play has no cohorts and one `s.pmf` number. There the split is the two scalars in
`TokenState.users` (`TokenUserSplit`), and the protection is that incentivised users are excluded
from the `pmf` growth term in `advanceWeek`. Slice 7.

`TokenUserSplit` is **authoritative only when `detailedPMF` is off.** In Career the cohorts are the
truth and Career code must never read it. That asymmetry is documented on the type itself, because
a mirror that Career writes and Quick Play reads is precisely how these two subsystems would desync.

---

## 6. Exported names later agents may import

From `src/game/token/types.ts` (**exists now**):

**Types** — `CapitalPath`, `TokenisationBlockerId`, `TokenisationBlocker`,
`TokenisationEligibility`, `SectorSuitability`, `TokenAllocationPlan`, `VestingPolicy`,
`TokenVestingSchedule`, `TokenUtilityModel`, `TokenLaunchPlan`, `TokenSupply`, `TokenMarket`,
`TokenCommunityState`, `TokenIncentiveCategory`, `TokenIncentiveProgramme`, `TokenUserSplit`,
`GovernanceProposalType`, `GovernanceProposal`, `TokenGovernanceState`, `TokenHistoryType`,
`TokenHistoryEntry`, `TokenSeriesPoint`, `FounderTokenPosition`, `TokenState`, `CohortOrigin`,
`RetentionSplit`, `TokenEndingKind`.

**Constants** — `TOKEN_STATE_VERSION`, `TOKEN_LIMITS`, `TOKEN_BOUNDS`, `TOKEN_SCORING`.

From `src/game/modes.ts` (**exists now**): capability keys `tokenisation`, `tokenEconomy`,
`tokenUserComposition`, `tokenIncentives`, `tokenCommunity`, `tokenGovernance`, `tokenNarrative`;
type `TokenDepth`; `GameRules.tokenDepth`.

From `src/game/types.ts` (**exists now**): `GameState.token`.

**Names later slices must create, with these exact spellings** — nothing else may be invented for
these jobs:

| Slice | Module | Export |
|---|---|---|
| 1 | `token/state.ts` | `capitalPath(s)`, `tokenActive(s)`, `createTokenState(...)` |
| 1 | `token/eligibility.ts` | `tokenisationEligibility(s)`, `sectorSuitability(sector)` |
| 1 | `token/persistence.ts` | `migrateTokenSlice(raw)` |
| 1 | `token/scoring.ts` | `founderStanding(s)`, `realisableTokenValue(s)`, `networkValue(s)`, `liquidityDiscount(s)` |
| 2 | `token/tick.ts` | `tickToken(s)` |
| 2 | `token/market.ts` | `treasuryValue(s)`, `fairValue(s)` |
| 3 | `token/users.ts` | `organicUsers(s)`, `incentivisedUsers(s)`, `organicShare(s)`, `resolveIncentivisedAcquisition(...)`, `expectedRetentionWithoutIncentives(...)` |
| 3 | `career/pmf.ts` | `organicCustomers(career, segmentId?)` |
| 3 | `career/types.ts` | `CustomerCohort.origin?`, `CareerPMFState.retentionBySegmentIncentivised?` |

`modes.ts`, `types.ts`, `engine.ts` and `store.ts` belong to the **integrator only**. Build agents
report the change they need; they do not make it.

---

## 7. What the brief gets wrong

Said now, per the instruction, rather than at Slice 4.

**7.1 §113's capability list is not buildable as written.** Two of its six can never be
independently false, and the two slices that matter most have no switch. See §3.

**7.2 §7 puts `organicUsers`/`incentivisedUsers` inside `TokenEconomyState`.** In Career that
duplicates the cohort truth and will desync — the cohort list is already reconciled against
`s.users` every tick. Resolved in §5.6: authoritative only when `detailedPMF` is off, documented on
the type.

**7.3 §7 stores `treasuryValue` next to `treasuryTokens` and `tokenPrice`.** A stored derived value
is a desync waiting to happen and it is exactly the double-count §49 warns about — the same number
would exist in two places with different update timings. `treasuryValue(s)` is a function.
`TokenState` has no such field. The same applies to `tokenMarketCap` (§50).

**7.4 §29's `treasuryValue = treasuryTokens * tokenPrice` is presented as the whole story and it is
the absorbing state.** The brief then says "use safeguards to prevent impossible runaway loops"
(§31) and stops. That is not a design; §4 is.

**7.5 §5 and §45 contradict each other on acquisitions.** §45 says the token path's endings are
network endings; §5 says "traditional acquisition may remain possible in some scenarios". If it
remains fully possible, the 2.05× premium is still available to token founders and the balance
argument in §1.3 shifts materially. **Decision: acquisition stays possible but is materially worse
on the token path** — the offer is priced off the discounted-user valuation (§1.5) and draws from a
reduced premium band, because an acquirer buying a company whose users are rented and whose
community can veto the deal pays less. This must be *implemented* in Slice 1 and *measured* in
Slice 8, not left to drift.

**7.6 §51 is written as hypothetical — "if Founder Mode later tracks founder wealth".** It already
does: `bankedPayout` and `gameOver.payout` are the game's score. §51 is therefore not future work;
the token leg has to be integrated at Slice 1 or the first tokenised run produces a wrong number.

**7.7 §55's Quick Play list has "Treasury capital ↑" as a benefit with no matching cost.** A token
sale that hands the player cash for nothing is a pure buff and violates §75 ("must NOT be
objectively better"). The costs must be immediate and mechanical: selling into your own float
depresses price and burns community trust, and the raise is bounded by **float depth, not by
ambition**. Target for Slice 1: the initial sale should raise, in expectation, *no more* than the
equity round it replaces — matched on the median, not on the best case.

**7.8 §44's five success states cannot all be endings.** One score, five endings, four cosmetic.
Resolved in §1.4: one `'network'` type plus `TokenEndingKind`.

**7.9 §43 does not say what a Community Revolt terminating actually is.** Decision: it routes to the
existing `fired` ending, whose payout formula already halves the equity leg — the right shape for
being removed. Recorded here so Slice 5 does not invent a seventh ending type.

**7.10 §70 asks for determinism but the brief never mentions the draw-order hazard**, which is the
actual way determinism breaks in this codebase. See §3.2. This is the failure most likely to ship
silently.

**7.11 Nothing in the brief accounts for `src/net/leaderboard.ts`'s ending whitelist.** A `'network'`
ending would be silently refused by `submitDailyScore` — no error, no score. Owner action, §1.4.

**7.12 §76 claims "no fixed optimal week" as a design goal but nothing in the brief creates the
tension that would make it true.** Early tokenisation is described as "large hype / weak utility",
late as "stronger fundamentals / less explosive upside" — but if the founder allocation is a fixed
fraction of supply and supply is fixed at launch, a later launch at a higher `fairValue` dominates
an earlier one on every axis. The mechanism that has to carry §76 is **community size at launch**:
`plan.totalSupply` and the initial sale clear against the community you have, so tokenising early
mints a small float that a growing company inflates past, while tokenising late mints a large float
that is harder to move. **Slice 1 must make the launch-time community the thing that sets supply
scale**, or §76 is decoration and the Early Token Bot loses to the Utility-First Bot every time.

---

## 8. Gate

Per `docs/ico-implementation-plan.md`: **the owner reads and approves §1 before Slice 1 starts.**
The rest of this document is recoverable. §1 is not.
