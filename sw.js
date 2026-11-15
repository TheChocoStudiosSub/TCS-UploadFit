const CACHE_NAME = 'tcs-uploadfit-shell-__CACHE_VERSION__';

const REQUIRED_SHELL_FILES = [
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
  '/offline.html',
  '/src/offline.css'
];

const OPTIONAL_SHELL_FILES = [
  '/assets/icon.svg',
  '/assets/logo tcs upload fit.jpg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
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

function offlineDocument(request) {
  const acceptedLanguages = request.headers?.get?.('accept-language') || '';
  const isIndonesian = /\bid\b/i.test(acceptedLanguages);
  const title = isIndonesian ? 'Anda sedang offline.' : "You're offline.";
  const description = isIndonesian
    ? 'Hubungkan kembali perangkat ke internet, lalu muat ulang TCS UploadFit. Setelah aplikasi terbuka, pemrosesan gambar berjalan langsung di perangkat.'
    : 'Reconnect your device to the internet and reload TCS UploadFit. Once the app has loaded, image preparation works locally on your device.';
  const html = `<!doctype html>
<html lang="${isIndonesian ? 'id' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#171916">
  <title>TCS UploadFit | Offline</title>
  <link rel="stylesheet" href="/src/offline.css">
</head>
<body>
  <main class="card">
    <h1>${title}</h1>
    <p>${description}</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function unavailableAssetResponse(request) {
  const pathname = new URL(request.url).pathname;
  const contentType = /\.m?js$/i.test(pathname)
    ? 'text/javascript; charset=utf-8'
    : /\.css$/i.test(pathname)
      ? 'text/css; charset=utf-8'
      : 'text/plain; charset=utf-8';
  return new Response('', {
    status: 503,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    }
  });
}

async function offlineFallback(request, fallbackPath) {
  const cached = await caches.match(request);
  if (cached) return cached;

  if (fallbackPath) {
    const fallback = await caches.match(fallbackPath);
    if (fallback) return fallback;
    return offlineDocument(request);
  }

  return unavailableAssetResponse(request);
}

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok) return await storeResponse(request, response);
    if (fallbackPath && response.status >= 500) {
      return offlineFallback(request, fallbackPath);
    }
    return response;
  } catch {
    return offlineFallback(request, fallbackPath);
  }
}

async function cacheShellFile(cache, file) {
  const response = await fetch(file, { cache: 'reload' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${file}`);
  await cache.put(file, response);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Do not activate a worker that cannot serve the complete application shell.
    await Promise.all(REQUIRED_SHELL_FILES.map(file => cacheShellFile(cache, file)));

    const optionalResults = await Promise.allSettled(
      OPTIONAL_SHELL_FILES.map(file => cacheShellFile(cache, file))
    );
    optionalResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn('[TCS UploadFit] Optional app-shell asset was not cached:', OPTIONAL_SHELL_FILES[index], result.reason);
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

  if (!REQUIRED_SHELL_FILES.includes(url.pathname) && !OPTIONAL_SHELL_FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    return networkFirst(request);
  })());
});
