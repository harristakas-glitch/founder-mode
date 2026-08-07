# Career mode: the actual model

Everything here was derived by reading `src/game/career/*.ts` and `src/game/engine.ts` and then
**running the code** to check it. Every number in this document was measured, not estimated. Where
the existing docs disagree with the code, the code wins and the disagreement is listed at the end.

Verified against the tree at the time of writing (`npm test` → ALL PASS).

---

## Why your PMF isn't moving

1. **The research slider does nothing to PMF in Career.** The `pmfGain` line still executes, but
   `tickCareerPMF` overwrites `s.pmf` two lines later. Measured: same seed, `resonance` forced to
   0.45 vs 1.60 (a 3.5× multiplier on `pmfGain`) → **identical PMF, identical user count.**
2. **PMF is flat for the first five weeks by construction.** Nothing has a four-week retention
   reading until week 6. Measured across 5 sectors × 2 seeds: PMF sits at 25–31 for weeks 2–5, then
   jumps 20–30 points in week 6, **in every single run**.
3. **Retention is 46 of the 100 points.** Price fit is 20, product fit 14, scale 12, market headroom
   8. If retention is flat, PMF is flat.
4. **Below 15 retained customers in a segment, the score is hard-capped at 40** no matter what.
5. **Features actively hurt.** Measured, 40 weeks, seed 4242: 70% features → PMF 47; 70% quality →
   PMF 60. Features generate bugs; bugs cut retention; quality is the *only* allocation lever that
   raises product fit.

---

## 1. How Career PMF actually works, end to end

### The branch

`advanceWeek` (`src/game/engine.ts`) runs one shared simulation. Career only replaces the
users/PMF step:

```
engine.ts:1086   careerDrag = careerProductDrag(s)          ← Career eats engineering capacity here
engine.ts:1106-1112  featureGain / quality / bugs           ← shared
engine.ts:1115-1119  researchPoints, researchSignal, pmfGain, s.pmf = ...   ← ALWAYS RUNS
engine.ts:1180   careerOn = can(s,'detailedPMF') && !!s.career
engine.ts:1181-1192   if (careerOn) { tickCareerPMF(...); s.users = r.customers;
                                      s.pmf = r.companyPmfScore }           ← OVERWRITES
engine.ts:1193-1206   else { Quick Play acquisition / churn }
```

Line 1119 writes `s.pmf`. Line 1190 overwrites it. Between them, nothing in the Career path reads
`s.pmf` — `productScore()` (line 468) uses only features/quality/bugs, and the venture/bet block
uses `bet.pmf`. **The `pmfGain` line is computed and thrown away every week in Career.**

### One Career week, in order (`tickCareerPMF`, `src/game/career/tick.ts`)

| # | Step | Lines |
|---|---|---|
| 1 | **Reconcile.** Events/arcs award users straight onto `s.users`. Surplus becomes a new cohort on the target segment; a shortfall is taken off the newest cohorts, keeping `exactCustomers` in step. | 73–101 |
| 2 | **Repositioning cools off.** `remainingWeeks--`; while active, `marketingPenalty` 0.55 and `productPenalty` 0.7. | 107–112 |
| 3 | **Experiments.** Any whose `completionWeek` has arrived resolve into evidence, which Bayes-updates beliefs. Nothing else. | 119–157 |
| 4 | **Acquire.** `resolveSegmentAcquisition` for the *target segment only*. | 165–190 |
| 5 | **Decay every cohort.** `resolveCohortRetention` gives a weekly keep rate; `exactCustomers *= keep`; `activeCustomers = round(exactCustomers)`. | 195–215 |
| 6 | **Snapshot four-week retention.** The first week a cohort is ≥4 weeks old, freeze `retentionAt4wk = exactCustomers / startingCustomers`. Once. | 211–214 |
| 7 | **Per-segment retention** = size-weighted mean of the last 10 cohorts' frozen snapshots. | 219–228 |
| 8 | **Derive PMF per segment** via `derivePmfForSegment`. | 231–243 |
| 9 | **Company PMF = the single best-scoring segment.** | 245 |

Step 9 is worth stating plainly: `const best = [...segmentPmf].sort((a,b) => b.score - a.score)[0]`.
Not an average, not the target segment. Measured at week 41, seed 4242, saas:

```
Freelancers  13 (unproven)   0 customers
Small Teams  52 (emerging)   564 customers
Enterprise    8 (unproven)   0 customers
s.pmf = 52    max = 52    mean = 24.3
```

An unproven segment can never *drag you down* — but it can never help either, and a segment with
zero customers scores from beliefs alone, capped at 40.

### The 100 points (`derivePmfForSegment`, `pmf.ts:419`)

**Above the customer floor:**

| Term | Formula | Max |
|---|---|---|
| Retention | `clamp01((retention4wk − 0.40) / 0.50) × 46` | **46** |
| Price fit | `(priceFit / 100) × 20` | 20 |
| Product fit | `(productFit / 100) × 14` | 14 |
| Scale | `clamp01(customers / max(200, ceiling × 0.12)) × 12` | 12 |
| Market headroom | `clamp01(marketSize / 60) × 8` | 8 |

Retention is 46% of the score on paper and closer to **100% of the variance in practice**, because
it is the only term that swings from 0 to full. Note the retention term is zero at or below 40%
four-week retention and saturates at 90%.

The scale term is nearly dead. It needs `ceiling × 0.12` retained customers for full marks:

| Sector / segment | Ceiling | Customers for the full 12 points |
|---|---|---|
| saas / Small Teams | 59,091 | 7,091 |
| devtools / Startup Eng | 196,364 | 23,564 |
| fintech / SMB Finance | 600,000 | 72,000 |
| social / Creators | 10,909,091 | 1,309,091 |

A typical 40-week SaaS run holds 300–800 customers. That is 0.5–1.4 of the 12 points. Treat scale
as noise and the real ceiling as ~88.

**Below the floor** (`customers < PMF_CUSTOMER_FLOOR`, which is `15`):

```
score  = round(meanConfidence × 28 + believedNeed/100 × 12)     → hard max 40
status = confidence < 0.3        ? 'unproven'
       : need > 55 && conf > 0.5 ? 'problem_validated'
       :                           'early_signal'
```

Measured with all seven beliefs at estimate 100 / confidence 1.0, and retention/price/product all
at 90+:

| Customers | Score | Status |
|---|---|---|
| 0 | 40 | problem_validated |
| 14 | 40 | problem_validated |
| **15** | **82** | **scalable** |
| 200 | 83 | scalable |

The floor is a cliff, not a ramp. One customer takes you from 40 to 82.

### Status thresholds

| Status | Requires |
|---|---|
| scalable | score ≥ 80 **and** retention4wk > 0.80 |
| strong | score ≥ 66 **and** retention4wk > 0.72 |
| emerging | score ≥ 52 **and** retention4wk > 0.62 |
| showing_value | score ≥ 38 |
| problem_validated | score ≥ 24 |
| early_signal | customers > 40 |

Both gates must pass. A score of 85 with 78% retention is `strong`, not `scalable`.

### The cohort-decay change (current behaviour — do not use older descriptions)

`CustomerCohort.exactCustomers` holds the unrounded survivor count. Decay runs on it:

```ts
const exact = Math.max(0, (c.exactCustomers ?? c.activeCustomers) * keep)
c.exactCustomers = exact
c.activeCustomers = Math.max(0, Math.round(exact))
...
c.retentionAt4wk = clamp01(exact / c.startingCustomers)   // off the exact figure
```

Previously the rounded count was decayed, so a cohort of 3 at keep 0.93 rounded back to 3 forever
and reported 100% retention. Measured over 6 weeks: unrounded 1.941 (displays as 2) vs the old
round-first path's 3. The four-week snapshot is now taken off `exact`, so small cohorts report
their real number. This roughly halved measured Career retention and revenue — the earlier bot
tables in `README.md` and `docs/career-phase-1-pmf-discovery.md` were inflated by this bug.

---

## 2. Discovery vs the research slider — read this one twice

### The research slider

**What `allocation.research` does in Career:**

- It still feeds `researchPoints` → `s.researchSignal` and `s.totalResearch` (engine.ts:1115–1117).
  `researchSignal` unlocks the Product screen's demand gauge at 14 points and narrows the band;
  `totalResearch` feeds `pivotBonus()`.
- It still computes `pmfGain` and writes `s.pmf` (line 1119). **That write is overwritten by
  `tickCareerPMF` at line 1190 in the same tick.**

**What it does not do in Career:** move PMF. At all. Ever.

Two proofs, both measured:

**Proof A — `resonance` is inert.** `pmfGain` is multiplied by `s.resonance`. Forcing resonance to
its floor vs its ceiling every week for 40 weeks:

```
seed 77    resonance 0.45 → pmf 44, users 402  |  resonance 1.60 → pmf 44, users 402
seed 4242  resonance 0.45 → pmf 52, users 556  |  resonance 1.60 → pmf 52, users 556
```

Byte-identical. If `pmfGain` survived, a 3.5× multiplier could not produce zero difference.

**Proof B — research is strictly negative.** Same seed, same everything, varying only the research
slider (40 weeks, $25k/wk marketing):

| Seed | research 0 | research 20 | research 60 |
|---|---|---|---|
| 77 | pmf **47**, q 39.8 | pmf 46, q 38.3 | pmf 45, q 36.3 |
| 4242 | pmf **54**, q 39.8 | pmf 54, q 38.3 | pmf 53, q 36.3 |
| 31337 | pmf **39**, q 39.8 | pmf 39, q 38.3 | pmf 38, q 36.3 |

Research never helps and slightly hurts, because `ar` steals allocation share from `aq`, quality
falls, product fit falls, retention falls.

**The default allocation ships at `research: 20`** (`engine.ts:237`). Every new Career game starts
with a fifth of engineering pointed at a stat that cannot move PMF.

The demand gauge / "idea quality" / STRONG–WEAK signal on the Product screen is a readout of
`s.resonance`, which in Career influences nothing. Same for `pivotBonus`: a pivot in Career rerolls
`resonance` (inert), does **not** reroll `segmentTruth`, does not change sector or target segment,
and costs you `quality × 0.7`, `features × 0.5`, `users × 0.7`, hype, morale and $15k. Measured:

```
before pivot: quality 37.9  features 13.7  users 442  pmf 57
after  pivot: quality 27.0  features  7.0  users 309  pmf 23
market truth unchanged: true | sector same: true | target same: true
10 weeks later: quality 31.2, users 453, pmf 49   (still below where it started)
```

**In Career, a pivot is pure damage.** Reposition (change target segment) instead.

### What Discovery is for

Discovery experiments move **belief**, and belief only. They never touch `segmentTruth` (generated
once from `hash(seed|sector|scenario|segmentId)` and never regenerated), and they never touch PMF
except through the below-15-customers confidence term capped at 40.

Discovery answers: *which of the three segments should I aim the company at, what quality bar do I
have to clear, and what will they pay?* Those three answers are worth a lot, because getting them
wrong costs you a repositioning (2–6 weeks at 0.7× product and 0.55× acquisition) or a whole
campaign spent on a segment whose `productRequirement` you can never reach.

### "Before, or in parallel?" — the real answer is the capacity cost

This is the part the docs get wrong. Experiments **do** consume real engineering capacity now.
`careerProductDrag` (tick.ts:49) multiplies both `engPoints` and `designPoints` in engine.ts:1087–1094:

```ts
const expDrain = activeExperiments.reduce((a, e) => a + e.productCapacityCost, 0)
return Math.max(0.3, (1 - Math.min(0.7, expDrain)) * repositioningPenalty)
```

Measured:

| Running | Product drag | Marketing drain |
|---|---|---|
| nothing | 1.000 | $0/wk |
| interviews | 1.000 | $0/wk |
| landing page | 1.000 | $3,000/wk |
| pricing test | 0.900 | $2,000/wk |
| prototype | 0.650 | $0/wk |
| pilot | 0.550 | $0/wk |
| pilot + prototype | **0.300** (floor) | $0/wk |
| interview + landing page + pricing test | 0.900 | $5,000/wk |
| repositioning alone | 0.700 | — |
| repositioning + pilot | 0.385 | — |

And `careerMarketingDrain` is subtracted from your ad budget *before* acquisition sees it
(`engine.ts:1185`: `marketingSpend: max(0, adSpend - careerMarketingDrain(s))`). A $3k/wk budget
with a landing-page test running buys **zero** customers.

So the answer to "before or in parallel" falls out of the cost curve, and it is per-instrument, not
per-phase:

- **Interviews are free in engineering terms** (0% capacity, $0 marketing, $4k cash, 2 weeks). Run
  them in parallel with anything, always.
- **Landing page** is free in engineering but eats $3k/wk of marketing. Run it when your marketing
  budget is above ~$10k/wk, or during a week you were not going to acquire anyway.
- **Pricing test** costs 10% of engineering and $2k/wk. Effectively parallel.
- **Prototype (35%) and pilot (45%) are not parallel work.** Running both floors you at 0.30 —
  a 70% cut to product velocity for the full 7 weeks of the pilot. Since quality is the only lever
  that raises product fit, and product fit is what raises retention, and retention is 46 points of
  PMF, a pilot run at the wrong moment is a direct 7-week hit to the thing you are trying to grow.

Measured, 26 weeks, seed 4242, identical allocation and marketing, following
`suggestedExperiment()`:

| Discovery policy | PMF | Quality | Users | Cash | Evidence items | 4wk retention |
|---|---|---|---|---|---|---|
| none | **57** | 43.6 | 297 | $85,428 | 0 | 67.1% |
| front-loaded (weeks 1–10 only) | 54 | 41.7 | 279 | $1,346 | 31 | 64.4% |
| continuous | 52 | 38.5 | 248 | **−$22,596** | 57 | 62.5% |

Discovery is not free and it does not pay for itself inside 26 weeks on a seed where the default
target happens to be right. What it buys is insurance against the seeds where it is wrong — the
per-campaign variance on `productRequirement` is ±14 and on `willingnessToPay` ±18, enough to make
the archetype misleading.

**Practical rule:** run the cheap instruments (interview, landing page, pricing test) continuously
from week 1, and buy exactly one heavy instrument (prototype or pilot) at the moment you are
deciding whether to reposition. Never run a prototype and a pilot at the same time.

---

## 3. What drives PMF right now

### The chain

```
allocation.quality × engPoints × careerProductDrag
    → s.quality
        → segmentProductFit = clamp(50 + (quality − productRequirement) × 0.85 + focusBonus)
            → resolveCohortRetention  (fit = 0.93 + productFit/100 × 0.085)
                → weekly keep rate → 4-week cohort snapshot
                    → retentionScore = clamp01((r4 − 0.40)/0.50) × 46
                        → PMF
```

The full weekly keep rate:

```ts
base        = 0.925 + retentionPotential/100 × 0.07      // 0.925 – 0.995, hidden, seed-fixed
fit         = 0.930 + productFit/100 × 0.085             // your only real lever
price       = 0.950 + priceFit/100   × 0.058
reliability = 1 − bugs/900
honeymoon   = weeksSinceAcquired < 4 ? 0.985 : 1.004
keep        = min(0.995, base × fit × price × reliability × honeymoon)
```

Measured weekly keep rates and the four-week number they produce:

| Situation | keep/wk | 4wk |
|---|---|---|
| perfect fit, no bugs (retPot 90, pFit 95, $Fit 95) | 0.9887 | 95.5% |
| good fit (retPot 72, pFit 70, $Fit 80, bugs 10) | 0.9367 | 77.0% |
| mediocre (retPot 50, pFit 50, $Fit 60, bugs 25) | 0.8805 | 60.1% |
| mismatched (retPot 38, pFit 20, $Fit 30, bugs 40) | 0.8205 | 45.3% |

Bugs alone, holding fit at 70 and price at 85:

| Bugs | keep/wk | 4wk |
|---|---|---|
| 0 | 0.9683 | 85.1% |
| 25 | 0.9414 | 74.0% |
| 40 | 0.9253 | 67.8% |
| 60 | 0.9038 | 60.3% |
| 80 | 0.8823 | 53.5% |

Going from 0 to 60 bugs costs 25 points of four-week retention = **23 points of PMF**.

### What does not drive PMF

| Input | Effect on Career PMF |
|---|---|
| `allocation.research` | none (proved above); slightly negative via opportunity cost |
| `s.resonance` / demand gauge | none |
| `s.hype` | feeds acquisition volume only; more customers at bad retention lowers PMF via the retention weight |
| Marketing spend | feeds acquisition volume only |
| Raw user count | ≤12 of 100 points, and unreachable in practice |
| Evidence / belief confidence | only below 15 customers, capped at 40 |
| `expansionPotential`, `salesCycleWeeks` | generated, believed, researched — **never read by any formula** |

### Why 70% into product can leave PMF flat

Measured, 40 weeks, seed 4242, $25k/wk marketing:

| Allocation | PMF | Quality | Bugs | Users | 4wk retention |
|---|---|---|---|---|---|
| 70 features / 10 q / 10 bugs / 10 res | **47** | 34.1 | 26.7 | 455 | 57.9% |
| 10 features / 70 q / 10 bugs / 10 res | **60** | 54.9 | 2.2 | 760 | 67.9% |
| 30 / 40 / 30 / 0 | 57 | 45.2 | 0.0 | 693 | 66.8% |
| 50 / 20 / 10 / 20 (the shipped default) | 50 | 37.9 | 19.3 | 512 | 60.3% |
| 0 / 0 / 0 / 100 (research only) | 51 | 30.0 | 7.4 | 517 | 61.8% |

Note the last row. **Pointing 100% of engineering at research beats pointing 70% at features.**
Features do not appear anywhere in the Career fit chain; they only appear in `featureGain × 0.55`
in the bug equation. "70% into product" is only a PMF strategy if the 70% is *quality*.

### And the first five weeks are always flat

`retentionBySegment` starts at 0 and stays 0 until a cohort turns four weeks old. The first cohort
is acquired in week 2, so the first snapshot lands in week 6. Measured, allocation
20/55/25/0, $6k/wk marketing:

| Sector (seed) | PMF weeks 2–13 | First retention reading |
|---|---|---|
| saas (77) | 28, 28, 28, 28, **49**, 49, 49, 50, 50, 49, 50, 49 | week 6 |
| saas (4242) | 29, 30, 30, 30, **56**, 56, 57, 56, 56, 57, 57, 56 | week 6 |
| devtools (4242) | 26, 26, 26, 26, **55**, 55, 56, 55, 55, 56, 56, 55 | week 6 |
| fintech (77) | 30, 30, 30, 30, **51**, 51, 51, 52, 52, 52, 52, 52 | week 6 |
| ecommerce (4242) | 28, 28, 28, 28, **58**, 57, 57, 57, 57, 58, 58, 57 | week 6 |
| social (4242) | 27, 27, 27, 27, **53**, 52, 52, 52, 52, 53, 53, 53 | week 6 |

Week 6 in ten runs out of ten. Nothing you do in weeks 1–5 shows up in the PMF number before week 6,
and everything you do in weeks 1–5 shows up *all at once* in week 6.

---

## 4. Segment × product focus

### How `values` is consumed

`segmentProductFit` (`pmf.ts:309`):

```ts
const rank = def.values.indexOf(focus)
const focusBonus = rank === 0 ? 18 : rank === 1 ? 9 : -8
return clamp(50 + (productQuality - truth.productRequirement) * 0.85 + focusBonus)
```

- **Order matters.** Index 0 → **+18**, index 1 → **+9**, absent (`indexOf` = −1) → **−8**.
- Every one of the 15 segments declares exactly two values, so there is no third rank. The only
  three outcomes are +18, +9, −8.
- A mismatch costs **26 points of fit** versus the first-choice focus — equivalent to
  26 / 0.85 = **30.6 points of product quality**.
- The result is clamped 0–100, so a segment whose `productRequirement` is far above your quality
  sits at 0–2 fit regardless of focus (measured: saas Enterprise at quality 40 with the wrong focus
  = 1.2).

Focus is changed instantly and for free in the store (`setProductFocus`, `store.ts:1017`) — no cost,
no lag, no repositioning penalty. **Repositioning your target segment does NOT change your focus.**
`repositionTo` never touches `career.focus`. If you pivot from Small Teams to Enterprise and forget
to switch focus from `collaboration` to `enterprise_readiness`, you take the −8 instead of the +18
permanently.

What that alignment is worth (saas Small Teams, seed 4242, market pricing, no bugs):

| Quality | Focus | productFit | 4wk retention | PMF |
|---|---|---|---|---|
| 40 | collaboration (1st) | 62.9 | 72.4% | **61** emerging |
| 40 | reliability (2nd) | 53.9 | 69.6% | 57 emerging |
| 40 | simplicity (miss) | 36.9 | 64.6% | 50 showing_value |
| 70 | collaboration (1st) | 88.4 | 80.7% | **72** strong |
| 70 | simplicity (miss) | 62.4 | 72.2% | 61 emerging |

Eleven points of PMF for a free dropdown change.

### The full matrix — all 15 segments

Baselines below are the archetype from `SECTOR_SEGMENTS` in `segments.ts`. **The truth for any one
campaign is the baseline plus seeded variance** (`generateSegmentTruth`), so treat these as the
archetype, not your run's numbers:

```
need ±24 · willingnessToPay ±18 · retentionPotential ±20 · reachability ±14
productRequirement ±14 · marketSize ±16 · competitiveIntensity ±20 · expansion ±18
salesCycleWeeks × 0.7–1.4
```

Quality columns: **q→50** is the quality at which product fit clears 50 with the first-choice focus
(the point at which `pmfBlocker` stops saying "doesn't clear this segment's bar"). **q→75** is the
quality for a fit of 75, which is roughly where retention starts compounding. **miss** is the q→50
figure if your focus is not in the segment's `values` at all.

| Sector | Segment | Focus values (in order) | Need | WTP | Ret | Reach | Bar | Size | Comp | Cycle | q→50 | q→75 | miss | Price |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| saas | Freelancers | simplicity › performance | 58 | 24 | 38 | 84 | 30 | 78 | 62 | 1 | 9 | 32 | 39 | **low** |
| saas | Small Teams | collaboration › reliability | 62 | 55 | 72 | 55 | 52 | 52 | 50 | 3 | 31 | 54 | 61 | **market** |
| saas | Enterprise | enterprise_readiness › reliability | 55 | 88 | 86 | 18 | 82 | 22 | 44 | 10 | 61 | 84 | 91 | **premium** |
| devtools | Individual Developers | simplicity › performance | 64 | 20 | 42 | 88 | 44 | 80 | 70 | 1 | 23 | 46 | 53 | **low** |
| devtools | Startup Engineering | automation › collaboration | 68 | 52 | 70 | 58 | 56 | 48 | 52 | 3 | 35 | 58 | 65 | **market** |
| devtools | Enterprise Engineering | enterprise_readiness › reliability | 52 | 90 | 88 | 16 | 86 | 18 | 40 | 12 | 65 | 88 | 95 | **premium** |
| fintech | Everyday Consumers | simplicity › reliability | 56 | 26 | 40 | 82 | 46 | 88 | 72 | 1 | 25 | 48 | 55 | **low** |
| fintech | SMB Finance Teams | reliability › automation | 70 | 58 | 74 | 48 | 62 | 44 | 48 | 4 | 41 | 64 | 71 | **market** |
| fintech | Regulated Institutions | enterprise_readiness › reliability | 48 | 92 | 90 | 12 | 90 | 14 | 36 | 14 | 69 | 92 | 99 | **premium** |
| ecommerce | Individual Sellers | simplicity › automation | 60 | 22 | 34 | 86 | 28 | 84 | 66 | 1 | 7 | 30 | 37 | **low** |
| ecommerce | Growing Brands | automation › reliability | 66 | 58 | 70 | 50 | 56 | 46 | 54 | 4 | 35 | 58 | 65 | **market** |
| ecommerce | Enterprise Retailers | enterprise_readiness › performance | 50 | 86 | 84 | 20 | 84 | 20 | 42 | 9 | 63 | 86 | 93 | **premium** |
| social | Casual Users | simplicity › performance | 44 | 10 | 28 | 92 | 34 | 94 | 76 | 1 | 13 | 36 | 43 | **low** |
| social | Creators | collaboration › performance | 72 | 44 | 66 | 52 | 58 | 40 | 58 | 2 | 37 | 60 | 67 | **low** |
| social | Brand Advertisers | enterprise_readiness › automation | 46 | 84 | 78 | 22 | 76 | 16 | 46 | 8 | 55 | 78 | 85 | **premium** |

Practical read:

- **The easy end (`simplicity` first) has a low bar you clear at quality 25–45, and a retention
  ceiling you can never raise.** `retentionPotential` 28–42 gives `base` = 0.945–0.954. Measured
  ceiling for saas Freelancers on seed 4242: 77% four-week retention at quality 55, and **still 77%
  at quality 100**. Fit saturates; the segment does not. That caps PMF around 55–62. Freelancers and
  Casual Users are places to prove the loop works, not places to win.
- **The middle (`collaboration` / `automation` / `reliability` first) is where the game is.**
  `retentionPotential` 66–74 and a bar of 52–62 that you reach around week 25–35 of honest quality
  work. Measured for saas Small Teams: 75% at quality 40 → 88% at quality 85. That is the difference
  between `emerging` and `scalable`.
- **The enterprise end (`enterprise_readiness` first) is unreachable early and the best endgame.**
  A bar of 76–90 means product fit is under 30 for the entire first half of a run, and `reach`
  12–22 means `resolveSegmentAcquisition`'s `reach` term (`0.25 + reach/100 × 1.5`) is only
  0.43–0.58 — you buy customers at roughly half the rate. But `retentionPotential` 78–90 puts the
  base keep rate at 0.980–0.988. Measured for saas Enterprise: 66% at quality 40, 82% at quality 100.

### Pricing

`segmentPriceFit` (`pmf.ts:327`) compares a fixed asked-price level against hidden
`willingnessToPay`. `PRICE_LEVEL` = low 26, market 52, premium 82.

```ts
gap = asked - wtp
return gap <= 0 ? clamp(100 + gap * 0.35)   // underpricing: 0.35 per point
                : clamp(100 - gap * 1.5)    // overpricing:  1.50 per point
```

Overpricing is punished **4.3× harder** than underpricing. Measured:

| Their WTP | low (26) | market (52) | premium (82) |
|---|---|---|---|
| 10 | **76** | 37 | 0 |
| 20 | **91** | 52 | 7 |
| 26 | **100** | 61 | 16 |
| 40 | **95** | 82 | 37 |
| 52 | 91 | **100** | 55 |
| 60 | 88 | **97** | 67 |
| 70 | 85 | **94** | 82 |
| 82 | 80 | 90 | **100** |
| 90 | 78 | 87 | **97** |

Price fit is worth 20 PMF points directly, plus it multiplies retention
(`0.95 + priceFit/100 × 0.058`) and conversion (`clamp01(0.18 + priceFit/100 × 0.70)`).
`revenueMultiplier` is 0.55 / 1.00 / 1.75 for low / market / premium.

Crossovers, measured by sweeping every WTP from 0 to 100: **low beats market up to WTP 47;
premium beats market from WTP 77 up.** In the band 48–76, market is the right answer. With ±18
variance, a "market" segment (baseline WTP 52–58) can genuinely land anywhere from 34 to 76 —
this is exactly what a pricing test is for, and it is the second-most reliable instrument at 0.70.

Default is `market` for every run (`createCareerPMF`). For any segment whose WTP is at or below 26 —
which is every `simplicity`-first segment's archetype — that default is an **exactly 39 point**
price-fit mistake you are shipped with (the gap is `1.5 × (52 − 26)` for all WTP ≤ 26; measured at
39.0 for Freelancers, Casual Users, Individual Developers, Individual Sellers and Everyday
Consumers alike). If you are targeting any of them, switch to `low` before week 2.
Note the revenue multiplier is 0.55 there, so it is genuinely a trade — but the 20 PMF points, the
retention multiplier and the conversion multiplier all move together.

---

## 5. The first 20 weeks

Grounded in the real starting position: **$200,000 cash, quality 30, features 5, zero employees,
$300/wk fixed burn at $0 marketing.** At $6k/wk marketing your burn is $6,300/wk — 32 weeks of
runway before hiring or experiments. The full experiment ladder run in series costs **$59,000 and
17 weeks**.

The target segment you start on was chosen from the *belief* with the highest `needIntensity`
estimate — an opinion drawn ±30 off the truth. Your starting focus is correctly set to that
segment's first value. If you reposition, you must change focus by hand.

| Week | Do this | Why, in the model |
|---|---|---|
| **1** | Set allocation to roughly **20 features / 55 quality / 25 bugs / 0 research**. | Research cannot move PMF. Quality is the only input to product fit. Bugs at 60 cost 25 points of retention. |
| **1** | Set marketing to **$5–7k/wk**. | You need ≥15 retained customers to leave the score cap; you do not need more. At $6k you cross 15 in week 2. |
| **1** | Check pricing against your target's archetype. Low-end segment → switch to `low` now. | Free, instant, worth up to 39 price-fit points and a retention multiplier. |
| **1** | Confirm focus = your target segment's first `value`. | +18 vs −8 is 26 fit points, free. |
| **1–2** | Start **customer interviews** on your target. $4k, 2 weeks, 0% engineering. | Free in the only currency that matters. Reads need, bar, and WTP — but overstates WTP by ~+21 on average, so do not act on the WTP number. |
| **3–4** | Interviews land. Start **customer interviews on a second segment** — one you have *not* been thinking about. | `suggestedExperiment` deliberately weights unexamined segments. The seeded variance means the archetype ranking is often wrong. |
| **5** | Start a **pricing test** on the target. $9k, 3 weeks, 10% engineering, $2k/wk marketing. | 0.70 reliability, and it is the only cheap instrument that does not lie about willingness to pay. Bump marketing to $8k to absorb the drain. |
| **6** | **Your first retention reading arrives.** Read it before anything else. | This is the week PMF stops being a placeholder. Expect a 20–30 point jump. |
| **6–8** | Judge on the number, not the feeling: <55% → the segment or the price is wrong. 55–68% → workable, keep building quality. >70% → you are on the right segment; do not reposition. | 62% is the `emerging` gate and the point where a cohort stops draining faster than marketing refills it. |
| **8** | Pricing test lands. Move pricing if it disagrees with your default. | Price fit multiplies retention, conversion and 20 PMF points at once. |
| **9–11** | If retention is under 55% and you are considering a different segment: run a **prototype test** on the *candidate* segment. $12k, 3 weeks, **35% of engineering**. | This is the decision instrument. 0.62 reliability on `productRequirement` — the number that determines whether you can ever serve them. Accept the velocity hit; you are buying a decision, not knowledge. Beware: at execution quality <0.45 a prototype *understates* need, which is the classic false negative. |
| **9–11** | If retention is above 65%: **run nothing heavy.** Keep 55% of engineering on quality. | Discovery has a measured cost: the continuous-discovery run ended 26 weeks in with PMF 52 and −$22,596 cash; the no-discovery run had PMF 57 and +$85,428. |
| **12** | Reposition now or not at all. If you do: change target **and** focus, and expect 2–6 weeks at 0.7× product / 0.55× acquisition. | The penalty is sized by `\|Δbar\| + \|ΔWTP\| / 30`, so a Freelancers→Enterprise swing is the full 6 weeks. |
| **13–16** | Hold allocation. Let quality climb. Do not raise marketing while retention is below 62%. | More marketing at low retention buys a bigger leak — the acquisition term scales with `sqrt(spend)` while churn scales with the whole base. |
| **17–20** | Only once four-week retention is **above 68% and not falling**, raise marketing toward $15–25k/wk. | Above the `emerging` gate the scale term and revenue finally compound instead of leaking. |
| **17–20** | If you are committed and have the cash: start the **paid pilot** ($28k, 7 weeks, 45% engineering). | 0.88 reliability, the only instrument that proves `retentionPotential`. It will floor your product velocity at 0.55 for seven weeks — budget for it, and never run it alongside a prototype (combined floor: 0.30). |

Reference: a real 20-week run at these settings (seed 4242, saas, no experiments, no cash cheating)
ends at **week 21, $104,334 cash, 236 customers, quality 40.6, bugs 0, PMF 56 (`emerging`), 68%
four-week retention** — which is a healthy, honest position to be in at week 20.

### Anti-patterns, each with its measured cost

| Anti-pattern | Cost |
|---|---|
| Leaving the default 20% research | ~1 PMF point and 1.6 quality per 40 weeks; more importantly it feels like progress |
| Pouring into features | 70/10/10/10 = PMF 47 vs 10/70/10/10 = PMF 60 |
| Pivoting | quality ×0.7, features ×0.5, users ×0.7, $15k — and the market does not change |
| Repositioning without changing focus | −26 product fit, permanently |
| Prototype + pilot together | product velocity floored at 0.30 for 7 weeks |
| Landing-page test on a $3k budget | acquisition receives $0 |
| Scaling marketing below 62% retention | churn scales with the base, acquisition with `sqrt(spend)` |

---

## Things that look wrong in the code

Listed, not fixed, per scope. Roughly in order of how much they affect play.

1. **`engine.ts:1115–1119` is dead work in Career.** `pmfGain` is computed and written to `s.pmf`,
   then overwritten by `tickCareerPMF` at line 1190. It is harmless but it is exactly what makes the
   research slider look load-bearing. Guarding the block with `if (!careerOn)` — or at least the
   `s.pmf` write — would make the intent readable. `researchSignal`/`totalResearch` should probably
   keep accumulating for the demand gauge.

2. **The shipped default allocation is `research: 20` (`engine.ts:237`)**, which in Career points a
   fifth of engineering at a stat with no PMF effect. A Career-specific default would be more honest.

3. **The Product screen still teaches Quick Play's model to Career players.** `src/screens/Product.tsx`
   renders a "Product-market fit" panel with the demand gauge, "Research says demand is STRONG. Pour
   it on", "PMF gates everything", "Research finds out what the market actually wants — without it,
   you are building in the dark", and a pivot button with a research-derived bonus. In Career, all of
   that is inert or actively wrong. `Dashboard.tsx:130` already special-cases Career for exactly this
   reason; `Product.tsx` does not. This is the most likely single source of confusion.

4. **`pivot()` in Career is pure loss.** It rerolls `s.resonance` (inert), zeroes `researchSignal`,
   and destroys quality/features/users/hype/morale/$15k — but never touches `career.segmentTruth`,
   `s.sector`, or `career.primaryTargetSegmentId`. There is nothing to reroll, so there is no upside.
   Measured: PMF 57 → 23, and still 49 ten weeks later. Either disable the pivot button in Career or
   make it reroll the campaign's segment truth.

5. **`expansionPotential` and `salesCycleWeeks` are inert.** Both are generated with variance, both
   have beliefs, and `expansionPotential` is one of the four metrics a $28k / 7-week **pilot**
   measures — but neither is read by any formula in `pmf.ts`, `tick.ts` or `engine.ts`. Players are
   paying real money to learn numbers that do nothing.

6. **`repositionTo` does not touch `career.focus`.** Switching target segment silently leaves you
   optimising for the old segment's first value, usually a swing from +18 to −8. At minimum this
   should warn; arguably focus should follow the target unless explicitly overridden.

7. **The scale term is effectively unreachable.** `clamp01(customers / max(200, ceiling × 0.12)) × 12`
   needs 7,091 retained customers in saas Small Teams and 1.3 million in social Creators. Real runs
   sit at 200–800. Twelve of the hundred points are, in practice, always near zero — which quietly
   makes the real PMF ceiling ~88.

8. **`ActiveExperiment.status = 'cancelled'` is typed but nothing sets it.** There is no way to abort
   a 7-week pilot, which matters now that a pilot costs 45% of engineering.

9. **The floor cliff is very sharp.** Going from 14 to 15 retained customers moved a measured score
   from 40 to 82 in one step. A blend over 15–40 customers would read less like a bug to a player.

10. **`derivePmfForSegment`'s below-floor branch caps at 40, not 39.** `confidence × 28 +
    believedNeed/100 × 12`. The docs say 39; that was measured at confidence 0.98. The true cap is 40.
    Cosmetic, but the number is quoted in three places.

### Where the code contradicts the existing docs

The code wins in all of these. `docs/career-phase-1-pmf-discovery.md` was written before several
fixes landed and is now stale in specific places.

| Doc claim | Reality in the code |
|---|---|
| `docs/career-phase-1-pmf-discovery.md:32–33` and `:2784–2785`: "engine.ts discards the `productCapacityDrain` … so running experiments also costs no engineering time" | **False.** `engine.ts:1086` calls `careerProductDrag(s)` and multiplies it into both `engPoints` and `designPoints`. Measured: a pilot alone = 0.55×; pilot + prototype = 0.30×. `README.md:88` ("eat real roadmap") is the correct one. |
| `docs/…:908`: "The product penalty (0.7) only modulates the returned `productCapacityDrain`, which `engine.ts` never reads — so product velocity is not actually reduced" | **False.** `careerProductDrag` multiplies by `repositioning.productPenalty`. Measured: repositioning alone = 0.700×. `README.md:96` is correct. |
| `docs/…:23–24` and `:1545`: "`revenueDeltaPct` is permanently 0 / hard-coded to 0" | **False.** `engine.ts:1237–1241` fills it after the shared revenue formula runs. The test at `test/career-pmf.test.ts:303` asserts it is non-zero. |
| `docs/…:1282`: "perfect research … yields `problem_validated`, score **39**" | The cap is **40** (`confidence × 28 + need/100 × 12`). 39 was measured at confidence 0.98, not 1.0. |
| `README.md:94`: confidence makes "only a small contribution" to PMF | Misleading. Confidence contributes **only** below 15 customers, and is the *entire* score there. Above the floor it contributes exactly zero. `docs/…:1282` states this correctly. |
| `README.md:92` and `README.md:210–212` bot/retention tables (Careless 28%, Disciplined 72%, Enterprise 87%) | Stale — measured before the `exactCustomers` fix, when small cohorts reported 100% retention forever. `BACKLOG.md:109–121` supersedes them (48% / 67% / 64% over 24 seeds). |
| `docs/…:940`: "a quality of 55 scores 100 for freelancers and 14 for enterprise" | Still true on seed 4242 — measured 100.0 and 13.9 — but it is a per-seed number, not a property of the segments. |
| `docs/…:980`: focus is "worth +18 / +9 / −8" | Correct, and the ordering is index 0 → +18, index 1 → +9, absent → −8. Every segment declares exactly two values, so the +18/+9 pair is always the declared pair and everything else is −8. |
| Nothing in any doc states the five-week PMF plateau | It is the single most visible property of the system: measured at week 6 in 10 of 10 runs across all five sectors. |
