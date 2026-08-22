# Founder Mode — security backlog

The standing list of security work: what is fixed, what is open, what only the owner can do, and
what has been investigated and deliberately accepted. **This file is maintained** — findings are
added when they are found and closed in place with the commit that fixed them, so the record of
what was believed at the time stays readable.

Every item says what it is, why it is still open, and what "done" looks like — enough to pick up
cold. Sibling of `BACKLOG.md` (features and balance); anything here that is not a security
question belongs there instead.

**Sources so far**
- 2026-08-07 security review — `docs/security-review.md`
- 2026-08-19 security review — `docs/security-review-2026-08.md`
- **2026-08-22 hostile audit** — 28 agents across five attacker lenses (secret exposure, RLS /
  PostgREST, the Realtime wire, credit-drain economics, account takeover), every finding
  independently re-verified against production before being believed. Four claims were refuted on
  verification and are recorded in §5 so they are not re-raised.

---

## 0. The threat model, stated once

This is a **free browser game with no authoritative server**. The publishable Supabase key ships
in the client by design, so the security boundary is **the RLS policies and the wire validators**,
never the secrecy of that key. Three consequences worth internalising before reading anything
below:

1. **Peers cannot be authenticated.** Anything a client asserts about itself — score, users,
   company name — is a claim, not a fact. The defence is bounding the damage a lie can do, not
   preventing the lie.
2. **Nothing client-side can rate-limit inbound requests.** Every quota/cost item below needs the
   edge (Supabase platform limits, a spend cap, or a proxy). No amount of TypeScript closes them.
3. **The prize is small.** There is no money, no PII beyond a chosen nickname, and no credential
   in the system. Rank findings by cost and availability impact, not by drama.

**What is NOT at risk, verified 2026-08-22 and re-checkable in minutes:** no secret, credential,
or account-access path exists in the repo, its complete git history, or the deployed bundle.
See §1.

---

## 1. Verified clean — do not re-litigate without new evidence

Recorded so future audits start here instead of re-deriving it. Re-verify if the deployment
changes shape (new provider, new host, new key).

| Surface | Method | Result |
|---|---|---|
| Working tree | pattern sweep for service-role keys, JWTs, `GOCSPX-`, private keys, `gh*_`/`phx_`/AWS tokens | clean |
| **Full git history** | same sweep over **every blob in `git rev-list --all`** | clean |
| Deployed `dist/` bundle | same sweep | clean |
| Source maps | fetched `*.js.map` from the live site | all 404 — not served |
| `.env` | tracked-status + history check | never committed; holds only the PostHog ingest key |
| `auth.users` via PostgREST | live probe with the public key | not exposed (PGRST205) |
| `private.player_identity` (bcrypt hashes) | live probe | not exposed |
| Schema introspection | `GET /rest/v1/` with the public key | empty definitions |
| Anon write paths | live `DELETE` on `daily_scores`, `INSERT` on `profiles` | 401 / 42501 |
| **OAuth session theft** | live probes against production Auth | **refuted — see §5.1** |

The two public keys are the publish-safe kind: `sb_publishable_…` (bounded by RLS) and the
PostHog `phc_…` **write-only ingest** key (cannot read analytics, cannot reach the account).

---

## 2. Owner actions — ranked. Nothing in the codebase can do these.

### 2.1 Confirm the project is on Free, or set a spend cap — **highest value**
Two unauthenticated flood vectors exist (§3.1, §3.2) and **no client can rate-limit them**. On the
free plan they hard-stop at quota: an outage, self-healing at the quota window. On a paid plan
with no cap they are a **bill**. This single fact decides the severity of half this file.

Cost control lives at the **organisation** level (click the org name → Billing), not in project
settings, and on Free it does not exist at all — free projects hard-stop rather than bill, so the
protection is already there.

**Done when:** either (a) the project is confirmed on Free — close as not-applicable, and
**reopen on any upgrade, because that is the moment the exposure becomes real**; or (b) a cap and
usage alert exist on a paid plan.

### 2.2 Disable the Email auth provider — pure removal, no downside
`GET /auth/v1/settings` reports `"email": true`, `"disable_signup": false`, `"mailer_autoconfirm":
false`. The app **only ever calls `signInWithOAuth('google'|'twitter')`** (`src/net/auth.ts`) — it
has no email, password, or magic-link UI anywhere — so the email endpoints are pure attack
surface. With the public key anyone can `POST /auth/v1/signup` or `/auth/v1/otp` and make the
project send mail to an arbitrary address: email-bomb a victim from your sender, exhaust the
default SMTP throttle so legitimate mail breaks, or fill `auth.users` with unconfirmed junk (each
of which now also mints a `profiles` row via the signup trigger).

**Done when:** Supabase → Authentication → Providers → **Email disabled**, Google (and X if
enabled) left on. Note `disable_signup` must stay `false` — OAuth onboarding needs it.

### 2.3 Clear the real name from the legacy leaderboard row — **still open**
`daily_scores` day 22 carries `display_name: "Harris Takas"`, world-readable with the public key.
It predates the nickname system and defeats the privacy design that system exists to provide.
The client can no longer produce this (nicknames only, since `d08ede0`), and no client may DELETE.

**Done when:** Supabase → Table Editor → `daily_scores` → null that `display_name` (and delete the
leftover `company: "test"` row with the billion-point score while there).

### 2.4 PostHog: set a billing/event cap
The `phc_` ingest key is public by necessity. Anyone can POST unlimited events to the capture
endpoint: exhaust the ~1M/month free tier so real analytics go blind, or **poison the dataset** so
every retention and funnel number the feature was built for is worthless. The consent and
anonymity machinery in `src/analytics/*` governs our own client only — it does nothing here.

**Done when:** a project-level event cap / billing limit is set in PostHog, and someone knows to
distrust the numbers if a spike appears. Rotating the key is a redeploy and does not fix it.

---

## 3. Open — code or architecture, not yet done

### 3.1 Unauthenticated leaderboard INSERT flood — **high**, needs the edge
`supabase/leaderboard-v6.sql` grants INSERT to `anon` with value-bound checks only; the key is
public; there is no rate limit. Each insert runs **bcrypt (cost 8) server-side** — twice, for a
fresh `player_id` — and inserts a `private.player_identity` row, and since `leaderboard-v7-proof.sql`
shipped, may carry a **journal blob up to ~256 KB**. A fresh random `player_id` per request defeats
every uniqueness ceiling.

**Impact:** ~2,000 requests fills the 500 MB free-tier database, after which **all** leaderboard
writes fail; no client can DELETE, so cleanup is manual. Sustained flooding burns shared CPU via
bcrypt and egress. The SQL file's own §10 already concedes this is unfixable in-repo.

**Options, none of them TypeScript:** a proxy in front of `/rest/v1` (Cloudflare) with a rate
limit; Supabase platform limits; or moving submission behind an edge function that can throttle.
A cheap partial mitigation is lowering the journal cap (measured proofs run 5–40 KB), which cuts
storage-per-request ~4× — **but tightening it risks rejecting a genuinely long run's proof, which
is exactly the failure mode this repo has shipped three times.** Measure the real distribution
before touching it.

**Done when:** a rate limit exists at the edge, or §2.1 is closed as "Free, hard-stops" and this is
accepted as an availability risk with a documented manual-cleanup procedure.

### 3.2 Realtime connection / message flood — **high**, needs the edge
Channels are created as `client.channel('fm-room-<code>')` with **no `config.private`**
(`src/net/online.ts`), so Supabase enforces no Realtime Authorization: the public key alone opens
connections and sends broadcasts. Verified live — join, presence track and broadcast all returned
`ok` on a random room. The client's `eventsPerSecond: 5` is a hint our own client honours and an
attacker ignores.

**Impact:** free tier — concurrent-connection and ~2M-message quotas exhaust, so multiplayer stops
working for everyone until the window resets. Paid — real money.

**Structural fix:** Realtime Authorization (private channels + RLS on `realtime.messages`), which
requires every player to be authenticated — currently in tension with anonymous play being a core
feature. Revisit when the Arena lobby ships, since a public lobby raises the same question.

**Done when:** either private channels are adopted (and anonymous play's fate decided), or §2.1
closes this as an accepted free-tier availability risk.

### 3.3 Lobby match-hijack — a non-host peer can force-start the match — **low**
`validStart` (`src/store.ts`) treats `players.find(x => x.host)` as authoritative, and
`readPlayers` sorts host-first then **company name ascending**. A peer that tracks presence with
`host: true` and a name sorting before the real host (`"AAAA"`) becomes the entry `find()` returns
even while the genuine host is present; its `start` broadcast then replaces every peer's local game
with an attacker-chosen seed, sector and capabilities.

Bounded: only during the lobby phase, and every field is whitelisted and clamped. Worst case is
griefing or fishing for a favourable seed.

**Done when:** the host is resolved **deterministically** among host-claimants (e.g. lowest id)
rather than by a sort order an attacker can bias, with a test asserting a second `host: true`
claimant cannot displace the real host whatever name it picks.

### 3.4 Room enumeration and open-book intel — **low**
5-char codes over a 32-symbol alphabet (~33.5M) are the only gate. `makeRoomCode` closed
*prediction* (CSPRNG) but not *enumeration*, and joining needs no approval, has no capacity check
and no expiry. A scanner can find live rooms and read every present player's presence data —
company, users, valuation, payout, cash, revenue, PMF.

Game state only: no PII, no credentials, no account access.

**Done when:** codes widen to 8 characters (a one-line change, and the natural moment is the lobby
work, since a public lobby changes the discovery model anyway), or private channels land per §3.2.

### 3.5 Peer numbers are still self-reported — **accepted, tracked**
Presence values (`users`, `val`, `payout`) are claims. `BACKLOG.md` §3.3 has always said so. The
2026-08-22 fixes (see §4.2) bounded the *damage* a lie can do; they do not make peers honest.
Unfixable without an authoritative server, and fine for a friendly game.

**Reopen if** Arena ever becomes ranked or carries a reward, because that is when lying pays.

### 3.6 Leaderboard scores are client-asserted — **half solved, tracked in BACKLOG §3.1**
A fabricated score cannot produce a journal that replays to it, and `leaderboard-v7-proof.sql`
shipped the columns, so every row is now **auditable by any reader**. What is missing is a reader
that rejects unverifiable rows. Tracked in `BACKLOG.md` §3.1/§3.2; listed here so the security
picture is complete in one place.

---

## 4. Fixed — closed in place, with the commit

### 4.1 `.claude/settings.local.json` was tracked in a public repo — FIXED `2d2d81a`
The `*.local` ignore rule does not match `settings.local.json` (the glob needs the extension), so
every allowlisted command — including the owner's macOS username and absolute home paths — was
public. **No credentials were ever in it.** Untracked with `git rm --cached` (the file survives on
disk, so local permissions keep working) and the ignore rule now names it explicitly with the
reason.

**Residual, accepted:** it remains in git history. Not worth a force-push rewrite of a public repo
for non-credential data. Revisit only if something sensitive is ever found in an old commit.

### 4.2 One presence write could collapse every other player's economy — FIXED `dd3584b`
Presence is not rate-limited, so a peer tracking `users: 1e10` — inside the wire's `MAX_USERS`
clamp and **166× the largest sector's TAM** — landed whole in the sum feeding `marketSaturation`.
Growth room is `(1 − saturation)^1.2`, so one presence write throttled every other founder's
acquisition and revenue to ~zero for the rest of the match, and each victim's own client persisted
the wrecked weeks to their save.

Each peer is now capped at `effectiveTam` on entry to that sum: a company cannot hold more of a
market than the market contains. It cannot block legitimate play — the simulation's own `room`
term stops real players far below the ceiling.

### 4.3 The concede flood bucket was keyed on sender-chosen free text — FIXED `dd3584b`
`concede` is the one broadcast that **adds users to the recipient's persisted save**, and its
rate-limit key was `fromCompany` — free text, so unbounded bucket cardinality: rotating it minted
a fresh allowance per message, leaving only the global cap. Now keyed on the **recipient**
(`to:<targetId>`, cardinality bounded by the presence roster), which bounds the quantity that
matters: how much can be aimed at one player. Allowance 2 → 4 so genuine four-player play is not
caught.

Asserted both ways in one run, per the rule §6 records: a forger rotating 500 company names gets
4 messages through, **and** three legitimately-conceded-to players in a round are all served.

### 4.4 Everything closed by earlier reviews
`validateAttack` dropping two of five attacks, the unvalidated `concede`, the service-worker origin
prefix test, `normalizePlayer` truncating ids after checking them, the unbounded `sanitizeJournal`,
the leaderboard policy that rejected 100% of real submissions, unsanitised leaderboard rendering,
the missing CSP and error boundary. Detail in `docs/security-review-2026-08.md`.

---

## 5. Investigated and REFUTED — do not re-raise without new evidence

Recorded because each of these is a plausible-sounding claim that a future audit will generate
again. Each was checked against production and found not to hold.

### 5.1 "The OAuth redirect allowlist is open — one link steals any signed-in session"
Raised as **high / account takeover**, the single scariest claim in the audit. Verified against
the production Auth endpoints: **the chain breaks at exactly the step the claim depends on.**
Google OAuth being enabled is true and harmless. **No account-takeover path exists.**

### 5.2 "The bcrypt secret hashes are world-readable"
Factually true and reproducible — `GET /rest/v1/daily_scores?select=secret` returns them. Not
exploitable: they are **bcrypt hashes**, which is the entire point of storing a hash rather than
the secret, and a leaked hash grants nothing. Dismissed as by-design.

*Documentation debt worth fixing when someone is nearby:* a code comment claims the column is
unreadable. It is readable and safe; the comment should say so rather than implying a control that
is not there.

### 5.3 "Anonymous REST reads are unbounded — egress burn"
True and inherent to a public read API. The auditor themselves rated it not worth a dedicated
control; the tables are tiny and the read path is the product working. Folded into §2.1.

### 5.4 "Email signup enables account-creation abuse" — *partially* refuted
One verifier could not make the impact hold end to end and downgraded it to a hardening note;
another confirmed the endpoint is open and can send mail. Kept as §2.2 because **disabling an
unused provider is free**, and a control that costs nothing does not need a proven exploit.

---

## 6. Rules this project keeps re-learning

Written down because each was paid for.

1. **Assert the attack is refused AND the honest path still works — in the same run, for every
   role that can reach the surface.** The leaderboard policy blocked every real player three times
   before this rule was adopted. Both 2026-08-22 fixes ship with both halves asserted.
2. **A control keyed on attacker-controlled text is not a control.** Bucket cardinality must be
   bounded by something the attacker does not choose (§4.3).
3. **Clamp to a number that means something.** `MAX_USERS = 1e10` passed every validator and was
   still 166× the largest market. A limit nobody can reach is not a limit (§4.2).
4. **Verify the claim, not the vibe.** Four confident findings in this audit were wrong (§5). Probe
   production before believing — and before fixing.
5. **A public key is not a finding.** "Public key + missing policy lets anyone read X" is.
