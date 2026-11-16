import { EDITION, formatEditionBytes } from './edition.js';
import { translate } from './i18n.js';

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
const RESERVED_WINDOWS_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i;
const INVALID_FILENAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

function sanitizeFilename(input) {
  let name = String(input || 'image')
    .normalize('NFC')
    .replace(INVALID_FILENAME_CHARACTERS, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180);
  if (!name || name === '.' || name === '..') name = 'image';
  if (RESERVED_WINDOWS_NAME.test(name)) name = `_${name}`;
  return name;
}

function uniqueFilename(input, usedNames) {
  const safeName = sanitizeFilename(input);
  const dot = safeName.lastIndexOf('.');
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : '';
  let candidate = safeName;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase('en-US'))) {
    const marker = ` (${suffix})`;
    candidate = `${stem.slice(0, Math.max(1, 180 - marker.length - extension.length))}${marker}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

function toDosDateTime(value) {
  let date = value instanceof Date ? new Date(value.getTime()) : new Date(Number(value));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) date = new Date();
  let year = date.getFullYear();
  if (year < 1980) year = 1980;
  if (year > 2107) year = 2107;
  const month = Math.min(12, Math.max(1, date.getMonth() + 1));
  const day = Math.min(31, Math.max(1, date.getDate()));
  const hours = Math.min(23, Math.max(0, date.getHours()));
  const minutes = Math.min(59, Math.max(0, date.getMinutes()));
  const seconds = Math.min(59, Math.max(0, date.getSeconds()));
  const dosTime = (hours << 11) | (minutes << 5) | (seconds >> 1);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function zipError(key, language, vars = {}) {
  return new Error(translate(key, language, vars));
}

export async function createZip(entries, { language = 'en' } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw zipError('zipNoFiles', language);
  if (entries.length > EDITION.maxImages) {
    throw zipError('zipTooMany', language, { maxFiles: EDITION.maxImages });
  }

  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry || !(entry.blob instanceof Blob)) throw zipError('zipMissingData', language);
    if (!Number.isSafeInteger(entry.blob.size) || entry.blob.size < 0) throw zipError('zipMissingData', language);
    totalBytes += entry.blob.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > EDITION.maxBatchOutputBytes) {
      throw zipError('zipTooLarge', language, { maxSize: formatEditionBytes(EDITION.maxBatchOutputBytes, language) });
    }
  }
  if (totalBytes > EDITION.maxBatchOutputBytes) {
    throw zipError('zipTooLarge', language, { maxSize: formatEditionBytes(EDITION.maxBatchOutputBytes, language) });
  }

  const encoder = new TextEncoder();
  const localParts = [];
  const directoryParts = [];
  const usedNames = new Set();
  let offset = 0;

  for (const entry of entries) {
    if (!(entry.blob instanceof Blob)) throw zipError('zipMissingData', language);
    const name = uniqueFilename(entry.name, usedNames);
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    if (data.byteLength !== entry.blob.size) throw zipError('zipMissingData', language);
    const checksum = crc32(data);
    const { dosTime, dosDate } = toDosDateTime(entry.lastModified);
    if (offset + 30 + nameBytes.length + data.byteLength > 0xffffffff) {
      throw zipError('zipTooLargeForFormat', language);
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    put32(localView, 0, 0x04034b50);
    put16(localView, 4, 20);
    put16(localView, 6, 0x0800);
    put16(localView, 8, 0);
    put16(localView, 10, dosTime);
    put16(localView, 12, dosDate);
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
    put16(directoryView, 12, dosTime);
    put16(directoryView, 14, dosDate);
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
  if (offset + directorySize + 22 > 0xffffffff || directorySize > 0xffffffff) {
    throw zipError('zipTooLargeForFormat', language);
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  put32(endView, 0, 0x06054b50);
  put16(endView, 8, entries.length);
  put16(endView, 10, entries.length);
  put32(endView, 12, directorySize);
  put32(endView, 16, offset);

  return new Blob([...localParts, ...directoryParts, end], { type: 'application/zip' });
}
