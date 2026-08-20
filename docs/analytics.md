# Founder Mode — product analytics

**Added:** 2026-08-20 · **Status:** implemented, **switched off**, one line away from being on.
**Code:** `src/analytics/` · **Tests:** `test/analytics.test.ts`, `test/csp.test.ts`
**Server side:** `supabase/run-journals-v1.sql`

---

## The one thing to know first

**Nothing is being collected right now.** `src/analytics/config.ts` ships a placeholder key, so the
whole layer is inert: no network call, no storage write, no consent prompt, and `posthog-js` is
never even downloaded — the dynamic import is not reached. `test/analytics.test.ts` §1 asserts that
with real traps on `fetch`, `XMLHttpRequest`, `sendBeacon` and `Image`, all of which must read zero
after every event in the module has been fired.

To switch it on, see [Switching it on](#switching-it-on). It is one string.

---

## The four questions, and what answers each

The owner asked four things. Every event exists to answer one of them; nothing is collected that
does not appear in this table.

| # | Question | Event(s) | How to read it |
|---|---|---|---|
| 1 | **Visitors** — how many people arrive, from where | `app_opened` | Count of the event = arrivals. PostHog attaches `$referrer`, `$referring_domain` and UTM parameters by itself. |
| 2 | **Games played** — runs started and finished, by mode/sector | `run_started`, `run_ended`, `run_abandoned` | Break down by `mode`, `format`, `sector`. `run_ended.ending` is which ending. |
| 3 | **Playing time** — engagement | `run_progress` (heartbeat), `run_suspended` | **In weeks advanced, not minutes.** See below. |
| 4 | **Retention** — do they come back | `app_opened`, `run_started` | Needs consent (a persistent id). Without it, `runs_started_before` / `runs_finished_before` on those events are an honest proxy. |

### Why weeks and not minutes

This is a turn-based game. A tab left open over lunch is an hour of "session duration" and zero
play; a founder who advances forty weeks in twenty minutes was gripped. PostHog records wall-clock
session length on its own and is welcome to — but `week` is on every progress, suspend, abandon and
end event, so no analysis ever has to reach for the dishonest number.

### Why abandonment is instrumented harder than completion

**Most players will never reach an ending.** If the only signal were `run_ended`, every chart would
describe the survivors and the game would look far more engaging than it is.

So `run_progress` is a heartbeat: weeks 1, 2, 3, 4, 5, then every fifth week. Dense where players
actually quit, thin where it would only burn quota — 22 events for a full 90-week run. **The last
heartbeat a player sends is where they stopped**, whether or not they ever come back to say so. It
carries the `screen` they were on, which is the design signal: "they gave up on Fundraising in week
6" is actionable in a way that "they gave up" is not.

`run_suspended` fires on `pagehide` / tab-hidden, by `sendBeacon`, because closing the tab is how
most runs really end.

---

## The complete event list

Twelve events. One named function per event in `src/analytics/events.ts` — there is no
`track('some string')` anywhere in this codebase, so this list and that file cannot drift apart.

| Event | Fires when | Carries | Question |
|---|---|---|---|
| `app_opened` | once per page load | `first_open`, `standalone`, `runs_started_before`, `runs_finished_before` | Q1, Q4 |
| `run_started` | a new company is founded | run properties, `founder`, `first_run`, `runs_finished_before` | Q2, Q4, "what do beginners pick" |
| `run_progress` | weeks 1–5, then every 5th | run properties incl. `week`, `screen`, `stage`, `users`, `cash`, `pmf` | Q3, **abandonment** |
| `run_suspended` | tab hidden / page unloading, run still live | run properties, `trigger` | Q3, **abandonment** |
| `run_abandoned` | Abandon button, or a new run over an unfinished one | run properties, `weeks`, `reason` | Q2, **abandonment** |
| `run_ended` | a run reaches an ending | run properties, `ending`, `weeks`, `score`, `verified` | Q2 |
| `screen_opened` | first visit to a screen, per run | run properties, `screen` | Does anyone find Discovery / Cohorts? |
| `feature_used` | first use of a system, per run | run properties, `feature` | Does anyone pivot / experiment / tokenise / raise / IPO / take debt / acquire / open the guide? |
| `note_seen` | an onboarding note was delivered | run properties, `concept` | Are the founder's notes read? |
| `notes_toggled` | the notes switch moves in the Field Guide | `notes_enabled` | Are they switched off? |
| `analytics_consent_set` | the player says **yes** | `consent: 'granted'` | ops |
| `run_journal_uploaded` | a journal upload lands or fails | `reason`, `entries`, `bytes`, `ok` | ops — so an empty table can be diagnosed |

"Run properties" throughout: `mode`, `format`, `sector`, `scenario`, `career`, `week`, `screen`,
`stage`, `employees`, `users`, `cash`, `revenue`, `pmf`, `pivots`, `tokenised`.

**Only the grant is reported, never the refusal.** Sending an event about somebody who has just
declined analytics would be collecting data about the person who said no.

---

## What is NOT collected

- **The company name.** The one string the player authors, and it never leaves the browser — not on
  an event, not in an uploaded run journal (where it is replaced with `redacted`).
- **Anything else typed:** the multiplayer chat box, the room code, the Field Guide's search field.
- **The OAuth display name or avatar**, for players who sign in for the leaderboard.
- **The leaderboard's `founder-mode-player-id` or `founder-mode-score-secret`.** They exist because
  a player opted into a leaderboard. Using them to key analytics would silently repurpose an
  identifier agreed to for something else — which is exactly the move that makes a privacy claim
  untrue. PostHog mints its own id, and the two never meet.
- **Autocapture.** `autocapture: false`. No clicks, no keystrokes, no form-field targets. This is a
  game, not a form-based app: autocapture would be noise, quota, and the one mechanism that could
  carry a typed company name out of the browser without anybody deciding it should.
- **Session recording, surveys, heatmaps, web vitals, feature flags** — all off, and the bundled
  build (`posthog-js/dist/module.slim.no-external`) does not contain the code for most of them.
- **Query strings and URL fragments.** Stripped from `$current_url` and `$referrer` before sending;
  the referring *domain* is all question 1 needs.

### How that is enforced, rather than promised

Two independent controls, neither of which needs the other to be correct:

1. **A positive allowlist of property names** (`src/analytics/props.ts`) applied to every event on
   the way out. `company`, `companyName`, `name`, `display_name`, `message`, `code`, `query` are not
   on it. Adding one is a visible diff in one list in one file.
2. **A shape check on every string value.** A property value must look like an identifier — short,
   no spaces, punctuation limited to `_.:+-`. "Hyperloop for Cats, Inc." fails on the space alone.

`test/analytics.test.ts` §3 fires the company name at a real event under thirteen different
property names and asserts none survives, then spreads an entire `GameState` into one and asserts
only allowlisted scalars come out.

---

## The consent model

Three states. The record lives under its **own** localStorage key, `fm-analytics-consent-v1`, never
inside the game save — clearing your game does not silently re-consent you, and a corrupt or absent
record reads as the *most private* state, never as consent.

| State | What happens | Persistent id? | Journal upload? |
|---|---|---|---|
| **`unset`** (default) | Events are sent **anonymously**: `persistence: 'memory'`, `person_profiles: 'never'`. Nothing is written to the device; the id PostHog generates dies with the tab. | No | No |
| **`granted`** | Persistence moves to localStorage+cookie and person profiles come on. | Yes — a random one, never the leaderboard's | Yes |
| **`denied`** | Nothing at all. `capture()` returns before a client is constructed. | No | No |

### Why anonymous-by-default, and not silence-by-default

This is the design decision worth arguing about, so here is the argument.

Retention is the only one of the four questions that needs a persistent identifier, and in the EU
storing an identifier for analytics generally needs consent. Sending anonymous events that store
nothing on the device does not — there is no terminal-equipment access to consent to.

If the default were silence, the consent prompt would be the only source of data, and the prompt is
only shown to somebody who has **finished a run**. Everyone who abandons in week 3 — the most
important population in the whole dataset, and the reason `run_progress` exists — would be invisible
by construction. The layer would measure survivors and report that the game is more engaging than it
is. That is the exact failure the instrumentation was built to avoid, so the default collects, and
collects without an identifier.

The honest cost, stated: in anonymous mode PostHog's "unique users" counts **app opens**, not
people. Treat that number as arrivals, not humans.

### When the player is asked

**Once, ever, after their first finished run.** Not on arrival: a banner at the door is a toll on a
game nobody has played yet, it is answered by reflex, and it teaches players to dismiss the
interface. Somebody who has just finished a run knows what they are being asked about.

Closing the prompt without answering counts as an answer — it means "stop asking me" — so it never
returns. Anyone who changes their mind uses the Field Guide.

### How a player opts out

**Field Guide → footer → "Play data".** Two checkboxes, matching the three states above:

- **Anonymous play data — on/off.** Unticking it sets `denied` and **stops collection in the same
  tick**: `analyticsActive()` is consulted on every capture, so the next event is refused before a
  client is even constructed, and the stored id is cleared and the SDK opted out behind it. There is
  no "takes effect on next reload".
- **Remember this browser.** Ticking it grants; unticking returns to anonymous.

The row renders nothing at all while the key is a placeholder — a privacy control for a system that
collects nothing is worse than no control, because it implies collection is happening.

`respect_dnt: true` is also set, so a browser that already sends Do-Not-Track is honoured without
being asked a question it has answered.

**Known limitation:** the Field Guide is only reachable during a run, so the switch is not available
on the start screen. Consent can only ever be *granted* after a finished run, so nobody can be stuck
"remembered" without a way back — but a player who wants to disable even the anonymous mode has to
start a run to do it. Worth moving if anybody asks.

---

## The run-journal upload

The part no vendor can give us. The game is deterministic, and `src/game/replay.ts` records a
complete, replayable action journal for every solo run — about 4 KB for a 90 weeks. Uploading
finished and abandoned runs means **any** metric can be computed retroactively, including questions
nobody has thought of yet, without having instrumented them in advance.

- **Behind the same consent gate.** Granted only.
- **Goes to the existing Supabase project**, so `connect-src` needed no further change.
- **Table:** `public.run_journals`, created by `supabase/run-journals-v1.sql`.
- **The company name is replaced with `redacted`** before upload — and the redacted header replays
  to the *same fingerprint* as the run it came from, which a test asserts. If the name ever starts
  feeding an outcome, that test goes red rather than every uploaded journal quietly ceasing to
  reproduce its own run.
- **Insert-only for `anon` and `authenticated`**, with a **column-level** grant: no select, no
  update, no delete, and a client cannot name `id` or `created_at` (so it cannot backdate a row).
- **Bounded on both axes**: 20,000 entries (`JOURNAL_LIMIT`, the client's own constant, reused
  rather than re-invented) and 256 KB. Over either, the payload is **dropped, never truncated** — a
  truncated journal replays to a desync and would read as tampering.
- Reading it: `select * from private.run_journal_summary limit 50;` in the SQL editor.

Nothing prunes old rows. At 4 KB a run this is small for a long time, but it is not self-limiting;
the script's §7 has the `delete … where created_at < now() - interval '180 days'` when it stops
being small.

---

## Content-Security-Policy

`src/csp.ts` ships `script-src 'self'` and `test/csp.test.ts` fails the build if that widens. **It
did not widen.**

The usual PostHog install is a snippet that pulls the SDK from a vendor CDN, and the usual "fix" is
to add that CDN to `script-src` — at which point the directive is decoration. Here `posthog-js` is
an npm dependency bundled into our own JS by Vite, and specifically the **`no-external`** build,
which contains no script-injection path at all (`createElement('script')` does not appear in it), so
its optional extensions cannot try a CDN script that the policy would then refuse.

**One directive changed:** `connect-src` gained `https://eu.i.posthog.com`, derived from
`POSTHOG_HOST` rather than retyped. It is named unconditionally, even though the shipped build never
dials it, because a policy whose shape depends on a feature flag is one nobody can review.

---

## Switching it on

### 1. The client — one line

In `src/analytics/config.ts`, replace the placeholder with your project key
(PostHog → Settings → Project → **Project API Key**, the one starting `phc_`):

```ts
export const POSTHOG_KEY = 'phc_your_real_key_here'
```

That is the whole activation. Redeploy. Nothing else in the repo changes, and `analyticsConfigured`
flips the entire layer on.

> The key is publishable by design — it can send events and do nothing else — which is why it lives
> in plain text next to the Supabase anon key rather than in an env var this repo does not use and
> GitHub Pages could not read.

**Use an EU project.** `POSTHOG_HOST` is `https://eu.i.posthog.com` and `test/csp.test.ts` asserts
it stays in the EU. A US project key pointed at the EU host will simply not work.

### 2. The run-journal table — optional, one paste

Only if you want run journals as well as events. Supabase dashboard → SQL Editor → New query →
paste **`supabase/run-journals-v1.sql`** → Run.

Success looks like a notice reading:

```
run_journals v1 self-test passed: anon AND authenticated can upload finished and abandoned runs;
read/update/delete/backdate/oversize/empty/miscounted/prose all refused; an unknown future sector
still uploads
```

Failure raises with a list of exactly which cases came out wrong — send that on rather than editing
the file until it passes. Either way the self-test leaves no fixture rows behind.

**Order:** `supabase/leaderboard-v6.sql` is still the one to run first and is unrelated to this; see
`LEADERBOARD-SETUP.md`. Skipping the run-journals script costs nothing — the client's upload refuses
and the game is unaffected.

### 3. Worth doing in the PostHog project, once

- **Set a billing cap.** The anon-key situation applies here too: the ingest key is public, and
  nothing in a client can rate-limit itself. The free tier's event allowance is the real protection
  until it is not.
- **Optionally enable "cookieless mode"** in project settings and set `cookieless_mode: 'on_reject'`
  in `src/analytics/client.ts`. It replaces the memory-persistence anonymous mode with a
  server-side privacy-preserving hash, which counts unique *visitors* honestly instead of counting
  app opens. It is deliberately not the default because it needs that project setting, and
  activation was meant to be one line.

---

## What this cost

| | Before | After |
|---|---|---|
| Entry chunk | 953,351 B (295.9 kB gzip) | 966,960 B (300.6 kB gzip) |
| `posthog-js` | — | 137.9 kB in **its own** lazily-loaded chunk (45.3 kB gzip), never in the entry bundle and not in the service worker's precache |
| `npm run bots` | md5 `8f02371197bf090c1111b76270f3f9c4` | **identical** |
| `test/csp.test.ts` | 18 assertions | 22 |
| `test/analytics.test.ts` | — | 41 |

The +13.6 kB in the entry chunk (+1.4%) is the analytics module itself — the consent record, the
allowlist, the watcher and the two small UI surfaces. The SDK is not in it.

**Analytics reads game state and never writes it.** `git diff main -- src/game/` is empty, the
golden traces in `test/modes.test.ts` are untouched, and `npm run bots` is byte-identical.
