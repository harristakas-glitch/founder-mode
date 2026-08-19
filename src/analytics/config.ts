// Product analytics (PostHog) — the two constants that decide whether any of this exists.
//
// The pattern is deliberately the same one src/net/config.ts uses for the Supabase anon key, for
// the same reason: a PostHog *project* key is a publishable, write-only ingest token. It is meant
// to be readable by every visitor — it can send events and it can do nothing else. Shipping it in
// the client is how the product is designed to work, exactly as the anon key is. So it lives here
// in plain text, next to the sentence explaining why, rather than in an env var this repo does not
// use and a `.env` file GitHub Pages could not read anyway.
//
// UNTIL THE PLACEHOLDER IS REPLACED, THE WHOLE ANALYTICS LAYER IS INERT. `analyticsConfigured` is
// false, so `capture()` returns before it constructs anything, the dynamic `import('posthog-js')`
// is never reached (posthog-js is therefore never even downloaded, let alone run), the consent
// prompt never appears, and the run-journal upload refuses with `unconfigured`. There is no
// network call, no storage write and no third-party code on the honest path. test/analytics.test.ts
// pins that property rather than trusting this paragraph.
//
// TO SWITCH IT ON: replace POSTHOG_KEY below with the project key from
// PostHog → Settings → Project → Project API Key, and redeploy. That is the entire activation.
// See docs/analytics.md for what starts being collected the moment you do.

/**
 * PostHog project API key ("phc_…"). Publishable by design — see the header.
 * Replace the placeholder to switch analytics on; leave it and nothing happens.
 */
export const POSTHOG_KEY = 'YOUR-POSTHOG-PROJECT-KEY'

/**
 * EU ingest host. The owner and the players are in the EU, so the data must not leave it — a US
 * project would move personal data across a border for no benefit whatsoever.
 *
 * This constant is ALSO read by src/csp.ts at build time, which derives the `connect-src` entry
 * from it rather than retyping it. Same reasoning as SUPABASE_URL: a policy naming a host by hand
 * is a policy that silently severs the feature the day the host changes.
 */
export const POSTHOG_HOST = 'https://eu.i.posthog.com'

/**
 * The gate. Mirrors `onlineConfigured` in src/net/config.ts, including the `YOUR-` test: the
 * placeholder is the off switch, and it is impossible to half-configure.
 */
export const analyticsConfigured = !POSTHOG_KEY.includes('YOUR-')

/**
 * Supabase table the run journals are uploaded into (see supabase/run-journals-v1.sql).
 * Not `daily_scores` — that table is the leaderboard, its RLS is written for a different threat
 * model, and mixing a bulk jsonb payload into it would put a storage DoS behind a policy tuned for
 * small scalar rows.
 */
export const RUN_JOURNAL_TABLE = 'run_journals'

/**
 * Hard ceiling on one uploaded journal payload, in bytes of JSON.
 *
 * Same number as the `pg_column_size(journal) <= 262144` bound in supabase/run-journals-v1.sql,
 * and deliberately so: the writer's ceiling has to be the reader's ceiling. `sanitizeJournal`
 * already refuses anything past JOURNAL_LIMIT entries (20,000) — this is the second axis, because
 * 20,000 short entries and 20,000 fat ones are very different amounts of storage. A payload over
 * the cap is DROPPED, not truncated: a truncated journal replays to a desync and would read as
 * tampering, which is exactly the mistake src/game/replay.ts already refuses to make.
 */
export const MAX_JOURNAL_BYTES = 262_144
