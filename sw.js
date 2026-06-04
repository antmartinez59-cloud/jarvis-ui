// JARVIS Service Worker — enables PWA install + background persistence
const CACHE = 'jarvis-v1';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/', '/index.html']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Network first — always get latest index.html
self.addEventListener('fetch', e => {
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
  }
});
