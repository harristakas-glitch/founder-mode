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

### 4.3 The PvP retune is unmeasured in a real arena
The shield, poach, raid-leverage and attack-cost changes were verified mechanically (unit
tests) but **not** re-measured in 4-player matches. The original audit's arena numbers are now
stale. **Done when:** a 4-player arena harness re-runs builder / raider / smearer / poacher
strategies over 25+ matches and confirms attacking is viable but not dominant, and that buying
a shield is no longer a net loss.

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

### 6.1 Move the bot test harnesses into the repo
The balance and regression harnesses currently live in a scratch directory and will be lost.
They are the only real test coverage this project has: rules/PvP assertions, hostile-input
regressions, seeded-determinism checks, a NaN hunt, and win-rate measurement.
**Done when:** they live under `test/` (or `scripts/`), run via an npm script, and CI runs them
on push.

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
