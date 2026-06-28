$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ExtensionDir = Join-Path $Root "packages\extension"
$DistDir = Join-Path $ExtensionDir "dist"
$ManifestPath = Join-Path $DistDir "manifest.json"
$PackageDir = Join-Path $Root "dist\chrome-store"

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

$manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
$version = $manifest.version
if (!$version) {
  throw "Unable to read extension version from $ManifestPath"
}

New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
$zipPath = Join-Path $PackageDir "localhost-control-$version-chrome-store.zip"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath
}

Compress-Archive -Path (Join-Path $DistDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Chrome Web Store package created:"
Write-Host $zipPath
