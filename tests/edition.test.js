import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EDITIONS } from '../src/edition.js';

test('edition limits are distinct and internally consistent', () => {
  assert.deepEqual(
    [EDITIONS.demo.maxImages, EDITIONS.demo.maxInputBytes, EDITIONS.demo.maxBatchOutputBytes, EDITIONS.demo.maxImagePixels, EDITIONS.demo.maxOutputEdge],
    [5, 10 * 1024 * 1024, 50 * 1024 * 1024, 20_000_000, 16_000]
  );
  assert.deepEqual(
    [EDITIONS.store.maxImages, EDITIONS.store.maxInputBytes, EDITIONS.store.maxBatchOutputBytes, EDITIONS.store.maxImagePixels, EDITIONS.store.maxOutputEdge],
    [5, 15 * 1024 * 1024, 40 * 1024 * 1024, 20_000_000, 16_000]
  );
  assert.equal(EDITIONS.demo.showDemoBadge, true);
  assert.equal(EDITIONS.demo.enableServiceWorker, true);
  assert.equal(EDITIONS.demo.tier, 'free');
  assert.equal(EDITIONS.store.enableServiceWorker, false);
  assert.equal(EDITIONS.store.tier, 'free');
  assert.equal(EDITIONS.store.features.zipExport, true);
  assert.equal(EDITIONS.store.showDemoBadge, false);
});

test('build script supports an output directory nested inside the repository root', async () => {
  const output = path.join(process.cwd(), 'dist', `uploadfit-nested-build-${process.pid}`);
  try {
    execFileSync(process.execPath, ['scripts/build.mjs', '--edition=demo', '--out', output], {
      cwd: process.cwd(), stdio: 'pipe'
    });
    const buildInfo = JSON.parse(await readFile(path.join(output, 'demo', 'edition-build.json'), 'utf8'));
    const html = await readFile(path.join(output, 'demo', 'index.html'), 'utf8');
    assert.equal(buildInfo.edition, 'demo');
    assert.ok(html.includes(EDITIONS.demo.title.en));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('build script produces independently configured demo and Store outputs', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'uploadfit-editions-'));
  try {
    execFileSync(process.execPath, ['scripts/build.mjs', '--out', output], {
      cwd: process.cwd(), stdio: 'pipe'
    });
    for (const id of ['demo', 'store']) {
      const directory = path.join(output, id);
      const buildInfo = JSON.parse(await readFile(path.join(directory, 'edition-build.json'), 'utf8'));
      const html = await readFile(path.join(directory, 'index.html'), 'utf8');
      const activeEdition = await readFile(path.join(directory, 'src/edition.js'), 'utf8');
      const sw = await readFile(path.join(directory, 'sw.js'), 'utf8');
      assert.equal(buildInfo.edition, id);
      assert.ok(html.includes(`<title>${EDITIONS[id].title.en}</title>`));
      assert.ok(html.includes(`content="${EDITIONS[id].description.en}"`));
      assert.ok(html.includes(`max="${EDITIONS[id].maxOutputEdge}"`));
      assert.ok(activeEdition.includes(`ACTIVE_EDITION = '${id}'`));
      assert.ok(sw.includes(`tcs-uploadfit-shell-${id}-v`));
      assert.ok(!sw.includes('__CACHE_VERSION__'));
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
