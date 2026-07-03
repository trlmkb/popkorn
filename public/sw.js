/* POPKØRN service worker — conservative runtime caching. */
const CACHE = 'pk-v1';
const IMAGE_LIMIT = 400;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > IMAGE_LIMIT) {
    await Promise.all(keys.slice(0, keys.length - IMAGE_LIMIT).map((k) => cache.delete(k)));
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Never cache the API or auth-gated admin HTML.
  if (url.pathname.startsWith('/api/')) return;

  // Immutable assets: cache-first.
  if (
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone());
          trimCache(cache);
        }
        return res;
      })
    );
    return;
  }

  // Pages: network-first with cache fallback for offline viewing.
  if (req.mode === 'navigate' && !url.pathname.startsWith('/admin')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
