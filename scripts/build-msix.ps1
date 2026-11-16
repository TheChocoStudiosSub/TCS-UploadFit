[CmdletBinding()]
param(
    [string]$IdentityConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "packaging\\partner-center.identity.json"),
    [switch]$SkipUploadPackage,
    [switch]$KeepWork
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command not found: $Name" }
}

Require-Command "node"
Require-Command "dotnet"

if (-not (Test-Path -LiteralPath $IdentityConfigPath -PathType Leaf)) {
    throw "Partner Center values are missing. Copy packaging\\partner-center.identity.example.json to packaging\\partner-center.identity.json and fill all three values."
}
$config = Get-Content -LiteralPath $IdentityConfigPath -Raw | ConvertFrom-Json
foreach ($field in @("IdentityName", "Publisher", "PublisherDisplayName")) {
    $value = [string]$config.$field
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match "^<.*>$") { throw "Set $field to the exact value shown in Partner Center." }
}
if ([string]$config.IdentityName -notmatch "^[A-Za-z0-9.\-]{3,50}$") { throw "Invalid Partner Center IdentityName." }
if ([string]$config.Publisher -notmatch "^CN=.+") { throw "Publisher must be the exact CN value from Partner Center." }

$version = "1.0.0.0"
if ($config.Version) { $version = [string]$config.Version }
if ($version -notmatch "^\d+\.\d+\.\d+\.\d+$") { throw "Version must have four numeric components." }
$packageName = "TCS-UploadFit"
if ($config.PackageName) { $packageName = [string]$config.PackageName }
if ($packageName -notmatch "^[A-Za-z0-9._-]+$") { throw "Invalid PackageName." }

$sdkList = (& dotnet --list-sdks) -join ([Environment]::NewLine)
if ($LASTEXITCODE -ne 0 -or $sdkList -notmatch "(?m)^10\.") { throw ".NET 10 SDK is required." }
$kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\\10\\bin"
$makeAppx = Get-ChildItem -LiteralPath $kitsRoot -Filter "MakeAppx.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\MakeAppx\.exe" } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeAppx) { throw "MakeAppx.exe was not found. Install the Windows 10 SDK." }

$workRoot = Join-Path $repoRoot "dist\\msix-work"
$webOutput = Join-Path $workRoot "web"
$manifestTemplate = Join-Path $repoRoot "packaging\\WindowsApp\\Package.appxmanifest.template"
$hostProject = Join-Path $repoRoot "packaging\\WindowsApp\\TCS.UploadFit.Host.csproj"
$logo = Join-Path $repoRoot "assets\\tcs-uploadfit-logo.jpg"
$msixDirectory = Join-Path $repoRoot "dist\\msix"
if (-not (Test-Path -LiteralPath $logo -PathType Leaf)) { throw "Source logo missing: $logo" }
if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $workRoot, $msixDirectory | Out-Null

Write-Host "Building the local Store web edition..."
& node (Join-Path $repoRoot "scripts\\build.mjs") --edition=store --out $webOutput
if ($LASTEXITCODE -ne 0) { throw "Store web build failed." }
$webRoot = Join-Path $webOutput "store"

$escapeXml = { param([string]$Value) [System.Security.SecurityElement]::Escape($Value) }
$bundlePackages = Join-Path $workRoot "bundle"
New-Item -ItemType Directory -Force -Path $bundlePackages | Out-Null
$architectures = @(
    @{ Name = "x64"; Rid = "win-x64"; Manifest = "x64" },
    @{ Name = "x86"; Rid = "win-x86"; Manifest = "x86" }
)

foreach ($arch in $architectures) {
    Write-Host "Publishing Windows host for $($arch.Name)..."
    $stage = Join-Path $workRoot ("package-" + $arch.Name)
    $publish = Join-Path $stage "App"
    $assets = Join-Path $stage "Assets"
    New-Item -ItemType Directory -Force -Path $stage, $assets | Out-Null

    & (Join-Path $repoRoot "scripts\\generate-store-assets.ps1") -SourceLogo $logo -OutputDirectory $assets
    & dotnet publish $hostProject -c Release -r $arch.Rid --self-contained true -o $publish "-p:WebRootPath=$webRoot"
    if ($LASTEXITCODE -ne 0) { throw ".NET host publishing failed for $($arch.Name)." }

    $template = Get-Content -LiteralPath $manifestTemplate -Raw
    $template = $template.Replace("__IDENTITY_NAME__", (& $escapeXml ([string]$config.IdentityName)))
    $template = $template.Replace("__PUBLISHER__", (& $escapeXml ([string]$config.Publisher)))
    $template = $template.Replace("__PUBLISHER_DISPLAY_NAME__", (& $escapeXml ([string]$config.PublisherDisplayName)))
    $template = $template.Replace("__VERSION__", $version)
    $template = $template.Replace("__ARCHITECTURE__", $arch.Manifest)
    if ($template -match "__[A-Z_]+__") { throw "Unresolved manifest placeholder for $($arch.Name)." }
    Set-Content -LiteralPath (Join-Path $stage "AppxManifest.xml") -Value $template -Encoding UTF8

    $msixPath = Join-Path $msixDirectory ("{0}_{1}_{2}.msix" -f $packageName, $version, $arch.Name)
    & $makeAppx.FullName pack /d $stage /p $msixPath /o /v
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed for $($arch.Name)." }

    $verify = Join-Path $workRoot ("verify-" + $arch.Name)
    & $makeAppx.FullName unpack /p $msixPath /d $verify /o
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $verify "App\\wwwroot\\index.html"))) {
        throw "MSIX payload verification failed for $($arch.Name)."
    }
    Copy-Item -LiteralPath $msixPath -Destination $bundlePackages
}

$bundleManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Bundle xmlns="http://schemas.microsoft.com/appx/2013/bundle" Version="$version" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Packages>
    <Package Type="application" Version="$version" Architecture="x86" FileName="$( [System.IO.Path]::GetFileName((Join-Path $msixDirectory ("{0}_{1}_x86.msix" -f $packageName, $version))) )" />
    <Package Type="application" Version="$version" Architecture="x64" FileName="$( [System.IO.Path]::GetFileName((Join-Path $msixDirectory ("{0}_{1}_x64.msix" -f $packageName, $version))) )" />
  </Packages>
</Bundle>
"@
# MakeAppx requires the bundle manifest inside AppxMetadata; placing it at the
# content root makes MakeAppx treat the XML as a package payload.
$bundleMetadata = Join-Path $bundlePackages "AppxMetadata"
New-Item -ItemType Directory -Force -Path $bundleMetadata | Out-Null
Set-Content -LiteralPath (Join-Path $bundleMetadata "AppxBundleManifest.xml") -Value $bundleManifest -Encoding UTF8
$bundlePath = Join-Path $msixDirectory ("{0}_{1}.msixbundle" -f $packageName, $version)
& $makeAppx.FullName bundle /d $bundlePackages /p $bundlePath /o /v
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed to create the x86/x64 MSIX bundle." }

$bundleVerify = Join-Path $workRoot "verify-bundle"
& $makeAppx.FullName unbundle /p $bundlePath /d $bundleVerify /o
if ($LASTEXITCODE -ne 0) { throw "MSIX bundle verification failed." }
$bundleManifestCheck = Get-Content -LiteralPath (Join-Path $bundleVerify "AppxMetadata\\AppxBundleManifest.xml") -Raw -ErrorAction SilentlyContinue
if (-not $bundleManifestCheck) { $bundleManifestCheck = Get-Content -LiteralPath (Join-Path $bundleVerify "AppxBundleManifest.xml") -Raw }
if ($bundleManifestCheck -notmatch 'Architecture="x86"' -or $bundleManifestCheck -notmatch 'Architecture="x64"') {
    throw "The generated bundle does not contain both x86 and x64 architectures."
}

$uploadPath = Join-Path $msixDirectory ("{0}_{1}.msixupload" -f $packageName, $version)
if (-not $SkipUploadPackage) {
    if (Test-Path -LiteralPath $uploadPath) { Remove-Item -LiteralPath $uploadPath -Force }
    Compress-Archive -Path $bundlePath -DestinationPath $uploadPath -CompressionLevel Optimal
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($uploadPath)
    try {
        if (-not ($archive.Entries | Where-Object { $_.Name -eq (Split-Path -Leaf $bundlePath) })) { throw "MSIXUPLOAD is missing the MSIX bundle." }
    } finally { $archive.Dispose() }
}

Write-Host "x86 MSIX: $(Join-Path $msixDirectory ("{0}_{1}_x86.msix" -f $packageName, $version))"
Write-Host "x64 MSIX: $(Join-Path $msixDirectory ("{0}_{1}_x64.msix" -f $packageName, $version))"
Write-Host "MSIX bundle: $bundlePath"
if (-not $SkipUploadPackage) { Write-Host "MSIXUpload: $uploadPath" }
Write-Host "Unsigned Store packages. Microsoft Store signs the distributed package after certification."
if (-not $KeepWork) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
