const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif'
]);
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|bmp|avif)$/i;

export function fileDedupKey(file) {
  return [
    String(file?.name || '').toLocaleLowerCase('en-US'),
    Number(file?.size) || 0,
    Number(file?.lastModified) || 0
  ].join('|');
}

export function validateIncomingFiles(incoming, existingFiles = [], maxImages, maxInputBytes) {
  if (!Array.isArray(incoming) || !Array.isArray(existingFiles)
    || !Number.isInteger(maxImages) || maxImages < 1
    || !Number.isFinite(maxInputBytes) || maxInputBytes < 1) {
    return { accepted: [], skipped: { tooLarge: 0, overCount: 0, unsupported: 0, empty: 0, duplicate: 0 } };
  }
  const accepted = [];
  const skipped = { tooLarge: 0, overCount: 0, unsupported: 0, empty: 0, duplicate: 0 };
  const existing = new Set(existingFiles.map(fileDedupKey));

  for (const file of incoming) {
    if (!file || file.size === 0) { skipped.empty += 1; continue; }
    if (!Number.isFinite(file.size) || file.size > maxInputBytes) { skipped.tooLarge += 1; continue; }
    const extensionSupported = SUPPORTED_EXTENSIONS.test(file.name || '');
    const mimeSupported = SUPPORTED_MIME_TYPES.has(file.type);
    if (!mimeSupported && !extensionSupported) { skipped.unsupported += 1; continue; }

    const key = fileDedupKey(file);
    if (existing.has(key)) { skipped.duplicate += 1; continue; }
    if (existing.size + accepted.length >= maxImages) { skipped.overCount += 1; continue; }

    existing.add(key);
    accepted.push(file);
  }
  return { accepted, skipped };
}
