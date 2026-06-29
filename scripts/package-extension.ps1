param(
  [ValidateSet("chrome", "firefox")]
  [string]$Target = "chrome"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ExtensionDir = Join-Path $Root "packages\extension"
$DistDir = Join-Path $ExtensionDir "dist"
$ManifestPath = Join-Path $DistDir "manifest.json"
$PackageDir = Join-Path $Root "dist\chrome-store"
if ($Target -eq "firefox") {
  $PackageDir = Join-Path $Root "dist\firefox-addons"
}

Push-Location $Root
try {
  pnpm --filter "@localhost-control/extension" build
}
finally {
  Pop-Location
}

if (!(Test-Path $ManifestPath)) {
  throw "Extension manifest not found at $ManifestPath"
}

node (Join-Path $Root "scripts\prepare-extension-target.mjs") "--target=$Target" "--dist-dir=$DistDir"

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

Compress-Archive -Path (Join-Path $DistDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "$Target extension package created:"
Write-Host $zipPath
