@echo off
rem Elimina la tarea programada del puente. No borra la configuracion, el estado ni los registros.
schtasks /Delete /TN "Cosprobell\Puente" /F
