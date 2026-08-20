# Founder Mode — product analytics

**Added:** 2026-08-20 · **Status:** implemented and **live**.
**Code:** `src/analytics/` · **Tests:** `test/analytics.test.ts`, `test/csp.test.ts`
**Server side:** none. Events go to PostHog and nowhere else.

---

## The one thing to know first

**This is on.** `src/analytics/config.ts` holds a real project key, so events are being sent — no
cookie, no account, no person profile, and nothing a player typed. **Nobody is asked anything:**
there is no consent banner. The default is the anonymous middle state and the only control is one
tick box in the Field Guide footer.

The strong claim, and it is tested rather than promised: **untick that box and the vendor SDK is
never even downloaded.** `test/analytics.test.ts` §1 fires every event in the module with real traps
on `fetch`, `XMLHttpRequest`, `sendBeacon` and `Image`, and asserts all four read zero and that the
dynamic `import('posthog-js')` was never reached. That claim used to hold because the committed key
was a placeholder; the key is real now, so it is anchored to the off switch instead — which is the
version that protects anybody.

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

| State | What happens | Cookie? | Person profile? |
|---|---|---|---|
| **`unset`** (default, and what everybody gets) | Events are sent **anonymously**: `persistence: 'localStorage'`, `person_profiles: 'never'`. A random number is kept in this browser's own storage so a second visit is not counted as a stranger. | No | No |
| **`denied`** (the tick box, unticked) | Nothing at all. `capture()` returns before a client is constructed, the stored id is cleared, and `posthog-js` is never downloaded. | No | No |
| **`granted`** | Adds a cookie and person profiles. **Unreachable — nothing in the interface can set it.** Kept, with its tests, because the deferred run-journal upload is what would need it. | Yes | Yes |

### Why anonymous-by-default, and not silence-by-default

This is the design decision worth arguing about, so here is the argument.

If the default were silence, a prompt would be the only source of data — and a prompt is answered by
the people who bother to answer prompts. Everyone who abandons in week 3, the most important
population in the dataset and the whole reason `run_progress` exists, would be invisible by
construction. The layer would measure survivors and report that the game is more engaging than it
is. That is precisely the failure this instrumentation was built to avoid.

**The device id, and why it exists.** This shipped briefly as `persistence: 'memory'`, which writes
nothing to the device at all. That is the purest option and it makes **retention unmeasurable**: an
id that dies with the tab means every returning player arrives as a stranger, and PostHog's "unique
users" counts app opens rather than people. Retention is one of the four questions this feature was
built to answer, so a design that cannot answer it is not more private — it is broken with a good
excuse. A random number in this browser's own localStorage, tied to no account, sent on no other
request, readable by no other site and erased by the tick box, is the smallest thing that makes the
question answerable. `test/analytics.test.ts` §2 asserts the mapping: no cookie, no person profile.

### When the player is asked

**Never.** There is no prompt, on arrival or anywhere else. A banner at the door is a toll on a game
nobody has played yet, it is answered by reflex, and it teaches players to dismiss the interface —
and the thing it would be asking permission for is a random number in their own browser.

`shouldAskConsent()` and `markAsked()` still exist in `src/analytics/consent.ts` and nothing calls
them. That is deliberate: they are the hooks a future prompt would use if the run-journal upload
(BACKLOG.md) is ever built, since uploading a run genuinely does need asking.

### How a player opts out

**Field Guide → footer → "Play data".** One checkbox:

- **Anonymous play data — on/off.** Unticking it sets `denied` and **stops collection in the same
  tick**: `analyticsActive()` is consulted on every capture, so the next event is refused before a
  client is even constructed, and the stored id is cleared and the SDK opted out behind it. There is
  no "takes effect on next reload".
One box, not two: the model has three states but only two are reachable, and a tick box wired to
nothing is worse than no tick box.

The row renders nothing at all while the key is a placeholder — a privacy control for a system that
collects nothing is worse than no control, because it implies collection is happening.

`respect_dnt: true` is also set, so a browser that already sends Do-Not-Track is honoured without
being asked a question it has answered.

**Known limitation:** the Field Guide is only reachable during a run, so the switch is not available
on the start screen. Nobody can be stuck in a state they cannot leave — `granted` is unreachable, so
the worst case is anonymous — but a player who wants to switch off even that has to start a run to
do it. Worth moving to the start screen if anybody asks.

---

## The run-journal upload — deferred, not abandoned

The part no vendor can give us, and the one piece of the original design that is **not shipped**.

The game is deterministic and `src/game/replay.ts` already records every decision a player makes, so
a finished run can be uploaded as a journal and replayed exactly — turning "players quit around week
12" into "here are four hundred runs that died in week 12, replay them and watch what they all did".
No analytics vendor can offer that, because it needs the simulation.

It was built (client, Supabase schema, RLS, self-test, redaction of the company name, a 256 kB
payload ceiling matched on both sides) and then deliberately left out of this release, because it
is a bigger decision than instrumentation: it needs a new Supabase table, a real consent prompt —
uploading somebody's run genuinely does require asking — and a retention policy for the data.

**It is not lost.** The complete implementation is on branch `worktree-agent-a2853745c13a521f7`,
commit `be69eae`, along with `supabase/run-journals-v1.sql` and its tests. `BACKLOG.md` carries the
item. The consent model kept its unreachable `granted` state, and its tests, precisely so that
picking this up later does not mean rebuilding the state machine underneath it.

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

### It is already on

`src/analytics/config.ts` holds the project key. There is nothing to run, nothing to paste and no
SQL: this feature has no server side. `supabase/leaderboard-v6.sql` remains the only SQL file in the
repo and is unrelated — see `LEADERBOARD-SETUP.md`.

> The key is publishable by design — it can send events and do nothing else — which is why it lives
> in plain text next to the Supabase anon key rather than in an env var this repo does not use and
> GitHub Pages could not read. A `phx_` **personal** key is a different thing entirely and must
> never be committed.

**It is an EU project.** `POSTHOG_HOST` is `https://eu.i.posthog.com` and `test/csp.test.ts` asserts
it stays in the EU. A US project key pointed at the EU host would simply not work.

### Worth doing in the PostHog project, once

- **Set a billing cap.** The anon-key situation applies here too: the ingest key is public, and
  nothing in a client can rate-limit itself. The free tier's event allowance is the real protection
  until it is not.
- **Consider "cookieless mode"** in project settings, with `cookieless_mode: 'on_reject'` in
  `src/analytics/client.ts`. It would replace the localStorage device id with a server-side
  privacy-preserving hash — the same retention answer with nothing kept on the device at all. Not
  the default because it needs that project setting switched on first, and because the current
  mode is already cookieless and profile-free.

---

## What this cost

| | Before | After |
|---|---|---|
| Entry chunk | 953,351 B (295.9 kB gzip) | 961,784 B (299.0 kB gzip) |
| `posthog-js` | — | 137,913 B in **its own** lazily-loaded chunk (45.3 kB gzip), never in the entry bundle, and not downloaded at all for a player who has switched it off |
| `npm run bots` | md5 `8f02371197bf090c1111b76270f3f9c4` | **identical** |
| `test/csp.test.ts` | 18 assertions | 22 |
| `test/analytics.test.ts` | — | 32 |

The +8.4 kB in the entry chunk (+0.9%) is the analytics module itself — the consent record, the
allowlist, the watcher and the one UI control. The SDK is not in it. The `slim.no-external` build is
used deliberately: it is roughly half the size of the default bundle and it is structurally
incapable of loading a remote script.

**Verified in a browser, not inferred.** Built and served at `localhost:4173`:

- zero CSP violations on a fresh load
- the SDK initialises with a random UUID `distinct_id`, `$user_state: "anonymous"`, and
  `document.cookie` **empty**
- `POST https://eu.i.posthog.com/e/` → **200**
- with consent set to `denied` and the page reloaded: the SDK chunk is **not downloaded**, there are
  **zero** requests to posthog, **zero** posthog storage keys, and no cookies

That last one is the claim worth re-checking if anything here is ever refactored: switching it off
has to stop the download, not merely silence it.

**Analytics reads game state and never writes it.** `git diff main -- src/game/` is empty, the
golden traces in `test/modes.test.ts` are untouched, and `npm run bots` is byte-identical.
