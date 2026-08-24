# Strategic Systems — balance log

Every cap change and probe read for the expansion lands here (the effects.ts header points at
this file). Format: what was measured, what moved, why.

## Phase 1 — Product Roadmap (2026-08-23)

**Caps as shipped** (effects.ts): buildVelocity ±35%, acquisitionEff ±20%, opex −20%…0,
arpu 0…+12%, churnRelief 0…15%, bugPressure ±25%. One impact point ≈ 2% on its axis before
diminishing (0.06/extra part) and caps.

**Reads:**
- Golden traces UNCHANGED with an empty roadmap — the foundation is inert until engaged
  (all multipliers exactly 1.0, zero new RNG draws, ambient debt's −0.08/wk drain exceeds a
  founder-only team's accrual). Verified against all three recorded seeds.
- Draw: 22% of eng output per active item, capped 44%. Measured in test: a builder ships
  visibly fewer features than a control twin over 4 weeks (7.16 vs 7.77 at week 5).
- **Tuned before shipping:** REFERENCE_VELOCITY was a flat 6 pts/wk; a founder-only quick team
  produced ~1.1 roadmap pts/wk → a "4-week" item took 23 weeks. Now depth-scaled: light 2.5,
  competitive 4, deep 6 — quick items land in ~4-9 weeks depending on team, career items reward
  real engineering headcount.
- Everything-shipped saas company: build ×1.04, acq ×1.11, arpu ×1.07 — comfortably inside
  caps; the pool cannot break the economy even fully cleared.
- Max debt (100): velocity −15%, bug pressure +25% — a real but recoverable hole; the per-sector
  debt item pays 14 back in 4 base weeks.

**Open questions for the balance campaign (phase 9):** does the 22% draw make slot-2 usage
rational in quick play? Is enterprise-item + enterprise-target the dominant career line (it
should be strong, not dominant)?

## Phase 2 — Big Bets (2026-08-23)

- Progress ONLY from aligned execution: a light bet with one aligned quick item running at full
  pace completes inside its window; declaring with no work = 0% forever (tested).
- Synergy: +10% progress on aligned roadmap items while a bet is active — one bounded part.
- Completion effects per archetype: 3–7% standing parts (arpu/acq/opex/build/churn), all through
  the capped composer. Abandonment: −5% build velocity for 3 weeks, then clean.
- The funded-mix trickle (0.25 aligned pts/wk) requires marketingSpend ≥ $2k — an untouched
  default budget is not a growth motion.

## Phase 3 — Growth Engine: CRO + marketing mix (2026-08-23)

- Default mix = 100% performance = the pre-expansion game exactly; goldens unchanged again.
- Brand: $3k/wk ≈ 1 stock point at zero, lag 8 weeks, decay 1.5%/wk (2.5% under 25). Sustained
  $5k/wk plateaus ~53 ("Strong") — measured over 200 weeks, no runaway. Effects at stock 100:
  acquisition +12%, CAC −12%, arpu +3% — all capped.
- CRO: one shipped item ≈ +6% conversion at full PMF, ceilinged by fit (0.4 + 0.6·pmf/100):
  the same item at PMF 15 is worth less than half its PMF-85 value. Cap +18% total.
- CRO items COMPETE for the same two roadmap slots as features — the §13 tradeoff is the slot.

## Phase 4 — Founder Attention (2026-08-23)

- Reference effect = one Focus: product +6% build, customers −4% churn & ×1.15 research,
  leadership +1.0 morale/wk, operations −8% bug pressure, recruiting +1 candidate skill,
  fundraising +5% offered valuations. Deep points scale by sqrt(pts/3) — 3 points ≈ one Focus,
  6 (the per-area cap) ≈ 1.41×. Budget 8.
- Neglect (deep, engaged only): −3% build / +6% bugs / −0.6 morale / −2% acq per shortfall
  point; DOUBLED where founder dependency ≥ 60. A Focus player is never billed for needs.
- Crisis: bugs > 60 forces operations 3 (counts at half weight — firefighting), squeezing the
  plan proportionally. Deterministic, no new dice.
- Dependency: +3/wk at ≥3 points (halved with senior cover), −2/wk at 0 points with cover.
  12 heavy weeks ≈ 36; delegation unwinds it.
- Bet trickle: focus on an affinity area = 0.15 aligned pts/wk (≈1.2%/wk deep) — measured 23%
  progress over 10 weeks vs 0% idle; attention alone can never complete a bet.

## Owner simplification (2026-08-23) — quick & arena revert to classic

Roadmap, big bets and the growth mix OFF outside Simulation (see implementation doc §6.6).
Balance effect: quick/arena return to their pre-expansion tuning exactly (goldens unchanged);
the calibration problem the owner reported — quick too EASY, simulation too HARD — is now a
pure classic-engine tuning question for quick, and a strategic-systems question only in
Simulation. The full balance campaign (phase 9) measures both.

## The calibration campaign — round 1 (2026-08-24)

Instrument: test/winrate-probe.ts (16 seeds x saas/social/fintech x quick/career x casual/active;
`--assert` turns the owner bands into a gate). Diagnosis: a 6-agent workflow (PMF plateau,
capital access, unit economics, exit cadence, quick resistance → synthesis). Knobs shipped:

1. **Career stage-extension round** (engine): a real business (revenue run-rate ≥ $100k/yr,
   past Pre-seed) that fails a raise on valuation now gets ONE bridge at a 30-45% haircut.
   Career-only, once per run. Active career bankruptcies: saas 5/16→1, social 15/16→2,
   fintech 5/16→1.
2. **Quick board teeth**: after a submitted ultimatum, two more misses = fired (quick/arena
   only; career keeps the forgiving cycle — unscoped this fired career actives 3-10/16).
   Passed reviews stop refilling strikes after a submission. Quick casual failure ~2% → 13-38%.
3. **Acquisition premium** 1.1-2.0 on spot growth → 1.0-1.5 on SUSTAINED growth; and acquirers
   skip companies at 2+ board strikes (diligence — closes the sell-before-fired hatch).
   Active quick medians -15-28%: big wins now take longer, real play.
4. **Guidance**: suggestedExperiment stops re-billing an answered pilot and names repositioning
   when the board says the segment churns by nature; the UI's reposition lever fires whenever
   the segment ceiling < 60 (the trap is named while runway remains). Advisory-only.
5. **Honest unit economics**: career unitEconomics measures marginal CAC via the segment
   resolver (constant rng) and LTV from settled cohort retention — the Growth card stops
   claiming 1.2-4.2x where truth was 0.27-0.65x, plus a "scale after retention holds" line.
6. **Softer repositioning**: cap 6→4 wks, penalties 0.7/0.55 → 0.85/0.75 — the measured
   difference between a mid-game correction dying (@95/@96) and closing acquired (@84).
7. **Fintech career acquisition** 8 → 9 via careerSectorAcqBase (career-only; 10 flipped
   career-balance's price-sensitive ordering, its own documented thinnest cell at 1.03-1.14x).

**After (16 seeds):** career active failure 6%/12%/6% with medians $10.2M/$9.6M/$6.2M vs
passive $11.3M/$9.2M/$16.4M — the skill inversion is CLOSED in social, near-parity in saas,
still open in fintech (its consumers segment rarely trips the informed-pivot signals; next
candidate: fintech-specific guidance or the rank-10 settle knob, owner call). Quick casual
failure saas 13% / social 38% / fintech 25% against the [25,35] band — saas under (its casual
runs sell at wk 44 with a clean board; further hardening would tax actives, all such levers
measured-and-rejected in the diagnosis). Recorded as: bands hit in spirit, two cells outside,
each with a named next knob awaiting an owner decision. token-incentives' warned-weeks floor
recalibrated 60→45 (predicate intact at 3/3 runs/inboxed; the extension IS the escape hatch).

## The calibration campaign — round 2 (2026-08-24): every cell to band

Round 1 left two cells outside: quick-saas casual failure 13% (band floor 25) and the fintech
career skill inversion (passive $16.4M > active $6.2M). Owner call: "do what it needs on all of
them." What it needed:

1. **SaaS board appetite** (quick/arena only): boardEffectiveTarget ×1.2 for saas outside deep
   career — a B2B board expects churn-proof revenue EXECUTED, not collected. One function feeds
   the review gate, the Dashboard dots and the defiance note, so display and enforcement cannot
   split. Measured: quick-saas casual failure 13% → 31-34%, actives 0 fired (no leak).
2. **The WTP trap gets signposted** (career guidance): fintech's consumers stay but pay almost
   nothing (truth WTP 16-25). suggestedExperiment gains the second trap branch: a confident
   low-WTP belief — or a low-confidence one CORROBORATED by the P&L (revenue per customer under
   half the sector norm, passed in by the Discovery screen) — recommends interviewing the
   best-believed richer segment.
3. **Reachability in every destination picker** (the round's biggest find): the pivot pickers
   scored alternatives on retention+pay alone, so every fintech pivot chose regulated
   institutions (believed rp/wtp ~100 — truth accessibility 12-15, market 5-11, cycles 12-18wk)
   and starved. All three pickers (guidance churn branch, guidance WTP branch, probe bot) now
   require believed accessibility ≥ 30 and market size ≥ 25: "who should we build for instead"
   may only answer with segments a pre-seed company can actually reach. After: every fintech
   pivot lands on smb_finance and the sector's active line flips from $6.2M to $18.6M (16 seeds).
4. **The probe's informed opening**: the active bot now opens on the best BELIEVED reachable
   segment (the same scoring as the pivot) instead of the most accessible one — the old opening
   is a designed mistake in trust-heavy sectors, and measuring it forever measured stubbornness.

**Final (32 seeds × 3 sectors):** quick casual failure saas 34% / social 28% / fintech 19%
(sector personality: fintech is the patient sector); quick actives 0-1 fired, medians $42-104M;
career active failure 0-9% and active medians beat passive in ALL SIX cells (saas 14.3 vs 8.5,
social 11.3 vs 7.2, fintech 11.2 vs 9.0). The `--assert` gate now pins: quick casual failure
[15,40], career active ≤ 30%, passive median ≤ active median, zero career firings.

## Phase 4+5 — Management Capacity & AI Adoption (2026-08-24)

- mgmtDrag == coordinationDrag byte-exactly outside deep career (tested at 0-40 heads); goldens
  unchanged. Deep: ±(supply−demand)·0.006, clamped [−0.25,+0.12] around the classic formula,
  floor 0.55 — a led 14-person org beats an unled one by ~8-12 points of drag. Overloaded orgs
  leak bugs +5% / morale −0.4/wk (Breaking: +10% / −0.9) through the composer.
- AI adoption (deep career only; quick/arena off per the owner simplification): 5 areas ×
  maturity ladder, 16 initiatives. One rollout at a time, cash up front, draw 3-15% of the eng
  week (combined roadmap+AI draw capped 60%). Implementation quality = f(capacity word, debt,
  ops attention, team skill) ∈ [15,95], deterministic. Effects at maturity m, quality q:
  scale=(m/4)(0.4+0.6q/100) → eng +10%·scale build (quality<40: +6% bugs instead), mkt +6% acq,
  sales +4% arpu, support +5% churn relief +4% opex, ops +6% opex + capacity supply. Morale
  +0.08/maturity level, −0.15 per resisting area. All inside existing caps; conversionLift
  untouched (no PMF hook, §5.10).
- Calibration gate re-run after both phases: PASS (bots don't adopt AI; the systems are
  opt-in pressure/leverage — a dedicated AI-line probe belongs to the next balance round).
