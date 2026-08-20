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
// is never reached (posthog-js is therefore never even downloaded, let alone run), and nothing is
// collected at all. There is no
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
export const POSTHOG_KEY = 'phc_CcRfT6PLSTrZV2aUbfoXg4Z4PJJHXsnKoqHo6VynfdhY'

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
