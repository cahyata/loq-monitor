#Requires -RunAsAdministrator
# LOQ Monitor | Install the SensorService scheduled task
# Author: cahyata
# Copyright (c) 2026 cahyata
<#
.SYNOPSIS
  Registers SensorService as a scheduled task that starts at logon with the highest run level.

.DESCRIPTION
  The task runs under the current user, so the service starts without a UAC prompt.
  It replaces any running copy of the service and starts the task immediately.

.PARAMETER Exe
  Path to SensorService.exe. Defaults to SensorService\out\SensorService.exe in this repository.

.PARAMETER TaskName
  Name of the scheduled task.
#>
param(
    [string]$Exe = (Join-Path $PSScriptRoot '..\SensorService\out\SensorService.exe'),
    [string]$TaskName = 'LOQ Monitor Service'
)

$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$user = "$env:USERDOMAIN\$env:USERNAME"

$action    = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory (Split-Path $Exe)
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable

Get-Process SensorService -ErrorAction SilentlyContinue | Stop-Process -Force
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Task '$TaskName' registered for $user and started."
Write-Host "Executable: $Exe"
