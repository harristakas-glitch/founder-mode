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
