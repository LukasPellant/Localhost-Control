param(
  [ValidateSet("chrome", "firefox")]
  [string]$Target = "chrome"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ExtensionDir = Join-Path $Root "packages\extension"
$DistDir = Join-Path $ExtensionDir "dist"
$PackageDir = Join-Path $Root "dist\chrome-store"
if ($Target -eq "firefox") {
  $PackageDir = Join-Path $Root "dist\firefox-addons"
}
$StageDir = Join-Path ([System.IO.Path]::GetTempPath()) "localhost-control-extension-$Target-$([System.Guid]::NewGuid().ToString('N'))"
$PackageMutex = [System.Threading.Mutex]::new($false, "LocalhostControlExtensionPackage")
$PackageLockTaken = $false

try {
  $PackageLockTaken = $PackageMutex.WaitOne([TimeSpan]::FromMinutes(10))
  if (!$PackageLockTaken) {
    throw "Timed out waiting for Localhost Control extension package lock."
  }

  Push-Location $Root
  try {
    pnpm --filter "@localhost-control/extension" build
  }
  finally {
    Pop-Location
  }

  $ManifestPath = Join-Path $StageDir "manifest.json"
  try {
    New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
    Copy-Item -Path (Join-Path $DistDir "*") -Destination $StageDir -Recurse -Force

    if (!(Test-Path $ManifestPath)) {
      throw "Extension manifest not found at $ManifestPath"
    }

    node (Join-Path $Root "scripts\prepare-extension-target.mjs") "--target=$Target" "--dist-dir=$StageDir"

    $manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
    $version = $manifest.version
    if (!$version) {
      throw "Unable to read extension version from $ManifestPath"
    }

    New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
    $zipSuffix = if ($Target -eq "chrome") { "chrome-store" } else { "firefox" }
    $zipPath = Join-Path $PackageDir "localhost-control-$version-$zipSuffix.zip"
    Get-ChildItem -Path $PackageDir -Filter "localhost-control-*.zip" -File -ErrorAction SilentlyContinue |
      Remove-Item -Force

    Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
    node (Join-Path $Root "scripts\validate-extension-package.mjs") "--target=$Target" "--artifact=$zipPath"
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
      throw "Extension package validation failed for $zipPath"
    }

    Write-Host "$Target extension package created:"
    Write-Host $zipPath
  }
  finally {
    Remove-Item -Path $StageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
finally {
  if ($PackageLockTaken) {
    $PackageMutex.ReleaseMutex()
  }
  $PackageMutex.Dispose()
}
