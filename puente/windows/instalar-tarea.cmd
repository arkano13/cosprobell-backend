@echo off
rem Uso: instalar-tarea.cmd DOMINIO\cuenta-puente MINUTOS
rem La cuenta y el intervalo se eligen explicitamente con sistemas.
setlocal
if "%~1"=="" goto uso
if "%~2"=="" goto uso
if /I "%~1"=="SYSTEM" goto uso
if /I "%~1"=="NT AUTHORITY\SYSTEM" goto uso
set "INTERVALO_PUENTE=%~2"
powershell -NoProfile -Command "$n=0; if(-not [int]::TryParse($env:INTERVALO_PUENTE,[ref]$n) -or $n -lt 1 -or $n -gt 1440){exit 1}"
if errorlevel 1 goto uso
set "RUTA=%~dp0ejecutar-puente.cmd"
rem /RP * pide la clave; no se guarda aqui. No se sobrescriben tareas existentes.
schtasks /Create /TN "Cosprobell\Puente" /TR "\"%RUTA%\"" /SC MINUTE /MO %~2 /RU "%~1" /RP *
if errorlevel 1 (
  echo No se pudo crear la tarea. Verificar que la ventana se abrio como administrador.
  exit /b 1
)
echo Tarea creada. Para ejecutarla ahora: schtasks /Run /TN "Cosprobell\Puente"
exit /b 0
:uso
echo Uso: instalar-tarea.cmd DOMINIO\cuenta-puente MINUTOS
echo Usar una cuenta dedicada sin privilegios administrativos.
exit /b 1
