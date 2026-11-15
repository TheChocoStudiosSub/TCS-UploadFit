const CACHE_NAME = 'tcs-uploadfit-shell-__CACHE_VERSION__';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/src/styles.css',
  '/src/app.js',
  '/src/processor.js',
  '/src/file-validation.js',
  '/src/presets.js',
  '/src/processor.worker.js',
  '/src/edition.js',
  '/src/zip.js',
  '/src/i18n.js',
  '/assets/icon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/offline.html',
  '/privacy.html',
  '/terms.html'
];
const NETWORK_FIRST_EXTENSIONS = /\.(?:m?js|css)$/i;

async function storeResponse(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok) await storeResponse(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) return fallback;
    }
    return new Response('This page or asset is unavailable offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(SHELL_FILES.map(async file => {
      const response = await fetch(file, { cache: 'reload' });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${file}`);
      await cache.put(file, response);
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error('[TCS UploadFit] App-shell asset was not cached:', SHELL_FILES[index], result.reason);
      }
    });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('tcs-uploadfit-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/offline.html'));
    return;
  }

  if (NETWORK_FIRST_EXTENSIONS.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (!SHELL_FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    return networkFirst(request);
  })());
});
