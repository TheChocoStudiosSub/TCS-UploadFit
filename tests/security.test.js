import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [vercel, offline, manifest, privacy, terms, sw] = await Promise.all([
  readFile(path.join(root, 'vercel.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'offline.html'), 'utf8'),
  readFile(path.join(root, 'manifest.webmanifest'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'privacy.html'), 'utf8'),
  readFile(path.join(root, 'terms.html'), 'utf8'),
  readFile(path.join(root, 'sw.js'), 'utf8')
]);

test('Vercel sets a restrictive page CSP and a same-origin-only service-worker policy', () => {
  const pageHeaders = vercel.headers.find(rule => rule.source === '/(.*)').headers;
  const serviceWorkerHeaders = vercel.headers.find(rule => rule.source === '/sw.js').headers;
  const pageCsp = pageHeaders.find(header => header.key === 'Content-Security-Policy').value;
  const workerCsp = serviceWorkerHeaders.find(header => header.key === 'Content-Security-Policy').value;
  assert.match(pageCsp, /default-src 'self'/);
  assert.match(pageCsp, /img-src 'self' blob: data:/);
  assert.match(pageCsp, /connect-src 'none'/);
  assert.match(pageCsp, /worker-src 'self' blob:/);
  assert.match(workerCsp, /connect-src 'self'/);
  assert.ok(pageHeaders.some(header => header.key === 'Strict-Transport-Security'));
  assert.ok(pageHeaders.some(header => header.key === 'X-Content-Type-Options'));
});

test('offline page uses an external stylesheet without inline styles', () => {
  assert.ok(offline.includes('href="/src/offline.css"'));
  assert.ok(!offline.includes('<style'));
  assert.ok(!/ style=/.test(offline));
  assert.ok(sw.includes("'/src/offline.css'"));
});

test('manifest does not request unsupported window-controls-overlay', () => {
  assert.equal(Object.hasOwn(manifest, 'display_override'), false);
});

test('privacy and terms pages provide Indonesian content and hosting-log disclosure', () => {
  assert.ok(privacy.includes('lang="id"'));
  assert.ok(privacy.includes('alamat IP'));
  assert.ok(privacy.includes('user-agent'));
  assert.ok(terms.includes('lang="id"'));
  assert.ok(terms.includes('Ketentuan Penggunaan'));
});
