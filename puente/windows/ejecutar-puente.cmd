@echo off
rem Ejecuta un ciclo del puente (clientes y productos) y agrega la salida al registro del dia.
rem Lo llama el Programador de tareas; tambien se puede ejecutar a mano para probar.
setlocal
cd /d "%~dp0" || exit /b 1
if not exist logs mkdir logs

rem El certificado del Service Layer debe definirse ANTES de iniciar Node: dentro de .env.puente no funciona.
if exist "%~dp0certificado\service-layer.pem" set "NODE_EXTRA_CA_CERTS=%~dp0certificado\service-layer.pem"

for /f %%f in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "HOY=%%f"
set "REGISTRO=logs\puente-%HOY%.log"

echo {"evento":"inicio","hora":"%DATE% %TIME%"} >> "%REGISTRO%"
node --env-file=.env.puente puente\ejecutar.js --once %* >> "%REGISTRO%" 2>&1
set "CODIGO=%ERRORLEVEL%"
echo {"evento":"fin","codigo":%CODIGO%,"hora":"%DATE% %TIME%"} >> "%REGISTRO%"

rem Conserva 30 dias de registros.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath './logs' -File -Filter 'puente-*.log' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | ForEach-Object { Remove-Item -LiteralPath $_.FullName }" >nul 2>&1
exit /b %CODIGO%
