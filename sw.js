const CACHE = 'order-sheet-pwa-v15';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './chatgpt-flow.css',
  './workflow-v11.css',
  './review-v2.css',
  './catalog-v13.css',
  './capture-v14.css',
  './app.js',
  './catalog-core.js',
  './catalog-db.js',
  './catalog/aeon-ayagawa/manifest.json',
  './review-edit-core.js',
  './session-history-core.js',
  './image-orientation-core.js',
  './capture-multishot-core.js',
  './capture-ui.js',
  './force-update-core.js',
  './force-update.js',
  './chatgpt-flow.js',
  './action-return.js',
  './action-return-core.js',
  './scan-session.js',
  './runtime-config.js',
  './capture-guard.js',
  './handoff-ui.js',
  './db.js',
  './ai.js',
  './lib.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const networkRequest = sameOrigin
    ? new Request(event.request, { cache: 'no-store' })
    : event.request;

  event.respondWith(
    fetch(networkRequest)
      .then(response => {
        const isCatalogShard = sameOrigin && requestUrl.pathname.includes('/catalog/aeon-ayagawa/part-');
        if (sameOrigin && response.ok && !isCatalogShard) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
