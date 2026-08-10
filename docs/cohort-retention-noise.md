# Why Career PMF goes up and then down

A measurement of the oscillation in `retentionBySegment`, and four options for what to do about it.
Nothing in the simulation was changed. Every number below is measured, and the harnesses that
produced them are described at the bottom so they can be rerun.

**The headline: it is not sampling noise, and it is not small cohorts.** The genuine, product-driven
four-week retention of a Career company on a stable policy rises smoothly and almost monotonically —
66.5% → 83.4% over the run measured, with a week-to-week wobble of **0.35pp**. What the player is
shown wobbles by **12.10pp**, because every company-wide user loss in the game is charged in full
against exactly one cohort: the newest one on the books, which is also the one whose four-week
snapshot is about to be frozen forever.

---

## 1. The mechanism

`tickCareerPMF` opens by reconciling `s.users` against the cohort list. Events, outages, rival price
wars and arcs move `s.users` directly, so when the company loses people the tick has to decide which
cohorts lost them (`src/game/career/tick.ts`, the `drain` helper):

```ts
for (let i = career.cohorts.length - 1; i >= 0 && left > 0; i--) {
  const c = career.cohorts[i]
  if (!pick(c)) continue
  const take = Math.min(c.activeCustomers, left)
  ...
}
```

`Math.min(c.activeCustomers, left)` means the newest cohort absorbs the **entire** loss up to its
own total before the second cohort is touched. Measured over six runs (seeds 4242/7/991/13/555/2024
across social, saas, marketplace and fintech), on **every single shock week in every single run**:

| run | weeks simulated | weeks carrying a shock | cohorts hit / cohorts live |
|---|---|---|---|
| social/4242 | 70 | 24 | **1.00 / 39** |
| social/7 | 39 | 12 | **1.00 / 27** |
| saas/991 | 70 | 31 | **1.00 / 41** |
| saas/13 | 70 | 33 | **1.00 / 37** |
| mkt/555 | 70 | 14 | **1.00 / 34** |
| fin/2024 | 70 | 4 | **1.00 / 25** |

A loss of ~1–3% of the segment, spread over 59 live cohorts, arrives as a 40–53% loss to one of
them. On seed 4242 the week-60 shock removed 2.86% of the segment; the cohort it landed on lost
53.1% of its people in a week.

That cohort is always young — it is the newest — so the damage is nearly always inside the first
four weeks, which is precisely the window `retentionAt4wk` measures before freezing forever.

## 2. The split: how much of the swing is real

Retention itself is deterministic. `resolveCohortRetention` is a pure function of the segment truth,
product fit, price fit, bugs and the cohort's age — there is no RNG in it. So each cohort's frozen
four-week number decomposes exactly:

```
retentionAt4wk  =  P  ×  S
   P = the product of the five clean weekly keep rates (fit, price, bugs, quality)  ← genuine
   S = the product of the drain factors it happened to absorb                       ← attribution
```

`P` is recovered without touching the engine: within a week every cohort in a segment shares one
keep rate, so the largest observed week-over-week ratio *is* that rate, and any cohort below it was
drained. Seed 4242, social, 70 weeks, stable policy:

| | dispersion between consecutive cohorts | range across the run |
|---|---|---|
| **as shipped** | **12.10pp** | 39% – 83% |
| same shocks, charged in proportion to cohort size | 0.92pp | 65% – 83% |
| clean product signal `P` | **0.35pp** | 67% – 83% |

Across all six runs the clean signal's week-to-week dispersion is 0.09–0.41pp against a shipped
dispersion of 3.76–17.15pp.

**So: essentially none of the visible oscillation is genuine.** The owner's product was getting
monotonically better for seventy consecutive weeks, and the screen told them it was going up and
down. They were not doing anything wrong.

Cohort sizes are not the problem either. On seed 4242 the median cohort is **696 people** (p25 525,
max 1,152). The related bug that motivated the brief — `round(3 × 0.95) === 3` — is genuinely fixed,
and small cohorts are not what is happening here.

## 3. It is also biased, not just noisy

The shipped estimator does not merely bounce around the truth; it sits **4.21pp below it** on
average, because the drain only ever removes people and only ever from cohorts about to be measured.
Across the six runs, against the clean signal over the same window:

| estimator | RMSE vs clean | bias | jitter (sd of weekly Δ) | worst single-week dip |
|---|---|---|---|---|
| **last 10, size-weighted mean (shipped)** | 5.55pp | −4.21pp | 1.13pp | 3.58pp |
| last 20 | 4.63pp | −3.79pp | 0.53pp | 1.66pp |
| last 30 | 4.10pp | −3.50pp | 0.37pp | 1.23pp |
| size-weighted median of last 10 | 3.67pp | −2.02pp | 1.77pp | 6.33pp |
| 20%-trimmed mean of last 10 | 4.09pp | −2.66pp | 1.22pp | 4.12pp |
| **20%-trimmed mean of last 16** | **3.26pp** | −2.40pp | 0.65pp | 2.18pp |
| drop cohorts under 50 people | 5.61pp | −3.99pp | 1.01pp | 3.65pp |
| drop cohorts under 200 people | 8.07pp | −5.70pp | 1.08pp | 3.57pp |
| *(the clean signal itself)* | 0 | 0 | 0.17pp | 0.52pp |

## 4. The options, with their costs

Responsiveness was measured with a real step: a stable run switched from `low` to `premium` pricing
at week 40, which genuinely craters price fit. The intrinsic floor is about five weeks — a cohort
acquired in week 40 cannot report until week 45 — plus however long the window takes to fill.

| estimator | 50% of the move by | 90% of the move by |
|---|---|---|
| shipped (last 10) | wk 52 (+12) | wk 60 (+20) |
| last 20 | wk 58 (+18) | wk 64 (+24) |
| last 30 | wk 61 (+21) | wk 71 (+31) |
| 20%-trimmed of last 16 | wk 56 (+16) | wk 64 (+24) |
| median of last 10 | wk 57 (+17) | wk 59 (+19) |

### Option A — spread the drain across cohorts in proportion to size **(recommended)**

One change in the `drain` helper: instead of emptying the newest cohort first, take each cohort's
share of a company-wide loss in proportion to how many people it holds. The same total leaves the
company; only the attribution is fair — and it is also the more truthful model, since an outage or a
price war does not selectively hit people who signed up nine days ago.

Counterfactual replay across the six runs, shipped estimator unchanged:

| | RMSE vs clean | bias | jitter | worst dip |
|---|---|---|---|---|
| as shipped | 5.55pp | −4.21pp | 1.13pp | 3.58pp |
| **proportional attribution** | **2.03pp** | **−1.73pp** | **0.25pp** | **0.94pp** |

Per run, RMSE goes 8.06→2.53, 3.16→1.34, 8.36→3.13, 8.62→3.15, 3.05→1.27, 2.05→0.77.

**Costs zero responsiveness** — the window is untouched, so every row of the step-response table is
unchanged. It removes 78% of the jitter and 59% of the bias, and it leaves a genuine decline landing
at full size on every cohort simultaneously, which is exactly how a real decline should read.

It is not free of risk: it touches `tickCareerPMF`, which the ICO slices also touch, and the
organic/rented split in that same block was itself a §52 fix. Any change here needs `npm run bots`
byte-compared. There is also a knock-on: incentivised cohorts currently act as shock absorbers by
sitting at the end of the array, and the proportional split already partly addresses that — the two
interact and should be reasoned about together.

### Option B — a longer averaging window

Cheap and safe, and it does work: last-30 cuts jitter from 1.13pp to 0.37pp. But it costs 9 weeks on
the half-response and 11 on the 90% response of a real step, it barely touches the bias (−4.21 →
−3.50), and a Career run is 70–90 weeks long. Waiting 31 weeks to see a pricing mistake fully land
is worse than the disease.

**Not recommended alone.** It treats the symptom and taxes the one thing the player is supposed to
learn from — that decisions have consequences you can watch arrive.

### Option C — a minimum cohort size before a snapshot counts

**Recommended against, on the measurement.** Cohorts are not small: median 696 people on seed 4242,
and the smallest measured cohort in that run is 66. Requiring ≥50 people changes RMSE from 5.55 to
5.61pp — no effect. Requiring ≥200 makes it *worse* (8.07pp, bias −5.70pp) by discarding real
evidence for no gain. The intuition that this is small-sample distortion is the natural one given
the `round(3 × 0.95)` history, and it is simply not what the data says this time.

A **robust** estimator does help, because the shock is a rare enormous outlier rather than broad
jitter: a 20%-trimmed mean of the last 16 gets RMSE from 5.55 to 3.26pp and jitter from 1.13 to
0.65pp for +4 weeks of lag. That is the best option available **without touching the simulation**,
and a reasonable fallback if Option A is judged too risky to land next to the ICO work.

### Option D — show the band instead of removing the noise **(recommended, and already built)**

The cohorts inside the shipped window spread **1.9–10.1pp** (size-weighted sd; the p10–p90 width is
3.0–19.1pp). The week-to-week move in the headline number averages **0.27–1.22pp**. Measured over
330 weeks across the six runs, the move is outside ±1 sd of the cohort spread in **0–2% of weeks**.

So a player who can see the spread can answer "did that mean anything?" correctly essentially every
time, with no change to the simulation at all. This is what the Cohorts screen does.

One honesty note, and the reason the screen calls it a *spread* and never a *confidence interval*:
because the estimator carries the −4.21pp bias from §3, the true value sits inside mean ± 1 s.e. only
24% of the time and inside ± 2 s.e. only 60%. "How far apart are the cohorts I averaged?" is a
question the data answers honestly. "Where is the true retention?" is not, until Option A lands.

### Recommendation

**A + D.** Fix the attribution, and keep showing the band — they are complementary, not alternatives.
A removes the artifact at its source at no cost to responsiveness; D is what lets the player see that
the remaining wobble is nothing, and it keeps working for the genuine residual noise that stays after
A lands. If A is judged too risky to land beside the ICO work right now, **C-robust + D** (a
20%-trimmed mean of the last 16, plus the band) buys most of the improvement for four weeks of lag
and no engine change.

---

## How these were measured

All harnesses live outside the repo (they are sweeps, not assertions) and drive the real engine
through `advanceWeek` with a stable policy: market pricing, `low` from week 30, fixed allocation, the
standard hiring and raise rules, no repositioning. Six runs: seeds 4242 and 7 on social, 991 and 13
on saas, 555 on marketplace, 2024 on fintech, 70 weeks each.

* **Clean-signal recovery** exploits the fact that `resolveCohortRetention` is deterministic and
  shared within a segment: the largest week-over-week exact-count ratio among live cohorts (with the
  age-4 honeymoon step normalised out) is that week's true keep rate. Any cohort below it was
  drained, and by exactly the shortfall.
* **The proportional counterfactual** recomputes each cohort's four-week number as `P` × the product
  of the *segment-wide* loss fractions over its five weeks — the same people removed, fairly charged
  — then reruns the shipped estimator over that stream. It is a replay, not a re-simulation, so it
  does not capture second-order feedback; the aggregate loss it redistributes averages 0.51%/week, so
  that feedback is small.
* **Estimator scoring** compares each estimator against the size-weighted mean of the *clean* numbers
  over the identical window, so lag and bias are measured against what the same ten cohorts would
  have said without the shocks.

The screen's own arithmetic is pinned by `test/cohort-analytics.test.ts`, which asserts that its
rebuilt segment average is bit-identical to `career.retentionBySegment` across all eight runs. That
file is mutation-verified: twelve mutants planted in `CohortAnalytics.tsx`, twelve killed.
