# Gameplay exploit & balance review

Scope: dominant strategies, degenerate loops, dead systems, traps and number abuse in the
simulation. Crashes and security holes are another agent's beat and are only noted in passing.

Everything numeric below comes from a run actually performed, not from reading the formula.
Two harnesses were used:

* `npm run bots -- all` — the existing three-strategy harness, 24 seeds × 90 weeks × 5 sectors.
* `npx tsx test/exploit-probe.ts all` — a new harness written for this review (`test/exploit-probe.ts`).
  Every strategy in it is a deliberately degenerate policy. Most are the *same* policy as the
  existing `Disciplined Discovery` bot with exactly one lever changed, so a difference between two
  rows is attributable to that lever and nothing else.

**One harness fidelity fix went in first**, because without it the numbers describe a game nobody
can play: `test/career-bots.ts` sets `s.marketingSpend` directly, up to `$200,000`, but the store
clamps the slider to `marketingMax(g)` — `$30k` at Pre-seed, `$50k` at Seed. The probe harness
routes every budget through a `spend()` helper that applies `marketingMax` and the cash balance.
Numbers below are all from the clamped harness.

---

## Ranked findings

### 1. Standing discovery studies are a trap, not an exploit — CONFIRMED, FIXED

**Severity: highest.** This is a brand-new mechanic that the Discovery screen actively invites the
player to turn on ("*One-off. Click to make it a standing study that renews itself.*"), and turning
it on is strictly worse in every sector measured.

`Standing rig` is the reference strategy with one change: every experiment it starts is flagged
`standing: true`. Same seeds, same segment choices, same pricing, same allocation, same hiring.

| Sector | Reference alive | Standing alive | Reference founder net | Standing founder net |
|---|---|---|---|---|
| B2B SaaS | 18/24 | **8/24** | $7.6M | **$3.0M** |
| Dev Tools | 12/24 | **8/24** | $9.2M | **$3.1M** |
| E-commerce | 6/24 | 6/24 | $10.8M | **$6.8M** |
| Fintech | 12/24 | **5/24** | $8.2M | **$2.3M** |
| Social App | 10/24 | **5/24** | $23.5M | **$11.0M** |

Median founder net (valuation × founder equity + banked secondaries) falls 37–72% and survival
falls in four of five sectors. There is no seed and no sector where standing is the better button.

**Mechanism** (`src/game/career/tick.ts`, the renewal loop): the renewal is unconditional. It
re-charges `def.cashCost` and restarts the identical study on the identical segment with no regard
for

1. whether the belief the study answers has already saturated — `updateBelief` gains
   `reliability × 0.28 × (1 − confidence)`, so a study whose metric is already at high confidence
   buys asymptotically nothing while charging full price forever; and
2. whether the player still targets that segment at all — a standing study survives `repositionTo`
   and keeps buying evidence about customers the company has abandoned.

That is the definition of an unbounded drain: a per-cycle cost with a benefit that decays to zero.
A rolling paid pilot is `$28,000` every 7 weeks = `$4,000/wk` against a Pre-seed starting balance
of `$200,000`, forever, for information that stops arriving.

**Reproduction:** `npx tsx test/exploit-probe.ts all` and compare the `Reference` and
`Standing rig` rows.

*(Fix and after-numbers: see "Fixes" below.)*

---

### 2. `low` pricing is a dominated option — CONFIRMED, design decision needed

Three probes hold everything constant and pin the pricing lever:

| Sector | Always low | Always market | Always premium | Oracle-priced |
|---|---|---|---|---|
| B2B SaaS | $2.4M · 20/24 | $4.3M · 19/24 | $5.0M · 20/24 | $6.5M · 16/24 |
| Dev Tools | $2.2M · 12/24 | $4.7M · 18/24 | $9.5M · 12/24 | $7.6M · 14/24 |
| E-commerce | $2.7M · 2/24 | $6.2M · 8/24 | $10.0M · 8/24 | $10.7M · 5/24 |
| Fintech | $2.4M · 20/24 | $6.3M · 16/24 | $6.6M · 21/24 | $7.8M · 15/24 |
| Social App | $7.5M · 8/24 | $13.1M · 12/24 | $25.5M · 13/24 | $30.0M · 12/24 |

(median founder net · runs alive at week 90)

`Oracle-priced` prices off `segmentTruth.willingnessToPay` directly — it is the perfectly-informed
player, an upper bound on what any amount of research could ever buy. Two readings:

* **Pricing is a real choice, narrowly.** Oracle beats always-premium on founder net in 4 of 5
  sectors, so knowing the truth is worth something. But always-premium beats oracle in Dev Tools
  and beats it on *survival* in SaaS, Fintech and E-commerce. The gap is small enough that
  "always charge premium" is a defensible no-research heuristic.
* **`low` is not a choice at all.** It is last on founder net in all five sectors, by 2–3×, and it
  does not buy survival to compensate (worst in E-commerce at 2/24, worst in Social at 8/24).

**Mechanism:** `revenueMultiplier` is `low 0.55 / market 1.0 / premium 1.75` — a 3.2× revenue swing.
The offsetting terms are much weaker: price fit enters acquisition as
`clamp01(0.18 + priceFit/100 × 0.7)` (at most a 3.9× conversion swing, but only against a segment
whose WTP is genuinely low) and retention as `0.95 + priceFit/100 × 0.058` (a 5.8 percentage-point
weekly band). Because valuation is dominated by `annualRev × multiple`, the revenue multiplier
wins.

**This is an owner decision, not a bug.** Making `low` competitive means either narrowing
`revenueMultiplier` or making underpricing buy materially more volume/retention than it does.
Both change the feel of the whole economy, so I have not touched it. Flagging it as the largest
*live* balance question in Career.

---

### 3. Doing nothing never dies; playing the game usually does — CONFIRMED, design question

| Sector | Coast (nothing) | Reference |
|---|---|---|
| B2B SaaS | **24/24 alive** · $1.6M | 18/24 · $7.6M |
| Dev Tools | **24/24** · $1.7M | 12/24 · $9.2M |
| E-commerce | **24/24** · $2.2M | 6/24 · $10.8M |
| Fintech | **24/24** · $1.7M | 12/24 · $8.2M |
| Social App | **24/24** · $2.0M | 10/24 · $23.5M |

`Coast` sets marketing to `$0`, hires nobody, runs no experiments, never raises, and resolves inbox
choices with option 0. It survives every seed in every sector. The reason is structural: with no
payroll and no marketing the only weekly costs are `$300` office base and `users × infraCost`, and
even a coasting company's organic acquisition covers that.

This is *not* obviously wrong — activity has 4–12× the expected founder net, so the risk is paid
for. But "the safest line of play is to not play" is worth an explicit design call: at minimum,
a company that ships nothing for 90 weeks should probably not still be alive with $2M of paper
value. Left alone deliberately; flagging for the owner.

**Harness caveat, recorded so nobody re-derives it:** the `Treasury (raise only)` probe returns
byte-identical results to `Coast` in all five sectors. That is not a finding about fundraising —
it is because its raise trigger is `cash < lastExpenses × 25`, and a coasting company's expenses
are ~$400/wk, so it never trips and never pitches. The row measures nothing.

---

### 4. The marketing slider's maximum is fatal in one click — CONFIRMED

`MaxSpend` sets `marketingSpend = marketingMax(s)` every week — the top of the slider the Growth
screen renders, reachable by dragging once.

| Sector | Alive at wk 90 |
|---|---|
| B2B SaaS | 0/24 |
| Dev Tools | 1/24 |
| E-commerce | 0/24 |
| Fintech | 0/24 |
| Social App | 0/24 |

`$30,000/wk` at Pre-seed against a `$200,000` balance is 6.7 weeks of runway from marketing alone.
This is a soft trap rather than a hard one — the burn is displayed and the player is choosing it —
so I have left the cap where it is. Worth noting that the cap is a stage-gate, not an
affordability gate, and the screen does not currently say "this is more than your runway".

---

### 5. Social and E-commerce survival gap — SEPARATED

The brief flagged that Social and E-commerce survive at 11–13/24 against 20–24/24 for SaaS and
Fintech, and asked whether that is sector character or the bots overspending. It is **neither one
explanation for both sectors** — the two sectors fail for different reasons, and I could only
separate them by varying one lever at a time.

`Thrifty` and `Lavish` are the reference policy at ⅓× and 3× the marketing budget:

| Sector | Thrifty (⅓×) | Reference | Lavish (3×) | No hires |
|---|---|---|---|---|
| B2B SaaS | 21/24 · $4.8M | 18/24 · $7.6M | 11/24 · $4.2M | 23/24 · $3.2M |
| Dev Tools | 19/24 · $6.5M | 12/24 · $9.2M | 11/24 · $6.5M | 20/24 · $4.3M |
| E-commerce | **13/24** · $8.7M | **6/24** · $10.8M | 5/24 · $7.6M | 19/24 · $4.8M |
| Fintech | 21/24 · $3.4M | 12/24 · $8.2M | 7/24 · $6.2M | 22/24 · $3.9M |
| Social App | **9/24** · $14.2M | **10/24** · $23.5M | **12/24** · $18.2M | 19/24 · $5.0M |

* **E-commerce is the bots overspending.** Cutting the budget 3× more than doubles survival
  (6 → 13/24) at a cost of only $2.1M in median founder net. Marketing is the binding constraint.
* **Social is not overspending — it is payroll.** Cutting the budget 3× leaves survival flat
  (10 → 9/24) and *raising* it 3× improves it (→12/24), so marketing is not what kills Social
  companies. Turning hiring off takes Social from 10/24 to 19/24, the single largest survival
  swing of any lever tested in that sector.

  The plausible cause is that the bots' hiring rule, `heads = 1 + floor(lastRevenue / 2500)`, is
  denominated in revenue, and Social's economics are high-volume/low-margin (`careerArpu 1.8` vs
  SaaS `22`). The same revenue therefore buys the same headcount on a fraction of the margin.

**What I could not separate:** whether Social is *also* structurally harder for a good human
player, independently of that hiring rule. Every strategy in both harnesses shares the same
revenue-denominated hiring heuristic, so I have shown the heuristic is wrong for Social but have
**not** shown that Social is survivable with a correct one. Answering that needs a bot whose
hiring is denominated in gross margin, which I did not build. Recorded as open rather than guessed.

---

### 6. `salesCycleWeeks` is dead data — CONFIRMED, since WIRED IN (2026-08-12)

> Closed: customers won this week now land `salesCycleWeeks − 1` weeks later through a pending
> `pipeline` queue on `CareerPMFState` (deterministic, no extra RNG draws, absent-means-empty
> save compat). A one-week cycle is the byte-identical old path, so only the long-cycle end of
> the market slowed. Measured re-baseline is in the wiring commit; regression assertions in
> `test/career-pmf.test.ts`, mutation-verified 4/4. The original finding follows.

`SegmentTruth.salesCycleWeeks` is generated per segment per seed
(`src/game/career/segments.ts`, with real per-sector variety: 1 week for Freelancers, 14 for
Regulated Institutions) and is then read by **nothing**. `grep -rn salesCycleWeeks src test` returns
only its declaration, its per-sector literals, its generation, and its explicit *exclusion* from
`TruthMetric`. No acquisition, revenue, retention or PMF formula touches it.

Cost to the player: zero attention, zero money — it is not surfaced. So it is dead weight rather
than a trap. It is also the single most obvious missing texture in the segment model: it is what
would make Enterprise genuinely slow rather than merely expensive. Left alone (adding a lag
mechanic is a feature, not a fix); flagged as an owner decision.

---

## Fixes

### Fix 1 — a standing study retires when it has answered its question

`src/game/career/pmf.ts`, `src/game/career/tick.ts`.

The renewal loop now checks `experimentAnswered(career, type, segment)` before charging. That
reads a new shared table, `EXPERIMENT_ANSWERS`, which pairs each instrument with the belief it
exists to move and the confidence at which that question counts as answered — `interview →
needIntensity @ 0.40`, `pilot → retentionPotential @ 0.65`, and so on. Past its bar the study is
retired with an inbox message and a journal entry that names the confidence it reached and the
per-cycle cost it just stopped spending.

The same table now drives `suggestedExperiment`'s ladder, which previously carried its own private
copy of those five bars. That was the actual root cause: the game recommended a study until
confidence 0.65 and then billed for it forever afterwards, with the two thresholds free to drift
apart. There is now exactly one definition of "answered" and both readers share it.

**Before / after**, same 24 seeds × 90 weeks, `Standing rig` vs the identical policy without
standing (`Reference`):

| Sector | Standing before | Standing after | Reference |
|---|---|---|---|
| B2B SaaS | 8/24 · $3.0M | **15/24 · $5.6M** | 18/24 · $7.6M |
| Dev Tools | 8/24 · $3.1M | **16/24 · $8.7M** | 12/24 · $9.2M |
| E-commerce | 6/24 · $6.8M | 3/24 · **$10.3M** | 6/24 · $10.8M |
| Fintech | 5/24 · $2.3M | **14/24 · $4.8M** | 12/24 · $8.2M |
| Social App | 5/24 · $11.0M | **10/24 · $32.3M** | 10/24 · $23.5M |

Median founder net rises in all five sectors (+87%, +181%, +51%, +109%, +194%) and survival rises
in four. Standing is no longer strictly dominated: it now beats or matches the one-off Reference
on survival in Dev Tools, Fintech and Social, and on founder net in Social. It remains behind
Reference on net in SaaS and Fintech, which is fine — it is a spending choice, and a spending
choice should cost something.

The E-commerce survival drop (6 → 3/24) is not caused by this fix and is not a regression in the
mechanic: freeing the study budget lets that policy spend more on marketing, and marketing spend is
exactly what kills E-commerce companies (finding 5). Median founder net there rose $6.8M → $10.3M.

The affordability pause and its message are unchanged; retirement is checked first, so a study that
has finished its job is retired rather than reported as "paused" for lack of cash.

---

### Fix 2 — winning a hiring auction has to actually move the candidate

`src/game/engine.ts`, the `offersOut` block. Regression tests in `test/hiring-market.test.ts`.

**The auction itself is clean — I could not break it.** `npx tsx test/arena-auction-probe.ts`
runs 1,000 head-to-head contests over 200 weeks of the shared pool:

| Contest | A wins |
|---|---|
| max premium (100, rep 50) vs asking price (0, rep 50) | 100.0% |
| max premium, rep 0, runway 5 vs asking price, rep 100, runway 60 | 29.2% |
| …restricted to skill ≥ 8 | 0.0% |
| max premium rep 0 vs max premium rep 100 | 0.0% |

`premiumPct` is clamped to `[0,100]` in the store *and* again in the wire validator, so the money
term tops out at 59–100 score points (it is scaled by `moneyWeight`, which falls with skill) while
reputation + runway + jitter top out at 39. So a maxed bid does beat an indifferent rival every
time — which is correct, that is what paying over the odds is for — but **no bid always wins**:
with money equal, reputation decides, and against a strong rival a maxed bid from a disreputable,
short-runway company loses outright, and loses 100% of the time on the high-skill candidates where
money is weighted least. There is also **no free hire**: the winning premium binds into the salary
pushed to `offersOut`, and `recruiterFee` is 15% of that salary, so a +100% win on a skill-8
engineer costs $152k → $304k/yr and a $22,800 → $45,600 fee. Both halves of the brief's question
come back negative, and that is a good result for the design.

What *was* broken is what happens next. Two defects, both fixed:

1. **The premium bought the auction but not the hire.** `acceptChance` read reputation, runway and
   climate — never the premium that had just won the contest. A founder could commit +100%,
   doubling salary and fee, and be declined 25.5% of the time for reasons unrelated to their bid.
   Acceptance now includes an `overPay` term derived from the offer against the role's market rate
   (`ROLE_BASE[role] + skill × 13,000`), so it needs no new state and behaves identically in Quick
   Play.
2. **A bankrupt company was exempt from the runway penalty.** The guard was
   `runwayNow > 0 && runwayNow < 10`. When cash is already negative `runwayNow` is negative, which
   fails the first half — so the company closest to death got *no* penalty while a merely nervous
   one with nine weeks of cash got −25 points. The decline message (`'— your runway scared them
   off'`) already used the correct `runwayNow < 10`, so the text and the maths disagreed. Now both
   use `looksDoomed = runwayNow < 10`.

**Before / after** acceptance probability:

| Situation | Before | After |
|---|---|---|
| rep 10, healthy runway, offer at asking price | 74.5% | **74.5%** (unchanged) |
| rep 10, healthy runway, won auction at +50% | 74.5% | **83.5%** |
| rep 10, healthy runway, won auction at +100% | 74.5% | **92.5%** |
| rep 60, healthy runway, asking price | 87.0% | **87.0%** (unchanged) |
| rep 10, 9 weeks of runway | 49.5% | **49.5%** (unchanged) |
| rep 10, bankrupt next week (runway −3) | 74.5% | **49.5%** |

The change is deliberately inert at the asking price, so no existing Quick Play or Career balance
moves; it only prices the range the Arena auction opens up.

---

## Deliberately left alone

* **`low` pricing being dominated (finding 2)** — fixing it means moving `revenueMultiplier` or the
  price-fit curves, which re-tunes the whole Career economy. That is a design call, not a bug fix.
* **Coasting being the safest line (finding 3)** — activity is correctly paid for in expected
  value; whether the *floor* should be that safe is an owner call.
* **The marketing slider maximum (finding 4)** — the burn is displayed and the player chooses it.
  Capping the slider by runway would remove a legitimate aggressive line.
* **`salesCycleWeeks` (finding 6)** — deleting it throws away per-sector data that is already
  correct and evocative; wiring it in is a feature. Costs the player nothing today.
  *(Since wired in — see the note on finding 6.)*
* **`src/net/**` and `supabase/**`** — out of my ownership; the security agent holds them and was
  editing them during this review. Nothing gameplay-relevant found that lives there. The "no bid
  always wins" result **depends on `premiumPct` being bounded to `[0,100]`**; both clamps were
  re-verified against the working tree at the end of the review and both hold:
  `src/store.ts:897` (`Math.min(100, Math.max(0, …))`) and `src/net/online.ts:395`
  (`int(p.premiumPct, 0, 100)`, carrying the comment *"an unbounded premium would auto-win every
  auction"*). If that wire-side bound is ever relaxed, the auction becomes trivially winnable and
  this finding must be re-run.

---

## Needs an owner decision

1. **Is `low` pricing supposed to be viable?** It is currently last on founder net in all five
   sectors by 2–3× and buys no survival to compensate. Either it should buy materially more volume
   and retention than it does, or the UI should stop presenting it as a peer of the other two.
2. **Should a company that does nothing for 90 weeks still be alive?** It currently is, in 24/24
   seeds in every sector.
3. **Should Social be survivable on a revenue-denominated hiring rule?** See finding 5 — I showed
   the rule is wrong for Social but not that Social is fine with a right one.
4. **`salesCycleWeeks`** — wire it in, or delete it and stop generating it.
   *(Decided and done, 2026-08-12: wired in. See the note on finding 6.)*

---

## Still open / not investigated

* The `$2k/wk` milestone in `test/career-bots.ts` no longer discriminates (every strategy clears it
  by ~week 10). Confirmed by inspection of the baseline run: 23/24, 24/24, 24/24 across the three
  strategies in four of five sectors. Not replaced with a discriminating gate — doing so is a
  harness change that would invalidate comparison against this review's numbers.
  *(Since replaced, 2026-08-12, with weeks-to-profitability — 4 consecutive weeks of revenue
  covering expenses — which separates all three strategies in every sector. The invalidation the
  bullet above predicted is real and is declared in the harness's own header: milestone columns
  printed before that date do not compare with columns printed after it.)*
* Quick Play / Arena-only systems (M&A, IPO pricing, debt covenants, PvP attacks and shields) were
  read but not bot-tested; the review's budget went to Career and the auction as ranked. One thing
  noticed while reading and **not verified**: `covenantCheck` seizes `min(cash, principal)` and
  converts only the shortfall to equity, so drawing debt, spending it immediately, then breaching
  the covenant may be cheaper than repaying. Unverified — no run was done.

---

## Harnesses

* `test/exploit-probe.ts` — 12 degenerate-policy strategies, `all` for five sectors, plus a
  `standing` sub-command that accounts for what a rolling study costs against the confidence it
  buys. Not wired into `npm test` (it is a ~10-minute sweep).
* `test/arena-auction-probe.ts` — head-to-head auction contests and the acceptance table. Fast.
* Regression coverage for both fixes is in `npm test`
  (`test/career-pmf.test.ts`, `test/hiring-market.test.ts`).
