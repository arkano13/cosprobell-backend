# Instalar «Actualizar todo» en el puente operativo

Esta actualización conecta el botón con las siete entidades del scanner. No activa
finanzas, no requiere migraciones, no borra datos y no modifica documentos de SAP.
El paquete del servidor contiene únicamente:

- puente/ejecutar.js
- puente/backend.client.js
- puente/sincronizar.js
- puente/solicitud-manual.js

## 1. PC: publicar el backend

En la terminal del repositorio cosprobell-backend, revisar y guardar los cambios:

```powershell
git status --short
git add puente/ejecutar.js puente/backend.client.js puente/sincronizar.js src/modules/sincronizacion/sincronizacion.routes.js src/modules/supervisor/supervisor.routes.js tests/integration/sincronizacion.test.js tests/integration/supervisor.test.js docs/INSTALAR_BOTON_MANUAL.md
git commit -m "Conectar actualización manual del scanner con el puente"
git fetch origin
git rebase origin/main
git push origin main
```

Si el rebase informa conflictos, detenerse y resolverlos antes de subir; no usar push
forzado. Los módulos solicitud-manual.js y solicitudes.service.js ya estaban versionados.

Esperar en Railway a que este commit esté desplegado correctamente. Después:

```powershell
Invoke-RestMethod 'https://cosprobell-backend-production.up.railway.app/health'
```

Esperado: status=ok y db=ok. Health confirma salud, no la versión: comprobar también
el commit del despliegue en Railway. No ejecutar Prisma ni limpiar ninguna tabla.

## 2. Servidor: detener la programación y esperar

En PowerShell del servidor:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Si aparece Running, esperar y consultar otra vez. No cerrar el proceso a la fuerza.
Si había una ejecución manual aparte, esperar también a que termine.

```powershell
$respaldoManual = 'C:\puente-cosprobell-respaldo-manual-' + (Get-Date -Format yyyyMMdd-HHmmss)
Copy-Item -LiteralPath 'C:\puente-cosprobell' -Destination $respaldoManual -Recurse
$respaldoManual
```

Esperado: una carpeta de respaldo en C:\ con fecha y hora. Conservarla.

## 3. Servidor: copiar solo cuatro archivos

Copiar puente-boton-manual.zip a C:\puente-boton-manual.zip. Luego:

```powershell
$origenManual = 'C:\actualizacion-boton-manual-' + (Get-Date -Format yyyyMMdd-HHmmss)
Expand-Archive -LiteralPath 'C:\puente-boton-manual.zip' -DestinationPath $origenManual
$archivosManual = @('ejecutar.js','backend.client.js','sincronizar.js','solicitud-manual.js')
foreach ($archivoManual in $archivosManual) {
  Copy-Item -LiteralPath (Join-Path $origenManual "puente\$archivoManual") -Destination (Join-Path 'C:\puente-cosprobell\puente' $archivoManual) -Force
}
```

No reemplazar .env.puente, estado, certificados, logs, ejecutar-oculto.vbs ni la tarea.
No usar aquí el ZIP financiero completo. La selección de almacenes queda igual.

## 4. Servidor: registrar que el puente admite el botón

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/ejecutar.js --once
$LASTEXITCODE
```

Esperado: 0. Puede mostrar omitida_por_frecuencia o pausa_por_presupuesto: son normales.
Esta ejecución registra las entidades habilitadas incluso si no corresponde consultar SAP.
Si aparece solicitud_no_disponible / HTTP_404, falta el despliegue correcto del backend.
Si aparece 401, revisar las credenciales del backend antes de repetir.

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Esperado: Ready o Running. Mantener la sesión Windows iniciada para la tarea Interactive.

## 5. PC: publicar el frontend e instalar la app

En el repositorio cosprobell-bodega-escritorio ya están preparados los cambios del botón
en la rama codex/actualizacion-manual. Ejecutar desde ese repositorio:

```powershell
git status --short
npm test
git add ui/js/api.js ui/js/app.js ui/js/sincronizacion-manual.js test/sincronizacion-manual.test.js test/sincronizacion.humo.mjs docs/ACTUALIZACION_MANUAL.md
git commit -m "Agregar botón de actualización manual en sincronización"
git push -u origin codex/actualizacion-manual
```

En GitHub, abrir un Pull Request de esa rama hacia main, revisar y fusionarlo. El
workflow «Instalador de Windows» de main generará el artefacto instalador-windows.
Descargar ese artefacto de Actions e instalar su .exe en los equipos del scanner.
Verificar que el workflow dispone de BODEGA_CLAVE_INGRESO; sin ella arma una app sin ingreso.
La copia local no contiene recursos/clave-ingreso.json, por eso no se entrega un
instalador local sin credenciales de ingreso. No pegar claves en Git.

Un push de la rama codex no genera instalador por sí solo con el workflow actual;
el PR o su integración a main sí. Cambiar archivos en la PC no actualiza la app instalada.

## 6. Probar el botón

1. Entrar como supervisor a Panel → Sincronización.
2. Pulsar «Actualizar todo» una sola vez.
3. Debe decir «Solicitud guardada. Esperando al puente».
4. En la siguiente ejecución debe mostrar «Actualizando: N de M entidades».
5. Al completar todas, debe decir «Actualización completada» y refrescar la tabla.

Con la tarea cada cinco minutos, el inicio puede esperar hasta el próximo disparo.
Los recorridos grandes continúan en varios disparos. No hay una duración total fija.
Si había un recorrido previo al clic, se termina y se inicia otro para incluir cambios recientes.
Si no quiere esperar al siguiente disparo, con el puente ya actualizado:

```powershell
Start-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
```

Comprobar resultado cuando termine:

```powershell
Get-ScheduledTaskInfo -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object LastRunTime, LastTaskResult, NextRunTime
Get-Content ('C:\puente-cosprobell\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

Esperado: LastTaskResult=0 al finalizar. Mientras corre, consultar también State.
La finalización de una ejecución no implica que toda la solicitud ya terminó: mirar
el progreso del botón. El sondeo --sondeo no registra ni atiende solicitudes manuales.

## Volver a la versión anterior

Desactivar la tarea, esperar que termine y restaurar únicamente los cuatro archivos
de código desde el respaldo. Conservar el estado actual y volver a habilitar la tarea.
Una solicitud activa dejará de avanzar mientras el puente anterior esté instalado.
