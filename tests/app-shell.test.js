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
const processor = await readFile(path.join(root, 'src/processor.js'), 'utf8');
const zip = await readFile(path.join(root, 'src/zip.js'), 'utf8');

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


test('queue controls are not nested interactive elements and status announcements are separate', () => {
  assert.ok(html.includes('id="queue-status"'));
  assert.ok(!/<ol[^>]*aria-live=/.test(html));
  assert.ok(!/id="dropzone"[^>]*role="button"/.test(html));
  assert.ok(html.includes('role="group"'));
  assert.ok(app.includes("className = 'queue-select'"));
  assert.ok(!app.includes("setAttribute('role', 'button')"));
});

test('app, processor and ZIP error messages resolve to both languages', () => {
  const calls = [
    ...app.matchAll(/tr\('([^']+)'/g),
    ...processor.matchAll(/message\('([^']+)'/g),
    ...zip.matchAll(/zipError\('([^']+)'/g)
  ];
  for (const match of calls) {
    assert.ok(messages.en[match[1]], `missing English message: ${match[1]}`);
    assert.ok(messages.id[match[1]], `missing Indonesian message: ${match[1]}`);
  }
});

test('removed translation keys are no longer part of the interface dictionary', () => {
  const removed = [
    'eyebrow','headlineB','deviceStamp','keepProportions','auto','fileLimit',
    'noSelected','presetApplied','noLimit','outputFile','source','noChange','languageSaved'
  ];
  for (const key of removed) {
    assert.equal(Object.hasOwn(messages.en, key), false, `unused English key remains: ${key}`);
    assert.equal(Object.hasOwn(messages.id, key), false, `unused Indonesian key remains: ${key}`);
  }
});

test('processing controls restore after errors and language changes refresh the mode note', () => {
  assert.match(app, /async function processQueue\([\s\S]*?finally \{/);
  assert.match(app, /function applyLanguage\([\s\S]*?updateModeNote\(\)/);
  assert.match(app, /normalizeSettings\(readSettings\(\), language\)/);
});

test('size behaviour offers maximum size and exact frame without a redundant enlargement toggle', () => {
  assert.ok(html.includes('data-target-mode="max"'));
  assert.ok(html.includes('data-target-mode="frame"'));
  assert.match(html, /<div\\b(?=[^>]*\\bid="frame-mode-controls")(?=[^>]*\\shidden(?:\\s|>))[^>]*>/);
  assert.ok(!html.includes('id="no-upscale"'));
  assert.ok(app.includes("targetMode: $('.target-mode-button.active')"));
  assert.ok(processor.includes("targetMode === 'max'"));
});

test('processing progress does not destroy the translated button label', () => {
  assert.ok(app.includes("$('#process-all').querySelector('[data-i18n=\"prepareAll\"]')"));
  assert.ok(app.includes("textContent = tr('prepareAll')"));
});

test('custom presets are filtered through settings validation before use', () => {
  assert.match(app, /filterValidPresets\(parsed, settings => normalizeSettings\(settings, language\), 30\)/);
  assert.ok(app.includes('function deleteSelectedPreset()'));
});
