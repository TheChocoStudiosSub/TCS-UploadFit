# TCS UploadFit: future Pro direction

This document is planning only. The current Store release is free. There is no payment, account, licence, entitlement, or feature-lock code in this release.

## Keep in the free edition

- Single-image resize, fit, crop and stretch.
- JPEG, PNG and WebP output, including supported source-format retention.
- Quality and file-size controls with an explicit warning when a target cannot be met.
- Batch preparation up to the published free limit and ZIP export.
- Indonesian and English interface.
- Saved local presets and local-only image handling.

Basic image preparation must remain useful without payment. The Store release should not make sign-in, a financial account, or a network connection necessary for its primary function.

## Possible Pro features after product validation

Only consider these after real users request them and reliability tests cover them:

1. Larger batch queues and folder-based batch workflows, with a clear memory budget.
2. More named presets and reusable output profiles.
3. Batch filename rules and repeatable export structures.
4. Optional metadata handling controls, with a clear explanation of which metadata is preserved or removed.
5. Additional output formats only where native browser encoding is available and verified.

Do not put routine resize, compress, convert, preview, or ZIP export behind a paywall.

## Price range to test

A reasonable first test is **Rp29.000 one-time** after the Pro workflows above exist and pass tests on representative Windows devices. Microsoft Store Indonesia examples checked on 16 November 2026 include Webp ImageConverter at Rp13.000, Resizely at a promotional Rp13.000 from Rp16.000, and JPG to WEBP / PNG to WEBP at a promotional Rp20.000 from Rp46.000. Rp29.000 sits between basic converters and a broader workflow; this is a future test price, not a claim that the current free feature set merits payment. Recheck local prices before launch.

References checked 16 November 2026:
- [Microsoft Store Indonesia, Photo & video paid apps](https://www.microsoft.com/en-id/store/top-paid/apps/pc?category=Photo+%26+video)
- [Microsoft Store Indonesia, Photo & video offers](https://www.microsoft.com/en-id/store/deals/apps/pc?category=Photo+%26+video&price=0.01to60000)

## Payments are not part of this release

For non-game Windows PC apps, Microsoft Store Policy 10.8 (version 7.20, effective 22 October 2026) permits a secure third-party purchase API or Microsoft Store in-app purchase API for digital items or services consumed in the app; the provider must be disclosed, the user authenticated and asked to confirm, PCI DSS applies when card data is handled, and the third-party API must be declared in Partner Center: [Microsoft Store Policy 10.8](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).

## Architecture note

The current edition metadata exposes simple feature flags through `src/edition.js`. Later releases can add tier capability maps and server-side or signed entitlement validation if needed, but no such mechanism should be added until a payment model is approved. A client-side feature flag alone is not a payment security boundary.
