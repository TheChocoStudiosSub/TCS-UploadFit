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


function readCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.length - 22;
  const count = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localOffset = view.getUint32(offset + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    entries.push({
      name, localName, localOffset,
      centralCrc: view.getUint32(offset + 16, true),
      localCrc: view.getUint32(localOffset + 14, true),
      dosDate: view.getUint16(offset + 14, true),
      localDosDate: view.getUint16(localOffset + 12, true)
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('central directory offsets and CRC values point to matching local entries', async () => {
  const archive = await createZip([
    { name: 'one.jpg', blob: new Blob(['first']), lastModified: Date.UTC(2023, 2, 4, 5, 6, 8) },
    { name: 'two.jpg', blob: new Blob(['second']), lastModified: Date.UTC(2024, 8, 9, 10, 11, 12) }
  ]);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const entries = readCentralDirectory(bytes);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.localName, entry.name);
    assert.equal(entry.localCrc, entry.centralCrc);
    assert.ok(entry.localOffset >= 0);
    assert.ok(entry.dosDate > 0);
    assert.equal(entry.localDosDate, entry.dosDate);
  }
  assert.ok(entries[1].localOffset > entries[0].localOffset);
});

test('ZIP names avoid case-insensitive collisions and Windows-reserved names', async () => {
  const archive = await createZip([
    { name: 'Foto.jpg', blob: new Blob(['a']) },
    { name: 'foto.jpg', blob: new Blob(['b']) },
    { name: 'CON.txt', blob: new Blob(['c']) },
    { name: 'NUL.jpg', blob: new Blob(['d']) },
    { name: 'trailing. ', blob: new Blob(['e']) }
  ]);
  const entries = readCentralDirectory(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(entries.map(entry => entry.name), [
    'Foto.jpg', 'foto (2).jpg', '_CON.txt', '_NUL.jpg', 'trailing'
  ]);
  assert.equal(new Set(entries.map(entry => entry.name.toLocaleLowerCase('en-US'))).size, entries.length);
});
