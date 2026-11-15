import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { formatBytes, formatDimensions } from '../src/processor.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [
  'README.md',
  'STORE-LISTING.md',
  'index.html',
  'src/app.js',
  'src/edition.js',
  'src/processor.js',
  'tests/smoke.html'
];

test('published source and copy avoid em dash punctuation', () => {
  const forbidden = String.fromCharCode(0x2014);
  const found = sourceFiles.filter(file => readFileSync(resolve(root, file), 'utf8').includes(forbidden));
  assert.deepEqual(found, []);
});

test('empty image metadata renders without a placeholder mark', () => {
  assert.equal(formatBytes(-1), '');
  assert.equal(formatDimensions(0, 0), '');
});
