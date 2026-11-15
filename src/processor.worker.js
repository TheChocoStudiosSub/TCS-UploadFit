import { processImage } from './processor.js';

self.addEventListener('message', async event => {
  const { file, settings, language = 'en' } = event.data || {};
  try {
    const result = await processImage(file, settings, { language });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      name: error?.name || 'Error',
      error: error?.message || 'Image processing failed.'
    });
  }
});
