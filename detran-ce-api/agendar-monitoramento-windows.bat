@echo off
setlocal
cd /d "%~dp0"

set TASK_NAME=Monitoramento Detran e Tacografo
set HORARIO=%1

if "%HORARIO%"=="" set HORARIO=12:00

echo Criando tarefa "%TASK_NAME%" para %HORARIO% (seg-sex)...
schtasks /Create /F /SC WEEKLY /D MON,TUE,WED,THU,FRI /TN "%TASK_NAME%" /TR "\"%~dp0rodar-monitoramento-combinado.bat\"" /ST %HORARIO%

echo.
echo Tarefa criada. Para testar agora, execute:
echo rodar-monitoramento-combinado.bat
pause
