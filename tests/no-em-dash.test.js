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
  'offline.html',
  'privacy.html',
  'terms.html',
  'src/app.js',
  'src/edition.js',
  'src/file-validation.js',
  'src/i18n.js',
  'src/processor.js',
  'src/processor.worker.js',
  'src/styles.css',
  'src/zip.js',
  'sw.js',
  'docs/MSIX-BUILD.md',
  'docs/PRO-ROADMAP.md',
  'packaging/WindowsApp/MainForm.cs',
  'packaging/WindowsApp/Package.appxmanifest.template',
  'scripts/build-msix.ps1',
  'scripts/generate-store-assets.ps1',
  'tests/smoke.html'
];

test('published source and copy avoid em dash punctuation', () => {
  const forbidden = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
  const found = sourceFiles.filter(file => forbidden.some(mark => readFileSync(resolve(root, file), 'utf8').includes(mark)));
  assert.deepEqual(found, []);
});

test('empty image metadata renders without a placeholder mark', () => {
  assert.equal(formatBytes(-1), '');
  assert.equal(formatDimensions(0, 0), '');
});
