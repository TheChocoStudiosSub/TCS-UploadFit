import { EDITION, formatEditionBytes } from './edition.js';
import { translate } from './i18n.js';

const message = (key, language, vars) => translate(key, language, vars);

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif']);
export const MAX_FILE_BYTES = EDITION.maxInputBytes;
export const MAX_IMAGE_PIXELS = EDITION.maxImagePixels;
export const MAX_OUTPUT_EDGE = EDITION.maxOutputEdge;
export const MIN_LOSSY_QUALITY = 0.65;

export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

export function formatDimensions(width, height) {
  return width > 0 && height > 0
    ? `${width.toLocaleString()} × ${height.toLocaleString()} px`
    : '';
}

function positiveInteger(value, label, language) {
  if (value === '' || value === null || value === undefined) return null;
  if (!/^\d+$/.test(String(value).trim())) {
    throw new Error(message(label === 'Width' ? 'widthDigits' : 'heightDigits', language));
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_OUTPUT_EDGE) {
    throw new Error(message(label === 'Width' ? 'widthRange' : 'heightRange', language, {
      maxEdge: MAX_OUTPUT_EDGE.toLocaleString(language === 'id' ? 'id-ID' : 'en-US')
    }));
  }
  return parsed;
}

export function normalizeSettings(raw = {}, language = 'en') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(message('invalidSettings', language));
  }
  if (raw?._normalized === true) {
    const width = positiveInteger(raw.width, 'Width', language);
    const height = positiveInteger(raw.height, 'Height', language);
    const maxBytes = raw.maxBytes === null || raw.maxBytes === undefined ? null : Number(raw.maxBytes);
    if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > EDITION.maxBatchOutputBytes)) {
      throw new Error(message('sizePositive', language));
    }
    if (!['original', 'image/jpeg', 'image/png', 'image/webp'].includes(raw.format)) throw new Error(message('formatChoice', language));
    if (!['max', 'frame'].includes(raw.targetMode) || !['fit', 'fill', 'stretch'].includes(raw.mode)) throw new Error(message('modeChoice', language));
    const quality = Number(raw.quality);
    if (!Number.isFinite(quality) || quality < MIN_LOSSY_QUALITY || quality > 1) throw new Error(message('invalidSettings', language));
    return {
      width, height, maxBytes, format: raw.format, quality,
      targetMode: raw.targetMode, mode: raw.mode,
      background: /^#[\\da-f]{6}$/i.test(raw.background || '') ? raw.background : '#f4f0e7',
      _normalized: true
    };
  }
  const width = positiveInteger(raw.width, 'Width', language);
  const height = positiveInteger(raw.height, 'Height', language);
  const rawMaxSize = raw.maxSize === '' || raw.maxSize === null || raw.maxSize === undefined
    ? null
    : String(raw.maxSize).trim();
  if (rawMaxSize !== null && !/^\d+(?:\.\d+)?$/.test(rawMaxSize)) {
    throw new Error(message('sizePositive', language));
  }
  const maxSizeValue = rawMaxSize === null ? null : Number(rawMaxSize);
  if (raw.sizeUnit !== undefined && !['KB', 'MB'].includes(raw.sizeUnit)) throw new Error(message('sizeUnitChoice', language));
  const isMegabytes = (raw.sizeUnit || 'MB') === 'MB';
  const unitMaximum = isMegabytes
    ? EDITION.maxBatchOutputBytes / (1024 * 1024)
    : EDITION.maxBatchOutputBytes / 1024;
  if (maxSizeValue !== null && (!Number.isFinite(maxSizeValue) || maxSizeValue <= 0 || maxSizeValue > unitMaximum)) {
    throw new Error(message(isMegabytes ? 'sizeMaxMB' : 'sizeMaxKB', language, {
      maxSize: unitMaximum.toLocaleString(language === 'id' ? 'id-ID' : 'en-US')
    }));
  }
  const sizeUnit = isMegabytes ? 1024 * 1024 : 1024;
  const maxBytes = maxSizeValue === null ? null : Math.max(1, Math.round(maxSizeValue * sizeUnit));
  const format = raw.format || 'image/jpeg';
  if (!['original', 'image/jpeg', 'image/png', 'image/webp'].includes(format)) {
    throw new Error(message('formatChoice', language));
  }
  const legacyTargetMode = raw.targetMode === undefined ? (raw.mode ? 'frame' : 'max') : raw.targetMode;
  if (!['max', 'frame'].includes(legacyTargetMode)) throw new Error(message('targetModeChoice', language));
  const mode = raw.mode || 'fit';
  if (!['fit', 'fill', 'stretch'].includes(mode)) throw new Error(message('modeChoice', language));
  const qualityInput = raw.quality === '' || raw.quality === null || raw.quality === undefined
    ? 86
    : Number(raw.quality);
  const quality = Math.min(100, Math.max(MIN_LOSSY_QUALITY * 100, Number.isFinite(qualityInput) ? qualityInput : 86)) / 100;
  const background = /^#[\da-f]{6}$/i.test(raw.background || '') ? raw.background : '#f4f0e7';

  return {
    width, height, maxBytes, format, quality, targetMode: legacyTargetMode, mode,
    background,
    _normalized: true
  };
}

export function calculateTarget(sourceWidth, sourceHeight, settings) {
  const { width: requestedWidth, height: requestedHeight, targetMode = 'frame', mode = 'fit' } = settings;
  if (!requestedWidth && !requestedHeight) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      draw: { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
    };
  }

  if (targetMode === 'max') {
    const scale = Math.min(
      requestedWidth ? requestedWidth / sourceWidth : Infinity,
      requestedHeight ? requestedHeight / sourceHeight : Infinity,
      1
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    return { width, height, draw: { x: 0, y: 0, width, height } };
  }

  const targetWidth = requestedWidth || Math.max(1, Math.round(sourceWidth * (requestedHeight / sourceHeight)));
  const targetHeight = requestedHeight || Math.max(1, Math.round(sourceHeight * (requestedWidth / sourceWidth)));

  if (mode === 'stretch') {
    return {
      width: targetWidth,
      height: targetHeight,
      draw: { x: 0, y: 0, width: targetWidth, height: targetHeight }
    };
  }

  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;

  return {
    width: targetWidth,
    height: targetHeight,
    draw: {
      x: (targetWidth - drawWidth) / 2,
      y: (targetHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight
    }
  };
}

export async function readImageHeader(file) {
  if (!(file instanceof Blob) || file.size < 12) return null;
  const sourceSize = file.size;
  const buffer = await file.slice(0, Math.min(sourceSize, 8 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

  // PNG signature and IHDR are both required. Extension and MIME labels are not trusted.
  if (bytes.length >= 33
    && bytes[0] === 0x89 && ascii(1, 3) === 'PNG'
    && ascii(4, 4) === '\r\n\x1a\n'
    && view.getUint32(8, false) === 13
    && ascii(12, 4) === 'IHDR') {
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { mime: 'image/png', width, height } : null;
  }

  // JPEG marker segments: require a valid Start Of Frame marker with non-zero dimensions.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 >= bytes.length) break;
      const segmentLength = view.getUint16(offset + 1, false);
      if (segmentLength < 2 || offset + 1 + segmentLength > bytes.length) break;
      if (sof.has(marker) && offset + 7 < bytes.length) {
        const height = view.getUint16(offset + 4, false);
        const width = view.getUint16(offset + 6, false);
        return width > 0 && height > 0 ? { mime: 'image/jpeg', width, height } : null;
      }
      offset += 1 + segmentLength;
    }
  }

  // WebP is a RIFF container. Check its declared length and the image chunk header.
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const riffLength = view.getUint32(4, true) + 8;
    const chunk = ascii(12, 4);
    if (riffLength > sourceSize || riffLength < 20) return null;
    if (chunk === 'VP8X' && view.getUint32(16, true) >= 10) {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { mime: 'image/webp', width, height };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && view.getUint32(16, true) >= 5 && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1 + ((bytes[22] >> 6) & 0x03) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      return { mime: 'image/webp', width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && view.getUint32(16, true) >= 10
      && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return width > 0 && height > 0 ? { mime: 'image/webp', width, height } : null;
    }
  }

  // BMP files require the BM signature and a readable BITMAPINFOHEADER or later DIB header.
  if (bytes.length >= 54 && ascii(0, 2) === 'BM') {
    const declaredSize = view.getUint32(2, true);
    const dibSize = view.getUint32(14, true);
    if (declaredSize > sourceSize || dibSize < 40 || 14 + dibSize > bytes.length) return null;
    const width = Math.abs(view.getInt32(18, true));
    const height = Math.abs(view.getInt32(22, true));
    return width > 0 && height > 0 ? { mime: 'image/bmp', width, height } : null;
  }

  // AVIF/AVIS dimensions are read from the ISO-BMFF ispe property before decoding.
  if (bytes.length >= 16 && ascii(4, 4) === 'ftyp') {
    const boxLength = view.getUint32(0, false);
    if (boxLength < 16 || boxLength > sourceSize || boxLength > bytes.length) return null;
    const brands = [ascii(8, 4)];
    for (let offset = 16; offset + 4 <= boxLength; offset += 4) brands.push(ascii(offset, 4));
    if (brands.some(brand => brand === 'avif' || brand === 'avis')) {
      const readBox = (offset, limit) => {
        if (offset + 8 > limit) return null;
        let size = view.getUint32(offset, false);
        const type = ascii(offset + 4, 4);
        let headerSize = 8;
        if (size === 1) {
          if (offset + 16 > limit) return null;
          const large = view.getBigUint64(offset + 8, false);
          if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
          size = Number(large);
          headerSize = 16;
        } else if (size === 0) {
          size = limit - offset;
        }
        if (size < headerSize || size > limit - offset) return null;
        return { offset, size, type, headerSize, end: offset + size };
      };
      const findSpatialExtents = (start, end, depth = 0) => {
        if (depth > 8) return null;
        let offset = start;
        while (offset + 8 <= end) {
          const box = readBox(offset, end);
          if (!box) return null;
          if (box.type === 'ispe' && box.size >= box.headerSize + 12) {
            const fullBox = box.offset + box.headerSize;
            const width = view.getUint32(fullBox + 4, false);
            const height = view.getUint32(fullBox + 8, false);
            if (width > 0 && height > 0) return { width, height };
          }
          let childStart = box.offset + box.headerSize;
          if (box.type === 'meta') childStart += 4;
          if (['meta', 'iprp', 'ipco'].includes(box.type)) {
            const found = findSpatialExtents(childStart, box.end, depth + 1);
            if (found) return found;
          }
          offset = box.end;
        }
        return null;
      };
      let offset = boxLength;
      while (offset + 8 <= bytes.length) {
        const box = readBox(offset, bytes.length);
        if (!box) break;
        if (box.type === 'meta') {
          const dimensions = findSpatialExtents(box.offset + box.headerSize + 4, box.end, 1);
          if (dimensions) return { mime: 'image/avif', ...dimensions };
        }
        offset = box.end;
      }
      return null;
    }
  }

  return null;
}
function throwIfAborted(signal, language = 'en') {
  if (!signal?.aborted) return;
  const error = new Error(message('processingCancelled', language));
  error.name = 'AbortError';
  throw error;
}

function canvasToBlob(canvas, mime, quality, language = 'en') {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mime, quality }).then(blob => {
      if (!blob) throw new Error(message('exportFailed', language));
      if (blob.type !== mime) throw new Error(message('formatUnavailable', language, {
        format: mime.replace('image/', '').toUpperCase()
      }));
      return blob;
    });
  }
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error(message('exportFailed', language)));
        if (blob.type !== mime) return reject(new Error(message('formatUnavailable', language, {
          format: mime.replace('image/', '').toUpperCase()
        })));
        resolve(blob);
      }, mime, quality);
    } catch (error) {
      reject(error);
    }
  });
}

function createCanvas(width, height, language = 'en') {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error(message('canvasUnavailable', language));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function renderToCanvas(bitmap, target, mime, background, language = 'en') {
  const canvas = createCanvas(target.width, target.height, language);
  const context = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
  if (!context) throw new Error(message('canvasUnavailable', language));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (mime === 'image/jpeg') {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(
    bitmap, 0, 0, bitmap.width, bitmap.height,
    Math.round(target.draw.x),
    Math.round(target.draw.y),
    Math.max(1, Math.round(target.draw.width)),
    Math.max(1, Math.round(target.draw.height))
  );
  return canvas;
}

export async function encodeWithinLimit(canvas, mime, requestedQuality, maxBytes, { signal, language = 'en' } = {}) {
  const quality = Math.min(1, Math.max(MIN_LOSSY_QUALITY, requestedQuality));
  const initial = await canvasToBlob(canvas, mime, quality, language);
  throwIfAborted(signal, language);
  if (!maxBytes || initial.size <= maxBytes || mime === 'image/png') {
    return { blob: initial, quality, metLimit: !maxBytes || initial.size <= maxBytes };
  }

  let low = MIN_LOSSY_QUALITY;
  let high = quality;
  let bestUnderLimit = null;
  let bestQuality = quality;
  let lowestSizeBlob = initial;

  for (let attempt = 0; attempt < 6 && high - low > 0.005; attempt += 1) {
    throwIfAborted(signal, language);
    const candidateQuality = (low + high) / 2;
    const candidate = await canvasToBlob(canvas, mime, candidateQuality, language);
    throwIfAborted(signal, language);
    if (candidate.size < lowestSizeBlob.size) lowestSizeBlob = candidate;
    if (candidate.size <= maxBytes) {
      bestUnderLimit = candidate;
      bestQuality = candidateQuality;
      low = candidateQuality;
    } else {
      high = candidateQuality;
    }
  }

  if (bestUnderLimit) return { blob: bestUnderLimit, quality: bestQuality, metLimit: true };

  if (quality > MIN_LOSSY_QUALITY) {
    throwIfAborted(signal, language);
    const minimum = await canvasToBlob(canvas, mime, MIN_LOSSY_QUALITY, language);
    throwIfAborted(signal, language);
    if (minimum.size <= maxBytes) return { blob: minimum, quality: MIN_LOSSY_QUALITY, metLimit: true };
    if (minimum.size < lowestSizeBlob.size) lowestSizeBlob = minimum;
  }
  return { blob: lowestSizeBlob, quality: MIN_LOSSY_QUALITY, metLimit: lowestSizeBlob.size <= maxBytes };
}

export async function processImage(file, rawSettings, { signal, language = 'en' } = {}) {
  const settings = rawSettings?._normalized === true ? rawSettings : normalizeSettings(rawSettings, language);
  if (!(file instanceof Blob)) throw new Error(message('fileUnreadable', language));
  if (file.size === 0) throw new Error(message('fileEmpty', language));
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(message('fileTooLarge', language, { maxSize: formatEditionBytes(MAX_FILE_BYTES, language) }));
  }
  if (typeof createImageBitmap !== 'function') throw new Error(message('decodeUnsupported', language));

  throwIfAborted(signal, language);
  const header = await readImageHeader(file);
  throwIfAborted(signal, language);
  if (!header || !SUPPORTED_MIME_TYPES.has(header.mime)) {
    throw new Error(message('unsupportedFormat', language));
  }
  if (header.width && header.height && header.width * header.height > MAX_IMAGE_PIXELS) {
    throw new Error(message('megapixelLimit', language, { maxPixels: MAX_IMAGE_PIXELS / 1_000_000 }));
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(message('decodeFailed', language));
  }

  try {
    throwIfAborted(signal, language);
    if (!bitmap.width || !bitmap.height) throw new Error(message('dimensionsUnreadable', language));
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error(message('megapixelLimit', language, { maxPixels: MAX_IMAGE_PIXELS / 1_000_000 }));
    }

    const mime = settings.format === 'original'
      ? (['image/jpeg', 'image/png', 'image/webp'].includes(header.mime) ? header.mime : 'image/png')
      : settings.format;

    let target = calculateTarget(bitmap.width, bitmap.height, settings);
    if (target.width > MAX_OUTPUT_EDGE || target.height > MAX_OUTPUT_EDGE) {
      throw new Error(message('outputEdgeLimit', language, { maxEdge: MAX_OUTPUT_EDGE.toLocaleString(language === 'id' ? 'id-ID' : 'en-US') }));
    }
    if (target.width * target.height > MAX_IMAGE_PIXELS) {
      throw new Error(message('outputPixelLimit', language, { maxPixels: MAX_IMAGE_PIXELS / 1_000_000 }));
    }
    let canvas = renderToCanvas(bitmap, target, mime, settings.background, language);
    let encoded = await encodeWithinLimit(canvas, mime, settings.quality, settings.maxBytes, { signal, language });

    if (!encoded.metLimit && settings.maxBytes && !settings.width && !settings.height && mime !== 'image/png') {
      let width = target.width;
      let height = target.height;
      for (let pass = 0; pass < 18 && !encoded.metLimit && Math.max(width, height) > 256; pass += 1) {
        throwIfAborted(signal, language);
        width = Math.max(1, Math.floor(width * 0.88));
        height = Math.max(1, Math.floor(height * 0.88));
        target = { width, height, draw: { x: 0, y: 0, width, height } };
        canvas = renderToCanvas(bitmap, target, mime, settings.background, language);
        encoded = await encodeWithinLimit(canvas, mime, settings.quality, settings.maxBytes, { signal, language });
      }
    }

    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    const baseName = String(file.name || 'image')
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90) || 'image';
    const outputName = `${baseName}_uploadfit.${extension}`;
    const reduction = file.size > 0 ? ((file.size - encoded.blob.size) / file.size) * 100 : 0;
    const downscaled = !settings.width && !settings.height
      && (canvas.width < bitmap.width || canvas.height < bitmap.height);
    const warning = encoded.metLimit
      ? null
      : mime === 'image/png'
        ? message('pngLimitMissed', language)
        : downscaled
          ? message('sizeLimitAfterDownscale', language)
          : message('sizeLimitFixed', language);

    return {
      blob: encoded.blob,
      outputName,
      mime,
      width: canvas.width,
      height: canvas.height,
      size: encoded.blob.size,
      sourceSize: file.size,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      downscaled,
      quality: encoded.quality,
      metLimit: encoded.metLimit,
      reduction,
      warning
    };
  } finally {
    bitmap.close?.();
  }
}
