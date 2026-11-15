import { EDITION, formatEditionBytes } from './edition.js';

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif']);
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|bmp|avif)$/i;
export const MAX_FILE_BYTES = EDITION.maxInputBytes;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_OUTPUT_EDGE = 16_000;
export const MIN_LOSSY_QUALITY = 0.65;

export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
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
    : '—';
}

function positiveInteger(value, label) {
  if (value === '' || value === null || value === undefined) return null;
  if (!/^\d+$/.test(String(value).trim())) throw new Error(`${label} must contain digits only.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_OUTPUT_EDGE) {
    throw new Error(`${label} must be a whole number between 1 and ${MAX_OUTPUT_EDGE.toLocaleString()} pixels.`);
  }
  return parsed;
}

export function normalizeSettings(raw = {}) {
  const width = positiveInteger(raw.width, 'Width');
  const height = positiveInteger(raw.height, 'Height');
  const rawMaxSize = raw.maxSize === '' || raw.maxSize === null || raw.maxSize === undefined ? null : String(raw.maxSize).trim();
  if (rawMaxSize !== null && !/^\d+(?:\.\d+)?$/.test(rawMaxSize)) throw new Error('File-size limit must be a positive number.');
  const maxSizeValue = rawMaxSize === null ? null : Number(rawMaxSize);
  const isMegabytes = raw.sizeUnit === 'MB';
  const unitMaximum = isMegabytes ? 100 : 102400;
  if (maxSizeValue !== null && (!Number.isFinite(maxSizeValue) || maxSizeValue <= 0 || maxSizeValue > unitMaximum)) {
    throw new Error(isMegabytes
      ? 'File-size limit must be greater than 0 and no more than 100 MB.'
      : 'File-size limit must be greater than 0 and no more than 102,400 KB (100 MB).');
  }
  const sizeUnit = isMegabytes ? 1024 * 1024 : 1024;
  const maxBytes = maxSizeValue === null ? null : Math.max(1, Math.round(maxSizeValue * sizeUnit));
  const format = raw.format || 'image/jpeg';
  if (!['original', 'image/jpeg', 'image/png', 'image/webp'].includes(format)) {
    throw new Error('Choose JPEG, PNG, WebP, or keep the source format.');
  }
  const mode = raw.mode || 'fit';
  if (!['fit', 'fill', 'stretch'].includes(mode)) throw new Error('Choose a supported frame mode.');
  const qualityInput = raw.quality === '' || raw.quality === null || raw.quality === undefined
    ? 86
    : Number(raw.quality);
  const quality = Math.min(100, Math.max(65, Number.isFinite(qualityInput) ? qualityInput : 86)) / 100;
  const background = /^#[\da-f]{6}$/i.test(raw.background || '') ? raw.background : '#f4f0e7';

  return {
    width,
    height,
    maxBytes,
    format,
    quality,
    mode,
    preserveRatio: raw.preserveRatio !== false,
    noUpscale: raw.noUpscale !== false,
    background
  };
}

export function calculateTarget(sourceWidth, sourceHeight, settings) {
  const { width: requestedWidth, height: requestedHeight, noUpscale, mode } = settings;
  if (!requestedWidth && !requestedHeight) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      draw: { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
    };
  }

  const onlyOneSide = Boolean(requestedWidth) !== Boolean(requestedHeight);
  const targetWidth = requestedWidth || Math.max(1, Math.round(sourceWidth * (requestedHeight / sourceHeight)));
  const targetHeight = requestedHeight || Math.max(1, Math.round(sourceHeight * (requestedWidth / sourceWidth)));

  if (onlyOneSide) {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight, noUpscale ? 1 : Infinity);
    const outWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outHeight = Math.max(1, Math.round(sourceHeight * scale));
    return { width: outWidth, height: outHeight, draw: { x: 0, y: 0, width: outWidth, height: outHeight } };
  }

  if (mode === 'stretch' || !settings.preserveRatio) {
    const outWidth = noUpscale ? Math.min(sourceWidth, targetWidth) : targetWidth;
    const outHeight = noUpscale ? Math.min(sourceHeight, targetHeight) : targetHeight;
    return { width: outWidth, height: outHeight, draw: { x: 0, y: 0, width: outWidth, height: outHeight } };
  }

  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  let scale = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  if (noUpscale) scale = Math.min(1, scale);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;

  if (mode === 'fill') {
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
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // PNG: IHDR width and height are fixed at byte offsets 16 and 20.
  if (bytes.length >= 24
    && view.getUint32(0) === 0x89504e47
    && view.getUint32(4) === 0x0d0a1a0a) {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk marker segments until a Start Of Frame marker is found.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      if (marker === 0xd9 || marker === 0xda) break;
      const segmentLength = view.getUint16(offset + 1, false);
      if (segmentLength < 2 || offset + 1 + segmentLength > bytes.length) break;
      if (sof.has(marker) && offset + 8 < bytes.length) {
        return {
          mime: 'image/jpeg',
          height: view.getUint16(offset + 4, false),
          width: view.getUint16(offset + 6, false)
        };
      }
      offset += 1 + segmentLength;
    }
  }

  // WebP: VP8X, VP8L and VP8 encode dimensions in different headers.
  if (bytes.length >= 30
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { mime: 'image/webp', width, height };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1 + ((bytes[22] >> 6) & 0x03) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      return { mime: 'image/webp', width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30
      && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return { mime: 'image/webp', width, height };
    }
  }
  return null;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Image processing was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function canvasToBlob(canvas, mime, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mime, quality }).then(blob => {
      if (!blob) throw new Error('The image could not be exported. Try another format or smaller dimensions.');
      if (blob.type !== mime) throw new Error(`${mime.replace('image/', '').toUpperCase()} export is unavailable in this browser.`);
      return blob;
    });
  }
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('The image could not be exported. Try another format or smaller dimensions.'));
        if (blob.type !== mime) return reject(new Error(`${mime.replace('image/', '').toUpperCase()} export is unavailable in this browser.`));
        resolve(blob);
      }, mime, quality);
    } catch (error) {
      reject(error);
    }
  });
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Canvas rendering is unavailable in this browser.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function renderToCanvas(bitmap, target, mime, background) {
  const canvas = createCanvas(target.width, target.height);
  const context = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
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

export async function encodeWithinLimit(canvas, mime, requestedQuality, maxBytes, { signal } = {}) {
  const quality = Math.min(1, Math.max(MIN_LOSSY_QUALITY, requestedQuality));
  const initial = await canvasToBlob(canvas, mime, quality);
  throwIfAborted(signal);
  if (!maxBytes || initial.size <= maxBytes || mime === 'image/png') {
    return { blob: initial, quality, metLimit: !maxBytes || initial.size <= maxBytes };
  }

  let low = MIN_LOSSY_QUALITY;
  let high = quality;
  let bestUnderLimit = null;
  let bestQuality = quality;
  let lowestSizeBlob = initial;

  // A short bounded search finds the highest acceptable quality above the floor.
  for (let attempt = 0; attempt < 6 && high - low > 0.005; attempt += 1) {
    throwIfAborted(signal);
    const candidateQuality = (low + high) / 2;
    const candidate = await canvasToBlob(canvas, mime, candidateQuality);
    throwIfAborted(signal);
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

  // Try the quality floor once. If it still misses, processImage reduces dimensions.
  if (quality > MIN_LOSSY_QUALITY) {
    throwIfAborted(signal);
    const minimum = await canvasToBlob(canvas, mime, MIN_LOSSY_QUALITY);
    throwIfAborted(signal);
    if (minimum.size <= maxBytes) return { blob: minimum, quality: MIN_LOSSY_QUALITY, metLimit: true };
    if (minimum.size < lowestSizeBlob.size) lowestSizeBlob = minimum;
  }
  return { blob: lowestSizeBlob, quality: MIN_LOSSY_QUALITY, metLimit: lowestSizeBlob.size <= maxBytes };
}

function mimeFromExtension(name) {
  const extension = String(name || '').match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' })[extension] || '';
}

export async function processImage(file, rawSettings, { signal } = {}) {
  const settings = normalizeSettings(rawSettings);
  if (!(file instanceof Blob)) throw new Error('The selected item is not a readable file.');
  if (file.size === 0) throw new Error('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`This file exceeds the ${formatEditionBytes(MAX_FILE_BYTES)} per-image limit.`);
  const extensionMime = mimeFromExtension(file.name);
  if (!SUPPORTED_MIME_TYPES.has(file.type) && !SUPPORTED_MIME_TYPES.has(extensionMime) && !SUPPORTED_EXTENSIONS.test(file.name || '')) {
    throw new Error('Unsupported format. Use JPEG, PNG, WebP, BMP or AVIF. Animated GIF and SVG are not supported.');
  }
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode images locally. Update Microsoft Edge or use a supported browser.');

  throwIfAborted(signal);
  const header = await readImageHeader(file);
  throwIfAborted(signal);
  if (header?.width && header?.height && header.width * header.height > MAX_IMAGE_PIXELS) {
    throw new Error('This image exceeds the 50-megapixel safety limit.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('The image could not be decoded. It may be damaged or use an unsupported encoding.');
  }

  try {
    throwIfAborted(signal);
    if (!bitmap.width || !bitmap.height) throw new Error('Image dimensions could not be read.');
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('This image exceeds the 50-megapixel safety limit.');

    const mime = settings.format === 'original'
      ? (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type
        : ['image/jpeg', 'image/png', 'image/webp'].includes(header?.mime) ? header.mime
          : ['image/jpeg', 'image/png', 'image/webp'].includes(extensionMime) ? extensionMime
            : 'image/png')
      : settings.format;

    let target = calculateTarget(bitmap.width, bitmap.height, settings);
    if (target.width * target.height > MAX_IMAGE_PIXELS) {
      throw new Error('The requested output frame exceeds the 50-megapixel safety limit. Reduce the dimensions.');
    }
    let canvas = renderToCanvas(bitmap, target, mime, settings.background);
    let encoded = await encodeWithinLimit(canvas, mime, settings.quality, settings.maxBytes, { signal });

    // When only a file-size ceiling is set, preserve the source first, then step down resolution.
    if (!encoded.metLimit && settings.maxBytes && !settings.width && !settings.height && mime !== 'image/png') {
      let width = target.width;
      let height = target.height;
      for (let pass = 0; pass < 18 && !encoded.metLimit && Math.max(width, height) > 256; pass += 1) {
        throwIfAborted(signal);
        width = Math.max(1, Math.floor(width * 0.88));
        height = Math.max(1, Math.floor(height * 0.88));
        target = { width, height, draw: { x: 0, y: 0, width, height } };
        canvas = renderToCanvas(bitmap, target, mime, settings.background);
        encoded = await encodeWithinLimit(canvas, mime, settings.quality, settings.maxBytes, { signal });
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
        ? 'The PNG is lossless. Its requested size limit could not be reached; use JPEG/WebP or reduce the dimensions.'
        : downscaled
          ? 'The size limit could not be reached even after reducing the image resolution.'
          : 'The size limit could not be reached at the requested dimensions. Reduce the frame or choose another format.';

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
