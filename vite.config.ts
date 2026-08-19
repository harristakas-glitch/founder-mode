import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { SUPABASE_URL } from './src/net/config'
import { buildContentSecurityPolicy } from './src/csp'

/**
 * Inject the Content-Security-Policy into the built index.html.
 *
 * `apply: 'build'` is load-bearing, not tidiness: the dev server shares this index.html and needs
 * inline script plus a localhost websocket, so injecting in dev would break `npm run dev`.
 * The policy itself, and the reasoning behind every source in it, lives in src/csp.ts — where
 * test/csp.test.ts can import and assert against the real thing rather than a copy.
 */
function contentSecurityPolicy(): Plugin {
  const policy = buildContentSecurityPolicy(SUPABASE_URL)
  return {
    name: 'founder-mode-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
            // First in <head>, so it governs every element that follows it. This still leaves the
            // charset declaration inside the first 1024 bytes the HTML spec requires (measured at
            // 573), which is the reason the policy is not injected any later than this.
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  // Relative asset paths so the built game runs straight from dist/index.html (file://)
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
})
