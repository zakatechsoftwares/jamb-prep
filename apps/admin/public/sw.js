// The reviewer workspace's app-shell cache (plan 7.9 "offline capable").
// Stale-while-revalidate for same-origin GETs: serves whatever's cached
// immediately if present, and refreshes the cache in the background from
// the network. That's what makes the app *launchable* with no connection —
// review data itself is never cached here. `/api/*` is explicitly excluded:
// the reviewer routes' offline story lives entirely in IndexedDB
// (offline-store.ts), which knows about claim expiry, idempotency keys and
// the late-arrival case in a way a blunt HTTP cache never could.

const SHELL_CACHE = 'jamb-reviewer-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? networkFetch;
    }),
  );
});
