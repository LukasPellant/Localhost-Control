$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$HostEntry = Join-Path $Root "packages\native-host\dist\index.js"
$OutDir = Join-Path $PSScriptRoot "out"
$LauncherSource = Join-Path $PSScriptRoot "LocalhostControlHost.cs"
$LauncherExe = Join-Path $OutDir "LocalhostControlHost.exe"
$HostPathFile = Join-Path $OutDir "host-path.txt"
$ManifestPath = Join-Path $OutDir "$HostName.json"

$Browser = "brave"
$ExtensionId = $null
$SkipBuild = $false

function Read-OptionValue {
  param(
    [string[]]$Values,
    [int]$Index,
    [string]$Name
  )

  if ($Index + 1 -ge $Values.Count -or $Values[$Index + 1].StartsWith("-")) {
    throw "Missing value for $Name"
  }

  return $Values[$Index + 1]
}

function Read-InstallArgs {
  $values = @($args) | Where-Object { $_ -ne "--" }

  for ($i = 0; $i -lt $values.Count; $i++) {
    switch -Regex ($values[$i]) {
      "^-{1,2}browser$" {
        $script:Browser = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $i++
        continue
      }
      "^-{1,2}extension-id$" {
        $script:ExtensionId = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $i++
        continue
      }
      "^-{1,2}extensionid$" {
        $script:ExtensionId = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $i++
        continue
      }
      "^-{1,2}skip-build$" {
        $script:SkipBuild = $true
        continue
      }
      "^-{1,2}skipbuild$" {
        $script:SkipBuild = $true
        continue
      }
      default {
        throw "Unknown argument: $($values[$i])"
      }
    }
  }

  if (@("brave", "chrome", "chromium", "edge", "all") -notcontains $Browser) {
    throw "Unsupported browser '$Browser'. Use brave, chrome, chromium, edge, or all."
  }

  if (!$ExtensionId -or $ExtensionId -notmatch "^[a-p]{32}$") {
    throw "Missing or invalid extension id. Expected 32 characters using letters a-p."
  }
}

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

  if ($SkipBuild -and (Test-Path $LauncherExe)) {
    return
  }

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

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Get-RegistryTargets {
  $targets = @{
    brave = @(
      "HKCU:\Software\WOW6432Node\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName",
      "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
    )
    chrome = @(
      "HKCU:\Software\WOW6432Node\Google\Chrome\NativeMessagingHosts\$HostName",
      "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
    )
    chromium = @(
      "HKCU:\Software\WOW6432Node\Chromium\NativeMessagingHosts\$HostName",
      "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName"
    )
    edge = @(
      "HKCU:\Software\WOW6432Node\Microsoft\Edge\NativeMessagingHosts\$HostName",
      "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
    )
  }

  if ($Browser -eq "all") {
    return @($targets.Values | ForEach-Object { $_ })
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

  Write-Utf8NoBom -Path $ManifestPath -Value ($manifest | ConvertTo-Json -Depth 4)
  Write-Utf8NoBom -Path $HostPathFile -Value $HostEntry
}

function Register-Manifest {
  foreach ($keyPath in Get-RegistryTargets) {
    New-Item -Path $keyPath -Force | Out-Null
    Set-Item -Path $keyPath -Value $ManifestPath
    Write-Host "Registered $HostName at $keyPath"
  }
}

Read-InstallArgs @args
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
