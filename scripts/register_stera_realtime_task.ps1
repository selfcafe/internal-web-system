$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"C:\Users\80000785\internal-web-system\scripts\run_poll_stera_realtime_sales.vbs"' -WorkingDirectory "C:\Users\80000785\internal-web-system\scripts"

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal -UserId "80000785" -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -DontStopOnIdleEnd -StartWhenAvailable

Register-ScheduledTask -TaskName "SteraRealtimeSalesPoll" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "stera smart oneの内部集計APIを10分おきにポーリングし、当日の店舗別・商品別売上数量をGAS backend(stera_realtime_today)へ送信する(2026-08-15追加)" -Force
