#Requires -RunAsAdministrator
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
