import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside <App/> on purpose: a boundary inside the tree it guards cannot catch a throw
        from the tree's own root. Without this, any render error left a blank page that the
        service worker could serve again on reload — see src/ErrorBoundary.tsx. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// PWA: cache the app for offline play — production only (a SW in dev serves stale modules).
// A cached worker will happily serve yesterday's build forever, so when a new one takes over
// we say so instead of leaving the player wondering why a shipped feature isn't there.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // check on load and hourly, so a long-lived tab doesn't sit on a stale build
        reg.update().catch(() => {})
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
        // a build that finished installing while nobody was listening — e.g. the page was
        // reloaded mid-install — sits in `waiting` and would otherwise never announce itself
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner()
        reg.addEventListener('updatefound', () => {
          const fresh = reg.installing
          if (!fresh) return
          fresh.addEventListener('statechange', () => {
            // "installed" with an existing controller means: a NEW version is ready and the
            // page is still running the old one
            if (fresh.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner()
          })
        })
      })
      .catch(() => {})
  })
}

function showUpdateBanner() {
  if (document.getElementById('fm-update-banner')) return
  const bar = document.createElement('div')
  bar.id = 'fm-update-banner'
  bar.setAttribute('role', 'status')
  // Theme tokens (with literal fallbacks in case the stylesheet never loaded), so the banner
  // matches the game's surfaces and follows the sector accent instead of staying SaaS blue.
  bar.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:9999;display:flex;gap:12px;align-items:center;' +
    'padding:10px 14px;border-radius:14px;font:600 13px/1.2 system-ui,sans-serif;' +
    'background:var(--color-surface2,#1a2338);color:var(--color-ink,#dce5f5);' +
    'border:1px solid var(--color-line2,#33405e);box-shadow:0 10px 30px rgba(0,0,0,.45)'
  const label = document.createElement('span')
  label.textContent = 'A new version of Founder Mode is ready.'
  bar.appendChild(label)
  const btn = document.createElement('button')
  btn.textContent = 'Reload'
  btn.style.cssText =
    'cursor:pointer;border:0;border-radius:9px;padding:6px 12px;font:700 13px system-ui,sans-serif;' +
    'background:var(--color-accent,#7c9aff);color:var(--color-bg,#0a0e18)'
  btn.onclick = () => location.reload()
  bar.appendChild(btn)
  document.body.appendChild(bar)
}
