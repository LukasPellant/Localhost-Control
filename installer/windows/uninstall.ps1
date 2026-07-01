$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$OutDir = Join-Path $PSScriptRoot "out"

$Browser = "all"
$KeepFiles = $false
$RegistryRoot = "HKCU:\Software"

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

function Read-UninstallArgs {
  $values = @($args) | Where-Object { $_ -ne "--" }

  for ($i = 0; $i -lt $values.Count; $i++) {
    switch -Regex ($values[$i]) {
      "^-{1,2}browser$" {
        $script:Browser = Read-OptionValue -Values $values -Index $i -Name $values[$i]
        $i++
        continue
      }
      "^-{1,2}keep-files$" {
        $script:KeepFiles = $true
        continue
      }
      "^-{1,2}keepfiles$" {
        $script:KeepFiles = $true
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
      default {
        throw "Unknown argument: $($values[$i])"
      }
    }
  }

  if (@("brave", "chrome", "chromium", "edge", "firefox", "all") -notcontains $Browser) {
    throw "Unsupported browser '$Browser'. Use brave, chrome, chromium, edge, firefox, or all."
  }
}

function Join-RegistryRoot {
  param([string]$Path)

  return (Join-Path $RegistryRoot $Path)
}

function Get-RegistryTargets {
  $targets = @{
    brave = @(
      (Join-RegistryRoot "WOW6432Node\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"),
      (Join-RegistryRoot "BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName")
    )
    chrome = @(
      (Join-RegistryRoot "WOW6432Node\Google\Chrome\NativeMessagingHosts\$HostName"),
      (Join-RegistryRoot "Google\Chrome\NativeMessagingHosts\$HostName")
    )
    chromium = @(
      (Join-RegistryRoot "WOW6432Node\Chromium\NativeMessagingHosts\$HostName"),
      (Join-RegistryRoot "Chromium\NativeMessagingHosts\$HostName")
    )
    edge = @(
      (Join-RegistryRoot "WOW6432Node\Microsoft\Edge\NativeMessagingHosts\$HostName"),
      (Join-RegistryRoot "Microsoft\Edge\NativeMessagingHosts\$HostName")
    )
    firefox = @(
      (Join-RegistryRoot "Mozilla\NativeMessagingHosts\$HostName")
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

Read-UninstallArgs @args

foreach ($keyPath in Get-RegistryTargets) {
  if (Test-Path $keyPath) {
    Remove-Item -Path $keyPath -Recurse -Force
    Write-Host "Removed $keyPath"
  }
}

if (!$KeepFiles -and (Test-Path $OutDir)) {
  Remove-Item -Path $OutDir -Recurse -Force
  Write-Host "Removed $OutDir"
}

Write-Host "Localhost Control native host uninstalled."
