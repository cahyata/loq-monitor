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

.PARAMETER NoAutoStart
  Registers the task without the logon trigger. The service still starts now, and later from the
  app (START SERVICE button) or with: schtasks /run /tn "LOQ Monitor Service".
#>
param(
    [string]$Exe = (Join-Path $PSScriptRoot '..\SensorService\out\SensorService.exe'),
    [string]$TaskName = 'LOQ Monitor Service',
    [switch]$NoAutoStart
)

$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$user = "$env:USERDOMAIN\$env:USERNAME"

$action    = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory (Split-Path $Exe)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable

Get-Process SensorService -ErrorAction SilentlyContinue | Stop-Process -Force
$register = @{ TaskName = $TaskName; Action = $action; Principal = $principal; Settings = $settings; Force = $true }
if (-not $NoAutoStart) { $register.Trigger = New-ScheduledTaskTrigger -AtLogOn -User $user }
Register-ScheduledTask @register | Out-Null
Start-ScheduledTask -TaskName $TaskName

$when = if ($NoAutoStart) { 'without a logon trigger' } else { 'to start at logon' }
Write-Host "Task '$TaskName' registered for $user $when and started."
Write-Host "Executable: $Exe"
