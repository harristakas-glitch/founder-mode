# Founder Mode — security review

**Date:** 2026-08-07 · **Commit reviewed:** `fc29bbb` · **Scope:** `src/net/**`, `supabase/**`, and the
trust boundaries those two reach into (`src/store.ts`, `src/screens/**`, `src/App.tsx` read-only).

Findings are ranked by **real-world exploitability**, not by category. Where something is fine, it says
so. Two findings turned out to be the reverse of what a security review usually reports: a control that
was *too* strict and had silently disabled a whole feature in production.

Line references are to commit `fc29bbb` (the vulnerable state). Fixes are described against the files
as they now stand.

> **Superseded in part — read `security-review-2026-08.md` alongside this.** The 2026-08-19 review
> consolidated `supabase/` down to a single script, `leaderboard-v6.sql`, and deleted the other five.
> Every `**Where:**` pointer below into `leaderboard.sql`, `leaderboard-hardening.sql` or
> `leaderboard-secure.sql` is therefore archaeological: those files describe the vulnerable state and
> live only in git history now (`git log -- supabase/`). Nothing below is retracted; the fixes it
> describes all landed in what is now v6.

---

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | The leaderboard rejects 100% of real score submissions | Fixed (SQL + client) |
| 2 | **High** | A peer can hijack your sealed bid and make you pay a premium you never offered | Fixed |
| 3 | **High** | A stranger can squat your `player_id` and lock you out of a day's leaderboard forever | Fixed (SQL + client) |
| 4 | Medium | Incoming attacks are effectively unlimited | Fixed at transport; residual needs `store.ts` |
| 5 | Medium | Any peer in the lobby can start the match with settings of their choosing | **Not fixed — `store.ts`, patch below** |
| 6 | Medium | No rate limiting anywhere; anon key is public and there is no spend cap | Partially mitigated; **owner decision** |
| 7 | Medium | `owns_score_row` is a public RPC: a free bcrypt-burning endpoint | Fixed |
| 8 | Low-Med | Reconnect supervisor leaks channels and can spin | Fixed |
| 9 | Low-Med | A peer can grow the roster and the bid list without bound | Fixed |
| 10 | Low | `Math.random()` picks player ids and room codes | Fixed |
| 11 | Low | Bidi/control characters from peers reach the UI | Fixed |
| 12 | Low | Open-book intel silently never worked (correctness bug found en route) | Fixed |
| 13 | Low | OAuth avatar URL goes unvalidated into `<img src>` | Fixed |
| 14 | Info | Commitment preimage is delimiter-joined and does not bind the week | Mitigated, not re-keyed |

Verified fine, not issues: **§"What is fine"** below.

---

## 1. Critical — the leaderboard has been rejecting every real submission

**Where:** `supabase/leaderboard-secure.sql:57` (CHECK constraint) and `:137` (INSERT policy) — `day >= 10000 and day <= 40000`.

The `day` column does not hold days-since-epoch. `src/store.ts:189-193` defines
`DAILY_EPOCH = 20666` and `dailyInfo()` returns `id: Math.floor(Date.now()/86_400_000) - DAILY_EPOCH + 1`
— a **challenge counter starting at 1**. `recordRun` parses that counter back out of the run label
(`src/store.ts:176-178`) and passes it as `day`. Today's real value is **7**.

v4 required `day >= 10000`. So every genuine daily score has been refused with
`new row violates row-level security policy` since v4 shipped.

**Verified against production**, identical payloads differing only in `day`:

```
day=7      -> HTTP 401   (what the game actually sends today)
day=9999   -> HTTP 401
day=10000  -> HTTP 201
```

The table contained 0 rows before this review. This is v3's failure mode repeated: the control
blocked attackers *and* every legitimate player, and shipped because only the attack direction was
tested. It is a security finding precisely because a security control caused it.

**Fixed** in `supabase/leaderboard-v6.sql`:

- The static CHECK now bounds `day` to `1 .. 100000` (the real domain, ~270 years of headroom).
- The anti-junk value moves to a **moving window** in the INSERT policy:
  `day between private.current_challenge() - 14 and private.current_challenge() + 1`.
  Generous backwards (a daily run started days ago and finished today is legitimate), nearly closed
  forwards (a future challenge number never is). This also collapses the junk-row surface from
  ~30,000 day slots to 15.
- §1 of the file carries a **KEEP IN SYNC** warning: the constant `20665` mirrors `DAILY_EPOCH`, and
  changing one without the other reintroduces exactly this outage.

**Also fixed client-side** (`src/net/leaderboard.ts`), because the reason this ran unnoticed is that
the client swallowed every error:

- Failures are now logged (`[leaderboard] score submission rejected: 42501 …`). Still non-fatal —
  the result screen must never break — but no longer silent.
- `ending` is validated against the six accepted values and `day` against `>= 1` *before* the
  request, so a malformed row fails locally and loudly rather than as an opaque 401.
- `score` is clamped to `1e12`, matching the database ceiling. It was clamped to `1e15`, which the
  DB constraint rejects — so a run scoring above `1e12` was silently dropped rather than clamped.

---

## 2. High — a peer can hijack your sealed bid

**Where:** `src/net/online.ts:245-274` (the `commit` and `reveal` broadcast handlers).

Supabase Realtime broadcast carries **no sender identity** — the callback receives
`{type, event, payload}` and nothing more. `playerId` was therefore just a string the sender chose,
and the handler only checked `typeof p.playerId === 'string'`.

Presence has a real guarantee (`normalizePlayer:154` rejects a blob whose `id` differs from its
presence key). Broadcast had none. The exploit chains through `store.ts`:

1. Attacker broadcasts `commit` with `playerId` set to **the victim's id**, a candidate the victim is
   bidding on, and a commitment the attacker knows the nonce for.
   `store.ts:532` does `commits.filter(c => c.playerId !== p.playerId)` then appends — so this
   **replaces the victim's own commitment on the victim's own client**.
2. Attacker broadcasts a matching `reveal` with `premiumPct: 100`. `store.ts:545` verifies the hash
   against the commit it now holds — the attacker's — and it verifies.
3. The victim's client now believes the victim bid +100%. `settleHiring:357-360` pays the premium
   *the client thinks it offered*: `salary * (1 + premiumPct/100)`.

So a modified client can make a rival pay double for a hire they bid asking price on, **or** simply
nullify every rival's bid (the victim's real reveal no longer matches the substituted commitment and
is discarded at `store.ts:546`) and win every auction uncontested. It can also mint unlimited fake
`playerId`s to stuff the auction, since the one-target-per-founder rule is keyed on `playerId`.

**Fixed** in `src/net/online.ts` — validation extracted into exported, unit-testable functions
(`validateCommit`, `validateReveal`, `validateAttack`, `validateChat`, `validateEmote`) enforcing:

1. **Nobody may speak as me.** Broadcast is configured `self: false`, so a payload claiming this
   device's id is forged by construction. This is the rule that kills the damaging variant — an
   attacker can no longer touch the victim's own bid on the victim's own client.
2. **Nobody may speak as an id that is not in the room.** Claimed ids must appear in the presence
   roster, which bounds the commit/bid lists to real participants instead of unlimited sockpuppets.
   Skipped when the roster is empty (pre-first-sync) so an honest rival is never locked out.
3. Commitments must be exactly 64 lowercase hex; nonces exactly 32. Ids containing `|` are rejected
   (see finding 14).
4. A commitment string already seen under a different `(playerId, week)` is dropped — replay guard.

**Evidence:** `docs/security-tests/net-security.test.mts`, 34 assertions, all passing. Both
directions are asserted throughout, e.g. "a peer CANNOT publish a commitment under my own id" sits
next to "a REAL rival commit still goes through" and "before the first presence sync an honest rival
is not locked out".

**Residual, and it is important:** these rules stop a peer impersonating *me*. They do **not** let two
peers authenticate *each other* — presence keys are self-chosen, so a hostile client can still take a
seat under another id and cause divergence between clients' views of the auction. That is structural;
see **Owner decision 1**.

---

## 3. High — `player_id` squatting permanently locks a player out

**Where:** `supabase/leaderboard-secure.sql:127-138` (INSERT policy).

v4 let anyone INSERT under **any** `player_id`, and `(day, player_id)` is unique. Player ids are
public — they are returned by the leaderboard SELECT that every client reads
(`src/net/leaderboard.ts:94`, rendered at `src/screens/DailyLeaderboard.tsx:57`).

So: harvest ids from the leaderboard, pre-insert a row for each under a future day with your own
secret. When the real owner finishes that day's run, their upsert hits the conflict, fails the
ownership `USING` check against *your* hash, and is refused. Permanently. Meanwhile the attacker
owns a row carrying the victim's id and can set its `company` and `display_name` to anything.

**Verified against production:**

```
squatter INSERT (victim's player_id, future day)  -> HTTP 201
victim's own legitimate upsert for that day       -> HTTP 401  (USING expression)
```

**Fixed** in `supabase/leaderboard-v6.sql` §3-4: a `private.player_identity(player_id, secret_hash)`
table binds each `player_id` to the **first device that used it**, enforced inside the existing
`SECURITY DEFINER` BEFORE INSERT trigger (which is the only place that sees the plaintext secret).
A squatter cannot register an id that is already bound — and *any id visible on the leaderboard is
bound by definition*, because its owner had to submit a score to put it there. The table lives in a
schema PostgREST does not expose, has RLS on with no policies, and all client grants revoked; only
the definer trigger touches it. Existing rows are backfilled from `daily_scores.secret`, which is a
bcrypt hash of the same per-device secret and so transfers as-is.

**Also fixed client-side:** if the server reports `player_id is registered to another device`,
`submitDailyScore` mints a fresh identity (`resetPlayerId()`) and retries once, so anyone squatted
before v5 lands self-heals instead of being silently locked out forever. Guarded by `!inRoom()` —
the id is also this device's seat in a multiplayer room.

> **This recovery had a serious bug that testing caught.** My first version rotated on *any* 42501 /
> RLS refusal. The live test then showed it firing on a **legitimate score improvement**, throwing
> away a real player's identity and their leaderboard history. It now matches only the v5 trigger's
> specific message. A destructive repair needs a certain diagnosis, not a plausible one — the
> regression test for this is section B of the leaderboard suite.

**Evidence:** `docs/security-tests/leaderboard-live.test.mts`, 16 assertions against the real
project, all passing — including honest submit, honest improve, worse-score rejection, the live squat
lockout, and the simulated-v5 recovery.

---

## 4. Medium — incoming attacks were effectively unlimited

**Where:** `src/net/online.ts:275-288` and `src/store.ts:566-579`.

`store.ts:572` rate-limits incoming attacks with `` `${p.fromId ?? p.fromCompany}@${g.week}` ``.
Both fields are attacker-chosen, and `fromId` was **optional** (`AttackPayload.fromId?`) — so a
modified client got one free hit per week per value it invented, i.e. unlimited.

**Fixed at the transport:** `validateAttack` now **requires** `fromId`, requires it not to be this
device's id, requires it to be in the presence roster, and rate-limits to 4 per minute per sender /
24 globally. `fromId` is no longer optional in practice.

**Residual (needs `src/store.ts`, not mine):** a peer holding N presence keys still gets N identities.
The dedupe key should not fall back to a company name. Exact patch:

```ts
// src/store.ts:566 — onAttack
onAttack: (p: AttackPayload) => {
  if (p.targetId !== myId()) return
  if (!p.fromId) return                       // transport guarantees it; refuse the legacy path
  const g = get().game
  if (!g || g.gameOver) return
  if (!hasCapability(g, 'pvpActions')) return
- const key = `${p.fromId ?? p.fromCompany}@${g.week}`
+ // company names are attacker-chosen; only the (roster-bound) id may key the once-per-week rule
+ const key = `${p.fromId}@${g.week}`
  if (attacksTakenThisWeek.has(key)) return
```

---

## 5. Medium — any peer in the lobby can start the match — **NOT FIXED, needs `src/store.ts`**

**Where:** `src/store.ts:383-398`, `validStart`:

```ts
const host = players.find((x) => x.host)
if (host && p.hostId && p.hostId !== host.id) return null
```

Both `host` and `p.hostId` are truthiness-guarded, so the check is **skipped entirely** when the
sender simply omits `hostId`. Any peer sitting in the lobby can broadcast `start` with a sector, cap
and capability set of their choosing and drag the whole room into it. (`onStart` refuses once
`phase === 'playing'`, so this is lobby griefing, not mid-match hijacking.)

I cannot edit `src/store.ts`. Exact patch:

```ts
 const validStart = (p: StartPayload, players: NetPlayer[]) => {
   const host = players.find((x) => x.host)
-  if (host && p.hostId && p.hostId !== host.id) return null
+  // Fail closed. An omitted hostId, or a room with no host yet, is not a licence to start.
+  if (!host || !p.hostId || p.hostId !== host.id) return null
   if (!SECTORS.some((s) => s.id === p.sector)) return null
```

The transport now rate-limits `start` (4/min per claimed `hostId`, 12/min globally), so the spam
variant is contained regardless — but the authorisation hole itself is in `store.ts`.

---

## 6. Medium — no rate limiting (BACKLOG 1.1) — **partially mitigated, rest is an owner decision**

Client-side rate limiting is partial by definition: a modified client ignores anything we do on the
send side. What *is* effective is limiting on the **receive** side, because that protects the honest
player who is being flooded. That is what was added.

**Added** (`src/net/online.ts`): inbound token buckets, per sender *and* global, since `from` on a
chat or emote is just a company name a flooder varies at will — the global bucket is the one that
actually holds.

| event | per sender | global | window |
|---|---|---|---|
| chat | 6 | 24 | 10s |
| emote | 10 | 40 | 10s |
| attack | 4 | 24 | 60s |
| commit / reveal | 8 | 48 | 60s |
| start | 4 | 12 | 60s |

Tested for both directions: a flooder cycling 500 fake names gets exactly 24 messages through, and
an 8-player room where everyone sends one of each message type is never throttled. The bucket map
self-evicts above 256 keys so identity-cycling cannot grow it.

**Not fixable in any client:** anyone with the public anon key can hit PostgREST directly and insert
rows as fast as the project allows. The identity binding from finding 3 forces a fresh `player_id`
per row, which costs the attacker nothing. This needs:

- an **edge rate limit** (Supabase's built-in limits, or Cloudflare in front of the REST endpoint),
- a **spending cap and usage alerts** in the Supabase dashboard — still not set,
- optionally, requiring auth to POST a score (see Owner decision 3).

---

## 7. Medium — `owns_score_row` was a public bcrypt endpoint

**Where:** `supabase/leaderboard-secure.sql:108-116`.

The function was created in `public` and granted to `anon`. Supabase exposes `public` over REST, so
it was callable as `POST /rest/v1/rpc/owns_score_row`. **Verified in production** — it returns
`false` rather than 404.

This is not an authentication risk: the secret is 96 bits of CSPRNG output, so the oracle it offers
is useless. It is a **cost and availability** risk — roughly 25ms of server CPU per call at bcrypt
cost 8, unauthenticated, unlimited, on a project with no spend cap.

**Fixed** in v5 §2/§6: the function moves to a `private` schema that PostgREST does not expose,
`anon` keeps `USAGE` + `EXECUTE` so the policy still works, and `public.owns_score_row` is dropped
after the policies are repointed (order matters — dropping it first fails on the dependency).

---

## 8. Low-Medium — the reconnect supervisor leaked channels and could spin

**Where:** `src/net/online.ts:296-358` (`openChannel`), `:361-384` (`scheduleRejoin`), `:391-403` (`wake`).

Three distinct defects, all reachable from ordinary network flapping rather than an attacker:

1. **Leak on failed join.** `openChannel(true)` assigned `channel = ch` before subscribing, then
   rejected on timeout or error without ever removing it. `store.ts:643` catches the error and clears
   its own state, but the subscription stayed alive retrying its join forever, and `inRoom()` kept
   answering `true` for a room the player was not in. One leaked channel per failed join attempt.
2. **Leak on concurrent rejoin.** `scheduleRejoin` guarded on `rejoinTimer`, but the timer callback
   sets `rejoinTimer = null` *before* awaiting `removeChannel` and `openChannel`. Anything calling
   `scheduleRejoin` during that await — `wake()` on a visibility change, or a `CLOSED` status —
   started a second `openChannel`. Both created a channel; the second overwrote `channel`; the first
   was never removed and kept tracking presence, so the room saw a ghost copy of the player.
3. **Backoff spin.** `wake()` reset `rejoinAttempt = 0` unconditionally, so flicking between tabs
   during an outage hammered a reconnect every 800ms for as long as the outage lasted.

**Fixed:** a shared `dropChannel()` teardown used on both failure paths; a `rejoinInFlight` flag
covering the window the timer id does not; and `wake()` resetting the backoff at most once per 10s
and returning early if an attempt is already running. `leaveRoom()` also clears the rate-limit and
replay state, which is per-room.

---

## 9. Low-Medium — unbounded roster and bid-list growth

A hostile client can track thousands of presence keys on one socket. `readPlayers()` mapped all of
them, and they feed React lists (`App.tsx:381`, `Market.tsx:33`), the market-share denominator
(`store.ts:332`), and — via forged `playerId`s — the `commits`/`bids` arrays rendered by
`Hiring.tsx:23-26`. Enough of them is a memory and render DoS.

**Fixed:** `MAX_PLAYERS = 32` ceiling in `readPlayers()` (with this device's own row always kept even
if a flood pushes it past the cut), plus the roster binding from finding 2, which caps the commit and
bid lists at the roster size, plus the rate limits from finding 6.

---

## 10. Low — `Math.random()` chose player ids and room codes

`myId()` used `Math.random().toString(36) + Date.now().toString(36)`; `makeRoomCode()` used
`Math.random()` for all five characters. `Math.random` is not a CSPRNG and its output is
predictable from other draws — and room codes are the *only* thing gating entry to a private match.

**Fixed:** both use `crypto.getRandomValues`. Player ids are now 96 bits of hex; room codes draw from
the CSPRNG with the modulo-bias check made explicit. This closes *prediction*; it does not close
brute force — see Owner decision 4.

---

## 11. Low — bidi and control characters from peers reached the UI

`str()` did `typeof v === 'string' ? v.slice(0, max) : fallback` and nothing else. React escapes
HTML, so this was never XSS — but a company name or chat message containing U+202E (RTL override)
reverses every line it lands in, and newlines break single-line labels. Company names appear
throughout the market table and leaderboard.

**Fixed:** `str()` strips C0/C1 controls, zero-width padding, and the bidi override/isolate range,
*then* applies the length cap (so padding cannot be used to truncate the visible text). U+200D is
deliberately preserved — emoji families are built from it, and the emote payload carries emoji.
Tested in both directions: `Acme<U+202E>Inc` → `AcmeInc`, and a ZWJ emoji family survives intact.

---

## 12. Low — open-book intel silently never worked

Not a vulnerability; found while auditing the coercion boundary. `NetPlayer` declares `cash`, `rev`
and `pmf` as open-book intel, `store.ts:324-326` sends them, and `Market.tsx:43-45` reads them — but
`normalizePlayer` never copied them out of the raw presence blob, so every rival's cash/revenue/PMF
column rendered as `—` for every match. **Fixed**, with bounds applied like everything else a peer
sends (`cash` ±1e12, `rev` 0..1e12, `pmf` 0..100).

---

## 13. Low — OAuth avatar URL unvalidated

`src/net/auth.ts:24` took `avatar_url` / `picture` straight from provider metadata into
`<img src={authUser.avatar}>` (`src/screens/NewGame.tsx:198`). Low risk — it is your own provider
metadata, affecting only your own client, and `referrerPolicy="no-referrer"` was already set — but it
was accepting anything, including `data:` payloads and plain `http:` that would downgrade the
connection. **Fixed:** `https:` absolute URLs under 512 chars only, else `null`.

---

## 14. Info — commitment preimage shape

`hiringCommitment` hashes `` `${candidateId}|${premiumPct}|${nonce}|${playerId}` ``. Two properties
are imperfect:

- **Delimiter injection.** A `candidateId` containing `|` could make one commitment parse two ways.
  Not exploitable — candidate ids are game-generated, and a forged one is discarded at settlement
  because `settleHiring:352` looks it up in `game.candidates`.
- **The week is not bound.** The same commitment replayed into a later round would still verify.

I did **not** re-key the hash. Changing the preimage means every client must upgrade simultaneously
or live auctions break between versions — a real availability cost for an attack with no practical
payoff. Instead: `opaqueId()` rejects any id containing `|`, and a seen-commitment map rejects a
commitment reused under a different `(playerId, week)`. Both are transport-level and cost nothing in
compatibility.

If the auction ever becomes competitively meaningful, the correct preimage is length-prefixed and
week-bound, rolled out behind a version field:

```ts
const parts = [candidateId, String(premiumPct), nonce, playerId, String(week)]
const data = new TextEncoder().encode(parts.map((p) => `${p.length}:${p}`).join(''))
```

---

## What is fine

Stated plainly, because a review that inflates severity is worse than useless.

- **XSS: clean.** No `dangerouslySetInnerHTML`, no `eval`, no `new Function`, no `srcdoc` anywhere in
  `src/`. React escapes by default and no peer string reaches a URL. The social share links
  (`App.tsx:652-657`) are fixed hosts with `encodeURIComponent` on the query, opened with `noopener`.
- **No secrets in the repo.** No `service_role` key, no JWT, nothing but the publishable anon key —
  which is public by design and correctly so.
- **The v4 ownership model is sound.** Verified live: a stranger cannot overwrite a row
  (`PATCH` → 0 rows), cannot upsert over one (401 USING), and cannot lower a score. The bcrypt
  approach was the right call and v5 keeps it unchanged.
- **`anon` cannot delete anything.** Verified live: a `DELETE` over an entire day, and a table-wide
  wipe attempt, both removed 0 rows. PostgREST answers 204/200 with an empty body even when RLS
  matched nothing, so the *status code* proves nothing here — only the row count does.
- **Presence self-consistency is correct.** `normalizePlayer` rejecting a blob whose `id` differs from
  its presence key is the right check and it works; it is simply not an *authentication* check.
- **The catch-up loop is bounded.** `CATCH_UP_LIMIT` and the match cap mean a peer advertising an
  absurd week cannot make us simulate unboundedly.
- **`StartPayload.deadline` is ignored.** The store computes its own from `ROUND_SECONDS`, so a
  hostile deadline cannot forfeit anyone's turn.
- **`advancing` is released in `finally`.** The latched-forever failure mode is already handled.

---

## Owner decisions — structurally unfixable in the client

### 1. There is no peer authentication in the room, and there cannot be one client-side

This is the root cause behind finding 2 and its residual. Supabase Realtime broadcast carries no
sender identity, and presence keys are chosen by the client — a modified client can subscribe under
another player's id. Everything added here is *self-defence* (nobody may speak as me, claimed ids must
be in the room); none of it lets two peers authenticate each other. Three options, in increasing order
of cost:

1. **Self-certifying ids.** Generate an ECDSA/Ed25519 keypair per device; make the player id the
   public key (or its hash); sign every broadcast; verify against the id the payload claims. Fully
   client-side and genuinely sound — an attacker can mint new identities but cannot impersonate an
   existing one. Costs: `myId()` must become async or block on key generation at startup (it is
   called synchronously from render at `App.tsx:183`), and every client must upgrade together.
2. **Supabase Realtime Authorization** with authenticated users, so the server enforces who may join
   a topic and what they may send. Requires mandatory login for multiplayer.
3. **An authoritative server** for the room. Correct, and much more than this game needs today.

My recommendation: option 1 if the sealed-bid auction matters competitively; otherwise accept it and
keep the self-defence rules. Multiplayer is a small-group game played with people you shared a code
with, and the remaining attacks cause divergence rather than theft.

### 2. Scores are not verified and cannot be

Nothing simulates the game server-side, so a player can submit a plausible but cheated score **for
themselves**. RLS cannot fix this at any level of cleverness. Closing it needs server-side simulation
or replay validation. Accept, or scope the leaderboard's meaning accordingly.

### 3. `display_name` is self-asserted

A signed-out player can put someone else's handle on their **own** row. Fix is to require login to
post a score and take the name from `auth.uid()` rather than the payload.

### 4. Room codes are enumerable

5 characters from a 32-symbol alphabet = ~33.5M codes. Prediction is now closed (finding 10) but
scanning for live rooms is feasible for a determined attacker. If private matches should stay private,
go to 8 characters (~1.1e12) — a one-line change to `makeRoomCode`, at the cost of a code that is
less pleasant to read aloud.

### 5. Set a Supabase spend cap

Still not set. With a public anon key and no rate limiting, the realistic worst case is a bill, not a
breach. This is the single highest-value five-minute action on this list.

---

## Verification

Two suites, both run, both asserting the attack is blocked **and** the legitimate path still works.

```
npx tsx docs/security-tests/net-security.test.mts        # 34 assertions — transport, offline
npx tsx docs/security-tests/leaderboard-live.test.mts     # 16 assertions — hits the real project
npm run build                                             # passes
npm test                                                  # passes
```

The live suite writes rows tagged `SECTEST-*` on day 10001; `leaderboard-v6.sql` §0 removes them.

**These suites are not wired into `npm test`** — `test/` and `package.json` are outside my file
ownership. To land them, move the two files into `test/` and extend the script:

```diff
-"test": "npx tsx test/modes.test.ts && … && npx tsx test/world-director.test.ts",
+"test": "npx tsx test/modes.test.ts && … && npx tsx test/world-director.test.ts && npx tsx test/net-security.test.ts",
```

Keep the live leaderboard suite **out** of the default run — it writes to production. It belongs
behind a separate script (`"test:live"`).

## Deployment order

1. Run `supabase/leaderboard-v6.sql` in the Supabase SQL editor. It is idempotent and **self-testing**:
   §8 runs the whole attack matrix against the policies it just created — honest insert, honest
   improve, score-lowering, stranger overwrite, stranger delete, squatting, new-player registration,
   the day window, and value bounds — and raises with a list of failures if any case comes out wrong.
   A successful run prints `leaderboard v5 self-test passed`.
   **I could not execute this myself** — the only credential available is the public anon key, and
   there is no local Postgres or Docker in this environment. The bug it fixes was verified live; the
   fix itself is verified by construction and by that embedded self-test.
2. Deploy the client. Findings 1, 3 and 5's mitigations expect v5 to be in place.
3. Apply the `store.ts` patches from findings 4 and 5.
4. Set the Supabase spending cap.
