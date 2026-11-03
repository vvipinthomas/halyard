// App-shell cache. API responses are never cached (they carry user data).
const CACHE = 'halyard-v6';
const SHELL = ['/', '/index.html', '/css/tokens.css', '/css/components.css', '/css/crew.css', '/js/icons.js', '/js/factory-view.js', '/vendor/qrcode.js', '/js/app.js', '/js/engine.js', '/js/providers.js', '/js/mascot.js', '/js/mcp-client.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
