[CmdletBinding()]
param(
    [string]$IdentityConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "packaging\partner-center.identity.json"),
    [switch]$SkipUploadPackage,
    [switch]$KeepWork
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

Require-Command "node"
Require-Command "dotnet"

if (-not (Test-Path -LiteralPath $IdentityConfigPath -PathType Leaf)) {
    throw "Partner Center values are missing. Copy packaging\partner-center.identity.example.json to packaging\partner-center.identity.json, fill all three values from Partner Center, then run this script again."
}

$config = Get-Content -LiteralPath $IdentityConfigPath -Raw | ConvertFrom-Json
foreach ($field in @("IdentityName", "Publisher", "PublisherDisplayName")) {
    $value = [string]$config.$field
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match "^<.*>$") {
        throw "Set $field to the exact value shown in Partner Center. Placeholders are not accepted."
    }
}
if ([string]$config.IdentityName -notmatch "^[A-Za-z0-9.\-]{3,50}$") {
    throw "IdentityName must use the exact package identity name supplied by Partner Center."
}
if ([string]$config.Publisher -notmatch "^CN=.+") {
    throw "Publisher must be the full Publisher value supplied by Partner Center, including its certificate subject."
}

$version = "1.0.0.0"
if ($null -ne $config.Version -and -not [string]::IsNullOrWhiteSpace([string]$config.Version)) {
    $version = [string]$config.Version
}
if ($version -notmatch "^\d+\.\d+\.\d+\.\d+$") {
    throw "Version must contain four numeric components, for example 1.0.0.0."
}
$packageName = "TCS-UploadFit"
if ($null -ne $config.PackageName -and -not [string]::IsNullOrWhiteSpace([string]$config.PackageName)) {
    $packageName = [string]$config.PackageName
}
if ($packageName -notmatch "^[A-Za-z0-9._-]+$") {
    throw "PackageName contains unsupported characters."
}

$sdkList = (& dotnet --list-sdks) -join ([Environment]::NewLine)
if ($LASTEXITCODE -ne 0 -or $sdkList -notmatch "(?m)^10\.") {
    throw ".NET 10 SDK is required. Install the current .NET 10 LTS SDK and reopen PowerShell."
}

$kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$makeAppx = Get-ChildItem -LiteralPath $kitsRoot -Filter "MakeAppx.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\MakeAppx\.exe$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $makeAppx) {
    $kit = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\App Certification Kit\MakeAppx.exe"
    if (Test-Path -LiteralPath $kit -PathType Leaf) {
        $makeAppx = Get-Item -LiteralPath $kit
    }
}
if (-not $makeAppx) {
    throw "MakeAppx.exe was not found. Install the Windows 10 SDK from Visual Studio Installer or the Windows SDK download page."
}

$workRoot = Join-Path $repoRoot "dist\msix-work"
$webOutput = Join-Path $workRoot "web"
$stage = Join-Path $workRoot "package"
$publish = Join-Path $stage "App"
$assets = Join-Path $stage "Assets"
$manifestTemplate = Join-Path $repoRoot "packaging\WindowsApp\Package.appxmanifest.template"
$hostProject = Join-Path $repoRoot "packaging\WindowsApp\TCS.UploadFit.Host.csproj"
$logo = Join-Path $repoRoot "assets\tcs-uploadfit-logo.jpg"

if (-not (Test-Path -LiteralPath $logo -PathType Leaf)) {
    throw "The new source logo is missing: $logo"
}
if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $workRoot, $stage, $assets | Out-Null

Write-Host "Building the local Store edition..."
& node (Join-Path $repoRoot "scripts\build.mjs") --edition=store --out $webOutput
if ($LASTEXITCODE -ne 0) { throw "The Store web build failed." }

$webRoot = Join-Path $webOutput "store"
& (Join-Path $repoRoot "scripts\generate-store-assets.ps1") -SourceLogo $logo -OutputDirectory $assets

Write-Host "Publishing the Windows host..."
& dotnet publish $hostProject -c Release -r win-x64 --self-contained true -o $publish "-p:WebRootPath=$webRoot"
if ($LASTEXITCODE -ne 0) { throw ".NET host publishing failed." }

$escapeXml = {
    param([string]$Value)
    [System.Security.SecurityElement]::Escape($Value)
}
$template = Get-Content -LiteralPath $manifestTemplate -Raw
$template = $template.Replace("__IDENTITY_NAME__", (& $escapeXml ([string]$config.IdentityName)))
$template = $template.Replace("__PUBLISHER__", (& $escapeXml ([string]$config.Publisher)))
$template = $template.Replace("__PUBLISHER_DISPLAY_NAME__", (& $escapeXml ([string]$config.PublisherDisplayName)))
$template = $template.Replace("__VERSION__", $version)
if ($template -match "__[A-Z_]+__") { throw "The package manifest still contains unresolved placeholders." }
Set-Content -LiteralPath (Join-Path $stage "AppxManifest.xml") -Value $template -Encoding UTF8

$msixDirectory = Join-Path $repoRoot "dist\msix"
New-Item -ItemType Directory -Force -Path $msixDirectory | Out-Null
$msixPath = Join-Path $msixDirectory ("{0}_{1}_x64.msix" -f $packageName, $version)
$msixUploadPath = Join-Path $msixDirectory ("{0}_{1}_x64.msixupload" -f $packageName, $version)

Write-Host "Creating the unsigned MSIX package for Store submission..."
& $makeAppx.FullName pack /d $stage /p $msixPath /o /v
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed to create the MSIX package." }

Write-Host "Checking the package by unpacking it..."
$verify = Join-Path $workRoot "verify"
& $makeAppx.FullName unpack /p $msixPath /d $verify /o
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $verify "App\wwwroot\index.html"))) {
    throw "The MSIX package did not pass the unpack and payload check."
}

if (-not $SkipUploadPackage) {
    $uploadStage = Join-Path $workRoot "upload"
    New-Item -ItemType Directory -Force -Path $uploadStage | Out-Null
    Copy-Item -LiteralPath $msixPath -Destination $uploadStage
    if (Test-Path -LiteralPath $msixUploadPath) { Remove-Item -LiteralPath $msixUploadPath -Force }
    Compress-Archive -Path (Join-Path $uploadStage "*") -DestinationPath $msixUploadPath -CompressionLevel Optimal

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($msixUploadPath)
    try {
        $packageEntry = $archive.Entries | Where-Object { $_.Name -eq (Split-Path -Leaf $msixPath) }
        if (-not $packageEntry) { throw "The MSIX upload archive does not contain the generated app package." }
    }
    finally {
        $archive.Dispose()
    }
}

Write-Host "MSIX: $msixPath"
if (-not $SkipUploadPackage) { Write-Host "MSIXUpload: $msixUploadPath" }
Write-Host "Package is unsigned for Microsoft Store submission. Do not self-sign this Store upload."
if (-not $KeepWork) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
