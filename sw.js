/**
 * sw.js — Service Worker
 *
 * Caches all app assets on install so the app works fully offline.
 * Update CACHE_VERSION when you deploy changes to force a cache refresh.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME    = `chinese-flashcards-${CACHE_VERSION}`;

const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/cards.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: cache all static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
