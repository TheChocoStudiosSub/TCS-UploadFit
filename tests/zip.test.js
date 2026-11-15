import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createZip } from '../src/zip.js';

test('CRC-32 matches the standard check vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('creates a valid uncompressed ZIP with UTF-8 filenames', async () => {
  const blob = await createZip([
    { name: 'cover image.jpg', blob: new Blob(['image-one']) },
    { name: 'foto-utama.png', blob: new Blob(['image-two']) }
  ]);
  assert.equal(blob.type, 'application/zip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(bytes.length - 22 + 8, true), 2);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
});

test('rejects empty ZIP exports', async () => {
  await assert.rejects(() => createZip([]), /no completed images/);
});
