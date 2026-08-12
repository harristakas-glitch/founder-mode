# Balance deep dive — Quick Play and the cross-cutting levers

Scope: everything the two existing balance documents did not cover.
`docs/balance-baseline.md` measured Career's traditional path exhaustively; `test/token-balance-probe.ts`
measured the token path. Neither touched **Quick Play** — the mode a new player meets first — and
`docs/gameplay-review.md` closes by saying so:

> Quick Play / Arena-only systems (M&A, IPO pricing, debt covenants, PvP attacks and shields) were
> read but not bot-tested.

Harness: `npx tsx test/deep-balance-probe.ts <section...> [sector...]`. 16 seeds (`11 × n`),
90 weeks, five sectors, median founder net off `gameOver.payout`. Every number below comes from a
run actually performed.

**Headline: Quick Play is not balanced, and it is not close.** Three of its five product sliders are
dominated by a fourth, one of its two founder kinds is dominated in all five sectors, its ending
system is effectively unreachable, and in three of five sectors the revenue model asks for a scale
the mode cannot produce.

---

## 0. The harness was wrong a fourth time — recorded so nobody re-derives it

The Career harnesses set `marketingSpend = lastRevenue × 0.5`. Ported to Quick Play, that policy
measures nothing:

```
acquired = acqBase × (hype/10)^1.25 × (0.4 + pScore/130) × pmfAcq × room + paid
```

Hype is bought with `adSpend`. A revenue-denominated budget cannot bootstrap from week 1, when
revenue is zero — so the whole mode reads as a flat $2M ceiling regardless of what you do. That is
a **cold start in the harness, not in the game**.

Calibrated across eight budget rules; `cash × 2%` is the best survivable one and is used
throughout. Hiring prefers **marketers**, because `marketerPoints` is what holds hype up against
its 8%/wk decay. Every number in this document is from the calibrated policy.

---

## Findings, ranked

### 1. Quick Play's revenue model is calibrated for a scale the mode cannot reach — **highest, FIXED**

**Fixed as P1:** `arpuWeekly` and `careerArpu` collapsed into one `arpuPerCustomer` (the Career
values, which were the calibrated ones). Measured after: bankruptcies fall from 10–15/16 to 0–3/16
in every sector under the calibrated policy, coasting still loses 7–21×, exits land at 4–9 of 16 —
which also satisfies P4's verification condition without touching a threshold — and `npm run bots`
is byte-identical, since Career already billed at these values. Golden traces re-recorded in the
same commit: the draw order is unchanged (advanceWeek reseeds per week; the change swaps one
multiplicand), only the state values in the hash moved. The table below is preserved as the
pre-fix record.

`npx tsx test/deep-balance-probe.ts econ`

| Sector | `arpuWeekly` | `careerArpu` | users to cover $6k/wk | reached @ 90wk | verdict |
|---|---|---|---|---|---|
| B2B SaaS | 9 | 22 | 875 | 1,210 | viable |
| Dev Tools | 5 | 24 | 1,585 | 1,583 | **exactly break-even** |
| E-commerce | 3 | 12 | 2,637 | 1,392 | **1.9× short** |
| Fintech | 4 | 18 | 2,041 | 1,047 | **1.9× short** |
| Social App | 0.12 | 1.8 | 73,171 | 4,410 | **16.6× short** |

`reached` is the median under the *best* allocation found anywhere in this document. It maps
straight onto observed bankruptcy: SaaS 1/16, Dev Tools 0–5/16, Fintech 3–11/16, E-commerce
10–15/16, Social 11–15/16. **A Social Quick Play company needs 73,000 users to cover a modest cost
base and tops out at 4,400.** No allocation, budget, hiring rule or founder kind changes that.

This is the *same defect* that was already found and fixed on the other side of the engine. The
`careerArpu` field exists precisely because Career counted retained accounts in the hundreds while
being billed at a rate written for tens of thousands, which left "every Career company structurally
unprofitable in all five sectors". Quick Play reaches hundreds-to-thousands too, and still bills at
`arpuWeekly`. **The fix was applied to one mode and not the other.**

### 2. Research dominates the product allocation; three of five sliders are dominated — **FIXED as P2**

**Fixed, structurally — three changes that give each slider its own clock:**
- **Research saturates on `researchSignal`** — the stock research itself accumulates, whose only
  other reader already treats it as "how much you have learned about this idea". Early interviews
  are gold; the hundredth is a rerun. A pivot resets it, so a new idea makes research young again.
- **Quality earns fit as a stock** (`+ quality/100 × 0.35` in `pmfGain`) and the churn craft terms
  run at full weight (`quality/120`, `bugs/90`, base re-centred so a mid product churns as before).
- **PMF decay is proportional (`pmf × 0.012`), not flat.** The flat −0.5/wk is what made research
  dominance inevitable: every other gain term saturates, so only the one unsaturated term could
  outrun a constant drain forever. Proportional decay makes the block an equilibrium system —
  sustained effort G settles at `G/(G/110 + 0.012)` — and it also removes finding 5's early-game
  death spiral (at PMF 8 the drain is 0.1, not 0.5).

**Measured after:** interior optimum at 10–30% research in four sectors; E-commerce prefers 0%
(a high-churn transactional market rewards shipping over discovery — sector character, and research
is first elsewhere). Research-100 is worst or near-worst everywhere. The game's default 40/30/20/10
allocation is now competitive with the tuned split — a new player's default is no longer a trap.
Exits fire at 2–7 of 16 through the unchanged $8M/pmf-50 gate, which closes most of P4. Original
finding preserved below.

`npx tsx test/deep-balance-probe.ts alloc`

Median founder net by research share, remainder split features/quality/bugs at 4:3:2:

| research % | SaaS | Dev Tools | E-commerce | Fintech | Social |
|---|---|---|---|---|---|
| 0% | $2.5M | $2.3M | $1.7M | $2.1M | $1.4M |
| 10% *(game default)* | $3.4M | $2.4M | $1.8M | $2.2M | $1.6M |
| 40% | $4.8M | $3.0M | $2.0M | $2.2M | $1.7M |
| 80% | **$9.8M** | $5.0M | **$2.8M** | $2.4M | $1.7M |
| 100% | $7.4M | **$6.6M** | $2.2M | **$3.0M** | **$1.9M** |

Monotone to 80–100% in all five sectors. **SaaS pays 3.9× for moving one slider**, and PMF tracks
it exactly: 17 at 0% research, 76 at 100%. "Ship nothing, fix nothing, research everything" is at
or near the top everywhere.

**Mechanism, and it is structural rather than a constant.** In `advanceWeek`:

```
pmfGain = (0.3 + researchPoints × 0.35 + featureGain × 0.25) × resonance × (1 − pmf/110)
featureGain = engPoints × af × 0.32 × (1 − features/130)
```

Per point of allocation, research credits `0.35` and features credit `0.32 × 0.25 = 0.08` —
**4.4× less** — and the feature term is additionally multiplied by `(1 − features/130)`, so it
decays toward zero as the product fills out while research never decays.

Then the payoff asymmetry compounds it. `s.pmf` is read by **four** multiplicative terms —
`pmfAcq`, `wordOfMouth ∝ (pmf/100)^1.5`, `churnMult`, and revenue `conversion` — while
`productScore` is read by **one**, `(0.4 + pScore/130)`, worth at most 1.77×. Features, quality and
bug-fixing all buy `productScore`. They are buying the cheap currency.

This is the same shape as the `low` pricing finding in `docs/balance-baseline.md` §2, and it is
larger: there, one option out of three was never correct; here, three sliders out of five are.

### 3. Quick Play's ending system is effectively unreachable

Across every configuration in this document — 9 allocations × 5 sectors × 16 seeds, plus the
founder, choice and debt sections — **exits never exceed 3 in 16, and are 0 in most cells.**

The acquisition trigger is `valuation > $8M && pmf > 50`. The Quick Play ceiling under the best
policy found is $2.4M–$9.8M median. IPO needs $500M and unicorn $1B. So a Quick Play run has one
realistic ending: reaching week 90 still trading, or going bankrupt.

This is the same class of defect the token work already surfaced — zero IPO endings in ~9,000
Career runs — and it is worse here, because Quick Play has no `network` ending to fall back on.

### 4. Founder kind: technical dominates in 5 of 5 sectors — **FIXED as P3, half of it a harness artifact**

**Half the gap was the bot, not the game.** The probe hired marketers-first for both kinds — the
correct complement for a technical founder and redundant for a business one, who already holds 4
marketer points against hype that saturates. Under matched play (engineer-first for both, which
post-P2 wins for both kinds in all five sectors), the 1.6–2.7× gap shrinks to 1.1–1.4×.

**The other half is the deal game**, added as three pure multipliers on existing draws: a business
founder prices rounds 18% higher (less dilution per cheque), runs exit processes that clear 15%
richer, closes candidates at +8 points, and the sales boost rises from decoration (8%) to 18%.

**Measured after, matched play:** technical first in SaaS (1.13×), Dev Tools (1.37×), Fintech
(1.17×), Social (1.32×); **business first in E-commerce** (1.12×, and safer, 1 failure vs 2). Each
kind is first in a nameable situation — the bar §2 of balance-baseline set for pricing. Original
finding preserved below.

`npx tsx test/deep-balance-probe.ts founder` — identical policy, one field changed:

| Sector | Technical | Business | ratio |
|---|---|---|---|
| B2B SaaS | $9.8M · 1 failed | $3.6M · 1 | **2.7×** |
| Dev Tools | $5.0M · 1 failed | $2.2M · **7** | **2.3× and safer** |
| E-commerce | $2.8M · 10 | $1.7M · 10 | 1.6× |
| Fintech | $2.4M · 10 | $2.0M · 11 | 1.2× |
| Social App | $1.7M · 14 | $1.4M · 15 | 1.2× |

`founderKind` is read in exactly three places: `engPoints` (5 vs 1.5), `marketerPoints` (4 vs 1),
and a flat `+0.08` sales boost. **This is finding 2 wearing a different hat** — `engPoints` feeds
the PMF engine, `marketerPoints` feeds hype only, and PMF is worth four terms to hype's one. Fixing
finding 2 should mostly fix this; it is listed separately because it must be re-measured, not
assumed.

### 5. PMF decays on a seeded coefficient the player cannot see or change — **death spiral fixed by P2; signpost (P6) still open**

P2's proportional decay removed the unwinnable-seed mechanism: a low-resonance company now settles
at a low equilibrium it can see and pivot out of, instead of decaying to zero regardless of play.
What remains open is the signpost — the UI still shows a resonance *band* rather than saying
plainly that this product is not resonating and a pivot is the instrument.

```
s.pmf = clamp(s.pmf + pmfGain − 0.5, 0, 100)
```

A flat **−0.5/week**, against a gain multiplied by `s.resonance` — seeded at `rand(0.5, 1.45)`,
clamped `[0.45, 1.6]`. At the low end of that range a solo founder's `pmfGain` is ≈0.29, so PMF
**falls every week no matter what the player does**, and every downstream term falls with it.

`pivot` rerolls resonance (`s.resonance = rand(0.5, 1.45) + bonus`) and is the only escape. Tested:
pivoting below 1.05 lifts median PMF 30 → 36 in SaaS. It is a real and necessary mechanic that no
bot had ever used and that the run does not signpost — `resonanceEstimate` shows a *band*, not the
instruction "this seed cannot be won without a pivot".

### 6. Inbox option 0 is systematically the right answer

`npx tsx test/deep-balance-probe.ts choices` — the only change is which index resolves each choice:

| Sector | Always first | Always second |
|---|---|---|
| B2B SaaS | 1/16 failed · $9.8M | **14/16 failed** · $1.6M |
| Dev Tools | 1/16 · $5.0M | **15/16** · $1.6M |
| E-commerce | 10/16 · $2.8M | **15/16** · $1.3M |
| Fintech | 10/16 · $2.4M | **16/16** · $1.2M |
| Social App | 14/16 · $1.7M | **16/16** · $985k |

Answering the second option instead of the first is close to a death sentence in every sector. The
events *read* as dilemmas but the menu is lopsided: there is a safe column and a punishing one, and
it is the same column every time. (Caveat: this policy also declines acquisitions, but exits are
0–3 per cell everywhere, so they cannot account for a 1→14 swing in failures.)

### 7. The covenant default is a flat 15% — latent, and the ordering matters — **FIXED as P0**

**Fixed:** `covenantConversion(shortfall, valuation) = clamp(shortfall/valuation × 1.5, 0.03, 0.6)`,
the same "capital costs ownership" shape as `saleDilution`, with a distress premium and a floor.
Measured through `advanceWeek`: a $100k default costs 3.0 points of equity, a $20M default 66.0,
against a flat 15.0 for both before. Landed BEFORE P1, which is what makes the credit line big
enough to abuse. Original finding preserved below.

`gameplay-review.md` flagged this by inspection and never ran it. Confirmed by reading
`covenantCheck`: the conversion is `s.founderEquity *= 0.85`, which **never reads `shortfall`**.
Defaulting on $10M and defaulting on $250k cost the founder exactly the same.

Measured (`deep-balance-probe.ts debt`), it is **not currently exploitable**: median debt drawn is
$0–309k and there are **zero covenant breaches** in any cell, because `debtCapacity` requires
$250k of annual revenue and caps at half of it — revenue Quick Play cannot generate (finding 1).

**So it is a live exploit the moment finding 1 is fixed.** Sequencing is load-bearing.

### 8. Carried forward: the token path still leads in two sectors

From `test/token-balance-probe.ts` after the three fixes in `b0ec4bd`/`c1cc65d`: E-commerce 2.82×
and Social 4.44×. Both are sector-shaped rather than token-shaped — "idle, sale burned" loses in
both — and Social is the sector `balance-baseline.md` already lists as undiagnosed.

---

## The plan

Ranked by leverage. **The order is not arbitrary — P0 must land before P1.**

### P0. Price the covenant default by what was actually defaulted on
`src/game/engine.ts`, `covenantCheck`. Replace the flat `*= 0.85` with a conversion that scales
with `shortfall` against enterprise value — the same rule `saleDilution` already applies to the
token sale, so there is one definition of "capital costs ownership" rather than two. Small, cheap,
and it must precede P1 because P1 is what makes the credit line big enough to abuse.
**Verify:** defaulting on a maxed line costs strictly more than defaulting on a small one, and more
than repaying.

### P1. Give Quick Play a revenue rate that matches its reachable scale
The `careerArpu` fix, applied to the mode that never got it. Not necessarily a second field —
the cleaner shape may be for the per-user rate to be a function of the scale a mode actually
reaches, so a third mode cannot repeat the bug.
**Verify:** bankruptcies fall to the 0–4/16 band in all five sectors; coasting still loses by ≥2×;
`npm run bots` and the golden traces are untouched (Career reads `careerArpu`, so they should be
byte-identical).

### P2. Make features, quality and bugs worth buying
The largest *design* item, and it is deliberately not a constant tweak. Two structural options,
and I would do both:
- **Give research the saturation term features already has.** Research is the only PMF input with
  no diminishing returns, which is why 100% is optimal in three sectors.
- **Put `productScore` into more than one term.** Retention/churn is the natural second home: a
  buggy, unpolished product should leak customers, and today it barely does (`churnMult` reads
  `quality/250` and `bugs/200` — an order of magnitude weaker than its `pmf/45` term).
**Verify:** the research sweep develops an interior optimum in all five sectors, and no single
slider is first at 100%.

### P3. Re-measure founder kind, and only then decide
P2 changes the currency `engPoints` and `marketerPoints` buy. Re-run `founder` afterward. Fix only
if technical still wins 5/5.
**Verify:** each kind is first in at least one nameable situation — the bar `balance-baseline.md`
§2 set for pricing.

### P4. Make at least one ending reachable in Quick Play
Either the ceiling rises out of P1+P2, or the thresholds are mode-scaled. Measure first: if P1+P2
put the median at $20M+, the $8M acquisition trigger starts firing on its own and nothing else is
needed. Do not scale thresholds before re-measuring.
**Verify:** exits land in a 4–10 of 16 band — common enough to be a real outcome, rare enough to
stay an achievement.

### P5. Audit the event choice table
Finding 6 is a content problem, not a formula problem: roughly 40 events in `src/game/data.ts`,
each needing its options checked for a systematically safe column. The measurable target is that
"always first" and "always second" land within ~30% of each other on median net.
**Verify:** re-run `choices`; the two rows converge.

### P6. Resonance — a floor, or a signpost
A seed where PMF decays regardless of play is a run the player cannot win and is not told about.
Either floor `resonance` so `pmfGain` can always clear the 0.5 decay at reasonable effort, or make
the UI say plainly that this product is not resonating and a pivot is the instrument. I lean to the
signpost: an unwinnable premise the player can *detect and escape* is good drama; one they cannot
see is not.

### P7. Then re-open the token gap
E-commerce and Social (finding 8) sit downstream of the sector curves P1 touches. Re-run
`token-balance-probe.ts` after P1 before doing anything token-side.

---

## Deliberately not changed, and why

* **Nothing in `src/` was modified for this document.** It is a measurement pass; every fix above is
  a proposal with a verification condition attached, in the shape the balance work has used
  throughout.
* **Career and the token path were not re-derived.** Both are already measured in their own
  documents, and re-running them here would only add noise.
* **Arena/PvP** — `test/pricewar-probe.ts` and `test/arena-auction-probe.ts` exist and the auction
  was cleared in `gameplay-review.md` §Fix 2. The attacks have not been swept against each other;
  that is the next unmeasured surface after this one, and it needs two live clients or a headless
  duel harness that does not exist yet. Recorded as open rather than guessed.

## Reproduction

```
npx tsx test/deep-balance-probe.ts all
npx tsx test/deep-balance-probe.ts alloc saas
npx tsx test/deep-balance-probe.ts econ
```
