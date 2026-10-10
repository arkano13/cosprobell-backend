@echo off
setlocal
cd /d "%~dp0" || exit /b 1
if not exist logs mkdir logs
if exist "%~dp0certificado\service-layer.pem" set "NODE_EXTRA_CA_CERTS=%~dp0certificado\service-layer.pem"
for /f %%f in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "HOY=%%f"
set "REGISTRO=logs\finanzas-%HOY%.log"
echo {"evento":"inicio_finanzas","hora":"%DATE% %TIME%"} >> "%REGISTRO%"
node --env-file=.env.puente puente\ejecutar-finanzas.js --once %* >> "%REGISTRO%" 2>&1
set "CODIGO=%ERRORLEVEL%"
echo {"evento":"fin_finanzas","codigo":%CODIGO%,"hora":"%DATE% %TIME%"} >> "%REGISTRO%"
powershell -NoProfile -Command "Get-ChildItem -LiteralPath './logs' -File -Filter 'finanzas-*.log' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | ForEach-Object { Remove-Item -LiteralPath $_.FullName }" >nul 2>&1
exit /b %CODIGO%
