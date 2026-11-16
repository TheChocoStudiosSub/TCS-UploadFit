# Build and submit the Windows MSIX

The Store edition is a Windows desktop package. All HTML, CSS, JavaScript, worker scripts, images, legal pages, and manifest files are copied into the MSIX. The WinForms host maps a local folder to the fixed HTTPS origin `uploadfit.example` through WebView2 virtual host mapping. The Store edition does not register the web demo service worker and the host blocks off-origin page navigation.

## Build prerequisites

- Windows 10 version 2004 (build 19041) or later. The build produces x86 and x64 packages.
- .NET 10 SDK for Windows.
- Windows 10 SDK with `MakeAppx.exe` (x64).
- Node.js 20 or later.
- PowerShell 5.1 or later.
- Microsoft Edge WebView2 Evergreen Runtime installed on the Windows device.

The host is published self-contained for .NET, but Microsoft Edge WebView2 Evergreen Runtime is a separate Windows runtime dependency. If the runtime is missing, install it before launch. The app's HTML, scripts, styles, workers, icons, and legal pages are packaged inside the MSIX. Image preparation works offline after the package and runtime are installed. A first-time .NET package restore may contact NuGet during the build, not while the app is processing images.

## Fill the package identity

1. Create or open the app entry in Partner Center.
2. The repository already contains `packaging/partner-center.identity.json` with the exact values supplied by the owner:
   - IdentityName: `TheChocoStudios.TCSUploadFit`
   - Publisher: `CN=44D78410-EFD1-4C99-A426-54D6F00EAA4F`
   - PublisherDisplayName: `The Choco Studios`
3. The package version is `1.0.0.0`. Increase it to a four-part version for every Store update.

Do not invent these identity strings. The build script rejects the example placeholders. The private identity file is ignored by Git and must not be committed.

The current Individual developer sign-up flow is free and verifies the owner using a government-issued ID and selfie; start at [Microsoft's Partner Center developer-account instructions](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account?tabs=individual).

## Run the build

Open PowerShell in the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\build-msix.ps1
```

Or use the package script:

```powershell
npm run build:msix
```

Expected output:

- `dist/msix/TCS-UploadFit_1.0.0.0_x86.msix`
- `dist/msix/TCS-UploadFit_1.0.0.0_x64.msix`
- `dist/msix/TCS-UploadFit_1.0.0.0.msixbundle` (contains both architectures)
- `dist/msix/TCS-UploadFit_1.0.0.0.msixupload` (upload this bundle to Partner Center)

The build publishes separate self-contained x86 and x64 WebView2 host executables, packages each architecture with the same local web payload, validates both packages, then creates and verifies one MSIX bundle. It does not produce ARM64. On 64-bit Windows, the Store can select the x64 package; 32-bit Windows receives x86. WebView2 Evergreen Runtime must be installed with the matching architecture.

The actual package filename uses the Version and PackageName in the identity JSON. The build script creates Store icon PNGs from `assets/tcs-uploadfit-logo.jpg` using contain scaling on transparent canvases. It does not crop, stretch, recolour, or rewrite the source JPEG.

MakeAppx creates the unsigned `.msix` package, but it does not create a Store upload file. The build script places that package in a ZIP container and renames it to `.msixupload`; Microsoft says the optional `.appxsym` file may be omitted, but crash-symbol analysis will then be unavailable. Microsoft signs the Store-distributed MSIX after certification, so a private signing certificate is not required. See [MakeAppx documentation](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool) and [manual MSIX upload packaging](https://learn.microsoft.com/en-us/windows/msix/package/packaging-uwp-apps).

## Additional identifiers

The Package Family Name, Package SID, Store ID, Store URL, Store protocol link, and MSA app ID are not values to insert into `AppxManifest.xml`. The manifest uses the Identity Name, Publisher, PublisherDisplayName, package version, and architecture; the Store calculates or assigns the other identifiers.

Owner-provided reference values:
- Package Family Name: `TheChocoStudios.TCSUploadFit_2a8frjvje2zd4`
- Store ID: `9MZ61KZF53LW`
- Store page: `https://apps.microsoft.com/detail/9MZ61KZF53LW`
- Store protocol: `ms-windows-store://pdp/?productid=9MZ61KZF53LW`
- MSA app ID: `edcc091f-8dbb-4e32-889e-5fc1a9d0ff3d`

## Upload in Partner Center

1. Open the app's submission page.
2. In Packages, upload the `.msixupload` file. The standalone `.msix` is also available if Partner Center asks for an app package directly.
3. Wait for package validation and resolve any warnings or errors shown by Partner Center.
4. Complete the Store listing in English and Indonesian using `STORE-LISTING.md`.
5. Upload at least one PC screenshot. Microsoft allows up to ten desktop screenshots and recommends at least four. Screenshots must be PNG, at least 1366 × 768 pixels, and no larger than 50 MB. The five-shot plan is in the listing guide.
6. Set the product price to Free, review age rating and declarations, then submit for certification.

Microsoft's Partner Center listing guide says a text description and at least one screenshot are required: [Add and edit Store listing info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info). Screenshot sizes are documented here: [App screenshots and images](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/screenshots-and-images).

## Build environment limitation

A non-Windows environment without MakeAppx.exe cannot produce or validate the final Windows MSIX. Run the script on the Windows x64 build machine with the prerequisites above after Partner Center has supplied the identity strings.
