@echo off
echo ==== %date% %time% ==== >> "%~dp0logs\watchdog_portal_health.log"
"C:\Users\80000785\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0watchdog_portal_health.py" >> "%~dp0logs\watchdog_portal_health.log" 2>&1
