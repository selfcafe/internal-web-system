@echo off
echo ==== %date% %time% ==== >> "%~dp0logs\import_stera_daily_sales.log"
"C:\Users\80000785\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0import_stera_daily_sales.py" >> "%~dp0logs\import_stera_daily_sales.log" 2>&1
