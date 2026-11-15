import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTarget, encodeWithinLimit, formatBytes, formatDimensions, normalizeSettings, processImage, readImageHeader, MAX_IMAGE_PIXELS } from '../src/processor.js';

const base = {
  width: '', height: '', maxSize: '', sizeUnit: 'MB', format: 'image/jpeg', quality: 86,
  targetMode: 'frame', mode: 'fit', background: '#f4f0e7'
};

test('formats byte counts without changing their units unexpectedly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatDimensions(1200, 800), '1,200 × 800 px');
});

test('normalizes valid settings and converts a KB ceiling to bytes', () => {
  const result = normalizeSettings({ ...base, maxSize: '500', sizeUnit: 'KB', width: '1200' });
  assert.equal(result.width, 1200);
  assert.equal(result.height, null);
  assert.equal(result.maxBytes, 512000);
  assert.equal(result.quality, 0.86);
  assert.equal(result._normalized, true);
});

test('rejects invalid or excessive pixel dimensions', () => {
  assert.throws(() => normalizeSettings({ ...base, width: '0' }), /between 1 and 16,000/);
  assert.throws(() => normalizeSettings({ ...base, width: '16001' }), /between 1 and 16,000/);
  assert.throws(() => normalizeSettings({ ...base, maxSize: '51', sizeUnit: 'MB' }), /no more than 50 MB/);
});

test('fit returns an exact frame without cropping the source', () => {
  const settings = normalizeSettings({ ...base, width: '1000', height: '1000', mode: 'fit' });
  const result = calculateTarget(4000, 3000, settings);
  assert.equal(result.width, 1000);
  assert.equal(result.height, 1000);
  assert.equal(result.draw.width, 1000);
  assert.equal(result.draw.height, 750);
  assert.equal(result.draw.y, 125);
});

test('fill covers the frame and crops beyond its edges', () => {
  const settings = normalizeSettings({ ...base, width: '1000', height: '1000', mode: 'fill' });
  const result = calculateTarget(4000, 3000, settings);
  assert.equal(result.width, 1000);
  assert.equal(result.height, 1000);
  assert.ok(result.draw.width > result.width);
  assert.ok(result.draw.x < 0);
});

test('a single target side preserves the original aspect ratio', () => {
  const settings = normalizeSettings({ ...base, width: '1200' });
  const result = calculateTarget(4000, 3000, settings);
  assert.equal(result.width, 1200);
  assert.equal(result.height, 900);
});

test('maximum size mode shrinks proportionally and adds no empty canvas', () => {
  const settings = normalizeSettings({ ...base, width: '1000', height: '1000', targetMode: 'max' });
  const result = calculateTarget(4000, 3000, settings);
  assert.deepEqual([result.width, result.height], [1000, 750]);
  assert.deepEqual(result.draw, { x: 0, y: 0, width: 1000, height: 750 });
});

test('maximum size mode never enlarges a smaller source', () => {
  const settings = normalizeSettings({ ...base, width: '1600', height: '1200', targetMode: 'max' });
  const result = calculateTarget(800, 600, settings);
  assert.deepEqual([result.width, result.height], [800, 600]);
});

test('maximum size mode handles extreme aspect ratios and one-sided bounds', () => {
  const oneSide = calculateTarget(4000, 3000, normalizeSettings({ ...base, width: '1200', targetMode: 'max' }));
  assert.deepEqual([oneSide.width, oneSide.height], [1200, 900]);
  const extreme = calculateTarget(20000, 10, normalizeSettings({ ...base, width: '16000', height: '1000', targetMode: 'max' }));
  assert.deepEqual([extreme.width, extreme.height], [16000, 8]);
  assert.ok(extreme.width * extreme.height <= MAX_IMAGE_PIXELS);
});

test('legacy saved settings without a target mode retain exact-frame behaviour', () => {
  const settings = normalizeSettings({ ...base, targetMode: undefined });
  assert.equal(settings.targetMode, 'frame');
});

test('stretch explicitly maps source pixels to the requested frame', () => {
  const settings = normalizeSettings({ ...base, width: '800', height: '800', mode: 'stretch', noUpscale: false });
  const result = calculateTarget(1600, 900, settings);
  assert.equal(result.width, 800);
  assert.equal(result.height, 800);
  assert.equal(result.draw.width, 800);
  assert.equal(result.draw.height, 800);
});


test('lossy size search keeps quality at or above the 65 percent floor', async () => {
  const qualities = [];
  const canvas = {
    toBlob(callback, mime, quality) {
      qualities.push(quality);
      callback(new Blob([new Uint8Array(Math.round(1000 * quality))], { type: mime }));
    }
  };
  const result = await encodeWithinLimit(canvas, 'image/jpeg', 0.86, 700);
  assert.ok(qualities.every(value => value >= 0.65));
  assert.ok(qualities.length <= 8);
  assert.equal(result.metLimit, true);
});

test('encode loop stops immediately when its signal is cancelled', async () => {
  let attempts = 0;
  const canvas = { toBlob(callback, mime) { attempts += 1; callback(new Blob(['encoded'], { type: mime })); } };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(encodeWithinLimit(canvas, 'image/jpeg', 0.86, 1, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(attempts, 1);
});

test('PNG, JPEG and WebP dimensions can be read from their file headers', async () => {
  const png = new Uint8Array(24);
  png.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const pngView = new DataView(png.buffer);
  pngView.setUint32(16, 10000);
  pngView.setUint32(20, 6000);
  assert.deepEqual(await readImageHeader(new Blob([png])), { mime: 'image/png', width: 10000, height: 6000 });
  assert.ok(10000 * 6000 > MAX_IMAGE_PIXELS);

  const jpeg = new Uint8Array([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x03,0x20,0x04,0x00,0,0,0,0,0,0,0,0,0,0,0xff,0xd9]);
  assert.deepEqual(await readImageHeader(new Blob([jpeg])), { mime: 'image/jpeg', width: 1024, height: 800 });

  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode('RIFF'));
  webp.set(new TextEncoder().encode('WEBP'), 8);
  webp.set(new TextEncoder().encode('VP8X'), 12);
  webp[24] = 0x7f; webp[25] = 0x02; webp[26] = 0;
  webp[27] = 0x3f; webp[28] = 0x01; webp[29] = 0;
  assert.deepEqual(await readImageHeader(new Blob([webp])), { mime: 'image/webp', width: 640, height: 320 });
});

test('oversized PNG is rejected from its header before image decode', async () => {
  const png = new Uint8Array(24);
  png.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 10000);
  view.setUint32(20, 6000);
  const previous = globalThis.createImageBitmap;
  let decodeCalled = false;
  globalThis.createImageBitmap = async () => { decodeCalled = true; throw new Error('should not decode'); };
  try {
    const file = Object.assign(new Blob([png], { type: 'image/png' }), { name: 'oversized.png' });
    await assert.rejects(processImage(file, base), /20-megapixel/);
    assert.equal(decodeCalled, false);
  } finally {
    globalThis.createImageBitmap = previous;
  }
});

test('size-only processing reports the original and reduced resolution', async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  globalThis.document = {
    createElement() {
      const canvas = {
        width: 0, height: 0,
        getContext() {
          return { fillRect() {}, drawImage() {}, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
        },
        toBlob(callback, type, quality) {
          const size = Math.max(100, Math.ceil(canvas.width * canvas.height * quality / 4));
          callback(new Blob([new Uint8Array(size)], { type }));
        }
      };
      return canvas;
    }
  };
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
  try {
    const file = Object.assign(new Blob([new Uint8Array(64)], { type: 'image/jpeg' }), { name: 'large.jpg' });
    const result = await processImage(file, { ...base, maxSize: '0.2', sizeUnit: 'MB' });
    assert.equal(result.downscaled, true);
    assert.equal(result.sourceWidth, 4000);
    assert.equal(result.sourceHeight, 3000);
    assert.ok(result.width < result.sourceWidth);
    assert.ok(result.height < result.sourceHeight);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('JPEG extension restores original format when the file MIME type is empty', async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  globalThis.document = { createElement() { return {
    width: 0, height: 0,
    getContext() { return { fillRect() {}, drawImage() {} }; },
    toBlob(callback, type) { callback(new Blob(['jpeg'], { type })); }
  }; } };
  globalThis.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
  try {
    const file = Object.assign(new Blob(['source']), { name: 'photo.jpg' });
    const result = await processImage(file, { ...base, format: 'original' });
    assert.equal(result.mime, 'image/jpeg');
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('drawImage coordinates and dimensions are integers', async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  let drawn;
  globalThis.document = { createElement() { return {
    width: 0, height: 0,
    getContext() { return { fillRect() {}, drawImage(...args) { drawn = args.slice(5); } }; },
    toBlob(callback, type) { callback(new Blob(['out'], { type })); }
  }; } };
  globalThis.createImageBitmap = async () => ({ width: 1000, height: 333, close() {} });
  try {
    const file = Object.assign(new Blob(['source'], { type: 'image/jpeg' }), { name: 'photo.jpg' });
    await processImage(file, { ...base, width: '1000', height: '1000', noUpscale: false });
    assert.ok(drawn.every(Number.isInteger));
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('non-decimal numeric strings are rejected and empty quality uses the default', () => {
  assert.throws(() => normalizeSettings({ ...base, width: '0x10' }), /digits only/);
  assert.equal(normalizeSettings({ ...base, quality: '' }).quality, 0.86);
});

test('rejects hexadecimal dimensions and defaults an empty quality to 86 percent', () => {
  assert.throws(() => normalizeSettings({ ...base, width: '0x10' }), /digits only/);
  assert.equal(normalizeSettings({ ...base, quality: '' }).quality, 0.86);
});
