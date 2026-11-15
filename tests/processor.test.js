import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTarget, formatBytes, formatDimensions, normalizeSettings } from '../src/processor.js';

const base = {
  width: '', height: '', maxSize: '', sizeUnit: 'MB', format: 'image/jpeg', quality: 86,
  mode: 'fit', preserveRatio: true, noUpscale: true, background: '#f4f0e7'
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
});

test('rejects invalid or excessive pixel dimensions', () => {
  assert.throws(() => normalizeSettings({ ...base, width: '0' }), /between 1 and 16,000/);
  assert.throws(() => normalizeSettings({ ...base, width: '16001' }), /between 1 and 16,000/);
  assert.throws(() => normalizeSettings({ ...base, maxSize: '101', sizeUnit: 'MB' }), /no more than 100 MB/);
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

test('no-upscale prevents increasing a source smaller than its requested frame', () => {
  const settings = normalizeSettings({ ...base, width: '1600', height: '1200', mode: 'fit', noUpscale: true });
  const result = calculateTarget(800, 600, settings);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1200);
  assert.equal(result.draw.width, 800);
  assert.equal(result.draw.height, 600);
});

test('stretch explicitly maps source pixels to the requested frame', () => {
  const settings = normalizeSettings({ ...base, width: '800', height: '800', mode: 'stretch', noUpscale: false });
  const result = calculateTarget(1600, 900, settings);
  assert.equal(result.width, 800);
  assert.equal(result.height, 800);
  assert.equal(result.draw.width, 800);
  assert.equal(result.draw.height, 800);
});
