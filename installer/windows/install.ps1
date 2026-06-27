param(
  [ValidateSet("brave", "chrome", "chromium", "edge", "all")]
  [string]$Browser = "brave",

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-p]{32}$")]
  [string]$ExtensionId,

  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$HostEntry = Join-Path $Root "packages\native-host\dist\index.js"
$OutDir = Join-Path $PSScriptRoot "out"
$LauncherSource = Join-Path $PSScriptRoot "LocalhostControlHost.cs"
$LauncherExe = Join-Path $OutDir "LocalhostControlHost.exe"
$HostPathFile = Join-Path $OutDir "host-path.txt"
$ManifestPath = Join-Path $OutDir "$HostName.json"

function Invoke-RepoBuild {
  if ($SkipBuild) { return }
  Push-Location $Root
  try {
    pnpm build
  }
  finally {
    Pop-Location
  }
}

function Build-Launcher {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

  $csc = Get-Command csc.exe -ErrorAction SilentlyContinue
  if ($csc) {
    & $csc.Source /nologo /target:exe /out:$LauncherExe $LauncherSource
    if ($LASTEXITCODE -ne 0) {
      throw "csc.exe failed to build LocalhostControlHost.exe"
    }
    return
  }

  try {
    Add-Type -TypeDefinition (Get-Content -Raw $LauncherSource) -OutputAssembly $LauncherExe -OutputType ConsoleApplication
  }
  catch {
    throw "Unable to compile native host launcher. Install .NET SDK or Visual Studio Build Tools, then rerun this script. $($_.Exception.Message)"
  }
}

function Get-RegistryTargets {
  $targets = @{
    brave = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
    chrome = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
    chromium = "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName"
    edge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
  }

  if ($Browser -eq "all") {
    return @($targets.Values)
  }

  return @($targets[$Browser])
}

function Write-NativeManifest {
  $manifest = [ordered]@{
    name = $HostName
    description = "Localhost Control native host"
    path = $LauncherExe
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }

  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $ManifestPath -Encoding UTF8
  Set-Content -Path $HostPathFile -Value $HostEntry -Encoding UTF8
}

function Register-Manifest {
  foreach ($keyPath in Get-RegistryTargets) {
    New-Item -Path $keyPath -Force | Out-Null
    (Get-Item $keyPath).SetValue("", $ManifestPath)
    Write-Host "Registered $HostName at $keyPath"
  }
}

Invoke-RepoBuild

if (!(Test-Path $HostEntry)) {
  throw "Native host entry not found at $HostEntry. Run pnpm build first or omit -SkipBuild."
}

Build-Launcher
Write-NativeManifest
Register-Manifest

Write-Host ""
Write-Host "Localhost Control native host installed."
Write-Host "Manifest: $ManifestPath"
Write-Host "Launcher: $LauncherExe"
Write-Host "Allowed origin: chrome-extension://$ExtensionId/"
