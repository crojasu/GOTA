const CACHE_NAME = 'gota-v3';
const SHELL = ['/', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only cache shell assets, not API calls
  if (url.pathname.startsWith('/search') ||
      url.pathname.startsWith('/files') ||
      url.pathname.startsWith('/upload') ||
      url.pathname.startsWith('/download') ||
      url.pathname.startsWith('/stream') ||
      url.pathname.startsWith('/health') ||
      url.pathname.startsWith('/protocols') ||
      url.pathname.startsWith('/metrics') ||
      url.pathname.startsWith('/peers') ||
      url.pathname.startsWith('/connect') ||
      url.pathname.startsWith('/identity') ||
      url.pathname.startsWith('/circle')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
