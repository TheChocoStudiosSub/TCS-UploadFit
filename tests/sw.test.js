import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'sw.js'), 'utf8');

function createHarness({ failures = [] } = {}) {
  const handlers = new Map();
  const stored = new Map();
  const logs = [];
  let online = true;
  let skipWaitingCalls = 0;
  const keyOf = input => {
    const value = typeof input === 'string' ? input : input.url;
    return new URL(value, 'https://uploadfit.test').pathname;
  };
  const cache = {
    async put(request, response) { stored.set(keyOf(request), response); },
    async add(request) {
      const response = await fetchMock(request);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      stored.set(keyOf(request), response);
    }
  };
  async function fetchMock(input) {
    const pathname = keyOf(input);
    if (!online || failures.includes(pathname)) throw new Error('offline');
    return {
      ok: true, status: 200, type: 'basic', body: networkBodies.get(pathname) ?? `network:${pathname}`,
      clone() { return { ...this }; }
    };
  }
  const networkBodies = new Map();
  const context = {
    URL,
    Response,
    console: {
      error: (...args) => logs.push(args),
      warn: (...args) => logs.push(args)
    },
    fetch: fetchMock,
    caches: {
      async open() { return cache; },
      async match(request) { return stored.get(keyOf(request)) || null; },
      async keys() { return ['tcs-uploadfit-shell-old']; },
      async delete() { return true; }
    },
    self: {
      location: { origin: 'https://uploadfit.test' },
      addEventListener(name, handler) { handlers.set(name, handler); },
      skipWaiting: async () => { skipWaitingCalls += 1; },
      clients: { claim: async () => {} }
    }
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  async function install() {
    let wait;
    handlers.get('install')({ waitUntil(value) { wait = value; } });
    await wait;
  }
  async function request(pathname, mode = 'no-cors') {
    let responsePromise;
    handlers.get('fetch')({
      request: {
        method: 'GET',
        url: new URL(pathname, 'https://uploadfit.test').href,
        mode,
        headers: { get: () => 'en-US,en;q=0.9' }
      },
      respondWith(value) { responsePromise = value; }
    });
    return responsePromise;
  }
  return {
    handlers, stored, logs, networkBodies, install, request,
    setOnline(value) { online = value; },
    setFailure(value) { failures.push(value); },
    get skipWaitingCalls() { return skipWaitingCalls; }
  };
}

test('a new deployment refreshes HTML and JS instead of serving stale cached modules', async () => {
  const sw = createHarness();
  await sw.install();
  sw.networkBodies.set('/', 'new-html');
  sw.networkBodies.set('/src/app.js', 'new-app-module');
  const page = await sw.request('/', 'navigate');
  const module = await sw.request('/src/app.js');
  assert.equal(page.body, 'new-html');
  assert.equal(module.body, 'new-app-module');
  assert.equal(sw.stored.get('/src/app.js').body, 'new-app-module');
});

test('privacy page is cached under its own URL and remains available offline', async () => {
  const sw = createHarness();
  await sw.install();
  sw.networkBodies.set('/privacy.html', 'privacy-content');
  const onlinePage = await sw.request('/privacy.html', 'navigate');
  assert.equal(onlinePage.body, 'privacy-content');
  assert.equal(sw.stored.get('/privacy.html').body, 'privacy-content');
  sw.setOnline(false);
  const offlinePage = await sw.request('/privacy.html', 'navigate');
  assert.equal(offlinePage.body, 'privacy-content');
  assert.notEqual(offlinePage.body, sw.stored.get('/index.html')?.body);
});

test('root navigation refreshes its own cache entry', async () => {
  const sw = createHarness();
  await sw.install();
  sw.networkBodies.set('/', 'updated-root');
  const response = await sw.request('/', 'navigate');
  assert.equal(response.body, 'updated-root');
  assert.equal(sw.stored.get('/').body, 'updated-root');
});

test('a missing optional policy page is logged without blocking the complete app shell', async () => {
  const sw = createHarness({ failures: ['/terms.html'] });
  await sw.install();
  assert.ok(sw.logs.some(args => args[1] === '/terms.html'));
  assert.ok(sw.stored.has('/index.html'));
  assert.ok(sw.stored.has('/offline.html'));
  assert.equal(sw.skipWaitingCalls, 1);
});

test('a failed required application asset prevents an incomplete worker from activating', async () => {
  const sw = createHarness({ failures: ['/src/app.js'] });
  await assert.rejects(sw.install(), /offline/);
  assert.equal(sw.skipWaitingCalls, 0);
});

test('unknown navigation uses the cached offline page instead of a plain text response', async () => {
  const sw = createHarness();
  await sw.install();
  sw.setOnline(false);
  const response = await sw.request('/uncached-offline-route', 'navigate');
  assert.equal(response.body, 'network:/offline.html');
  assert.equal(response.status, 200);
});

test('navigation still returns a readable offline document if its cache entry is absent', async () => {
  const sw = createHarness();
  await sw.install();
  sw.stored.delete('/offline.html');
  sw.setOnline(false);
  const response = await sw.request('/uncached-offline-route', 'navigate');
  assert.equal(response.status, 503);
  assert.match(await response.text(), /You\\'re offline\\./);
  assert.match(response.headers.get('content-type'), /text\\/html/i);
});
