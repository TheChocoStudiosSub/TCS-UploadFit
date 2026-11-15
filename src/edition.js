export const EDITIONS = Object.freeze({
  demo: Object.freeze({
    id: 'demo',
    maxImages: 5,
    maxInputBytes: 10 * 1024 * 1024,
    maxBatchOutputBytes: 50 * 1024 * 1024,
    maxImagePixels: 20_000_000,
    maxOutputEdge: 16_000,
    showDemoBadge: true,
    badgeText: 'DEMO TCS',
    title: { en: 'TCS UploadFit — Demo', id: 'TCS UploadFit — Demo' },
    description: {
      en: 'TCS UploadFit demo: prepare and preview images locally with a limited public capacity.',
      id: 'Demo TCS UploadFit: siapkan dan pratinjau gambar secara lokal dengan kapasitas demo terbatas.'
    }
  }),
  store: Object.freeze({
    id: 'store',
    maxImages: 5,
    maxInputBytes: 15 * 1024 * 1024,
    maxBatchOutputBytes: 40 * 1024 * 1024,
    maxImagePixels: 20_000_000,
    maxOutputEdge: 16_000,
    showDemoBadge: false,
    badgeText: '',
    title: { en: 'TCS UploadFit — Image preparation', id: 'TCS UploadFit — Persiapan gambar' },
    description: {
      en: 'Resize, compress and convert images locally before uploading. Inspect the output and save files on your device.',
      id: 'Ubah ukuran, kompres, dan konversi gambar secara lokal sebelum diunggah. Periksa hasil dan simpan file di perangkat.'
    }
  })
});

// Local development defaults to demo. The build script selects the edition in dist.
export const ACTIVE_EDITION = 'demo';
export const EDITION = EDITIONS[ACTIVE_EDITION];

export function formatEditionBytes(bytes, language = 'en') {
  const mb = 1024 * 1024;
  const kb = 1024;
  if (bytes >= mb && bytes % mb === 0) return `${bytes / mb} MB`;
  if (bytes >= kb && bytes % kb === 0) return `${bytes / kb} KB`;
  return `${bytes.toLocaleString(language === 'id' ? 'id-ID' : 'en-US')} B`;
}
