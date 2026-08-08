# Registers a daily Windows Task Scheduler task that runs the Veridian backend
# backup script at 2:00 AM.
#
# Usage (run as Administrator from the veridian-backend directory):
#   powershell -ExecutionPolicy Bypass -File .\src\scripts\install-scheduled-backup-windows.ps1
#
# Equivalent one-liner via schtasks.exe, if you'd rather register it yourself:
#   schtasks /Create /TN "VeridianBackendBackup" /TR "node src\scripts\backup.js" /SC DAILY /ST 02:00 /F

$ErrorActionPreference = "Stop"

$taskName = "VeridianBackendBackup"
$projectDir = (Get-Location).Path
$nodePath = (Get-Command node).Source

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "src\scripts\backup.js" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily backup of Veridian leads database" -Force

Write-Host "Registered scheduled task '$taskName' to run daily at 2:00 AM."
