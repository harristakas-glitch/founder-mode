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

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return
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
      if (cached && req.url.includes('/assets/')) return cached // content-hashed: immutable
      const network = fetch(req)
        .then((res) => store(cache, req, res))
        .catch(() => cached ?? Response.error())
      return cached ?? network
    }),
  )
})
