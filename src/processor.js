import { EDITION, formatEditionBytes } from './edition.js';

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif']);
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|bmp|avif)$/i;
export const MAX_FILE_BYTES = EDITION.maxInputBytes;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_OUTPUT_EDGE = 16_000;

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
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_OUTPUT_EDGE) {
    throw new Error(`${label} must be a whole number between 1 and ${MAX_OUTPUT_EDGE.toLocaleString()} pixels.`);
  }
  return parsed;
}

export function normalizeSettings(raw = {}) {
  const width = positiveInteger(raw.width, 'Width');
  const height = positiveInteger(raw.height, 'Height');
  const maxSizeValue = raw.maxSize === '' || raw.maxSize === null || raw.maxSize === undefined
    ? null
    : Number(raw.maxSize);
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
  const qualityNumber = Number(raw.quality);
  const quality = Math.min(100, Math.max(25, Number.isFinite(qualityNumber) ? qualityNumber : 86)) / 100;
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
  let targetWidth = requestedWidth || Math.max(1, Math.round(sourceWidth * (requestedHeight / sourceHeight)));
  let targetHeight = requestedHeight || Math.max(1, Math.round(sourceHeight * (requestedWidth / sourceWidth)));

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

  // Fit uses an exact output frame; smaller images are centered without being enlarged.
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

function canvasToBlob(canvas, mime, quality) {
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

function renderToCanvas(bitmap, target, mime, background) {
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (mime === 'image/jpeg') {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, target.draw.x, target.draw.y, target.draw.width, target.draw.height);
  return canvas;
}

async function encodeWithinLimit(canvas, mime, requestedQuality, maxBytes) {
  const initial = await canvasToBlob(canvas, mime, requestedQuality);
  if (!maxBytes || initial.size <= maxBytes || mime === 'image/png') {
    return { blob: initial, quality: requestedQuality, metLimit: !maxBytes || initial.size <= maxBytes };
  }

  let low = 0.25;
  let high = requestedQuality;
  let bestUnderLimit = null;
  let lowestSize = initial;
  let usedQuality = requestedQuality;

  for (let attempt = 0; attempt < 9; attempt += 1) {
    const candidateQuality = (low + high) / 2;
    const candidate = await canvasToBlob(canvas, mime, candidateQuality);
    if (candidate.size < lowestSize.size) lowestSize = candidate;
    if (candidate.size <= maxBytes) {
      bestUnderLimit = candidate;
      usedQuality = candidateQuality;
      low = candidateQuality;
    } else {
      high = candidateQuality;
    }
  }

  if (bestUnderLimit) return { blob: bestUnderLimit, quality: usedQuality, metLimit: true };
  const minimumQuality = await canvasToBlob(canvas, mime, 0.25);
  if (minimumQuality.size < lowestSize.size) lowestSize = minimumQuality;
  return { blob: lowestSize, quality: 0.25, metLimit: lowestSize.size <= maxBytes };
}

export async function processImage(file, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  if (!(file instanceof Blob)) throw new Error('The selected item is not a readable file.');
  if (file.size === 0) throw new Error('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`This file exceeds the ${formatEditionBytes(MAX_FILE_BYTES)} per-image limit.`);
  if (!SUPPORTED_MIME_TYPES.has(file.type) && !SUPPORTED_EXTENSIONS.test(file.name || '')) {
    throw new Error('Unsupported format. Use JPEG, PNG, WebP, BMP or AVIF. Animated GIF and SVG are not supported.');
  }
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode images locally. Update Microsoft Edge or use a supported browser.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('The image could not be decoded. It may be damaged or use an unsupported encoding.');
  }

  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Image dimensions could not be read.');
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('This image exceeds the 50-megapixel safety limit.');

    const mime = settings.format === 'original'
      ? (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/png')
      : settings.format;

    let target = calculateTarget(bitmap.width, bitmap.height, settings);
    if (target.width * target.height > MAX_IMAGE_PIXELS) {
      throw new Error('The requested output frame exceeds the 50-megapixel safety limit. Reduce the dimensions.');
    }
    let canvas = renderToCanvas(bitmap, target, mime, settings.background);
    let encoded = await encodeWithinLimit(canvas, mime, settings.quality, settings.maxBytes);

    // If the user supplied only a file-size target, resolution may step down gradually.
    // Explicit dimensions remain fixed so the app never silently breaks a requested frame.
    if (!encoded.metLimit && settings.maxBytes && !settings.width && !settings.height) {
      let width = target.width;
      let height = target.height;
      for (let pass = 0; pass < 18 && !encoded.metLimit && Math.max(width, height) > 256; pass += 1) {
        width = Math.max(1, Math.floor(width * 0.88));
        height = Math.max(1, Math.floor(height * 0.88));
        target = { width, height, draw: { x: 0, y: 0, width, height } };
        canvas = renderToCanvas(bitmap, target, mime, settings.background);
        encoded = await encodeWithinLimit(canvas, mime, settings.quality, settings.maxBytes);
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
    const warning = encoded.metLimit
      ? null
      : mime === 'image/png'
        ? 'The PNG is lossless. Its requested size limit could not be reached; use JPEG/WebP or reduce the dimensions.'
        : 'The size limit could not be reached without changing your requested dimensions. Reduce the frame or choose another format.';

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
      quality: encoded.quality,
      metLimit: encoded.metLimit,
      reduction,
      warning
    };
  } finally {
    bitmap.close?.();
  }
}
