// Founder Mode service worker: offline-capable without going stale.
// Navigations are network-first (every online launch gets the newest build; offline falls
// back to the cached shell). Hashed /assets/ files are immutable, so cache-first.
// Everything else is stale-while-revalidate.
const CACHE = 'founder-mode-v2'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./']))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// cache.put rejects on 206 responses and on quota pressure — neither should kill the response
async function store(cache, req, res) {
  if (res && res.status === 200) {
    try {
      await cache.put(req, res.clone())
    } catch {
      /* quota or partial response — serve without caching */
    }
  }
  return res
}

// `startsWith(origin)` is a string prefix test, not an origin test: https://example.github.io
// is a prefix of https://example.github.io.evil.test, so a third-party host could be pulled into
// our cache and served from it. Parse the URL and compare origins — and scope the cache to this
// app's own directory, because on GitHub Pages the origin is shared with every other project the
// same account publishes.
const SCOPE = new URL('./', self.location.href)

function ours(url) {
  try {
    const u = new URL(url)
    return u.origin === SCOPE.origin && u.pathname.startsWith(SCOPE.pathname)
  } catch {
    return false
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !ours(req.url)) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (req.mode === 'navigate') {
        try {
          return await store(cache, req, await fetch(req))
        } catch {
          return (await cache.match(req)) ?? (await cache.match('./')) ?? Response.error()
        }
      }
      const cached = await cache.match(req)
      // Cache-first is only safe for content-hashed build output, so match the real asset
      // directory rather than the substring `/assets/` anywhere in the URL — a query string
      // was enough to pin an arbitrary response in the cache permanently.
      if (cached && new URL(req.url).pathname.startsWith(SCOPE.pathname + 'assets/')) return cached
      const network = fetch(req)
        .then((res) => store(cache, req, res))
        .catch(() => cached ?? Response.error())
      return cached ?? network
    }),
  )
})
