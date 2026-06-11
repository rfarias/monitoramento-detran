@echo off
echo Iniciando Evolution API (WhatsApp)...
cd /d "%~dp0evolution-api"
npx tsx ./src/main.ts
