import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.UPLOADFIT_BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));

try {
  const smoke = await context.newPage();
  await smoke.goto(`${baseUrl}/tests/smoke.html`, { waitUntil: 'load' });
  await smoke.waitForFunction(() => /browser checks passed/i.test(document.querySelector('#results')?.textContent || ''), null, { timeout: 30000 });
  const smokeText = await smoke.locator('#results').innerText();
  assert.match(smokeText, /5\/5 browser checks passed/i, smokeText);
  await smoke.close();

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#file-input').waitFor({ state: 'attached' });

  await page.locator('#language-select').selectOption('id');
  await assertText(page, '#page-title', 'Persiapkan gambar untuk diunggah.');
  await assertText(page, '#recipe-heading', 'Pengaturan output');
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
  await page.waitForFunction(() => document.querySelector('#download-selected')?.disabled === false, null, { timeout: 30000 }).catch(async () => {
    const state = await page.locator('#toast').innerText().catch(() => '');
    const queue = await page.locator('#queue-list').innerText().catch(() => '');
    throw new Error(`Image did not reach a prepared state. Toast: ${state}. Queue: ${queue}`);
  });

  const [singleDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-selected').click()
  ]);
  assert.match(singleDownload.suggestedFilename(), /uploadfit\.(jpg|png|webp)$/i);

  const [zipDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-all').click()
  ]);
  assert.match(zipDownload.suggestedFilename(), /\.zip$/i);
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

  assert.deepEqual(errors, [], `Browser page errors: ${errors.join('; ')}`);
  console.log('PASS browser smoke page');
  console.log('PASS Indonesian language switch');
  console.log('PASS image upload and local processing');
  console.log('PASS single-file download');
  console.log('PASS ZIP download and signature');
  console.log('PASS custom preset save and delete');
} finally {
  await context.close();
  await browser.close();
}

async function assertText(page, selector, expected) {
  const actual = (await page.locator(selector).innerText()).trim();
  assert.equal(actual, expected, `Unexpected text in ${selector}`);
}
