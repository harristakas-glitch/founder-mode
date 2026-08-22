# Founder Mode — security review, August 2026

**Date:** 2026-08-19 · **Branch:** `worktree-agent-a5cdb21d911189e80` · **Base:** `add71a6`
**Scope:** `src/net/**`, `supabase/**`, `public/sw.js`, the save/load path, the replay/journal
path, and the deployment surface (CSP, error boundary, service worker).

This continues `docs/security-review.md` (2026-08-07) rather than replacing it. That review found
the leaderboard policy rejecting every real submission; this one found the multiplayer wire
dropping two of the game's five attacks, and a `supabase/` directory that had grown to six scripts
with four different documents each naming a different one as the one to run.

Findings are ranked by **real-world exploitability**, not by category. Where something is fine, it
says so. Where a fix is only insurance against a hole that does not exist yet, it says that too —
a review that inflates severity is worse than useless.

---

## The one thing that matters most

**The global leaderboard has never worked, and only the owner can fix it.**

The shipped RLS policy bounds `day` to 10000..40000. `day` is the daily-challenge counter — it is
**19** today. Every genuine submission has been rejected with a 401 since the policy went up. The
table contains no real score.

The fix is written, self-testing, and cannot be applied from here — it needs SQL-editor access.
See [What only the owner can do](#what-only-the-owner-can-do). It is one paste into one text box.

---

## Findings, ranked by exploitability

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `validateAttack` silently dropped 2 of the game's 5 attacks | **High** — feature dead in production | Fixed `c373f4e` |
| 2 | Leaderboard policy rejects 100% of real submissions | **High** — feature dead in production | Fix written, **owner must run it** |
| 3 | `concede` — the one broadcast that adds users to the persisted save — had no validator | **High** | Fixed `c373f4e` |
| 4 | Service worker origin check was a string prefix test | **Medium-High** | Fixed `750eb39` |
| 5 | Signed-in players would have been locked out of the leaderboard the moment social login was enabled | **Medium-High** (latent) | Fixed both ends |
| 6 | `supabase/` held six scripts; the setup doc pointed at the least secure one | **Medium-High** | Fixed `d9159ef` |
| 7 | `normalizePlayer` truncated ids *after* checking them, collapsing distinct identities | **Medium** | Fixed `750eb39` |
| 8 | `sanitizeJournal` had no length cap, so a hand-written save froze the tab | **Medium** | Fixed `750eb39` |
| 9 | Service worker cache-first matched `/assets/` as a substring | **Medium** | Fixed `750eb39` |
| 10 | Legacy null-secret rows left their `player_id` unbound and squattable | **Medium** | Fix written, **owner must run it** |
| 11 | Presence roster could be pushed past `MAX_PLAYERS` | **Medium** | Fixed `c373f4e` |
| 12 | U+2028/U+2029 survived the unsafe-character strip | **Low-Medium** | Fixed `c373f4e` |
| 13 | Leaderboard rows rendered unsanitised for every player | **Low-Medium** | Fixed `c373f4e` |
| 14 | No Content-Security-Policy anywhere | **Low** (no live sink) | Added `3185add` |
| 15 | No React error boundary anywhere | **Low** (availability, not confidentiality) | Added `3185add` |
| 16 | The security test file was binary to git | **Low** (review integrity) | Fixed `13a21f7` |

---

### 1. `validateAttack` silently dropped two of the five attacks — HIGH

**Where:** `src/net/online.ts`, the attack whitelist.

The game ships five attacks. The wire validator whitelisted three: `poach`, `smear`, `raid`.
`hitpiece` and `pricewar` were dropped by **every victim's client** — silently, with no error on
either side. The attacker paid the cash cost and burned the cooldown; nothing happened to anybody.

**This means the price-war economy has never functioned in real multiplayer.** Not "was
exploitable" — never functioned. Every player who spent on a price war in an online match spent
into a void, and the receiving player never learned an attack had been aimed at them.

The receive path was traced end to end before calling the whitelist a sufficient fix: the store
passes `p.kind` straight through to `applyAttackIncoming`, which branches on all five kinds. So the
whitelist was the *only* thing standing between those two attacks and working. Widening it is a
complete fix, not a partial one.

**Fix:** the whitelist is derived from the same source as the attack table, so a sixth attack
cannot be added without the wire learning about it.
**Test:** `test/net-security.test.ts` — every one of the five is asserted to land, and an invented
sixth (`nuke`) is asserted to be refused, in the same run.

### 2. The leaderboard policy rejects every real submission — HIGH, owner action

Carried forward from the 2026-08-07 review and **still open**, because applying it needs
SQL-editor access. Detail in [What only the owner can do](#what-only-the-owner-can-do).

Worth restating plainly: this is the third time a control in this file has blocked attackers and
every legitimate user at once (v3 by removing a grant `ON CONFLICT` needs, v4/v5 by the `day`
domain, and finding 5 below latently). The rule that catches all three is the one the replacement
script now enforces on itself: **assert the attack is refused and the honest path still works, in
the same run, for every role that can reach the table.**

### 3. `concede` had a sender and a handler but no listener and no validator — HIGH

**Where:** `src/net/online.ts`.

`concede` is the one broadcast that **adds users to the local persisted save** — a conceding rival's
users are absorbed by the survivor. It had a sender and a store handler, but no channel listener
and no validator. It was unvalidated by virtue of being unreachable: the moment anyone wired the
listener up, an unvalidated, save-mutating message would have been live.

**Fix:** validator added (`validateConcede`) and the channel wired, so the feature works *and* the
payload is bounded before it can touch the save.
**Test:** asserts a forged concede from outside the room is refused, an absurd user count is
bounded rather than trusted, and a legitimate concede still transfers users.

### 4. The service worker's origin check was a string prefix test — MEDIUM-HIGH

**Where:** `public/sw.js`.

```js
if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return
```

`startsWith` on an origin is not an origin check. `https://example.github.io` is a prefix of
`https://example.github.io.evil.test`, so a third-party host could be pulled into the app's cache
and subsequently served *from* it.

The fix also scopes the cache to the app's own directory, which matters specifically here: on
GitHub Pages the origin `<user>.github.io` is shared with **every other project the same account
publishes**. Without a path scope, the service worker was caching for its neighbours.

**Fix:** parse the URL and compare `origin` exactly, then require the path to sit under the
worker's own scope.

### 5. Enabling social login would have blanked the leaderboard for signed-in players — MEDIUM-HIGH, latent

**Where:** `src/net/leaderboard.ts` and the RLS policies.

supabase-js derives its session storage key from the project ref alone (`sb-<ref>-auth-token`) and
`persistSession` defaults to true, so the leaderboard client and the Realtime client **share one
session**. The moment a player signed in, the leaderboard client would have started attaching that
user's JWT, PostgREST would have switched the request role from `anon` to `authenticated` — and
every policy was written `to anon`. Signed-in players would have seen an empty leaderboard and been
unable to post.

Nothing in the client had to change for this to fire. `BACKLOG.md` §1.2 is an open owner action to
switch the Google provider on; that alone would have done it. The players it would have hit are
exactly the ones engaged enough to sign in.

**Fix, deliberately at both ends so neither depends on the other:** the leaderboard client is now
built with `persistSession: false, autoRefreshToken: false, detectSessionInUrl: false` (ownership
is proved by the `x-player-secret` header, never by a session, so there is nothing to persist), and
the replacement SQL grants every policy to `authenticated` as well as `anon`.

### 6. Six SQL scripts, and the setup doc pointed at the least secure one — MEDIUM-HIGH

`supabase/` held six scripts. Four documents each named a **different** one as the one to run:

- `LEADERBOARD-SETUP.md` said `leaderboard.sql` — the v1 script, whose UPDATE policy is
  `using (true)`: **anyone may overwrite anyone's row.**
- `BACKLOG.md` said `leaderboard-secure.sql` — the one currently rejecting 100% of submissions.
- `README.md` and `docs/security-review.md` said `leaderboard-v5.sql` — never applied.
- Only a code comment pointed at `leaderboard-v6.sql`.

Six candidates and no marking is how a total leaderboard outage survived two weeks.

**Fix (`d9159ef`):** one script, `supabase/leaderboard-v6.sql`. The other five are deleted and live
in git history (`git log -- supabase/`). Every document now names that one file.

Reviewing v6 as unverified code found it could not actually stand alone, which its own header
nonetheless invited a reader to assume:

- It never created `public.daily_scores` — only `ALTER`ed it. On a fresh project every statement
  from §0 onward failed with `relation does not exist`. The table, its `(day, player_id)` unique
  constraint (load-bearing — the client's improve path is `ON CONFLICT` against exactly those
  columns) and its index are now folded in.
- The `daily_scores_sane` CHECK names `display_name` and `secret`, but the two
  `add column if not exists` statements ran **after** it. A no-op on the existing table, fatal on a
  fresh one. Reordered.

Verified before consolidating, rather than assumed: v6 is a genuine superset of v5 for §2–§7
(diffed section by section), and it drops both the old `anon can …` and the new `players can …`
policy names, so it is correct whether or not v5 was ever applied.

### 7. `normalizePlayer` truncated ids after checking them — MEDIUM

**Where:** `src/net/online.ts`.

The id was compared against the presence key and *then* truncated to 64 characters. A 71-character
key passed the check and came back as a 64-character id that was no longer its own key. Two
different keys sharing a 64-character prefix collapsed onto one `NetPlayer.id` — which defeats the
single guarantee presence offers, duplicates React keys, and (now that the broadcast roster is
built from `readPlayers()`) would put a forged id into the bid gate.

**Fix:** the id is held to the same domain as every other id on the wire (`opaqueId`: non-empty,
≤ 64 chars, no control or bidi characters, no `|`) and must then equal its key exactly.
**Test:** two over-long keys sharing a prefix cannot collapse onto one identity; a real 96-bit hex
id is accepted unchanged; an id at exactly the 64-char ceiling still works.

### 8. `sanitizeJournal` accepted a journal no honest run could produce — MEDIUM

**Where:** `src/game/replay.ts`.

`recordJournal` drops the journal the moment it passes `JOURNAL_LIMIT` (20,000), so no honest run
can persist a longer one. `sanitizeJournal` accepted **any** length — and localStorage is
user-writable. Every `advance` entry costs a full simulated week (~1.4 ms measured) and `App.tsx`
replays the whole log synchronously inside a render `useMemo`, so length converts directly into a
frozen tab: 200k entries fit inside the storage quota and cost roughly 4.5 minutes.

The writer's ceiling has to be the reader's ceiling too.

**Fix:** refuse (not truncate) past `JOURNAL_LIMIT`, matching what `recordJournal` already does
with an overflow — a truncated log would replay to a desync and read as tampering.
**Test:** a journal at exactly the writer's ceiling still loads; one entry past it is refused.

### 9. Cache-first matched `/assets/` anywhere in the URL — MEDIUM

**Where:** `public/sw.js`. `req.url.includes('/assets/')` was used to decide a response was
content-hashed and therefore immutable. A query string containing that substring was enough to pin
an arbitrary response in the cache permanently.

**Fix:** match the real asset directory on the parsed pathname, under the worker's own scope.

### 10. Legacy rows left their `player_id` unbound and squattable — MEDIUM, owner action

Rows written before the `secret` column existed have `secret is null`, so their `player_id` stayed
**unbound** while being publicly visible on the leaderboard — ids are in the board everyone reads.
A stranger could read such an id, insert a row for it, and have the trigger register the id to the
**attacker's** secret. That is the exact squat the identity binding exists to prevent, through the
one door the earlier backfill left open.

**Fix:** reserve those ids with an unmatchable hash rather than deleting the rows (deleting would
throw away a real score; the row was already unimprovable). Ships in the script the owner must run.

This strands the honest owner of such a row — so the client's recovery path was checked rather than
assumed: `isIdentityRejection()` in `src/net/leaderboard.ts` matches `registered to another
device`, which is verbatim the message the trigger raises, and mints a fresh identity. It is also
narrowly diagnosed on purpose — it deliberately does **not** rotate on a generic 42501, because an
earlier version did and threw away legitimate players' whole leaderboard history.

### 11–13. Roster bypass, bidi characters, unsanitised rows — MEDIUM to LOW-MEDIUM

- **Presence roster could be pushed past `MAX_PLAYERS`**, bypassing the room cap.
- **U+2028 and U+2029 survived the unsafe-character strip** — line separators that terminate a line
  in some parsers while looking like nothing at all.
- **Leaderboard rows rendered unsanitised for every player**, so one player's chosen company name
  was displayed to everyone with no bound on shape.

All three fixed in `c373f4e` and covered in `test/net-security.test.ts`.

### 14. No Content-Security-Policy — LOW, insurance

The string "Content-Security-Policy" did not appear anywhere in the repo. No meta tag, no header
config, no `_headers` / `netlify.toml` / `vercel.json`. The app shipped to GitHub Pages with no
policy at all.

**Severity is genuinely low, and inflating it would be dishonest:** the app has no HTML-injection
sink anywhere — no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no `new Function`, no
`srcdoc`. This is defence in depth against a sink arriving later, not a patch for a live hole.

**Fix (`3185add`):** built into `dist/index.html` by a Vite plugin. `script-src` is exactly
`'self'` — no inline, no eval, no wildcard; `object-src`, `frame-src`, `base-uri` and `form-action`
are `'none'`; `connect-src` names only the Supabase host, over https and wss.

Two constraints shaped it, both recorded as accepted risks below: delivery is `<meta>` because
GitHub Pages cannot set headers, and injection is build-only because the same `index.html` serves
`npm run dev`, which needs inline script and a localhost websocket. A CSP hard-coded into the
source HTML would have broken the dev server for every developer — this repo's signature failure
mode, committed to the one file whose job is to prevent it.

`connect-src` is derived from `SUPABASE_URL` rather than retyped, so migrating the project cannot
leave the policy naming the old host and silently severing every network call the game makes.

**Verified in a real browser, not by reading it:** served the production build and loaded it under
the policy — the app renders, styles, icons and fonts resolve, and no CSP violation appears. The
one console error (a service worker script fetch) was reproduced against a **control build with the
CSP removed** and is byte-identical in both, so it belongs to the automated browser, not the policy.

### 15. No React error boundary — LOW, availability

`main.tsx` mounted `<App />` bare, so any throw during render unmounted the whole tree and left the
player on an empty `<div id="root">`: a white screen, no message, no way back.

Two things made that worse than usual, and they compound. The service worker serves a cached shell,
so "just reload" can re-serve the same broken build indefinitely — the blank screen is durable, not
transient. And the store persists to localStorage, so a save that survives sanitisation but breaks
a render crashes identically on every reload, forever. The only escape was devtools.

**Fix (`3185add`):** a boundary offering Reload and an explicit, never-automatic "start fresh" that
clears `founder-mode-save` and `founder-mode-hall` — but deliberately **not** the score secret or
player id, since wiping those strands the player's existing leaderboard rows, a larger loss than
the crash it fixes. It renders `error.message` and **never** the stack: `safeErrorText` cuts at the
first stack frame, flattens newlines and truncates, so internal module paths cannot reach the DOM.
The full error and component stack go to `console.error` only.

**Known limit, stated rather than hidden:** store rehydration runs at module scope, *before* React
mounts, so a throw escaping it lands where this boundary cannot catch it. That path is covered from
the other side instead — see `test/save-integrity.test.ts` §2b, which pins that a corrupt save
degrades to a fresh dashboard rather than throwing.

### 16. The security test file was binary to git — LOW, review integrity

`test/net-security.test.ts` embeds the characters it defends against as literal bytes — a NUL, a
DEL, RTL overrides, zero-width joiners, U+2028/U+2029. The NUL made git classify the file as
binary, so every change to the security suite showed up in review as `Bin 19162 -> 19164 bytes` and
nothing else. A test file whose diffs are invisible is a poor place to keep the tests that prove the
controls work.

**Fix (`13a21f7`):** the 13 offending code points are escaped. Byte-identical strings at runtime,
textual diffs restored.

---

## Accepted risks

These are live, understood, and not being fixed — with the reason.

**Clickjacking is not defended, and cannot be from here.** `frame-ancestors` is ignored in `<meta>`
form by specification, and GitHub Pages serves static files with no way to set response headers. A
host that sets headers (Cloudflare Pages, Netlify) would fix it. Owner decision, not a code change.

**CSP violations are not reported, for the same reason** — `report-uri` and `report-to` are also
ignored in meta form. The policy is enforced but silent.

**`style-src` keeps `'unsafe-inline'`.** React's `style={{}}` and the update banner are CSSOM writes
that CSP does not govern, but a dependency injecting a `<style>` tag would break the interface
silently. Style injection is not a meaningful escalation route while `script-src` stays closed, and
a silently broken UI is the worse trade.

**`img-src` allows `https:` broadly.** OAuth avatars arrive as arbitrary provider metadata.
`safeAvatar()` in `src/net/auth.ts` already narrows them to https and rejects `data:`, `blob:` and
`javascript:`, so the directive mirrors a check that exists rather than replacing one.

**Multiplayer is client-authoritative and cannot be made otherwise without a server.** Each client
simulates its own company; a modified client can lie about its own numbers. The wire validators
bound what a peer can *assert* and stop one peer corrupting another's state, which is the reachable
goal. Cheating in a friends-and-family arena is architectural, and the architecture is deliberate.

**The Supabase anon key is public by design** and shipped in `src/net/config.ts`. That is how the
key is meant to work; the controls that matter are the RLS policies behind it.

**`src/screens/NewGame.tsx` renders a raw Supabase `error.message`.** React escapes it, so there is
no XSS; at worst it surfaces a policy or schema name to the user who triggered it. Low value to
change, non-zero risk of swallowing the diagnostic a player would paste into a bug report.

**Legacy null-secret rows become permanently unimprovable** once the reservation in finding 10
lands. They were already unimprovable — nothing is lost that was not already lost — and the honest
owner self-heals by minting a fresh identity.

**There is no client-side rate limiting** on leaderboard submission. Nothing in the client can fix
it; it needs the edge. Tracked as `BACKLOG.md` §1.2 and folded into the owner actions below.

---

## What only the owner can do

Everything above that is marked "Fixed" is done and needs nothing from you. This section is the
remainder — the work that needs credentials or a dashboard, which no agent here has or should have.

### A. Run the leaderboard SQL — **do this first, it is the highest-value action in the repo**

The global leaderboard has never accepted a real score. One paste fixes it.

1. Open the Supabase dashboard for the project → **SQL Editor** → **New query**.
2. Paste the **entire** contents of `supabase/leaderboard-v6.sql`.
3. Press **Run**.

It creates the table as well as securing it, so it is correct on a fresh project and on the
existing one, and it is idempotent — running it twice is harmless. **Since this section was
written, one more script exists: `supabase/leaderboard-v7-proof.sql`** — additive proof columns
(BACKLOG §3.1), run it AFTER v6, ideally in the same sitting. There is still nothing to run
*before* v6, and v6/v7 is the complete list.

It supersedes `leaderboard-v5.sql`, which **was never applied**, and you should not go looking for
it: it and the four other former scripts were deleted in `d9159ef` precisely so there is nothing to
pick wrongly. They remain in `git log -- supabase/`.

**Success looks like** a notice reading:

```
leaderboard v6 self-test passed: anon AND authenticated can submit, improve and read;
squat/overwrite/delete/lower/inflate/unknown-ending all refused
```

It also prints the challenge number it computed. **Compare that number to the "Daily #N" the game
shows.** They were verified equal at the time of writing (both **19**) — the client's
`dailyInfo()` and the file's `current_challenge()` are algebraically identical — and a mismatch
there is the exact bug that caused the outage.

**Failure looks like** an exception listing every case that came out wrong. If that happens, send
the message on rather than editing the file until it passes. The self-test's fixture rows are never
left behind either way.

**Order matters if you are also enabling social login (§B):** run this first. Before it, the
policies name `anon` only, and signing in would blank the leaderboard for the signed-in player.

### B. Decide on social login

The Google and X providers are written but not enabled; the buttons error if pressed. If you enable
them, **run §A first** — the client-side half of finding 5 has landed, but the policy half arrives
with that script.

### C. Set a Supabase spend cap, or confirm the project is on Free

There is no rate limiting anywhere in the client and nothing in the client can add it. Cost control
lives at the **organisation** level (click the org name → Billing), not in project settings — and
on the **free plan it does not exist at all**, because free projects hard-stop at quota rather than
billing, so the protection is already there.

**Done when:** either a cap and usage alert are set on a paid plan, or the project is confirmed to
be on Free and this is closed as not-applicable — to be reopened on any upgrade. Tracked as
`BACKLOG.md` §1.2.

### D. Synthetic rows in production — handled by §A, no separate action

`BACKLOG.md` §1.4 records 14 synthetic rows written into production `daily_scores` during the
2026-08-07 review. §0 of the script in §A deletes them (`SECTEST-%`, `victim-%`, `v3-%`,
`verify-bot-%`, `claude-test`, and the specific `day = 10001` rows) as its first act. Running §A
closes §1.4 too.

### E. Optional: move to a host that can set headers

Only if clickjacking protection or CSP violation reporting is wanted. Both are impossible on GitHub
Pages, as described in Accepted risks. This is a hosting decision with its own costs; the app does
not otherwise need it.

---

## Verification

**Build:** `npm run build` green (`tsc -b` type-checks `test/` too).

**Tests:** `npm test` green, exit 0.

| Suite | Before | After |
|---|---|---|
| `test/net-security.test.ts` | 34 | **54** |
| `test/save-integrity.test.ts` | — (new) | **43** |
| `test/csp.test.ts` | — (new) | **18** |
| Whole suite, assertion lines | 1511 | **1534** |

**The suite's rule, which is why findings 1 and 3 were found at all:** every case asserts the
attack is refused **and** the honest path still works, in the same run. A control that blocks
attackers and legitimate users equally has shipped in this repo three times.

**Mutation verification** — 13 mutants against `test/csp.test.ts`, each a plausible weakening
rather than a syntactic tweak. **12 killed on the first pass, 1 survivor**, recorded honestly
because it is the more interesting result:

- `MAX_ERROR_TEXT` raised from 300 to 100000 **survived**. The truncation assertion measured the
  output against the very constant that decides it, so raising the constant moved the goalposts
  along with the code. A cap is only a cap if something independent pins its size. The assertion
  now bounds the constant on both sides; re-ran the mutant, now killed. **13/13.**

Killed on the first pass: `script-src` gaining `'unsafe-inline'` or `'unsafe-eval'`; `connect-src`
losing `wss` (the Arena dying silently) or gaining an `https:` wildcard; `base-uri` weakened to
`'self'`; `form-action` removed; `object-src` weakened; `img-src` losing `blob:`/`data:` (the share
card dying); `worker-src` removed; `manifest-src` removed; `safeErrorText` returning the raw
message (the stack leak); and "start fresh" also wiping the leaderboard secret.

**Game behaviour unchanged:** `npm run bots` is byte-identical to `main`
(md5 `213d7889df0236df0535f3b642b4d0da` on both).

**Not done, deliberately:** no live Supabase call was made, nothing was deployed, and nothing was
pushed. The SQL in §A has not been executed anywhere — it cannot be, from here.
