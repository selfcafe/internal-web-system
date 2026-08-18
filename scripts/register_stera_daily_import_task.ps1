$action = New-ScheduledTaskAction -Execute "C:\Users\80000785\internal-web-system\scripts\run_import_stera_daily_sales.cmd" -WorkingDirectory "C:\Users\80000785\internal-web-system\scripts"

$trigger = New-ScheduledTaskTrigger -Daily -At "06:03"

$principal = New-ScheduledTaskPrincipal -UserId "80000785" -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -DontStopOnIdleEnd -StartWhenAvailable

Register-ScheduledTask -TaskName "SteraDailySalesImport" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "stera smart oneの注文詳細CSVを毎朝6時に前日分エクスポートし、stera_daily_salesへ確定値として取り込む(2026-08-15自動化)"
