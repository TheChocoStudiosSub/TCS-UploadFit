# Microsoft Store listing draft

Release: **Free**  
Product: **TCS UploadFit**  
Platform: **Windows desktop, x64 MSIX**  
Account model: no account required  
In-app purchases: none in this release

## Short description

### English

Prepare images for upload on this device. Resize, compress and convert JPEG, PNG or WebP files, preview the results, then save individual files or a ZIP. Images are not uploaded by the app.

### Bahasa Indonesia

Siapkan gambar untuk diunggah langsung di perangkat ini. Ubah ukuran, kompres, dan konversi file JPEG, PNG, atau WebP, periksa hasilnya, lalu simpan satu per satu atau sebagai ZIP. Aplikasi tidak mengunggah gambar.

## Full description

### English

TCS UploadFit helps prepare image files before you upload them to a website, form, catalogue, or other service.

Choose image files from your device, set the output dimensions and format, then inspect the prepared result before saving it. Image processing runs locally in the app. TCS UploadFit does not send selected image contents to a server.

**What you can do**

- Resize to maximum width and height without enlarging a smaller source.
- Create an exact output frame with fit, crop, or stretch.
- Export JPEG, PNG, or WebP files.
- Adjust JPEG and WebP encoding quality.
- Set a requested maximum output file size. When the target cannot be met, the app reports that result.
- Compare the source and prepared image, dimensions, and file size.
- Prepare up to five images in one queue and export prepared files to a ZIP archive.
- Save named settings on this device and switch between English and Indonesian.

**Current limits**

Each source file can be up to 15 MiB. Images over 20 megapixels are rejected. Each output edge is limited to 16,000 pixels. A ZIP batch can contain up to 40 MiB of prepared files. JPEG, PNG, WebP, BMP and AVIF input are recognized by file signature; actual decoding depends on Windows WebView2 image support. Animated GIF and SVG are not supported. The output choices are JPEG, PNG and WebP.

TCS UploadFit is an image preparation utility. It does not assess image content or guarantee that a receiving website will accept the result. Check the requirements of the destination before uploading.

### Bahasa Indonesia

TCS UploadFit membantu menyiapkan file gambar sebelum diunggah ke situs, formulir, katalog, atau layanan lain.

Pilih file gambar dari perangkat, atur dimensi dan format keluaran, lalu periksa hasilnya sebelum disimpan. Pemrosesan gambar berjalan secara lokal di aplikasi. TCS UploadFit tidak mengirim isi gambar yang dipilih ke server.

**Fitur**

- Ubah ukuran berdasarkan batas lebar dan tinggi tanpa memperbesar gambar sumber yang lebih kecil.
- Buat bingkai keluaran dengan ukuran persis melalui mode muat, potong, atau tarik.
- Ekspor gambar ke format JPEG, PNG, atau WebP.
- Atur kualitas encoding JPEG dan WebP.
- Tetapkan target ukuran file keluaran. Jika target tidak dapat dicapai, aplikasi menampilkan hasilnya dengan jelas.
- Bandingkan gambar asli dan hasil, termasuk dimensi serta ukuran file.
- Proses maksimal lima gambar dalam satu antrean dan ekspor hasil sebagai arsip ZIP.
- Simpan nama pengaturan di perangkat ini dan gunakan antarmuka Bahasa Indonesia atau Inggris.

**Batas saat ini**

Setiap file sumber maksimal 15 MiB. Gambar di atas 20 megapiksel akan ditolak. Setiap sisi gambar keluaran dibatasi 16.000 piksel. Satu ekspor ZIP dibatasi hingga 40 MiB hasil pemrosesan. Input JPEG, PNG, WebP, BMP, dan AVIF dikenali berdasarkan signature file; kemampuan membaca gambar bergantung pada dukungan decoder WebView2 di Windows. GIF animasi dan SVG tidak didukung. Pilihan format keluaran adalah JPEG, PNG, dan WebP.

TCS UploadFit adalah alat persiapan gambar. Aplikasi tidak menilai isi foto dan tidak menjamin hasil akan diterima oleh situs tujuan. Periksa ketentuan layanan penerima sebelum mengunggah file.

## Search terms

Use up to these seven relevant search terms: image resizer, image compressor, batch image converter, reduce photo size, JPEG converter, WebP converter, image upload.

## Privacy statement

The Store edition processes selected image files locally in the Windows app package. The app does not upload image content, use an image-processing server, require an account, include an advertising SDK, or collect analytics. Image data remains in memory while it is being processed and is saved only when the user exports it. The app stores language choice and saved presets in local WebView2 storage on the device. Closing the app releases its in-memory image queue. The original files are not intentionally overwritten.

The app requires Microsoft Edge WebView2 Runtime as a Windows component. The runtime is not used as a remote image-processing service. No network connection is required for the image-preparation workflow after the app and runtime are installed.

Dukungan: thechocostudio@gmail.com

## Screenshots to capture

Microsoft requires at least one desktop screenshot, allows up to ten, and recommends at least four. Prepare **five PNG screenshots** at **1366 × 768 pixels or larger**; 1920 × 1080 is a practical capture size for readable controls. Each file must be below 50 MB. Capture the real packaged Windows app, not a mock-up.

1. **Main workspace:** complete app window showing the TCS logo, image settings, file picker area, and preview panel.
2. **Batch queue:** several real test images in the queue with filename, source size, and status visible.
3. **Resize controls:** maximum-size and exact-frame modes with the fit, crop, and stretch choices visible.
4. **Before and after:** one source image and its prepared result, with dimensions and file sizes visible.
5. **ZIP export:** completed batch and the ZIP export action or save confirmation.

Use the same real app state for both language listings, or capture a separate localized set for each language. Do not put promotional claims, fake ratings, or extra logos over the screenshots.

## Store package assets

Keep the owner-supplied source logo at `assets/tcs-uploadfit-logo.jpg` unchanged. The MSIX build script verifies that it is 1408 × 768, then generates package icons using contain scaling and transparent padding. It creates StoreLogo (50 × 50), Square44x44Logo (44 × 44), Square71x71Logo (71 × 71), Square150x150Logo (150 × 150), Square310x310Logo (310 × 310), Wide310x150Logo (310 × 150), and SplashScreen (620 × 300). The source JPEG remains unchanged.
