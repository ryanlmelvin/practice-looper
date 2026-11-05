/* Generated release and precache list are supplied by scripts/build.mjs. */
const RELEASE = 'bce79d7cb0ca';
const PRECACHE = ["./assets/app-G6NWKIKN.js","./assets/styles-a7c19f94bea2.css","./icon-192.png","./icon-512.png","./icon.svg","./index.html","./manifest.webmanifest","./release.json"];
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `practice-looper:${SCOPE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE}`;
const SHELL_URL = new URL('./index.html', SCOPE).href;
const RECOVERY_PATH = new URL('./update.html', SCOPE).pathname;
const ASSETS_PATH = new URL('./assets/', SCOPE).pathname;
const ASSET_URLS = new Set(PRECACHE.map((path) => new URL(path, SCOPE).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      // Fetch the whole release before writing it. A failed asset must leave
      // the prior worker in charge, not an incomplete new app shell.
      const entries = await Promise.all([...ASSET_URLS].map(async (canonical) => {
        const download = new URL(canonical);
        download.searchParams.set('release', RELEASE);
        const response = await fetch(download.href, { cache: 'reload', credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Required app asset failed: ${canonical}`);
        // Drain each body now: install fetches can be concurrency-limited,
        // and leaving streams unread can prevent later downloads from starting.
        // It also ensures a truncated response fails before the cache is written.
        const body = await response.arrayBuffer();
        return [canonical, new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })];
      }));
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Preserve older releases for windows that have not chosen to reload.
  // Only app-owned hashed assets below are looked up in those older caches.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  // This independent page must always be able to repair an outdated updater.
  if (url.pathname === RECOVERY_PATH) return;

  const isShell = request.mode === 'navigate' &&
    (url.pathname === SCOPE.pathname || url.pathname === new URL(SHELL_URL).pathname);
  const canonical = new URL(url.href);
  canonical.search = '';
  canonical.hash = '';
  const isCurrentAsset = ASSET_URLS.has(canonical.href);
  const isVersionedAsset = url.pathname.startsWith(ASSETS_PATH) && /[-.][a-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg)$/i.test(url.pathname);
  if (!isShell && !isCurrentAsset && !isVersionedAsset) return;

  event.respondWith((async () => {
    const current = await caches.open(CACHE_NAME);
    const key = isShell ? SHELL_URL : canonical.href;
    const cached = await current.match(key);
    if (cached) return cached;
    if (isVersionedAsset) {
      const olderCaches = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
      for (const name of olderCaches.reverse()) {
        const oldAsset = await (await caches.open(name)).match(key);
        if (oldAsset) return oldAsset;
      }
    }
    return fetch(request);
  })());
});
