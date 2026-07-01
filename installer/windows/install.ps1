$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$DefaultExtensionId = "oamllgeaemchejbebgamdakjloahgjdc"
$DefaultFirefoxExtensionId = "localhost-control@lukaspellant.dev"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OutDir = Join-Path $PSScriptRoot "out"
$RustTargetExe = Join-Path $Root "target\release\localhost-control-host.exe"
$HostExe = Join-Path $OutDir "localhost-control-host.exe"

$Browser = "all"
$ExtensionId = $DefaultExtensionId
$ExtensionIdExplicit = $false
$FirefoxExtensionId = $DefaultFirefoxExtensionId
$RegistryRoot = "HKCU:\Software"
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
        $script:ExtensionIdExplicit = $true
        $i++
        continue
      }
      "^-{1,2}extensionid$" {
        $script:ExtensionId = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $script:ExtensionIdExplicit = $true
        $i++
        continue
      }
      "^-{1,2}firefox-extension-id$" {
        $script:FirefoxExtensionId = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $i++
        continue
      }
      "^-{1,2}registry-root$" {
        $script:RegistryRoot = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $i++
        continue
      }
      "^-{1,2}registryroot$" {
        $script:RegistryRoot = Read-OptionValue -Values $values -Index $i -Name $values[$i]
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

  if (@("brave", "chrome", "chromium", "edge", "firefox", "all") -notcontains $Browser) {
    throw "Unsupported browser '$Browser'. Use brave, chrome, chromium, edge, firefox, or all."
  }

  if ($Browser -ne "firefox" -and (!$ExtensionId -or $ExtensionId -notmatch "^[a-p]{32}$")) {
    throw "Missing or invalid extension id. Expected 32 characters using letters a-p."
  }

  if ($Browser -eq "firefox" -and $ExtensionIdExplicit) {
    $script:FirefoxExtensionId = $ExtensionId
  }

  if ($Browser -eq "firefox") {
    $script:ExtensionId = $FirefoxExtensionId
  }
}

function Build-RustHost {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  Remove-Item -Path (Join-Path $OutDir "LocalhostControlHost.exe"), (Join-Path $OutDir "host-path.txt") -Force -ErrorAction SilentlyContinue

  if ($SkipBuild) {
    if (!(Test-Path $HostExe)) {
      throw "Rust native host not found at $HostExe. Rerun without -SkipBuild."
    }
    return
  }

  if ((Test-Path $HostExe) -and !(Test-Path (Join-Path $Root "Cargo.toml"))) {
    Write-Host "Using bundled Rust native host at $HostExe"
    return
  }

  $cargo = Get-Command cargo -ErrorAction SilentlyContinue
  if (!$cargo) {
    if (Test-Path $HostExe) {
      Write-Host "Using bundled Rust native host at $HostExe"
      return
    }
    throw "Cargo was not found. Install Rust to build the Windows native host from source, or provide $HostExe and rerun with -SkipBuild."
  }

  Push-Location $Root
  try {
    & $cargo.Source build --release -p localhost-control-host
    if ($LASTEXITCODE -ne 0) {
      throw "cargo build failed for localhost-control-host"
    }
  }
  finally {
    Pop-Location
  }

  Copy-Item -Path $RustTargetExe -Destination $HostExe -Force
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Join-RegistryRoot {
  param([string]$Path)

  return (Join-Path $RegistryRoot $Path)
}

function Get-RegistryTargets {
  $targets = @{
    brave = @(
      @{ Browser = "chromium"; Path = Join-RegistryRoot "WOW6432Node\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName" },
      @{ Browser = "chromium"; Path = Join-RegistryRoot "BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName" }
    )
    chrome = @(
      @{ Browser = "chromium"; Path = Join-RegistryRoot "WOW6432Node\Google\Chrome\NativeMessagingHosts\$HostName" },
      @{ Browser = "chromium"; Path = Join-RegistryRoot "Google\Chrome\NativeMessagingHosts\$HostName" }
    )
    chromium = @(
      @{ Browser = "chromium"; Path = Join-RegistryRoot "WOW6432Node\Chromium\NativeMessagingHosts\$HostName" },
      @{ Browser = "chromium"; Path = Join-RegistryRoot "Chromium\NativeMessagingHosts\$HostName" }
    )
    edge = @(
      @{ Browser = "chromium"; Path = Join-RegistryRoot "WOW6432Node\Microsoft\Edge\NativeMessagingHosts\$HostName" },
      @{ Browser = "chromium"; Path = Join-RegistryRoot "Microsoft\Edge\NativeMessagingHosts\$HostName" }
    )
    firefox = @(
      @{ Browser = "firefox"; Path = Join-RegistryRoot "Mozilla\NativeMessagingHosts\$HostName" }
    )
  }

  if ($Browser -eq "all") {
    return @($targets.Values | ForEach-Object { $_ })
  }

  if ($Browser -eq "brave") {
    return @($targets["brave"] + $targets["chrome"] + $targets["chromium"])
  }

  return @($targets[$Browser])
}

function Write-NativeManifest {
  param([string]$TargetBrowser)

  $manifestPath = Join-Path $OutDir "$HostName.json"
  $manifest = [ordered]@{
    name = $HostName
    description = "Localhost Control native messaging host"
    path = $HostExe
    type = "stdio"
  }

  if ($TargetBrowser -eq "firefox") {
    $manifestPath = Join-Path $OutDir "$HostName.firefox.json"
    $manifest.allowed_extensions = @($FirefoxExtensionId)
  } else {
    $manifest.allowed_origins = @("chrome-extension://$ExtensionId/")
  }

  Write-Utf8NoBom -Path $manifestPath -Value ($manifest | ConvertTo-Json -Depth 4)
  return $manifestPath
}

function Register-Manifest {
  foreach ($target in Get-RegistryTargets) {
    $manifestPath = Write-NativeManifest -TargetBrowser $target.Browser
    New-Item -Path $target.Path -Force | Out-Null
    Set-Item -Path $target.Path -Value $manifestPath
    Write-Host "Registered $HostName at $($target.Path)"
  }
}

Read-InstallArgs @args
Build-RustHost
Register-Manifest

Write-Host ""
Write-Host "Localhost Control native host installed."
Write-Host "Manifest directory: $OutDir"
Write-Host "Host: $HostExe"
if ($Browser -eq "firefox") {
  Write-Host "Allowed Firefox extension: $FirefoxExtensionId"
} else {
  Write-Host "Allowed origin: chrome-extension://$ExtensionId/"
  Write-Host "Allowed Firefox extension: $FirefoxExtensionId"
}
