# Founder Mode — pending work

Everything known-but-unfixed, as of 2026-08-15 (refreshed after the feature campaign; closed and stale entries marked in place rather than deleted, so the history of what was believed stays readable). Each item says what it is, why it was left,
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


### 1.2 Supabase spend cap is still unset — OPEN, owner action
There is no rate limiting anywhere in the client, and `owns_score_row` was until this review a
public RPC that burns bcrypt on every call. Anyone with the anon key (it is public by definition,
in `src/net/config.ts`) can drive cost. Nothing in the client can fix this: it needs the edge.

**Owner could not find the setting.** It is not in project settings — cost control lives at the
ORGANISATION level (click the org name, then Billing), and on the **free plan it does not exist at
all**: free projects hard-stop at quota rather than billing, so the protection is already there.

**Done when:** either (a) the project is on a paid plan and a cap + usage alert are set, or (b) it
is confirmed to be on Free and this item is closed as not-applicable — to be REOPENED on any
upgrade, because that is the moment the exposure becomes real.

### 1.3 leaderboard-v6.sql has not been run — OPEN, owner action, HIGHEST VALUE
The shipped policy has been rejecting **100% of real submissions** since it went up: it bounds
`day` to 10000..40000, but `day` is the daily-challenge counter (`dailyInfo()`), which is a small
number like 7. Verified against production with identical payloads: day 7 → 401, day 9999 → 401,
day 10000 → 201. The table contains no genuine score. **The global leaderboard has never worked.**

This was the SECOND time a control here blocked attackers and every real user at once (v3 did the
same), and the 2026-08-19 review found a latent THIRD — v5 wrote every policy `to anon` only, so
enabling social login (§1.2) would have blanked the leaderboard for exactly the players who
engaged most. The rule that would have caught all three: assert the attack is blocked AND the
legitimate path still works, in the same run, for every role that can reach the table.

**Run `supabase/leaderboard-v6.sql`, and nothing else.** It is now the only SQL file in the repo
(the 2026-08-19 review deleted the other five — see "Reference — what the SQL files are" below).
It creates the table as well as securing it, it is idempotent, and it is self-testing: it runs its
own attack matrix as both `anon` and `authenticated` and raises with a list of failures if any
case comes out wrong. It could not be run from here — only the public anon key is available and
there is no local Postgres, and running it needs SQL-editor (owner) access by design.

**Done when:** the owner pastes it into the Supabase SQL editor and it completes printing
`leaderboard v6 self-test passed`. If it raises instead, the message names every case that failed
— paste that back rather than editing the file to make it pass.

Exact steps, and everything else that needs the dashboard rather than the codebase, are in
`docs/security-review-2026-08.md` § "What only the owner can do". Running this also closes §1.4
below: §0 of the script deletes the synthetic rows as its first act.

### 1.4 Production leaderboard holds 14 synthetic rows — OPEN, owner action
During the security review an agent wrote test rows directly into production `daily_scores` and
attempted table-wide deletes. No real data was lost — the table was empty of genuine scores
because of 1.3 — but 14 fixture rows remain (`SECTEST-*`, plus four hex ids paired with company
names "Honest Inc"/"Victim Inc"). All sit at day 10000/10001/39901/39902, outside the real range.

Cleanup was attempted and blocked by the safety classifier: a DELETE against a production database
is not something to automate. **Done when:** removed via the Supabase dashboard, or by running:

```
curl -X DELETE "$SUPABASE_URL/rest/v1/daily_scores?player_id=like.SECTEST*" -H "apikey: $KEY"
curl -X DELETE "$SUPABASE_URL/rest/v1/daily_scores?day=gte.10000" -H "apikey: $KEY"
```

The second line is safe only while 1.3 holds and no real row can exist above day 10000. Run it
BEFORE deploying v5, not after.

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

### 2.3 Run-journal upload — built, tested, deliberately not shipped
The one analytics question no vendor can answer. The game is deterministic and
`src/game/replay.ts` already records every decision, so a finished run can be uploaded as a
journal and **replayed exactly** — turning "players quit around week 12" into "here are four
hundred runs that died in week 12, replay them and watch what they all did".

It exists and it passes its tests: client, Supabase table, RLS, a self-testing SQL script, the
company name redacted out of the header, a 256 kB payload ceiling enforced on both the writer and
the reader, and a canary asserting an uploaded journal replays to the **same fingerprint** as the
run it came from.

**Why it wasn't shipped:** it is a bigger decision than instrumentation. It needs a new Supabase
table, a real consent prompt — uploading somebody's run genuinely does require asking, unlike an
anonymous counter — and a retention policy for run data. Shipping analytics did not have to wait
for those answers.

**Where it is:** branch `worktree-agent-a2853745c13a521f7`, commit `be69eae`, including
`supabase/run-journals-v1.sql`. The shipped consent model kept its (currently unreachable)
`granted` state and its tests specifically so this can be picked up without rebuilding the state
machine underneath it. See `docs/analytics.md`.

### 2.3 Arena matchmaking — join a game without knowing anybody

**Decided 2026-08-20: build it, but not yet, and build a LOBBY rather than a QUEUE.**

Today Arena is join-by-code only, so playing a stranger is impossible: you must already know
someone and send them five characters. Matchmaking is the fix, and the architecture is friendlier
than expected — rooms are Supabase **Realtime channels + presence**, not database rows
(`src/net/online.ts`). The channel *is* the room. Discovery can therefore be a single well-known
lobby channel that players join while looking for a game: **no new tables, no new RLS policy, and
no SQL for the owner to run.** That matters given this repo has shipped a broken leaderboard policy
three times and §1.3's `leaderboard-v6.sql` is still unrun.

**Why a lobby and not a queue.** A queue only works above a concurrency threshold. Below it, it
shows a spinner forever, which is strictly worse than join-by-code because it promises a game it
cannot deliver and reads as "this game is dead". A visible list is honest at any scale:

    3 founders looking for a game right now
      Kestrel     SaaS      waiting 40s   [Join]
      Northreef   Fintech   waiting 2m    [Join]
      Start a room and I'll put you on this list

Auto-pairing is then an *emergent* behaviour to switch on later — when two people are waiting,
offer the match automatically — rather than the thing the design depends on.

**The blocking unknown is a number we are about to have.** Nobody knows the concurrent player
count. PostHog went live 2026-08-20 and now captures sessions and duration correctly (§ analytics),
so within about a week `run_started` overlap will answer it. Do not design the pairing rules before
reading that number.

**Format choice: 1v1 or free-for-all.** The player picks which they are queuing for, and this is
not cosmetic — the two are *balanced differently and already were*. `test/arena-duel-probe.ts`
calibrates against a single peer while `test/arena-ffa-probe.ts` calibrates a crowd, and
`engine.ts:2927` documents a cap that "would silently rebalance every duel in the file that
calibrated it". The Lobby is already hard-capped at 4 (`Lobby.tsx:136`), so today's Arena is
"2 to 4 players, undifferentiated" — the simulation makes the distinction and the UI never asks.

This changes the lobby design rather than sitting on top of it: two pools, shown with their own
counts, because a single number ("5 searching") is a lie when four of them want a format you do
not. Expect 1v1 to fill first at low concurrency — it needs one other person, not three — which
makes it the better default and the honest thing to surface first.

    ARENA          [ 1v1 ]   [ Free-for-all ]
    2 founders searching for a duel · nobody in free-for-all yet

Also settle, when picked up, whether a queued player accepts *either* format ("any game") — good
for fill rate, bad if it drops someone into a format they did not want to play.

Scope when it is picked up:
- **format selection first**: 1v1 and free-for-all as separate pools with separate live counts
- lobby channel + presence-based "looking for a game" broadcast; reuse `connectRoom` for the join
- real counts always, never a spinner — including "nobody is here right now"
- bot backfill after ~60s, **with consent** ("play against 3 AI rivals?"); the sim already drives
  rivals, so this is mostly wiring
- **abuse story — the genuinely new work.** A public lobby is the first surface in this game where
  a stranger broadcasts text (company name) to people who did not invite them. It needs the
  treatment `validateChat` already applies, plus a rate limit on lobby joins.

Already in place and reusable: `MAX_PLAYERS` (32), presence rosters, forfeit/absence detection,
per-event rate limiting, and validated wire payloads.

---

### 2.4 Arena §42/§43 first live render — VERIFIED 2026-08-21
Two real clients (separate origins for separate identities), one live Supabase room (A9RVW),
three rounds played. Standings rendered on both match HQs (rank, share, raised own-row, the round
clock, the match cap in Upcoming); the round reveal rendered on week commit with rows frozen,
share %, per-round deltas and tap-to-dismiss. One field note: the Arena advance button reads
"Ready — end my week", which is why naive automation aimed at "Advance Week" misses it.

---

### 2.2 Multiplayer has no jeopardy
A 52-week Sprint produced **3 bankruptcies per 100 player-runs** — it's a pure score race, with
relative growth as the only real interaction. That may be exactly right for a short competitive
format; flagging it so the choice is deliberate rather than accidental.

---

## 3. Security — residual risk, accepted for now

> **Security work now lives in `SECURITY-BACKLOG.md`** (added 2026-08-22 after a hostile audit of
> the public repo, keys and live services). That file is the maintained list: owner actions, open
> items, what is fixed, and — importantly — what has been investigated and refuted. The entries
> below are kept because other sections reference them, and are mirrored there.

Both need mandatory login or an authoritative server. Neither is worth the friction unless the
leaderboard becomes genuinely competitive.

### 3.1 Client-side score cheating — HALF SOLVED, and the half that remains is a schema column
The old text said this was "unfixable without an authoritative server". That was wrong, and the
determinism work is what made it wrong: a run is exactly reproducible from its config plus its
ordered action log, so `verifyRun` (src/game/replay.ts) replays a submission and compares an
end-state fingerprint. A fabricated score cannot produce a journal that replays to it, and the
journal keys entities by index rather than by `uid()`, so the old blocker does not apply.

**What is done:** every simulation-mutating store action journals through the same registry function
replay uses; the results screen reports verified / desync / legacy; the honesty canary (an
unjournalled mutation must turn verification red) is tested.

**Staged 2026-08-21 — one owner action from closed:** `supabase/leaderboard-v7-proof.sql` adds the
columns (additive, idempotent, size-capped so the journal column cannot become free blob storage;
run it AFTER v6). The client now attaches the stored proof to every submission when it has a
verified one, with a schema-tolerant fallback: until v7 runs, submissions land exactly as before.
Carrying the proof verifies nothing by itself — it makes every row auditable by any reader, which
is the honest claim. Run v6 then v7 in the same sitting.

### 3.2 `display_name` is self-asserted for anonymous players
A signed-out player can type anyone's handle on **their own** row. They cannot touch anyone
else's row. Same fix as 3.1 — derive `display_name` from the authenticated session server-side.

### 3.3 Multiplayer peers are trusted for their own numbers
Presence values (`users`, `val`, `payout`) are self-reported. The receive path is hardened
against crashes, NaN, impersonation and hangs — but not against a peer *lying* about how well
it's doing. Unfixable without an authoritative server; fine for a friendly game.

---

## 4. Balance — measured but unfixed

### 4.1 "Late Entrant" isn't actually harder — FIXED, measured in `docs/balance-baseline.md` §5
97% win rate versus 90% for Standard. It only took *longer* (median week 165) and pushed you
toward acquisitions, because oversized rivals occupied TAM without ever attacking you.

**Done.** AI rivals now use the attack layer that already existed and was calibrated for Arena
(`ATTACKS`, `raidMagnitude`, `applyAttackIncoming`, the shield), behind a `rivalAggression`
capability that is on in Quick Play and Career and off in Arena. The policy is **situational, not
timed** — `rivalStance` reads market position, your growth, the funding gap and the product
comparison, and the rival table renders that same function, so a hostile rival is visible for a
full week before their first move and the crisis retainer and counter-punch are available to answer
it. Standard is a talent fight arriving around week 73–94; Late Entrant is a user raid from week
15–21.

Measured, 24 seeds × 200 weeks × 6 sectors, A/B on the capability inside one build:

* Late Entrant takes **1.5–2.2× the pressure** of Standard in every sector and returns the lowest
  founder net of any scenario in every sector (SaaS Late/Standard net 0.587 → **0.359**).
* Fintech is the clean inversion: Late Entrant used to fail **less** than Standard (0/24 vs 1/24)
  and now fails more (3/24 vs 1/24).
* Standard's win rate is unchanged in five of six sectors; the reference Career policy's failures
  move by at most one in any sector; `npm run bots` keeps Disciplined Discovery strongest in all
  six. Golden traces did not need re-recording (§5.7 explains why that is a property, not luck).

**Still open, deliberately:** the win rate under the *calibrated* policy is saturated at 100% in
most scenarios, so the headline 97%/90% comparison could only be reproduced on a weaker "ordinary
play" bot. That is BACKLOG §2.1's missing clock, not this defect — free play cannot be lost by not
playing, so a 200-week run resolves on score rather than survival.

### 4.2 Secondary sales are correctly EV-negative but nothing says so — FIXED (copy only)
The numbers were right and are unchanged: 2% of the company at a 30% discount is cash worth 1.4% of
it, −24% on final score. That is a hedge that survives bankruptcy, not a value play. The defect was
that the panel never said so, so a player could take it expecting to come out ahead and learn the
shape of it at the postmortem. The panel now states the trade in the run's own numbers — paper value,
cash received, and the difference named as the price of certainty.

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

### 4.4 The PvP retune is unmeasured in a real arena — SUPERSEDED for 1v1, open for 4-player
`test/arena-duel-probe.ts` (2026-08-12) measured 1v1 headless duels and retuned the whole attack
layer: as shipped every attack was a self-own (33-43% win vs a passive victim) and the shield a
second trap (turtle 45% vs bare 68%). After three measured rounds: smear is a real trade (57%
situational), raid breakeven, spam correctly taxed, mirror wars negative-sum, shield price-neutral.
**Still open:** a 4-player free-for-all harness — gang-up and kingmaking dynamics do not exist in
1v1 — and the shield never quite EARNS its price against rational aggression.

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

## 4.8 The post-`pitchInvestors` re-measure — DONE 2026-08-21, and the raising question is CLOSED

The README table is re-measured on the fixed harness (24 seeds × 90 weeks × six sectors);
Disciplined Discovery still wins all six, so the load-bearing ordering survived the fix. The open
question — "raising worth 5–15× with no downside: intended, or the next target?" — is answered
with a counterfactual arm (`NORAISE=1 npm run bots -- all`, same seeds): median **1.7×**, range
0.9×–4.8×, failures rising from ~0 to 62/432 without it, and one arm that nets more by never
raising. Not dominant, not free, real texture per sector. **No balance change needed**; the 5–15×
reading was the pre-fix harness. Full numbers in the README's Balance section.

---

## 5. UI/UX follow-ups

### 5.0 Owner decisions from the FM26 Portal review — 2026-08-20
Three calls made while reviewing the HQ against Football Manager's Portal, recorded so they are
not re-litigated by a future pass:

- **Rival standings: Arena only.** No standings line on the single-player HQ — the market table
  on Rivals is enough there. In Arena, standings ARE the game and belong on the HQ (§42 work).
- **Named-person messages: not now.** FM attributes every message to a named staff member; the
  owner's direction instead is **"blogs from famous people"** later — educational content in the
  voice of well-known founders/investors, closer to Living World content authoring than to inbox
  attribution. Park until the content pipeline exists.
- **Desktop zoning: DONE same day** — the owner played the single-column HQ and reversed the
  deferral. Shipped as two zones (FM-style feed column left — horizon + week stream — with the
  now-zone right), one DOM for both layouts via `display: contents` wrappers. A third column
  remains possible at 2xl if the feed ever splits.


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

### 6.2 The weekly simulation isn't seeded — STALE, RESOLVED
`advanceWeek` reseeds on `(seed, week)` via `mixSeed` (engine.ts), golden traces pin the draw
order, and dailies replay whole runs. Kept for history only.

### 6.3 The service worker has no update prompt — STALE, and it was already built
`main.tsx` has carried the banner since `264f37c`. One real gap was closed on top (a worker already
in `waiting` at page load now announces itself) and the hard-coded colours became theme variables.
Verified live: byte-changed `sw.js`, called `reg.update()`, banner appeared, Reload activated the new
worker and evicted the old cache.

### 6.4 Commit hygiene when agents run in parallel
Two commits (`f33eaed`, `e2c40c0`) mix leaderboard-security changes with an unrelated UI pass,
because a `git add -A` swept another agent's in-progress files. Nothing was lost. Rule going
forward: when concurrent work is in flight, stage by explicit pathspec, never `-A`.

---

## Reference — what the SQL files are

There is exactly **one**: `supabase/leaderboard-v6.sql`. Run it. It creates the table as well as
securing it, so it works on a fresh project and on the existing one, and it is idempotent.

The 2026-08-19 review deleted the other five (`leaderboard.sql`, `leaderboard-hardening.sql`,
`leaderboard-secure.sql`, `leaderboard-v5.sql`, `auth-upgrade.sql`). Six scripts in one directory,
with four different documents each naming a different one as "the one to run", is how a policy
that rejected 100% of real submissions survived for two weeks. They are in git history
(`git log -- supabase/`) if the story is ever needed.

The security model, briefly: each device stores a random secret in localStorage and sends it as
a header; the database stores only a **bcrypt hash** of it, so reading the column gains an
attacker nothing. A `BEFORE UPDATE` trigger makes `player_id`, `day` and the secret immutable
and scores monotonic, so even a leaked secret can only ever *raise* one row's score.

**Testing lesson worth keeping:** this took four iterations because two of them were verified
against the wrong thing. v2 was tested with an unrelated attacker id instead of the victim's
(which is public). v3 was tested for lockdown without checking that real players could still
submit — the lockdown had broken every score submission. Always assert both properties in the
same run: attackers are out, and legitimate users can still act.

---

## 7. Refreshed 2026-08-12 — the balance campaign's own residue

The full record is `docs/balance-deep-dive.md` (Quick Play, allocation, founder kinds, events,
covenant, resonance) plus the commit trail `8fbde4e..7c6f734`. What it left open:

- **Token gap, E-commerce 2.49× / Social 2.76×.** Both paths behave correctly in isolation
  ("idle, sale burned" loses everywhere); the residue is early-capital compounding. Watchlist.
- **`salesCycleWeeks` is still dead data** (gameplay-review finding 6). Wire it in or delete it.
- **The `$2k/wk` bot yardstick no longer discriminates** — every strategy clears it by ~week 10.
- **Optional event content pass** — the audit scorer found option 0 best in 33/40; the free tier
  was priced (energy), the residual ruled deliberate. A per-event pass is polish, not correction.
- **Board ultimatum at 2 strikes vs "of 3" everywhere — FIXED 2026-08-12** (`strikes >= 3`).

---

## 8. Refreshed 2026-08-15 — what the feature campaign closed, and what it left

**Closed since the last refresh** (each measured, not asserted): the tokenisation feature reached
**7 of 7 slices**; the Living World reached **8 of 16 phases**; a sixth sector (AI/ML Infra) shipped
through all five calibration gates; replay verification made §3.1 half-solvable; AI rivals now use
the attack economy, which closed §4.1; `salesCycleWeeks` became load-bearing; the `$2k/wk` bot
yardstick was replaced with weeks-to-profitability; the 4-player Arena harness closed §4.4's open
half; the board ultimatum fires on the third strike as everything else already claimed; §4.2's copy
landed; and CI now runs `npm run build` + `npm test` on every push, with `test/` type-checked.

### 8.1 Still open, ranked by what it costs to leave

1. **The leaderboard proof column** (§3.1's remainder). Additive schema; the client already builds
   and stores the proof. Until it exists, verification is local-only.
2. **`supabase/leaderboard-v6.sql` has still never been run** (§1.3) — and the shipped policy is
   still rejecting 100% of real submissions. It now also carries the `network` ending in its CHECK,
   so one run covers both. This is the single highest-value owner action in this file.
3. **Tokenisation in Quick Play** — Slice 7 stopped at the mode boundary deliberately rather than
   half-wire a second mode. Every token capability is `false` in Quick Play.
4. **Living World phases 9–16** — `longTermCallbacks`, `rivalArchetypes`, `rivalNarrative`,
   `proceduralPostmortem`, and the `livingWorld` umbrella flag, all `false` everywhere.
5. **A clock for free play** (§2.1) — still the product call it always was, and the rival work
   sharpened the reason: the calibrated policy now never goes bankrupt in any scenario, so win rate
   is saturated and "harder" can only be measured on founder net. A terminal week would restore it.
6. **The two memory-selection engines** — `memory.ts`'s scored recall system is still dead code that
   nothing calls, and it is the larger of the two, so it is what the next person will find first.

### 8.2 Open questions the campaign raised and did not answer

- **E-commerce and Social still lead the token band** (2.5×, 2.8× at last measurement). Both paths
  behave correctly in isolation — "idle, sale burned" loses in both — so the residue is early capital
  compounding through sector curves, not the token module.
- **The Arena shield never quite *earns* its price against rational aggression.** Price-neutral in
  1v1, positive in ambient 4-player lobbies, a burn in peacetime. Acceptable while attacks are trades
  rather than dominant, and recorded rather than tuned away.
- **The `network` ending never fires in B2B SaaS or Fintech** (0/51 and 1/58). Their networks are
  structurally smaller; left as sector character, but it means two of six sectors have one fewer
  reachable outcome.


## 9. Added 2026-08-21 — Discovery's honesty gap, found in play

### 9.1 Operating evidence never updates beliefs — SHIPPED 2026-08-22, measured

Real customers now update the hypothesis board. Every `OPERATING_EVIDENCE.cadenceWeeks` (4) weeks,
each segment with ≥5 organic customers files evidence through the same `updateBelief` pipe
experiments use: measured 4-week retention → `retentionPotential` (the retention model inverted at
the measured number), paying at the current price → `willingnessToPay` (a FLOOR observation —
a giveaway price caps what it can reveal), and the live channel → `acquisitionAccessibility`
(target only). Reliability rides the same two ramps as `evidenceRamp` (bodies knee 60, maturity
knee 12 weeks). Organic only — 400 rented customers teach the board nothing, asserted as a test.

Four things the plan did not foresee, all found by measurement or adversarial review in the same
sitting:

1. **It did NOT move the goldens.** The reads are noiseless — the noise is real and lives
   upstream in the measured retention itself, so adding rng would have counted it twice — and a
   noiseless read draws nothing, so the draw order never changed. Quick Play traces, the full
   suite, and `test/pmf-mode-probe.ts` all came out **byte-identical** (the probe was the
   verify-don't-assume item; verified). Only `npm run bots` moved, and only the Disciplined rows —
   the other two strategies never read beliefs and were bit-for-bit unchanged.
2. **The instrument was born biased and had to be taught about war.** First integration run:
   belief converged to truth−20, because shock losses (rival raids, outages, event cuts — routed
   through the reconciliation drain) depress cohort snapshots, and the inversion's 1/0.07 leverage
   turns ~4.5pp of raid damage into ~16 points of "this segment churns". Fix: the drain stamps
   `preSnapshotShockKeep` on cohorts it hits before their snapshot (absent-means-1, no migration),
   and the read divides it back out. `retentionAt4wk` itself stays raw — PMF is still scored on
   what actually happened, shocks included.
3. **Deconvolving with TODAY'S terms was an exploit, caught adversarially before commit.**
   Reconstructing fit/price/bugs at read time let a player flip pricing to premium on a read week
   and turn frozen snapshots into fabricated pilot-grade evidence (signal 50 → 87–100 at full
   reliability, `experimentAnswered('pilot')` for free) — and punished honest policy fixes with a
   20–40 point wrong-way bias. Fix: the tick records the non-segment keep factors **as applied**,
   week by week (`preSnapshotNonSegmentKeep`), and the read divides them out exactly. The flip
   now changes nothing (asserted as a test), and the recovered signal equals truth to one decimal
   across 12 seed×sector probes — belief within 0.5 of truth at ~0.9 confidence by week 48.
4. **The WTP floor observation must not be fed in as a point estimate.** "They pay at least X" is
   censored: fed symmetrically it dragged a CORRECT prior of 85 down to ~52 and hardened it. Fix:
   when the cap binds and the prior sits at or above it, no read at all (no estimate pull, no
   confidence, no `evidenceCount` toward auto-retiring pricing tests); below the cap the floor is
   genuine upward information, carried at a 0.6 discount.

Log discipline: at most ONE evidence item per segment per cycle, and only while it still teaches
(once the board converges the log goes quiet) — 11 items over 48 weeks, not 34. The Discovery
bridge, coach card, attention insight and glossary all now say the board is FED by customers, not
superseded ("only experiments move them" became false the moment this shipped). Bots: Disciplined
stays strongest in all six sectors and mostly widened its lead (SaaS net $10.2M → $16.2M) — a bot
that stops paying for answered questions is richer. README table re-measured in the same commit.
The review also surfaced a PRE-EXISTING §52 leak, filed as §9.3 below.

### 9.3 §52 leak, pre-existing, found by the §9.1 review: user-award events scale with rented users and mint organic cohorts

Verified chain (adversarial review of §9.1, 2026-08-22, confirmed by execution): `s.users` includes
incentivised customers (engine.ts sets `s.users = r.customers`, which is `totalCustomers`); several
events and arcs award users proportional to `s.users` (viral moment `s.users × 0.15` at
data.ts:207, app-store feature `× 0.12` at data.ts:1032 — its `s.users > 2000` gate is crossable
on rented headcount alone — plus influencer arc stages); and next week's reconciliation mints the
award as an origin-less cohort, which IS organic. So token spend inflates events whose payouts
arrive as organic customers — feeding PMF's protected number, and (since §9.1) beliefs too.
Predates §9.1: the same minted cohorts have fed `derivePmfForSegment`'s customer and retention
inputs since ICO Slice 3 shipped. Candidate fixes, undecided: scale awards on organic customers
only, or stamp `origin: 'incentivised'` on awards in proportion to the rented share. Either moves
event balance, so measure with `test/token-balance-probe.ts` when picked up.

### 9.2 Research value is real but invisible — dramatize the kill, then consider one hard hook

Traced 2026-08-21 (4-agent workflow over engine.ts/tick.ts/pmf.ts, owner question "what's the
value of research?"). The verified facts: in Career, research's ONLY hard mechanical payoffs are
(a) the under-15-customer PMF score (confidence×28, cap ~40) which feeds revenue conversion
(0.25 + 0.75·pmf/100) and a few event/pitch gates — small while the customer count is small — and
(b) standing-study retirement stopping a recurring charge. Career acquisition and churn never read
s.pmf or beliefs; the pmf^1.5 word-of-mouth loop is Quick-only. The dominant value is the
information itself, and it is enormous: right vs wrong segment+price is ~86% vs ~62% 4-week
retention, 2–5× the weekly adds, an equilibrium customer base 5–25× larger, and the wrong bet is
mathematically locked out of Strong/Scalable PMF (retention gates 0.72/0.8). The catalogue costs
$4k–$28k against a repositioning penalty of 2–6 weeks at 0.55× marketing.

Two follow-ups, in order of value:
1. **Dramatize the kill.** When evidence moves a belief ≥15 points (or kills the planted
   overconfident prior), the completion inbox message should say what was wrong and what it was
   steering: "You believed willingness-to-pay was 60. It is 24. Premium pricing was built on the
   old number." The text lives in tick.ts → goldens move → same-commit re-record.
2. **Candidate hard hook, if research still feels optional after §9.1 + (1): repositioning
   discount for researched destinations.** Repositioning cost already scales with segment
   distance; scale it also by destination-segment evidence confidence — "you knew where you were
   going." Thematic, small surface area, gives evidence a price in weeks. Balance-probe before and
   after; must not make serial repositioning free.
