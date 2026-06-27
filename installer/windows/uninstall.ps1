param(
  [ValidateSet("brave", "chrome", "chromium", "edge", "all")]
  [string]$Browser = "brave",

  [switch]$KeepFiles
)

$ErrorActionPreference = "Stop"

$HostName = "com.localhost_control.host"
$OutDir = Join-Path $PSScriptRoot "out"

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
