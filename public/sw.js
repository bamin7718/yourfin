/* ============================================================
   SoFin — service worker

   Cache-first with a network fallback, so the app opens instantly and keeps
   working with the radio off. Three rules keep that from breaking the parts
   of the app that genuinely need the network:

     1. Supabase is never touched. Auth, REST and realtime must reach the real
        server or a stale cache would silently serve someone else's session.
        Anything that is not a GET is passed straight through as well.
     2. js/env.js is network-first. It carries the project URL and anon key;
        pinning a rotated key in a cache would lock the user out.
     3. Everything precached is served from cache and refreshed in the
        background, so a deploy lands on the next open rather than never.

   The cache name is versioned from the ?v= on this script's own URL, which
   scripts/generate-env.js stamps at build time — a new deploy is therefore a
   new cache, and activate() throws the old ones away.
   ============================================================ */

'use strict';

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'sofin-' + BUILD;

/* The shell needed to boot with no network at all. env.js is deliberately
   absent — it is fetched network-first and cached opportunistically. */
const PRECACHE = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/css/shell.css',
  '/js/sync.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  /* Without the client library the app cannot even reach its local cache of
     the data, so the CDN bundle is part of the shell. */
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

const isSupabase = url => /\.supabase\.(co|in)$/i.test(url.hostname);
const isEnv = url => url.origin === self.location.origin && url.pathname === '/js/env.js';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* One bad URL must not fail the whole install, so each entry is added on
       its own and a miss is only logged. */
    await Promise.all(PRECACHE.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] không precache được', url, err); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    /* Every cache on this origin belongs to this app, so drop anything that
       is not the current one — that also clears the pre-rename finyourtin-*
       buckets instead of leaving them behind for good. */
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* Let the page tell a waiting worker to take over immediately. */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (isSupabase(url)) return;                       // rule 1
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isEnv(url)) {                                  // rule 2
    event.respondWith(networkFirst(req));
    return;
  }

  /* A navigation offline falls back to the cached shell rather than the
     browser's dinosaur — the app renders from localStorage from there. */
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, '/index.html'));
    return;
  }

  event.respondWith(cacheFirst(req));                // rule 3
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: false });
  if (hit) {
    /* refresh in the background; the current response is already on its way */
    revalidate(cache, req);
    return hit;
  }
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const any = await cache.match(req, { ignoreSearch: true });
    if (any) return any;
    throw err;
  }
}

function revalidate(cache, req) {
  fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
  }).catch(() => { /* offline: the cached copy stands */ });
}

async function networkFirst(req, fallbackPath) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req) || (fallbackPath && await cache.match(fallbackPath));
    if (hit) return hit;
    throw err;
  }
}
