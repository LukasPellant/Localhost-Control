param(
  [ValidateSet("chrome", "firefox")]
  [string]$Target = "chrome"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $Root
try {
  node "scripts/package-extension.mjs" "--target=$Target"
  if ($LASTEXITCODE -ne 0) {
    throw "Extension package failed for $Target"
  }
}
finally {
  Pop-Location
}
