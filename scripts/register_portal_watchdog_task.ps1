$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"C:\Users\80000785\internal-web-system\scripts\run_watchdog_portal_health.vbs"' -WorkingDirectory "C:\Users\80000785\internal-web-system\scripts"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal -UserId "80000785" -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -DontStopOnIdleEnd -StartWhenAvailable

Register-ScheduledTask -TaskName "InternalPortalHealthWatchdog" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "社内ポータルの本番Web App(?action=getSettings)を10分おきに監視し、「承認が必要です」等の異常応答を検知したらkaihipay-gbp-approval-bot経由でLINE WORKSへ即時通知する(2026-08-22追加、監視対象と別のGASプロジェクト経由なので同じOAuth認可切れの影響を受けない)"
