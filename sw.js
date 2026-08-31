/**
 * Budget Planner service worker.
 *
 * Two jobs:
 *   1. Make the app work with no internet at all, by precaching every file it
 *      needs. There are no runtime network calls to fall back on — the page's
 *      Content-Security-Policy blocks them — so the cache is the whole story.
 *   2. Make the app installable, which on iOS is what stops Safari's
 *      Intelligent Tracking Prevention from deleting saved budgets after seven
 *      days of not opening it. Installed web apps get their own usage counter.
 *
 * Bump CACHE_VERSION on every deploy: activate() deletes any cache that is not
 * the current one, so a stale shell can never survive an update.
 */
const CACHE_VERSION = 'v74';
const CACHE = `budget-planner-${CACHE_VERSION}`;

/* Everything the app needs to run offline. Excel support (SheetJS, 930 KB) is
   included deliberately: it is the single biggest file, but leaving it out
   would mean the Excel buttons silently fail for anyone who first tries them
   while offline. */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './chart.umd.min.js',
  './xlsx.full.min.js',
  './icon-180.png',
  './icon-192.png',
  './icon-32.png',
  './icon-512-maskable.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is atomic: one failure aborts the install, which is what we want.
    // A half-populated cache would mean an app that half-works offline.
    // cache:'reload' bypasses the browser's own HTTP cache. Without it a
    // fresh worker can dutifully re-cache a stale index.html and the update
    // lands with none of the changes in it.
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('budget-planner-') && n !== CACHE)
           .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The page itself: prefer the network so a deployed update is picked up on
  // the next launch, but fall straight back to the cache when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) ??
               (await caches.match('./')) ??
               new Response('Offline and no cached copy available.', {
                 status: 503, headers: { 'Content-Type': 'text/plain' },
               });
      }
    })());
    return;
  }

  // Everything else is a static asset that only changes on deploy: serve from
  // cache instantly, and top the cache up if it was somehow missed.
  event.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    try {
      const fresh = await fetch(request);
      // Only cache clean URLs. A request carrying a query string is a one-off
      // — a cache-buster, a tracking parameter — and storing each variant would
      // grow the cache without bound for files that are already precached.
      if (fresh.ok && !url.search) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

// Lets the page trigger an immediate update instead of waiting for a reload.
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  // Lets the footer show which version is actually running.
  if (event.data === 'version' && event.ports && event.ports[0])
    event.ports[0].postMessage(CACHE_VERSION);
});
