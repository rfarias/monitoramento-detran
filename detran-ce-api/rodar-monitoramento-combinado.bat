@echo off
cd /d "%~dp0"

netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WhatsApp] Evolution API nao esta rodando. Iniciando...
    start "Evolution API" /MIN /D "%~dp0..\evolution-api" cmd /c "npx tsx ./src/main.ts"
    timeout /t 20 /nobreak >nul
    echo [WhatsApp] Evolution API iniciada.
) else (
    echo [WhatsApp] Evolution API ja esta rodando na porta 8080.
)

npm run monitor-combinado
