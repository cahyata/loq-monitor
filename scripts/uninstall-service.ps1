#Requires -RunAsAdministrator
# LOQ Monitor | Remove the SensorService scheduled task
# Author: cahyata
# Copyright (c) 2026 cahyata
<#
.SYNOPSIS
  Removes the scheduled task created by install-service.ps1 and stops the service.
#>
param([string]$TaskName = 'LOQ Monitor Service')

$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' removed."
} else {
    Write-Host "Task '$TaskName' not found."
}
Get-Process SensorService -ErrorAction SilentlyContinue | Stop-Process -Force

# A service that was ended while the Insights tab was open can leave its disk trace running.
if (Get-Command logman -ErrorAction SilentlyContinue) { & logman stop LOQMonitorDisk -ets 2>&1 | Out-Null }
