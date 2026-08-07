# Founder Mode — pending work

Everything known-but-unfixed, as of 2026-08-07. Each item says what it is, why it was left,
and what "done" looks like — enough to pick up cold.

Sources: a 4-part code review, an in-game balance audit (bot-measured, 20–40 runs per
configuration), a security assessment, and a UI/UX modernization pass. Everything those
turned up that is **not** listed here has already shipped.

---

## 1. Needs the owner — no code involved

### 1.1 Set a Supabase spend cap and usage alerts — **do this first**
There is currently **no rate limiting of any kind** on the project. The publishable key ships
in the JS bundle (by design), so anyone can call the REST API or open Realtime channels at any
volume. The realistic damage is a bill or an exhausted free tier, not data loss — the RLS work
below is done — but nothing stops it today.

**Done when:** a spending cap and usage alerts exist in the Supabase dashboard, and Realtime
connection/message rate limits are configured. Free-tier ceilings worth watching: 500 MB
database, 5 GB egress/month, 200 concurrent Realtime connections, 2M messages/month.

### 1.2 Social login is built but not switched on
`src/net/auth.ts` and the sign-in buttons are shipped and fail gracefully; the OAuth providers
were never enabled, so the buttons error if pressed. Anonymous play is unaffected.

**Done when:** in Supabase → Authentication: enable the Google provider (needs a Google Cloud
OAuth client with callback `https://rgxwsffpfsvcpqgvogkl.supabase.co/auth/v1/callback`),
optionally X; and under URL Configuration set Site URL to
`https://harristakas-glitch.github.io/founder-mode/` with `http://localhost:5173` in the
redirect allowlist.

### 1.3 Tidy leftover GitHub repos (cosmetic)
Four private `git-connector-XXXXXXXX` repos and `founder-mode-old` remain from the abandoned
Lovable integration. Harmless; `founder-mode-old`'s history is fully contained in the canonical
repo. Deletable via each repo's Settings → Danger Zone.

---

## 2. Decisions only you can make

### 2.1 A clock for free play — the balance audit's #1 recommendation
Free play cannot be lost by *not playing*. An idle bot (no hires, no raises, minimum ads)
survived **30/30 runs to week 300** — burn is ~$1.3k/wk and the solo founder eventually
researches their way to ramen profitability. Sloppy-but-funded play is worse: **31/40 runs were
still alive at week 300**, idling on a ~$17M payout with no failure state.

The proposed fix is a 260-week (5-year) cap ending in `timeup` with `payout = valuation ×
equity`. Expected effect: every week costs something, and the 90%-win plateau becomes a score
race instead of a binary.

**Why it wasn't done:** the start screen advertises free play as *"Solo vs AI rivals. Pick your
market, **no time limit**."* Adding a cap contradicts a stated promise, so it's a product call,
not a bug fix. Alternatives: make it an opt-in "Career mode" toggle, or reword the mode card.

### 2.2 Multiplayer has no jeopardy
A 52-week Sprint produced **3 bankruptcies per 100 player-runs** — it's a pure score race, with
relative growth as the only real interaction. That may be exactly right for a short competitive
format; flagging it so the choice is deliberate rather than accidental.

---

## 3. Security — residual risk, accepted for now

Both need mandatory login or an authoritative server. Neither is worth the friction unless the
leaderboard becomes genuinely competitive.

### 3.1 Client-side score cheating
Nothing simulates the game server-side, so a modified client can submit a plausible but
fabricated score for **itself**. The RLS work stops players damaging *other* rows; it cannot
tell a real run from an invented one.

**Real fix:** move submission behind a `security definer` RPC keyed on `auth.uid()`, revoke
anon INSERT/UPDATE, and require login to post a score.

### 3.2 `display_name` is self-asserted for anonymous players
A signed-out player can type anyone's handle on **their own** row. They cannot touch anyone
else's row. Same fix as 3.1 — derive `display_name` from the authenticated session server-side.

### 3.3 Multiplayer peers are trusted for their own numbers
Presence values (`users`, `val`, `payout`) are self-reported. The receive path is hardened
against crashes, NaN, impersonation and hangs — but not against a peer *lying* about how well
it's doing. Unfixable without an authoritative server; fine for a friendly game.

---

## 4. Balance — measured but unfixed

### 4.1 "Late Entrant" isn't actually harder
97% win rate versus 90% for Standard. It only takes *longer* (median week 165) and pushes you
toward acquisitions, because oversized rivals occupy TAM without ever attacking you.
**Suggested:** have rivals starting 8–14× your size actively raid your users, not just sit on
the market.

### 4.2 Secondary sales are correctly EV-negative but nothing says so
`secondaryProceeds` = `valuation × 0.02 × 0.7` — you give up 2% of the company for cash worth
1.4% of it, measured at −24% final score. That's *good design* (it's a hedge that survives
bankruptcy, not a value play) — **do not change the numbers.** The problem is purely that the
UI never explains the trade. **Suggested:** a line on the panel — "selling 2% for the cash value
of 1.4%; this only pays off if the run ends badly."

### 4.3 Career strategy spread — RESOLVED: it was the bot, but not the gate we blamed
Re-measured with `npm run bots` (24 seeds × 90 weeks, deterministic) after the cohort-retention
fix. Median, with [worst…best] across seeds:

**B2B SaaS**

| Strategy | Alive | Customers | 4wk retention | Rev/wk | Valuation | Reached $2k/wk |
|---|---|---|---|---|---|---|
| Careless Growth | 19/24 | 373 [238…837] | 48% [40…70] | $909 [$0.5k…$3.5k] | $2.7M [1.3…4.6] | 2/24 |
| Disciplined Discovery | 20/24 | 476 [175…744] | 67% [48…85] | $3,689 [$1.7k…$9.1k] | $4.8M [2.7…11.2] | 21/24, wk 36 |
| Enterprise Bet | 19/24 | 355 [158…722] | 64% [53…92] | $3,249 [$1.3k…$10.6k] | $4.4M [2.7…10.6] | 21/24, wk 44 |

**Fintech** (second sector, to check the result isn't a single-market artifact)

| Strategy | Alive | Customers | 4wk retention | Rev/wk | Valuation | Reached $2k/wk |
|---|---|---|---|---|---|---|
| Careless Growth | 19/24 | 388 | 46% | $357 | $2.1M | 0/24 |
| Disciplined Discovery | 13/24 | 482 | 62% | $1,607 | $3.0M | 8/24, wk 68 |
| Enterprise Bet | 15/24 | 372 | 61% | $1,413 | $2.8M | 6/24, wk 70 |

**Verdict: bot bug, not an economic imbalance.** Discovery and the enterprise bet now finish
within noise of each other on every axis, and both beat careless spending on revenue and
valuation by 3–4× — a gap far outside noise. The strategies genuinely trade off:

- **Careless Growth** loses on money. It survives as well as anyone (it barely spends) but
  reaches $2k/wk in 2 of 24 SaaS runs and 0 of 24 fintech runs. It stays alive by staying small.
- **Enterprise Bet** loses on speed: median week 44 to $2k/wk vs 36 for discovery in SaaS, and
  fewer customers. Betting the hand without checking it costs you the time you'd have saved.
- **Disciplined Discovery** loses on survival where evidence is expensive: 13/24 in fintech vs
  19/24 careless. Buying evidence is a real cost, and in low-reachability markets it can kill you.

The gap between Disciplined and Enterprise (13% revenue, 9% valuation, 1 survivor) is **inside
the noise at 24 seeds — do not read it as a ranking.** The Careless gap is not.

**The 4.3 hypothesis was wrong.** Reverting the 0.72 marketing gate on its own changes nothing
(20→22 alive, $3.7k→$3.4k rev — noise), because tiny cohorts round to 100% retention and the
gate opened at week 6–11 anyway. Removing each fix one at a time (SaaS / fintech medians):

| Fix removed | Alive | Rev/wk |
|---|---|---|
| *(all four fixes, shipped)* | 20/24 · 13/24 | $3,689 · $1,607 |
| revert marketing gate to 0.72 | 22/24 · 15/24 | $3,354 · $1,509 |
| revert experiment budget rule | **10/24 · 6/24** | $2,491 · $970 |
| revert price/focus/allocation | 19/24 · 15/24 | **$1,084 · $471** |
| revert discovery marketing floor | 22/24 · 18/24 | $3,069 · $1,538 |
| all four reverted (the old bot) | 13/24 · 11/24 | $934 · $374 |

Two real bot bugs, both in `test/career-bots.ts`, now fixed:

1. **The disciplined bot never used the levers the other two bots used.** Careless and Enterprise
   each set pricing, product focus and engineering allocation; the disciplined bot left all three
   at defaults for 90 weeks. The harness was comparing a configured company against an
   unconfigured one, and calling the difference "strategy". Worth 3.4× revenue on its own — it is
   the entire original gap. It now sets all three *from its own beliefs*, which is the point of
   the mode.
2. **It had no discovery budget and bankrupted itself buying pilots.** A pilot's reliability is
   throttled by segment reachability, so reaching the bot's 0.7 confidence bar on retention costs
   8–13 pilots — $224k–$364k and 56–91 weeks, more than the starting cash and longer than the
   campaign. It bought evidence it could never finish collecting. Now it only starts an experiment
   it can carry (cash > 8× cost), and uses the confidence bars the game itself recommends to the
   player in `suggestedExperiment` rather than a stricter set invented in the harness.

Also changed, both neutral in the numbers but kept because the old behaviour was indefensible:
the marketing gate is now "enough retained customers to read the number, at or above the 62%
payback threshold the game itself states in `pmfBlocker`, and not still falling" instead of an
absolute 0.72 some segments cannot reach; and the pre-scale marketing budget now covers the
marketing its own experiments consume (a landing-page test eats $3k/wk, so a $3k budget bought
literally zero customers).

**Resolved.** No change to `src/game/**`. Three findings that fell out of this and are *not*
resolved are filed as 4.5, 4.6 and 4.7.

### 4.4 The PvP retune is unmeasured in a real arena
The shield, poach, raid-leverage and attack-cost changes were verified mechanically (unit
tests) but **not** re-measured in 4-player matches. The original audit's arena numbers are now
stale. **Done when:** a 4-player arena harness re-runs builder / raider / smearer / poacher
strategies over 25+ matches and confirms attacking is viable but not dominant, and that buying
a shield is no longer a net loss.

### 4.5 `resolveChoiceOnState` is the one player action that isn't seeded — RESOLVED
`resolveChoiceOnState` now delegates to `resolveChoiceOnStateInner` inside `seeded(s, …)` like
every other engine entry point, so the `rand(5, 8)` / `randomName()` draws in `applyEffects` come
from the seeded generator. The `stable()`/`withSeed` workaround in `test/career-bots.ts` is
deleted, and two consecutive `npm run bots` runs are byte-identical without it. Replays, shared
seeds and leaderboard verification involving an inbox choice with a hire attached no longer
diverge.

### 4.6 4-week retention reads 100% on cohorts too small to measure — RESOLVED
Fixed at the source rather than by discarding small cohorts. `CustomerCohort` gained
`exactCustomers`: decay runs on the unrounded count and `activeCustomers` is its rounded shadow,
so 3 × 0.95 is 2.85 rather than being rounded back to 3 forever. The four-week snapshot is taken
off the exact figure, so a small cohort reports a real rate instead of a rounding artifact. The
reconciliation path that removes users keeps both counts in step, or decay would resurrect them.

This was propping up the whole economy: measuring retention honestly roughly halved Career
revenue (SaaS Disciplined $3,689 → $1,595/wk), which is what exposed 4.7 as an economy-wide
problem rather than a two-sector one.

### 4.7 Two sectors kill every strategy — RESOLVED, and it was all five
The diagnosis in the original entry was wrong. Instrumenting deaths showed B2B SaaS companies
"surviving" on $548/wk of revenue against $5,571/wk of expenses — they were not solvent, they
were draining the starting $200k more slowly than the others. **Every Career company in every
sector was structurally unprofitable.** E-commerce and Social were not uniquely broken; they were
simply the fastest to run out of road.

Cause: Career billed customers at `sector.arpuWeekly`, which is calibrated for Quick Play's user
volumes (tens of thousands). Career counts retained *accounts* in the hundreds, so a sector whose
ARPU assumes consumer scale can never fund a team — Social needed ~80,000 customers at $0.12 to
cover payroll and tops out near 4,000.

Fix: `Sector.careerArpu`, used by the engine only when `detailedPMF` is on, so Quick Play and
Arena are untouched. Calibrated so a few hundred well-retained customers carry a small team, with
sector character preserved in the ratios — a social user is still worth a fraction of a B2B seat.
saas 22, devtools 24, fintech 18, ecommerce 12, social 1.8.

Survivors at week 90, 24 seeds (before → after):

| Sector | Careless | Disciplined | Enterprise |
|---|---|---|---|
| B2B SaaS | 22 → 24/24 | 20 → 20/24 | 18 → 22/24 |
| Dev Tools | 20 → 20/24 | 17 → 17/24 | 20 → 20/24 |
| E-commerce | 1 → 5/24 | 2 → 11/24 | 8 → 6/24 |
| Fintech | 18 → 23/24 | 15 → 21/24 | 14 → 16/24 |
| Social App | 2 → 12/24 | 1 → 13/24 | 0 → 8/24 |

Disciplined Discovery is now the strongest strategy in all five sectors, which is the outcome the
mode exists to teach.

**Two caveats left open, deliberately.** (1) The `$2k/wk` yardstick in the bot report is now
obsolete — every strategy clears it by roughly week 10, so it no longer discriminates and should
be replaced with a higher bar or with weeks-to-profitability. (2) Social and E-commerce still sit
at 11–13/24 against 20–24/24 for SaaS and Fintech. That is plausibly correct sector character
(high volume, thin margin, high churn), but it has *not* been separated from the alternative
explanation: the bots' hiring and marketing rules are keyed off revenue and may simply overspend
in high-volume sectors. Do not read the remaining gap as intended difficulty until that is tested.

---

## 5. UI/UX follow-ups

Carried over from the design pass. None are defects; all are real improvements.

1. **Market table → cards on mobile.** Same class of problem as Hiring (fixed): actions sit
   off-screen behind horizontal scroll. Hiring's card layout is the pattern to copy.
2. **Compact mobile topbar.** Nine metrics in a horizontal scroller is a lot on a phone; two
   key stats plus a tap-to-expand sheet would read better.
3. **Highlight what changed this week** in the topbar. The consequences of a decision are
   currently easiest to read on the Dashboard digest only.
4. **Code-split the bundle** (~658 kB). `@supabase/supabase-js` and the share-image renderer are
   both lazily loadable — neither is needed for a solo first paint.
5. **Reduced-motion path is unverified visually.** The CSS block and the `matchMedia` guard in
   `useTicker` are in place but were never exercised in a browser that emulates the setting.

---

## 6. Engineering / robustness

### 6.1 Move the bot test harnesses into the repo — **done 2026-08-07**
Now `test/modes.test.ts`, `test/rules.test.ts` and `test/regressions.test.ts`, run with
`npm test`. Remaining: wire them into CI on push, and note that `tsc -b` does not currently
type-check `test/` (they are executed through tsx).

### 6.2 The weekly simulation isn't seeded
`newGame` is wrapped in `withSeed`, so everyone gets an identical *starting world* — but
`advanceWeek` is not, so week-to-week rolls diverge. Daily Challenge players therefore share a
starting hand, not a whole run. Seeding the weekly sim would make dailies truly comparable, and
is a prerequisite for replays or server-side verification. Note `uid()` uses `Date.now()` +
`Math.random()` and would need to change too (ids are currently nondeterministic even in seeded
worlds — harmless today).

### 6.3 The service worker has no update prompt
Navigations are network-first, so an online launch always gets the newest build — but a user who
stays on an open tab runs the previous version indefinitely with no nudge. A "new version
available, reload?" toast would close it.

### 6.4 Commit hygiene when agents run in parallel
Two commits (`f33eaed`, `e2c40c0`) mix leaderboard-security changes with an unrelated UI pass,
because a `git add -A` swept another agent's in-progress files. Nothing was lost. Rule going
forward: when concurrent work is in flight, stage by explicit pathspec, never `-A`.

---

## Reference — what the SQL files are

Run **only** `supabase/leaderboard-secure.sql`; it supersedes the other two and is idempotent.
`leaderboard.sql` (original table) and `leaderboard-hardening.sql` (a superseded attempt whose
UPDATE policy was defeated in testing) are kept for history.

The security model, briefly: each device stores a random secret in localStorage and sends it as
a header; the database stores only a **bcrypt hash** of it, so reading the column gains an
attacker nothing. A `BEFORE UPDATE` trigger makes `player_id`, `day` and the secret immutable
and scores monotonic, so even a leaked secret can only ever *raise* one row's score.

**Testing lesson worth keeping:** this took four iterations because two of them were verified
against the wrong thing. v2 was tested with an unrelated attacker id instead of the victim's
(which is public). v3 was tested for lockdown without checking that real players could still
submit — the lockdown had broken every score submission. Always assert both properties in the
same run: attackers are out, and legitimate users can still act.
