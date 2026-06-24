@echo off
cd /d "%~dp0"
set LOG_DIR=%~dp0data\logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set LOG_FILE=%LOG_DIR%\monitor-%date:~6,4%-%date:~3,2%-%date:~0,2%_%time:~0,2%%time:~3,2%.log
set LOG_FILE=%LOG_FILE: =0%
npm run monitor-combinado >> "%LOG_FILE%" 2>&1
