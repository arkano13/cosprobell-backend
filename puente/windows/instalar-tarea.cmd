@echo off
rem Registra la tarea "Cosprobell\Puente": ejecuta el puente cada 15 minutos, aunque nadie haya iniciado sesion.
rem Ejecutar como administrador (clic derecho, "Ejecutar como administrador").
rem Si ya hay un ciclo en curso, Windows no inicia otro (comportamiento predeterminado de schtasks).
setlocal
set "RUTA=%~dp0ejecutar-puente.cmd"
schtasks /Create /TN "Cosprobell\Puente" /TR "\"%RUTA%\"" /SC MINUTE /MO 15 /RU SYSTEM /F
if errorlevel 1 (
  echo No se pudo crear la tarea. Verificar que la ventana se abrio como administrador.
  exit /b 1
)
echo Tarea creada. Para ejecutarla ahora: schtasks /Run /TN "Cosprobell\Puente"
