import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { messages } from '../src/i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const app = await readFile(path.join(root, 'src/app.js'), 'utf8');
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');

test('all literal DOM IDs used by the app exist exactly once', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const counts = new Map();
  ids.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  for (const [id, count] of counts) assert.equal(count, 1, `duplicate id: ${id}`);
  const selectors = [...app.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map(match => match[1]);
  for (const id of new Set(selectors)) assert.ok(counts.has(id), `missing id: ${id}`);
});

test('all interface translation keys exist in both languages', () => {
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
  for (const key of new Set(keys)) {
    assert.ok(messages.en[key], `missing English translation: ${key}`);
    assert.ok(messages.id[key], `missing Indonesian translation: ${key}`);
  }
});

test('app shell references a present set of local assets', async () => {
  const paths = [...html.matchAll(/(?:src|href)="(\/(?:assets|src)\/[^\"]+)"/g)].map(match => match[1]);
  for (const webPath of new Set(paths)) await access(path.join(root, webPath.slice(1)));
  assert.match(css, /\.image-wait/);
});
