/**
 * The Content-Security-Policy shipped in the built index.html.
 *
 * BUILD-TIME ONLY. Nothing in the running app imports this — it is consumed by vite.config.ts,
 * which injects the result as a `<meta http-equiv>` during `vite build`. It lives in src/ rather
 * than beside the config for one reason: tsconfig.test.json covers `src` and `test`, so putting
 * it here is what makes test/csp.test.ts able to import the real policy instead of a copy of it.
 * A policy asserted against a copy of itself proves nothing.
 *
 * WHY `<meta>` AND NOT A RESPONSE HEADER: the game deploys to GitHub Pages, which serves static
 * files and cannot set headers. `<meta>` is the only delivery mechanism available, and it comes
 * with a real cost — `frame-ancestors`, `sandbox` and `report-uri` are ignored in meta form by
 * specification. So this policy cannot deliver clickjacking protection and cannot report its own
 * violations. Both are recorded as accepted risks in docs/security-review-2026-08.md; both need a
 * host that sets headers, which is an owner decision and not a code change.
 *
 * WHY BUILD-ONLY AND NOT IN index.html: that same file serves `npm run dev`, and Vite's dev client
 * needs inline script plus a websocket to localhost. A CSP hard-coded into the source HTML would
 * break the dev server for every developer — this repo's signature failure mode is a control that
 * stops attackers and legitimate users in one move, and it has shipped three times.
 *
 * WHAT THIS IS AND IS NOT: at the time of writing the app has no HTML-injection sink anywhere —
 * no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no `new Function`, no `srcdoc`. This is
 * therefore defence in depth against a sink being introduced later, not a fix for a live hole.
 * Saying so plainly is the point; a review that inflates severity is worse than useless.
 *
 * EVERY SOURCE BELOW EXISTS FOR A NAMED REASON. Do not add one without a reason, and do not widen
 * script-src at all — test/csp.test.ts fails the build if you do.
 */
export function buildContentSecurityPolicy(supabaseUrl: string, analyticsHost: string): string {
  // Realtime dials wss:// on the same host PostgREST uses, so both are derived from the one
  // constant in src/net/config.ts. Deriving rather than retyping means migrating the Supabase
  // project cannot leave this policy pointing at the old host and silently sever every network
  // call the game makes — a failure that would look exactly like "multiplayer is broken".
  const { origin, host } = new URL(supabaseUrl)
  // Same rule for the analytics ingest host: derived from POSTHOG_HOST in src/analytics/config.ts,
  // never retyped, so moving region cannot leave the policy naming the old one.
  const analyticsOrigin = new URL(analyticsHost).origin

  return [
    `default-src 'self'`,

    // No CDN, no third-party script of any kind. Vite emits one external module and that is the
    // whole inventory. No 'unsafe-inline', no 'unsafe-eval', no https: wildcard: with script-src
    // this tight, an injected <script> has nowhere to load from and nothing to run.
    //
    // THIS DID NOT WIDEN WHEN ANALYTICS ARRIVED, AND THAT WAS THE CONSTRAINT THE FEATURE WAS BUILT
    // AROUND. posthog-js is an npm dependency bundled into our own JS by Vite, not a snippet
    // fetched from a vendor — and specifically the `no-external` build, which contains no
    // script-injection path at all, so its optional extensions cannot try a CDN <script> that this
    // directive would then refuse. See the header of src/analytics/client.ts.
    `script-src 'self'`,

    // Tailwind compiles to an external stylesheet, so 'self' carries the real UI. 'unsafe-inline'
    // is here deliberately: React's style={{}} and the update banner in main.tsx are CSSOM writes
    // (which CSP does not govern at all), but a dependency that injects a <style> tag would
    // otherwise break the interface silently. Style injection is not a meaningful escalation route
    // while script-src stays closed, and a silently broken UI is the worse trade.
    `style-src 'self' 'unsafe-inline'`,

    // 'self' covers the app icons and og.jpg. https: is for OAuth avatars, which arrive as
    // arbitrary provider metadata — safeAvatar() in src/net/auth.ts already narrows them to https
    // and rejects data:/blob:/javascript:, so this mirrors a check that exists. data:/blob: are
    // for the canvas share card.
    `img-src 'self' https: data: blob:`,

    // The only network peers that exist anywhere in the app: PostgREST and Auth over https,
    // Realtime over wss, and the PostHog EU ingest endpoint. Anything else the app tries to reach
    // is a bug or an exfiltration attempt.
    //
    // The analytics host is named UNCONDITIONALLY, even though the game ships with a placeholder
    // key and therefore never contacts it. Two reasons, and they are worth the extra source:
    // a policy that changes shape depending on a feature flag is a policy nobody can review (the
    // owner would be turning analytics on and silently altering the security posture in the same
    // edit), and this is a build-time constant either way — a permitted destination nothing ever
    // connects to costs exactly nothing. `connect-src` is also the ONLY directive analytics
    // touched; see the note on script-src above for why it needed no others.
    `connect-src 'self' ${origin} wss://${host} ${analyticsOrigin}`,

    // System fonts only — src/index.css declares no @font-face and imports no font service.
    `font-src 'self'`,
    `manifest-src 'self'`,
    // ./sw.js, same origin.
    `worker-src 'self'`,

    // Nothing in the game embeds, frames or plugs anything in.
    `object-src 'none'`,
    `frame-src 'none'`,
    `media-src 'none'`,

    // An injected <base> would repoint every relative asset path in the document. That matters
    // more here than in most apps: vite.config.ts sets base: './' so the build runs from
    // file://, which means every script and style path in index.html is relative.
    `base-uri 'none'`,

    // The app contains exactly one <form> (ChatWidget) and it preventDefault()s — it never
    // submits. Denying form submission outright therefore costs nothing and closes the classic
    // "inject a form, post the DOM to an attacker" exfiltration route.
    `form-action 'none'`,
  ].join('; ')
}
