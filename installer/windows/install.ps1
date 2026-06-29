$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OutDir = Join-Path $PSScriptRoot "out"
$RustTargetExe = Join-Path $Root "target\release\localhost-control-host.exe"
$HostExe = Join-Path $OutDir "localhost-control-host.exe"
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

function Build-RustHost {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  Remove-Item -Path (Join-Path $OutDir "LocalhostControlHost.exe"), (Join-Path $OutDir "host-path.txt") -Force -ErrorAction SilentlyContinue

  if ($SkipBuild) {
    if (!(Test-Path $HostExe)) {
      throw "Rust native host not found at $HostExe. Rerun without -SkipBuild."
    }
    return
  }

  $cargo = Get-Command cargo -ErrorAction SilentlyContinue
  if (!$cargo) {
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
    path = $HostExe
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }

  Write-Utf8NoBom -Path $ManifestPath -Value ($manifest | ConvertTo-Json -Depth 4)
}

function Register-Manifest {
  foreach ($keyPath in Get-RegistryTargets) {
    New-Item -Path $keyPath -Force | Out-Null
    Set-Item -Path $keyPath -Value $ManifestPath
    Write-Host "Registered $HostName at $keyPath"
  }
}

Read-InstallArgs @args
Build-RustHost
Write-NativeManifest
Register-Manifest

Write-Host ""
Write-Host "Localhost Control native host installed."
Write-Host "Manifest: $ManifestPath"
Write-Host "Host: $HostExe"
Write-Host "Allowed origin: chrome-extension://$ExtensionId/"
