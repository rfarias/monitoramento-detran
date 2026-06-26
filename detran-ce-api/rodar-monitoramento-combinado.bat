@echo off
cd /d "%~dp0"
set LOG_DIR=%~dp0data\logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set DATE_STR=%%i
set LOG_FILE=%LOG_DIR%\monitor-%DATE_STR%.log
npm run monitor-combinado >> "%LOG_FILE%" 2>&1
