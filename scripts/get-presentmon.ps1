# LOQ Monitor | Download PresentMon
# Author: cahyata
# Copyright (c) 2026 cahyata
<#
.SYNOPSIS
  Downloads PresentMon, the frame timing tool behind the overlay FPS readings, and checks its hash.

.DESCRIPTION
  PresentMon is MIT licensed (Intel Corporation). The service looks for PresentMon.exe next to
  SensorService.exe, so copy the file there. The installer build does this for you.

.PARAMETER Destination
  Folder that receives PresentMon.exe.
#>
param(
    [Parameter(Mandatory)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$version = '2.6.0'
$sha256 = 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af'
$url = "https://github.com/GameTechDev/PresentMon/releases/download/v$version/PresentMon-$version-x64.exe"

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$target = Join-Path $Destination 'PresentMon.exe'
Invoke-WebRequest -Uri $url -OutFile $target

$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
if ($actual -ne $sha256) {
    Remove-Item -LiteralPath $target -Force
    throw "PresentMon $version has an unexpected hash ($actual). The file was deleted."
}
Write-Host "PresentMon $version saved to $target"
