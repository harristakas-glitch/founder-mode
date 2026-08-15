# Career balance baseline — Slice −1

Purpose: make the traditional capital path a baseline worth measuring a second economy against.
`docs/ico-implementation-plan.md` blocks Slice 0 on this, because "does tokenisation dominate?" is
unanswerable against a skewed baseline.

Everything numeric here comes from a run actually performed. Harnesses:

* `npm run balance -- <mode> [sector...]` — `test/balance-probe.ts`, written for this slice.
  Modes: `ladder`, `unit`, `heads`, `pricing`, `landgrab`, `margin`.
* `npm run bots -- all` — `test/career-bots.ts`, the three-strategy harness.
* `npx tsx test/exploit-probe.ts all` — the degenerate-policy harness.
* Regressions: `test/career-balance.test.ts`, wired into `npm test`.

Unless stated otherwise: 24 seeds (`11 × n`), 90 weeks, five sectors, median founder net.

---

## 0. The harness was wrong a third time — and it produced two of the three findings

`docs/gameplay-review.md` measured fitness as `alive = !gameOver`.

`gameOver` is not failure. It covers `acquired`, `unicorn` and `ipo` alongside `bankrupt` and
`fired`. And every bot in both harnesses resolves inbox choices with option 0:

```ts
for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
```

Option 0 on an acquisition offer is **`Sell the company`** (`src/game/engine.ts`, the
`Acquisition offer` message). So every bot successful enough to be bought sold, and the harness
recorded the sale as a death. The offer trigger is `valuation > $8M && pmf > 50`, and `Coast` peaks
at a $2.0–2.6M valuation — so **coasting scored 24/24 "alive" by never being worth buying.**

The same line also understated the winners: `founder net` was recomputed as
`valuation(s) × founderEquity + bankedPayout`, discarding the acquisition premium that
`gameOver.payout` already carries. Measured over the reference policy's exits, the median offer is
**2.05× the company's own valuation that week**, worst case 1.18×.

Splitting `gameOver` into `failed` (bankrupt + fired) and `exits`, and scoring off
`gameOver.payout`, changes the reference policy's record from *"5–21/24 alive"* to:

| Sector | reported "deaths" | actually bankrupt | acquisitions | founder net (was) |
|---|---|---|---|---|
| B2B SaaS | 6/24 | **2/24** | 4 | $9.3M ($7.6M) |
| Dev Tools | 12/24 | **2/24** | 10 | $10.5M ($9.2M) |
| E-commerce | 18/24 | **4/24** | 14 | $16.7M ($10.8M) |
| Fintech | 12/24 | **2/24** | 10 | $10.6M ($8.2M) |
| Social App | 14/24 | **0/24** | 14 | $49.3M ($23.5M) |

Both harnesses now report `failed` and `exits` separately and never re-collapse them.

---

## 1. Coasting beats playing — **diagnosed, and it was the metric**

### The three named candidate causes, each closed with numbers

**"Marketing spend is net-negative EV at some scales."** Partly true, and correctly so.
`npm run balance -- unit all` samples marginal CAC and marginal LTV off the live state every week —
CAC by calling the engine's own `resolveSegmentAcquisition` at the current budget and at
budget + $1,000 with a *constant* rng so the ±15% noise cancels; LTV from the run's own
`lastRevenue / users` less infra, discounted by the engine's own weekly keep rate. Nothing is
transcribed.

| Sector | LTV/CAC, retention <50% | 50–65% | 65–80% | ≥80% |
|---|---|---|---|---|
| B2B SaaS | 0.28 | 0.33 | 0.68 | **6.28** |
| Dev Tools | 0.29 | 0.46 | 0.78 | **3.79** |
| E-commerce | 0.52 | 0.88 | 1.02 | **2.77** |
| Fintech | 0.25 | 0.43 | 0.68 | **4.01** |
| Social App | 0.63 | 1.26 | 2.38 | **7.96** |

The gradient is monotonic in all five sectors and crosses 1.0 in all five. Marketing pays back
exactly when the company has retention and not when it doesn't. **That is the correct shape and
nothing was changed here** — it is the design rule "growth is rented until retention is real",
priced.

**"Hiring is priced above what a marginal employee returns."** False.
`npm run balance -- heads all`, capping headcount:

| Sector | 0 heads | 1 | 2 | 3 | 8 |
|---|---|---|---|---|---|
| B2B SaaS | $3.2M · 0 failed | $4.7M · 0 | $7.5M · 3 | $9.3M · 2 | $9.3M · 2 |
| Dev Tools | $4.3M · 0 | $6.3M · 0 | $7.4M · 2 | $10.5M · 2 | $10.5M · 2 |
| Fintech | $3.9M · 0 | $3.6M · 1 | $8.2M · 2 | $8.9M · 2 | $10.6M · 2 |

Headcount pays 2–3× on the score and **saturates at three** rather than running away —
`coordinationDrag` is doing its job. A hire costs survival (0 → 2–4 failures) and buys value. That
is a trade, not a mispricing.

**"Growth invites events or board pressure that passive play avoids."** False.
**Zero `fired` endings** across every run in this slice — several thousand campaigns. `boardReview`
only fires once `s.board` exists, which requires a raise; and no bot in any configuration lost a
company to it.

### What was actually wrong

The premise inversion was §0. On the score the game reports at the end:

| Sector | Coast | Reference | ratio | Reference p10 |
|---|---|---|---|---|
| B2B SaaS | $1.6M · 0 failed | $9.3M · 2 failed | 5.8× | $1.9M |
| Dev Tools | $1.7M · 0 | $10.5M · 2 | 6.2× | $3.2M |
| E-commerce | $2.2M · 0 | $16.7M · 4 | 7.6× | $2.7M |
| Fintech | $1.7M · 0 | $10.6M · 2 | 6.2× | $2.4M |
| Social App | $2.0M · 0 | $49.3M · 0 | 24.7× | $6.0M |

The **10th-percentile active run beats or matches the median coasting run in all five sectors**.
Coasting is safe and it is worth 4–25× less. That is a defensible risk premium, and no fix was
applied to coasting — "make doing nothing worse" would have been the wrong shape.

`npm run balance -- ladder all` decomposes Coast → Reference one lever at a time if this needs
re-checking; each row differs from `Reference` in exactly one lever.

**Also measured, worth recording:** `Reference, never sells` (declines every acquisition) returns
$7.3M/$9.3M/$19.1M/$9.2M/$58.1M against selling's $8.3M/$9.3M/$19.1M/$14.1M/$29.2M. Selling wins in
two sectors, holding wins in two, one ties. The acquisition button is a real decision in both
directions.

---

## 2. `low` pricing is dominated — **fixed**

### Diagnosis

`always low` and `always premium` both let *beliefs* pick the segment, and belief scoring
(`needIntensity × 0.4 + willingnessToPay × 0.35 + retentionPotential × 0.55`) steers at the
high-willingness-to-pay end. So the review's table measured *pricing low while targeting
Enterprise* — the lever against the wrong market. That is the same class of error the harness
header already warns about ("giving only one bot the levers measures the levers, not the strategy").

Pointing a low-price policy at the market it exists for — the reachable, price-sensitive archetype
every sector has (Freelancers, Individual Developers, Individual Sellers, Everyday Consumers,
Casual Users) — `low` was already ahead there. But that market was itself dominated: **low-on-the-
cheapest-segment lost to premium-on-the-richest-segment in all five sectors**, so `low` could never
be the right answer at strategy level.

**Root cause.** Those segments are designed with three penalties (retention 38 vs 86, WTP 24 vs 88,
expansion 14 vs 80) and one compensating advantage: market-size headroom (`marketSize` 78 vs 22).
The headroom is never collected. Median segment ceilings against what a 90-week campaign actually
reaches:

| | median ceiling | reached | utilisation | `room` term |
|---|---|---|---|---|
| SaaS Freelancers | 88,636 | ~2,000 | 2.3% | 0.97 |
| SaaS Enterprise | 23,864 | ~350 | 1.5% | 0.98 |

`room = (1 − customers/ceiling)^1.3` sits at 0.97–0.99 all game **at both ends of the market**. The
low end's 3.7× headroom advantage was applied at a difference of about one percentage point of
acquisition, while its retention, price and expansion penalties were charged every single week.

### The change

`src/game/career/pmf.ts`, `resolveSegmentAcquisition` — one new term:

```ts
const referral = currentCustomers * (truth.acquisitionAccessibility / 100) * REFERRAL_RATE * (0.4 + truth.needIntensity / 140)
const raw = (spendEffect + organic + referral) * conversion * competition * room * marketingPenalty
```

`REFERRAL_RATE = 0.05`. Existing customers bring more customers, gated on how reachable their peers
are — an advantage that pays *weekly* instead of only at a ceiling nobody reaches. It is
deliberately **not** multiplied by `priceFit` in the term itself: `conversion` already carries
price fit, and that single application is the whole trade-off. Underprice a reachable segment and
the referral engine converts (+27 customers/wk on a 1,500 base); charge premium at the same people
and it stalls (+9/wk).

The constant was chosen so the loop has a restoring force rather than becoming absorbing — a
requirement the ICO plan makes explicit. At the most referral-friendly segment in the game
(reachability 84) it refers **1.80%/wk against 6.19%/wk churning out**, so referrals amplify growth
and can never sustain it. `room` caps it again at the ceiling. Both bounds are asserted in
`test/career-balance.test.ts`.

### Before / after — the price-sensitive segment, all five sectors

| Sector | low (before) | low (after) | market (after) | premium (after) |
|---|---|---|---|---|
| B2B SaaS | $4.8M · 4 failed | **$7.2M · 1** | $6.7M · 0 | $2.3M · 1 |
| Dev Tools | $4.8M · 2 | **$8.2M · 3** | $4.4M · 0 | $2.3M · 1 |
| E-commerce | $8.0M · 7 | **$11.9M · 6** | $4.0M · 10 | $2.9M · 5 |
| Fintech | $3.1M · 11 | **$4.4M · 3** | $3.0M · 4 | $2.1M · 1 |
| Social App | $8.1M · 8 | **$14.7M · 6** | $3.9M · 10 | $2.4M · 12 |

Founder net rises 42–81% and the failure count falls in four of five sectors (Fintech 11 → 3 is the
largest single move).

### Every pricing option now owns a situation

`npm run balance -- landgrab all` — three price points against all three segment tiers:

| Sector | price-sensitive tier | middle tier | high-WTP tier |
|---|---|---|---|
| B2B SaaS | **low** $7.2M | **market** $25.8M | **premium** $5.7M |
| Dev Tools | **low** $8.2M | **market** $24.0M | **premium** $11.8M |
| E-commerce | **low** $11.9M | premium $22.5M | **premium** $16.7M |
| Fintech | **low** $4.4M | **market** $16.7M | **premium** $7.1M |
| Social App | **low** $14.7M | **market** $24.2M | **premium** $60.9M |

`low` is first on the price-sensitive tier in **5/5**, `market` on the middle tier in **4/5**,
`premium` on the high-WTP tier in **5/5**. No pricing option is dominated.

`always low` on a belief-chosen (high-WTP) segment is still last, and should be — the fix is not to
make a wrong choice right, it is to make sure the right choice exists.

---

## 3. The Social / E-commerce gap — **separated; Social was the artifact**

The review could not tell "Social is structurally harder" from "the bots' revenue-denominated
hiring rule is wrong for Social", and asked for a margin-denominated bot. Built
(`npm run balance -- margin all`; headcount denominated in `lastRevenue − infra − office` instead
of `lastRevenue`):

Post-fix numbers (the verdict is identical pre-fix; both sets are in the scratch runs):

| Sector | revenue-denominated | margin-denominated | no hires |
|---|---|---|---|
| B2B SaaS | 1 failed · $8.3M | 1 failed · $9.3M | 0 · $3.4M |
| Dev Tools | 2 · $9.3M | 1 · $16.7M | 0 · $4.5M |
| E-commerce | 3 · $19.1M | 4 · $12.4M | 1 · $7.9M |
| Fintech | 2 · $14.1M | 1 · $14.5M | 0 · $3.4M |
| **Social App** | **0 · $29.2M** | **0 · $52.0M** | **0 · $6.0M** |

**Stated plainly: Social is not structurally harder, and it was a harness artifact.** Social has
**zero bankruptcies in 24 seeds under every hiring rule tested** — with hires, without hires, and
under both denominations, before and after the pricing fix. The review's "10/24 alive" was 14
acquisitions and no failures at all, and "turning hiring off takes Social from 10/24 to 19/24" was
measuring how many companies stayed too small to be bought.

The margin-denominated rule is nonetheless **better** in Social on value ($52.0M vs $29.2M; p10
$12.0M vs $7.8M; p90 $515.5M vs $104.6M), so the review's hypothesis that the revenue-denominated
rule is wrong for Social was directionally right — it just had no survival gap to explain. It is a
*bot* improvement, not an engine change, and nothing in `src/` was altered for it.

**E-commerce is the real one, and it stands.** It is the hardest sector on the corrected metric
(3–4/24 bankruptcies against 0–2 elsewhere), a margin-denominated rule does not rescue it (3 → 4),
and the earlier finding that it is the bots overspending is unaffected. At ~13–17% it is hard, not
broken, and it is left alone deliberately.

---

## Is the traditional path a fair baseline now?

**Yes, with one caveat named below.**

* No strategy dominates. Each pricing option is first in an identifiable, nameable situation
  (5/5, 4/5, 5/5). Adaptive belief-priced play beats every fixed pricing rule in SaaS, E-commerce
  and Fintech. Headcount pays and then saturates. Selling and holding each win in two sectors.
* Active play beats coasting by 4–25× on the score the game reports, with the 10th-percentile
  active run at or above the median coasting run — a risk premium, not a coin flip.
* True failure rates sit at 0–17% across all five sectors under the reference policy.

**Caveat for Slice 8.** `Social App` premium-on-brand-advertisers returns $60.9M against the
adaptive bot's $29.2M. That is not a *pricing* imbalance — it is that Social's ceiling is 26M
customers and its `careerArpu` scale-boost is logarithmic in users, so the sector's top end is
simply much larger than the other four. Measure the token path per-sector, not pooled, or Social
will dominate the average regardless of which capital path is used.

---

## What changed, and what deliberately did not

**Changed**

* `src/game/career/pmf.ts` — added `REFERRAL_RATE` and the `referral` term in
  `resolveSegmentAcquisition`. Career-only.
* `test/career-bots.ts`, `test/exploit-probe.ts` — report `failed` / `exits` separately, score off
  `gameOver.payout`, and document why `alive = !gameOver` was wrong.
* `test/balance-probe.ts` — new diagnosis harness (`npm run balance`).
* `test/career-balance.test.ts` — new, in `npm test`.

**Golden traces: not re-recorded, and they did not need to be.** All three
(`test/modes.test.ts`) still pass unchanged — verified. `resolveSegmentAcquisition` is reached only
behind `can(s, 'detailedPMF')`, which is Career-only, and the traces run
`newGame('Trace', 'saas', 'technical', { seed, aiRivals: true })`, i.e. Quick Play. The new term
adds no RNG draw: `resolveSegmentAcquisition` still draws exactly once, at the end.

**Deliberately not changed**

* **Coasting's floor.** It is safe and worth 4–25× less. Nerfing it would have made playing win by
  punishing idling rather than by paying.
* **The marketing payback curve.** LTV/CAC below 1 at low retention is the intended rule, priced.
* **`salesCycleWeeks`** — still dead data; wiring it in is a feature (unchanged from the review).
* **The marketing slider maximum** — `MaxSpend` still dies, and the burn is displayed.

  **Superseded.** `marketingMax` read `s.stage` and nothing else, and `s.stage` moves only in
  `acceptTermSheet`, so a company that never raised was frozen at $30k/wk however profitable. It is
  now `max(stage ladder, operating profit + 2% of cash)`, with both self-funded terms gated on being
  profitable — ability to fund, never appetite, so the LTV/CAC rule above survives intact. Measured:
  the reported bootstrapped case goes $30k → $358k/wk, every loss-making company keeps exactly the
  stage floor at any bank balance, and on `test/exploit-probe.ts` the `MaxSpend` policy is
  **bit-identical** with and without the change in all five sectors — it still fails 15–22/24 and
  returns 2.3–6.2× less than the reference policy, because a company running it is never profitable
  and so never earns a dollar of headroom. `npm run bots` does not move at all: those bots set
  `s.marketingSpend` from their own revenue/cash rules and never clamp to the cap.

---

## Mutation proofs

Every assertion in `test/career-balance.test.ts` was verified by breaking the thing it guards.

| Mutation | Assertions that go red |
|---|---|
| `REFERRAL_RATE` 0.05 → 0 | the mechanism assertion (`32 → 32 new customers/wk`), plus `low` wins on the price-sensitive segment in Dev Tools and Social |
| `spendEffect` → 0 (marketing buys nothing) | active play returns ≥2.5× coasting in SaaS (1.5×) and E-commerce (2.1×), plus 5 pricing assertions |
| acquisition `premium` → 1.0 | selling pays a real premium (1.09× against a 1.1× bar) — and nothing else |
| Social `careerArpu` 1.8 → 0.25 | Social is not a harder sector (3/12 vs 0/12) and the margin-rule row (4/12) — and nothing outside Social except its own pricing rows |

Each mutation was reverted immediately; `git diff` was checked clean between runs.

---

# 5. Rivals that act — BACKLOG §4.1, closed

**The defect.** `BACKLOG.md` §4.1: the "Late Entrant" scenario won **97% of runs against Standard's
90%** and was merely *longer* (median exit week 165). Rivals starting 8–14× your size occupied TAM
and never came for you. Meanwhile a whole attack economy existed and was calibrated against human
play (`test/arena-duel-probe.ts`, `test/arena-ffa-probe.ts`) — and AI rivals could not reach any
of it.

**Harness:** `npx tsx test/rival-pressure-probe.ts <scenarios|ordinary|counter|posture> [sectors]`.
24 seeds (`11 × n`) × 200 weeks × 6 sectors × 5 scenarios. 200 rather than 90 because free play has
no clock (§2.1) and §4.1's own median exit is week 165, so a 90-week harness scores most Late
Entrant runs as "still going" and measures nothing.

`rivalAggression` is a capability, so **every table below is an A/B on one flag inside one build** —
the "off" column is not a comparison against an older checkout. `npm run bots -- no-aggro` and
`npm run balance -- <mode> no-aggro` take the same switch.

## 5.1 The measurement that mattered: the obvious variable was useless

The natural gate for "a big rival raids a small one" is the size ratio. Swept over 24 seeds × 200
weeks, **an AI rival is bigger than the player essentially always**, by wildly sector-dependent
amounts — median rival/player ratio **8.9× in B2B SaaS but 54× in Fintech**, and 45× / 348× under
Late Entrant. A `ratio >= 2.5` gate is satisfied **92–100% of the time**, so it gates nothing, and a
leverage term built on it pins at its cap in every sector — which is the defect restated, not fixed.
Iteration 1 duly moved Late/Standard founder net from 0.587 to 0.547: no separation at all.

**Share of the effective TAM** is normalised by construction and separates the scenarios. Median
rival share, same sweep:

| Sector | Standard | Late Entrant |
|---|---|---|
| B2B SaaS | 2.6% | 11.8% |
| Dev Tools | 5.1% | 14.8% |
| E-commerce | 0.9% | 6.7% |
| Fintech | 1.7% | 9.7% |
| Social App | 9.1% | 18.5% |
| AI/ML Infra | 2.5% | 11.2% |

Both force (`rivalRaidLeverage`) and frequency (`rivalAggroCooldown`) ramp on it, 5% → 13%. Social
is high in both, which is sector character rather than a bug: a winner-take-all market has
entrenched incumbents by design.

## 5.2 Iterations

24 seeds × 200 wk, B2B SaaS, calibrated reference policy.

| # | change | attacks/run | Standard net | Late net | Late/Std |
|---|---|---|---|---|---|
| — | *(aggression off)* | 0 | $48.4M | $28.4M | 0.587 |
| 1 | cooldown 12, chance .34, player-symmetric leverage | **27** | $31.6M | $17.3M | 0.547 |
| 2 | cooldown 26, chance .22, tighter poach/smear gates | 10 | $42.4M | $22.4M | 0.528 |
| 3 | leverage on TAM share (floor 3%, cap 18%) | 10 | $36.2M | $13.0M | 0.359 |
| 4 | + cooldown ramps 26→14 with grip | 10 | $27.9M | $14.7M | 0.527 |
| 5 | floor 3%→5%, cap 14%→13% **(shipped)** | 6.9 | **$36.2M** | **$13.0M** | **0.359** |

Iteration 1's 27 attacks per run is weather, and players are right to ignore weather — the same
failure `test/pricewar-probe.ts` found in the Arena bots, which sat at war 86% of all weeks until a
cooldown made a war an episode. Iteration 4 bought separation at the cost of a 42% hit to Standard,
which is not "moves only modestly"; raising the share floor to 5% put Standard's median rival back
below the bar in five of six sectors and left Late Entrant's above it in all six.

## 5.3 Result — all six sectors, calibrated policy

`win` = 1 − (bankrupt + fired)/24. `atk` = attacks landed per run.

| Sector | Standard off | Standard ON | Late off | Late ON |
|---|---|---|---|---|
| B2B SaaS | 100% · $48.4M | 100% · $36.2M · 6.9 atk | 100% · $28.4M | 100% · **$13.0M** · 9.9 atk |
| Dev Tools | 100% · $141.8M | 100% · $43.2M · 9.1 | 100% · $25.9M | **96%** · $20.0M · 13.5 |
| E-commerce | 92% · $74.0M | 92% · $64.7M · 5.7 | 88% · $23.3M | 92% · **$19.5M** · 9.5 |
| Fintech | 96% · $51.0M | 96% · $25.1M · 5.9 | **100%** · $40.7M | **88%** · $20.0M · 11.3 |
| Social App | 92% · $52.8M | 79% · $34.4M · 5.1 | 75% · $26.0M | **63%** · $15.0M · 8.0 |
| AI/ML Infra | 100% · $56.7M | 100% · $45.7M · 6.1 | 100% · $48.4M | 100% · **$13.8M** · 13.0 |

* **Late Entrant now takes 1.5–2.2× the pressure of Standard in every sector**, and returns the
  lowest or near-lowest founder net of any scenario in every sector.
* **Fintech is the clean case**: Late Entrant was *easier* than Standard before (0/24 failures
  against 1/24) and is now clearly harder (3/24 against 1/24).
* **Standard's win rate is unchanged in five of six sectors.** Social moves 92%→79%, and Social is
  the one market whose rivals genuinely hold ~9% of TAM at baseline.
* **Nothing became unplayable.** The worst cell is Social + Late Entrant at 63%, in the sector that
  was already hardest (75% before) and where Funding Winter and Rich Kid still sit at 96%/100%.

## 5.4 The mix is situational, not a timer

Total attacks over 24 seeds × 200 wk, and the median week of the first one:

| Sector · scenario | first attack | mix |
|---|---|---|
| SaaS · standard | wk 73 | poach 103 · raid 58 · pricewar 4 |
| SaaS · late | **wk 21** | **raid 176** · poach 62 |
| Fintech · standard | wk 94 | poach 99 · raid 39 · pricewar 2 · smear 1 |
| Fintech · late | **wk 15** | **raid 209** · poach 61 |

Standard is a **talent fight arriving late** — a rival who out-raised you by two rounds comes for
your people. Late Entrant is a **user raid from week 15** that never really stops. Different
scenario, different threat, different answer, from one policy reading one state.

## 5.5 Does answering pay?

Both counter-policies act only on `hostileRivals` — the same posture the rival table renders, so the
bot has no information a player lacks.

| Sector · scenario | bare | shield when threatened | shield + counter-raid |
|---|---|---|---|
| SaaS · standard | $36.2M | $51.5M · 6.0 blocked | $53.6M |
| SaaS · late | $13.0M | **$31.4M** · 12.0 blocked | $27.5M |
| Fintech · standard | $25.1M | $28.5M | $34.1M |
| Fintech · late | $20.0M · 3/24 failed | $21.6M · 1/24 | $32.2M · 1/24 |

The retainer is the reliable answer and pays most exactly where the pressure is (SaaS Late Entrant,
+142%). The counter-raid is a genuine gamble — better in Fintech, **worse than simply turtling in
SaaS Late Entrant**. That is the shape `arena-ffa-probe` already found for the shield: bought when
the lobby is hot, skipped when it is not.

### The exploit this section found

Opening `applyAttackOutgoing` to AI rivals pointed an Arena-calibrated formula at a size gap it was
never measured against. `leverage = clamp(targetUsers / yourUsers, 0.5, 3)` — "punching up at the
leader pays 3×" — is fine between peers and absurd when the target is 10–350× you: 10% of a
19,000-user incumbent times 3 is **5,700 customers for one $40k cheque** against a 434-user company.
Measured before the fix: shield+raid returned **$868M–$1.05B** of founder net against a bare
policy's $13–36M, on 40k–99k users.

A cap alone was not enough. **Any** cap proportional to your own size compounds over the 5-week ops
cooldown — 1.15^40 is 267×, and the capped policy still returned $183M. The fix is
`RIVAL_RAID_GAIN_CAP` (15% of your own users) **and** `RIVAL_RAID_FATIGUE` (each raid yields 0.7× the
last), the latter for the same reason `backfireChance` escalates: the second campaign against a
market is aimed at the customers who ignored the first. Both live in `attackRival` and **not** in
`applyAttackOutgoing`, because a 3× leverage against a 3× peer already pays 90% of your own user
base in Arena and capping it centrally would silently rebalance the duels that calibrated it.

## 5.6 Career: the reference policy barely notices

`npm run balance -- ladder all`, with and without the flag. Career runs are 90 weeks and the first
attack in a Standard market lands around week 73–94, so most Career runs end before the pressure
arrives. This is the intended shape: the fix targets long free-play runs, which is where §4.1's
defect lived.

| Sector | failed before → after | founder net before → after |
|---|---|---|
| B2B SaaS | 4 → 4 | $6.3M → $6.2M |
| Dev Tools | 1 → **0** | $11.6M → $10.3M |
| E-commerce | 5 → 5 | $15.0M → $15.0M |
| Fintech | 4 → 4 | $12.1M → $12.1M |
| Social App | 6 → **7** | $14.5M → $10.4M |
| AI/ML Infra | 1 → 1 | $13.0M → $13.7M |

**Failures move by at most one in any sector.**

`npm run bots -- all`, founder net, and the property that must not break:

| Sector | Careless | **Disciplined** | Enterprise |
|---|---|---|---|
| B2B SaaS | $5.3M → $4.0M | **$7.6M → $6.2M** | $4.5M → $4.3M |
| Dev Tools | $2.6M → $2.5M | **$11.3M → $9.4M** | $5.2M → $4.0M |
| E-commerce | $4.3M → $4.3M | **$14.1M → $14.1M** | $12.0M → $12.0M |
| Fintech | $2.1M → $2.0M | **$11.2M → $8.8M** | $3.5M → $3.5M |
| Social App | $1.7M → $1.7M | **$11.6M → $12.1M** | $9.7M → $5.9M |
| AI/ML Infra | $3.1M → $3.1M | **$12.9M → $12.9M** | $10.4M → $6.4M |

**Disciplined Discovery is strongest in all six sectors, before and after.** The strategy ordering
is preserved.

## 5.7 Golden traces: not re-recorded, and that is a property rather than luck

All three hashes in `test/modes.test.ts` pass unchanged. Two independent reasons, both pinned by
`test/rival-aggression.test.ts`:

1. With the capability **off**, `rivalAggressionStep` is never called and draws **zero** times, so a
   passive run is byte-identical to the pre-change engine. This is what makes every "off" column
   above a valid baseline rather than a second game.
2. With it **on**, no rival may act before week 12 (`RIVAL_AGGRO_MIN_WEEK`) — and the traces cover
   exactly weeks 1–12.

The test asserts a played 12-week run is identical with the flag on or off, that a 120-week run
**diverges** (so the first assertion is a property and not a tautology), and that the grace period
is `>= 12` against a literal rather than against the constant being guarded.

## 5.8 Mutation proofs

28 mutations of `src/game/engine.ts`, **27 killed, 1 equivalent**. Reproduce with
`bash scripts/mutate-rival-aggression.sh`; the full table is at the bottom of
`test/rival-aggression.test.ts`.

The survivor is genuinely equivalent: aggression is gated twice (`tickRivals` will not call the
step, and `rivalStance` returns `calm`), so removing either gate alone leaves behaviour identical.
Mutations 2 and 3 kill the two gates individually.

**The sweep found two real defects**, which is the argument for running it:

* **Dead code.** The announcement used to `return` after writing `hostileSince`, handing out one
  week of notice as a side effect and leaving the `RIVAL_AGGRO_NOTICE` guard unreachable — deleting
  the guard changed nothing. The return is gone and the guard is the notice.
* **A gate nothing depended on.** `rivalStance` checked the capability, but no assertion cared, so a
  run with rivals passive would still have painted Hostile badges for attacks that could never come.

And two weak assertions of the classic kinds: fixtures built from the very constants under mutation
(`staged({ week: RIVAL_AGGRO_MIN_WEEK - 1 })` moves with the code, so zeroing the floor stayed
green), and bounds loose enough to pass on a broken engine (`product < before + 1.1` holds with the
product cost at zero, since the weekly build is +0.3..+1.1).
