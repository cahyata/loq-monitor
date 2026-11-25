# LOQ Monitor | Print the changelog section of one version
# Author: cahyata
# Copyright (c) 2026 cahyata
<#
.SYNOPSIS
  Prints the section of CHANGELOG.md for one version, for use as GitHub Release notes.

.PARAMETER Version
  Version without the leading v, for example 0.1.2.

.PARAMETER Changelog
  Path to the changelog. Defaults to CHANGELOG.md in the repository root.
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Changelog = (Join-Path $PSScriptRoot '..\CHANGELOG.md')
)

$ErrorActionPreference = 'Stop'
$lines = Get-Content -LiteralPath $Changelog
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith("## [$Version]")) { $start = $i; break }
}
if ($start -lt 0) { throw "CHANGELOG.md has no section for version $Version." }

$end = $lines.Count
for ($i = $start + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^## \[' -or $lines[$i] -match '^\[[^\]]+\]: ') { $end = $i; break }
}
($lines[($start + 1)..($end - 1)] -join "`n").Trim()
