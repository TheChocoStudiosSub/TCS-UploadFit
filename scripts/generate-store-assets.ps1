[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourceLogo,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SourceLogo -PathType Leaf)) {
    throw "The source logo was not found: $SourceLogo"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$expectedHash = "7324f9660e9f1ee27212982ec310e71f1475a8161846e396be2ada7eb5b764be"
$actualHash = (Get-FileHash -LiteralPath $SourceLogo -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "The logo source is not the original owner-supplied file. Replace assets\tcs-uploadfit-logo.jpg with the exact 1408x768 JPEG. Expected SHA-256: $expectedHash. Actual: $actualHash."
}
try {
    $logo = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourceLogo))
}
catch {
    throw "The owner-supplied logo could not be decoded as a JPEG. Replace assets\tcs-uploadfit-logo.jpg with the original file. Details: $($_.Exception.Message)"
}
if ($logo.Width -ne 1408 -or $logo.Height -ne 768) {
    $actual = "{0}x{1}" -f $logo.Width, $logo.Height
    $logo.Dispose()
    throw "Wrong source logo dimensions ($actual). Expected 1408x768. Do not resize or crop the source."
}

function Write-ContainedPng {
    param([int]$Width, [int]$Height, [string]$FileName, [double]$Padding = 0.08)

    $canvas = [System.Drawing.Bitmap]::new(
        $Width,
        $Height,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        $innerWidth = $Width * (1.0 - (2.0 * $Padding))
        $innerHeight = $Height * (1.0 - (2.0 * $Padding))
        $scale = [Math]::Min($innerWidth / $logo.Width, $innerHeight / $logo.Height)
        $drawWidth = [Math]::Max(1, [int][Math]::Round($logo.Width * $scale))
        $drawHeight = [Math]::Max(1, [int][Math]::Round($logo.Height * $scale))
        $x = [int][Math]::Floor(($Width - $drawWidth) / 2.0)
        $y = [int][Math]::Floor(($Height - $drawHeight) / 2.0)
        $destination = [System.Drawing.Rectangle]::new($x, $y, $drawWidth, $drawHeight)
        $graphics.DrawImage($logo, $destination)

        $target = Join-Path $OutputDirectory $FileName
        $canvas.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host ("Created {0} ({1}x{2}, contain)" -f $target, $Width, $Height)
    }
    finally {
        $graphics.Dispose()
        $canvas.Dispose()
    }
}

try {
    Write-ContainedPng -Width 50 -Height 50 -FileName "StoreLogo.png"
    Write-ContainedPng -Width 44 -Height 44 -FileName "Square44x44Logo.png"
    Write-ContainedPng -Width 71 -Height 71 -FileName "Square71x71Logo.png"
    Write-ContainedPng -Width 150 -Height 150 -FileName "Square150x150Logo.png"
    Write-ContainedPng -Width 310 -Height 310 -FileName "Square310x310Logo.png"
    Write-ContainedPng -Width 310 -Height 150 -FileName "Wide310x150Logo.png"
    Write-ContainedPng -Width 620 -Height 300 -FileName "SplashScreen.png"
    Write-ContainedPng -Width 44 -Height 44 -FileName "Square44x44Logo.targetsize-24_altform-unplated.png"
}
finally {
    $logo.Dispose()
}
