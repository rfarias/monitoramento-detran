@echo off
setlocal
cd /d "%~dp0"

set TASK_NAME=Monitoramento Detran CE
set HORARIO=%1

if "%HORARIO%"=="" set HORARIO=08:00

echo Criando tarefa diaria "%TASK_NAME%" para %HORARIO%...
schtasks /Create /F /SC DAILY /TN "%TASK_NAME%" /TR "\"%~dp0rodar-monitoramento.bat\"" /ST %HORARIO%

echo.
echo Tarefa criada. Para testar agora, execute:
echo rodar-monitoramento.bat
pause
