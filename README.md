# TCS UploadFit

<p><img src="assets/icon.svg" width="88" height="88" alt="TCS UploadFit logo"></p>

**TCS UploadFit** is a local-first image preparation application by The Choco Studios. It is designed as a compact production bench: specify the target, prepare a batch, inspect the output, then export.

## Product principles

- **Local processing:** selected image pixels are read, transformed and encoded on the device. The app does not upload images to TCS.
- **No destructive edits:** source files are never overwritten.
- **Explicit constraints:** fixed dimensions are not silently changed to satisfy a file-size target. When the output cannot meet the target, the app shows a warning.
- **Honest validation:** the app checks format, pixel dimensions and file size; it does not certify image content or guarantee acceptance by a destination.
- **Low operating cost:** no account, cloud processing, paid API, analytics SDK or advertising SDK is required.

## Public demo

The public demo is built from `src/edition.js`: **5 images**, **10 MB per input image**, and **50 MB of prepared output per batch**. The Store build uses **10 images**, **20 MB per input image**, and **80 MB of prepared output per batch**. `npm run build` creates both editions from one configuration; `npm run build:demo` creates the public demo output.

[Open Demo TCS](https://tcs-uploadfit.vercel.app/)

## Features

- Resize using width, height or an exact two-sided frame.
- Fit, crop-to-fill or stretch modes.
- JPEG, PNG and WebP output.
- Quality tuning for lossy formats.
- File-size targeting with explicit pass/fail feedback.
- Sequential batch processing for up to 5 images in the public demo, with a 50 MB aggregate prepared-output cap.
- Before/after proof with actual dimensions and byte counts.
- ZIP export for completed batches.
- Local custom recipes and English/Indonesian interface.
- App-shell caching for offline use after the first successful load.

## Supported inputs and limits

JPEG, PNG, WebP, BMP and AVIF are accepted when the browser can decode them. Animated GIF and SVG are intentionally excluded. The demo accepts inputs up to 10 MB each and 50 MB of prepared output per batch. The Store edition accepts inputs up to 20 MB each and 80 MB of prepared output per batch. Maximum decoded and output dimensions are 50 megapixels. The underlying ZIP writer has a 256 MB safety ceiling, but the demo's lower batch cap applies first. Some formats depend on browser support.

## Build editions

Run `npm run build` with Node.js 20 or newer to generate `dist/demo` and `dist/store`. `npm run build:demo` generates the Vercel demo output. Edition limits, page titles, descriptions, and the service-worker cache version come from `src/edition.js`.

## Run locally

No build step or third-party runtime dependency is required. Use a local HTTP server because service workers need a secure context:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` in a current Chromium-based browser or another browser with `createImageBitmap`, Canvas `toBlob`, module scripts and service-worker support.

## Tests

Run the pure-logic test suite with Node.js 20 or newer:

```bash
npm test
```

For browser image-pipeline checks, serve the project and open `/tests/smoke.html`. The browser suite covers decode, resize, format export and ZIP signatures.

## Microsoft Store path

The current project is a PWA source. Before Store submission:

1. Publish the app on a stable HTTPS origin.
2. Validate the manifest, icons, service worker, privacy policy and offline behaviour on that origin.
3. Run the origin through PWABuilder and resolve its report-card findings.
4. Generate the Windows package with the exact Package Identity and Publisher ID from Partner Center.
5. Test the package on a clean Windows 10/11 installation and run Windows App Certification Kit.
6. Configure paid availability, regional pricing, age rating, listing assets and support information in Partner Center.

The repository does not contain a Store package, signing identity or configured price yet.

## Project map

- `index.html` — semantic workspace and application controls.
- `src/styles.css` — bespoke editorial-industrial design system.
- `src/app.js` — queue, presets, preview, downloads and language handling.
- `src/processor.js` — local decode, resize, encode and size targeting.
- `src/zip.js` — dependency-free ZIP writer.
- `src/i18n.js` — English and Indonesian strings.
- `sw.js` — offline app-shell caching.
- `manifest.webmanifest` — install metadata.
- `privacy.html`, `terms.html` — public policy pages.
- `tests/` — Node and browser checks.

## Ownership

© 2026 The Choco Studios. All rights reserved. Third-party rights remain with their respective owners.
