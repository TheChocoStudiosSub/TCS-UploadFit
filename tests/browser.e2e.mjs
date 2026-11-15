import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.UPLOADFIT_BASE_URL || 'http://127.0.0.1:4173';
const smokeUrl = process.env.UPLOADFIT_SMOKE_URL || `${baseUrl}/tests/smoke.html`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const errors = [];
const consoleErrors = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
});

try {
  const smoke = await context.newPage();
  await smoke.goto(smokeUrl, { waitUntil: 'load' });
  await smoke.waitForFunction(() => /browser checks passed/i.test(document.querySelector('#results')?.textContent || ''), null, { timeout: 30000 });
  const smokeText = await smoke.locator('#results').innerText();
  assert.match(smokeText, /5\\/5 browser checks passed/i, smokeText);
  await smoke.close();

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#file-input').waitFor({ state: 'attached' });

  await page.locator('#language-select').selectOption('id');
  await assertText(page, '#page-title', 'Siapkan gambar untuk diunggah.');
  await assertText(page, '#recipe-heading', 'Pengaturan gambar');
  await assertText(page, '#jobs-heading', 'Daftar gambar');
  await page.locator('#language-select').selectOption('en');
  await assertText(page, '#page-title', 'Prepare images for upload.');

  const pngBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2E1B12';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#C18A5A';
    context.fillRect(40, 40, 120, 90);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const png = Buffer.from(pngBytes);
  await page.locator('#file-input').setInputFiles({
    name: 'browser-check.png',
    mimeType: 'image/png',
    buffer: png
  });
  await page.waitForFunction(() => document.querySelector('#process-all')?.disabled === false);
  await page.locator('#process-all').click();
  await page.waitForFunction(() => {
    const ready = document.querySelector('#download-selected')?.disabled === false;
    const failed = [...document.querySelectorAll('.queue-row .row-status')].some(node => node.classList.contains('error'));
    return ready || failed;
  }, null, { timeout: 30000 }).catch(() => {});
  if (await page.locator('#download-selected').isDisabled()) {
    const diagnostics = await page.evaluate(() => ({
      toast: document.querySelector('#toast-region')?.innerText || '',
      proofState: document.querySelector('#proof-state')?.innerText || '',
      proofMessage: document.querySelector('#proof-message')?.innerText || '',
      queue: [...document.querySelectorAll('.queue-row')].map(row => ({
        text: row.innerText,
        error: row.querySelector('.row-status')?.title || ''
      }))
    }));
    throw new Error(`Image did not reach a prepared state. Diagnostics: ${JSON.stringify(diagnostics)}. Browser errors: ${consoleErrors.join('; ')}. Page errors: ${errors.join('; ')}`);
  }

  const [singleDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-selected').click()
  ]);
  assert.match(singleDownload.suggestedFilename(), /uploadfit\\.(jpg|png|webp)$/i);

  const [zipDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-all').click()
  ]);
  assert.match(zipDownload.suggestedFilename(), /\\.zip$/i);
  const zipPath = await zipDownload.path();
  assert.ok(zipPath, 'ZIP download should produce a file');
  const fs = await import('node:fs/promises');
  const zipHeader = await fs.readFile(zipPath);
  assert.deepEqual([...zipHeader.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  await page.locator('#save-preset').click();
  await page.locator('#preset-name').fill('Browser smoke preset');
  await page.locator('#confirm-preset').click();
  await page.waitForFunction(() => document.querySelector('#delete-preset')?.disabled === false);
  await page.locator('#delete-preset').click();
  await page.waitForFunction(() => document.querySelector('#delete-preset')?.disabled === true);

  const offlinePage = await context.newPage();
  await offlinePage.goto(baseUrl, { waitUntil: 'networkidle' });
  await offlinePage.evaluate(async () => navigator.serviceWorker.ready);
  await offlinePage.reload({ waitUntil: 'networkidle' });
  await offlinePage.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  const cachedShell = await offlinePage.evaluate(async () => ({
    offlinePage: Boolean(await caches.match('/offline.html')),
    appScript: Boolean(await caches.match('/src/app.js')),
    stylesheet: Boolean(await caches.match('/src/styles.css'))
  }));
  assert.deepEqual(cachedShell, { offlinePage: true, appScript: true, stylesheet: true });
  await context.setOffline(true);
  await offlinePage.goto(`${baseUrl}/__uploadfit_offline_check__`, { waitUntil: 'domcontentloaded' });
  await assertText(offlinePage, 'h1', "You're offline.");
  await context.setOffline(false);
  await offlinePage.close();

  assert.deepEqual(errors, [], `Browser page errors: ${errors.join('; ')}`);
  console.log('PASS browser smoke page');
  console.log('PASS Indonesian language switch');
  console.log('PASS image upload and local processing');
  console.log('PASS single-file download');
  console.log('PASS ZIP download and signature');
  console.log('PASS custom preset save and delete');
  console.log('PASS production build app-shell caching');
  console.log('PASS offline navigation fallback');
} finally {
  await context.close();
  await browser.close();
}

async function assertText(page, selector, expected) {
  const actual = (await page.locator(selector).innerText()).trim();
  assert.equal(actual, expected, `Unexpected text in ${selector}`);
}
