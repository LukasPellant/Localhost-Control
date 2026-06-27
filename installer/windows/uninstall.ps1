$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$OutDir = Join-Path $PSScriptRoot "out"

$Browser = "brave"
$KeepFiles = $false

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
      default {
        throw "Unknown argument: $($values[$i])"
      }
    }
  }

  if (@("brave", "chrome", "chromium", "edge", "all") -notcontains $Browser) {
    throw "Unsupported browser '$Browser'. Use brave, chrome, chromium, edge, or all."
  }
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
