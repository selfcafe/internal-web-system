@echo off
echo ==== %date% %time% ==== >> "%~dp0logs\poll_stera_realtime_sales.log"
"C:\Users\80000785\AppData\Local\Programs\Python\Python312\python.exe" "%~dp0poll_stera_realtime_sales.py" >> "%~dp0logs\poll_stera_realtime_sales.log" 2>&1
