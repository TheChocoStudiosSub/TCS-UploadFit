const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[value] = crc >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function put16(view, offset, value) { view.setUint16(offset, value, true); }
function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export async function createZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('There are no completed images to export.');
  if (entries.length > 1000) throw new Error('A ZIP export can contain up to 1,000 files.');

  const totalBytes = entries.reduce((sum, entry) => sum + (entry.blob?.size || 0), 0);
  if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('A ZIP export is limited to 256 MB per archive to keep device memory use bounded.');

  const encoder = new TextEncoder();
  const localParts = [];
  const directoryParts = [];
  let offset = 0;

  for (const entry of entries) {
    if (!(entry.blob instanceof Blob)) throw new Error('A ZIP item is missing its image data.');
    const name = String(entry.name || 'image').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const checksum = crc32(data);
    if (offset + data.byteLength > 0xffffffff) throw new Error('This export is too large for a standard ZIP archive.');

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    put32(localView, 0, 0x04034b50);
    put16(localView, 4, 20);
    put16(localView, 6, 0x0800);
    put16(localView, 8, 0);
    put32(localView, 14, checksum);
    put32(localView, 18, data.byteLength);
    put32(localView, 22, data.byteLength);
    put16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const directory = new Uint8Array(46 + nameBytes.length);
    const directoryView = new DataView(directory.buffer);
    put32(directoryView, 0, 0x02014b50);
    put16(directoryView, 4, 20);
    put16(directoryView, 6, 20);
    put16(directoryView, 8, 0x0800);
    put16(directoryView, 10, 0);
    put32(directoryView, 16, checksum);
    put32(directoryView, 20, data.byteLength);
    put32(directoryView, 24, data.byteLength);
    put16(directoryView, 28, nameBytes.length);
    put32(directoryView, 42, offset);
    directory.set(nameBytes, 46);
    directoryParts.push(directory);

    offset += local.byteLength + data.byteLength;
  }

  const directorySize = directoryParts.reduce((total, part) => total + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  put32(endView, 0, 0x06054b50);
  put16(endView, 8, entries.length);
  put16(endView, 10, entries.length);
  put32(endView, 12, directorySize);
  put32(endView, 16, offset);

  return new Blob([...localParts, ...directoryParts, end], { type: 'application/zip' });
}
