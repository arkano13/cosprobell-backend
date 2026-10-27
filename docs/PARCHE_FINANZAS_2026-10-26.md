# Actualización por archivos: primera carga financiera

Entrega del 26 de octubre de 2026. Son archivos nuevos o editados para la instalación del servidor revisada. No es un puente completo. No incluye la mejora operativa aplazada, no agrega una tarea financiera recurrente y no instala el selector del botón en la app.

## Qué contiene cada ZIP

- `parche-finanzas-puente-20261026.zip`: 10 archivos de funcionamiento, el verificador, un manifiesto y esta guía. Tres archivos nuevos de importación; tres módulos financieros editados; cliente SAP con el método GET financiero; contrato financiero; dos contratos de traslados actualizados según los merges. No incluye ni reemplaza `ejecutar.js`, `config.js`, `control.js`, `estado.js`, `sincronizar.js` ni `solicitud-manual.js` del puente operativo.
- `parche-finanzas-backend-20261026.zip`: cuatro archivos del receptor financiero. Son para el proyecto backend de tu máquina, no para la carpeta del servidor SAP. Se deben revisar e integrar sobre main actualizado conservando los merges recientes. No incluye una nueva migración.

El cliente SAP del parche conserva el comportamiento operativo de la base revisada; añade únicamente la lectura GET financiera. No incluye el cambio aplazado de verificación de almacenes.

## 1. Backend primero

Integrar los cuatro archivos de `parche-finanzas-backend-20261026.zip` en el backend actualizado y desplegarlo por el procedimiento habitual. Este parche no ejecuta commit, push, migraciones ni despliegues. No comenzar la carga sin publicar el receptor compatible con `get_parcial`.

Los registros se guardan en las tablas financieras existentes y se consultan por `/finanzas`; no se llenan automáticamente las tablas tradicionales de `/facturas` o `/pagos`. Para consultas se necesita una aplicación autorizada en `FINANZAS_APPS_AUTORIZADAS`.

## 2. Detener y conservar la instalación

En el servidor:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
```

Deshabilitar evita nuevos inicios; no termina una ejecución activa. Esperar a que finalice. Comprobar el estado y el último `fin` del log:

```powershell
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
Get-Content ('C:\puente-cosprobell\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 15
```

Si el lanzador oculto termina antes que Node, el estado de la tarea no basta. No copiar mientras siga activo un proceso Node del puente. No cerrar procesos Node ajenos. No borrar el candado para saltarse una ejecución.

Con el Explorador, guardar una copia privada de la carpeta actual. Esa copia contiene credenciales y estado: no enviarla ni subirla a Git.

## 3. Copiar solo el parche del puente

Extraer `parche-finanzas-puente-20261026.zip` fuera de la instalación. Copiar sus carpetas `puente`, `src`, `scripts` y el archivo `PARCHE_FINANZAS.json` dentro de `C:\puente-cosprobell`, combinando carpetas y reemplazando solo los archivos con el mismo nombre. No borrar las carpetas originales para sustituirlas por las del parche: faltan deliberadamente los archivos que no cambiaron.

Conservar `.env.puente`, las carpetas de estado y caché, `logs`, `node_modules`, certificados si existen, lanzadores y archivos personalizados. No hace falta reinstalar Node ni dependencias.

Comprobar la copia:

```powershell
cd C:\puente-cosprobell
node scripts/verificar-parche-finanzas.js
```

Esperado: `"correcto":true`. Este verificador lee archivos locales; no conecta a SAP ni al backend.

## 4. Ajustar configuración sin duplicar líneas

Conservar todas las credenciales, almacenes, TLS y frecuencias operativas. Cambiar o agregar solo estas entradas de `.env.puente`:

```dotenv
BRIDGE_MAX_REQUESTS=35
BRIDGE_STATE_DIR=C:\puente-cosprobell\.bridge-state-produccion
BRIDGE_FINANCE_ENABLED=true
BRIDGE_FINANCE_SINCE=1900-01-01
BRIDGE_FINANCE_LOCAL_CURRENCY=LPS
BRIDGE_FINANCE_SYSTEM_CURRENCY=USD
BRIDGE_FINANCE_ROUTE_FIELD=U_ZONA
BRIDGE_FINANCE_ZONE_FIELD=
BRIDGE_FINANCE_FREQUENCIES_JSON={}
BRIDGE_FINANCE_MAX_REQUESTS=10
BRIDGE_FINANCE_MAX_SECONDS=60
BRIDGE_FINANCE_IMPORT_PAUSE_SECONDS=30
```

Usar la misma carpeta de estado activa de siempre; en el servidor revisado era `.bridge-state-produccion`. Solo se expresa su ruta absoluta, no se crea otra carpeta de estado. El límite de 35 es del puente operativo; el importador usa tandas separadas de hasta 10 solicitudes, 60 segundos y 30 segundos de pausa. No confundir ambos presupuestos.

## 5. Sondeo financiero

Con la tarea aún deshabilitada, Node 22.13 o posterior (el Node 24 del servidor sirve) y el receptor publicado:

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/importar-finanzas.js --sondeo
$LASTEXITCODE
```

Esperado: `sondeo_financiero` por entidad y salida `0`. No envía registros al backend. Una muestra vacía no valida documentos reales; si falla, no iniciar la carga y revisar el error.

## 6. Cargar todo el historial financiero

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --cargar
```

Continúa solo por tandas hasta terminar. Para pausar, Ctrl+C una vez y esperar que termine la operación actual. Para retomar, repetir el mismo comando sin borrar estado. Si termina con error, resolverlo antes de repetir. No usar `--forzar`, `--registrar` ni el ejecutor financiero antiguo para esta carga.

Comprobar:

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --estado
```

Debe indicar `completo:true` y las 12 entidades completas. Comparar también documentos conocidos contra SAP y el receptor: un informe completo no garantiza por sí solo exactitud contable. La copia financiera queda a las fechas de lectura, sin actualización periódica por ahora.

Incluye empresa, clientes/rutas, vendedores, condiciones de pago, facturas/líneas/cuotas, notas de crédito/líneas, pagos/aplicaciones y movimientos contables. Sin conciliaciones ni partidas abiertas verificadas. Algunos importes no expuestos quedan en null (no cero), entre ellos el total completo de pagos, datos de cuotas y saldos FC/SC del cliente. No reconstruye todas las aplicaciones manuales de notas de crédito ni garantiza una cartera conciliada.

Lee datos mediante GET del Service Layer. Login y Logout usan su POST habitual; el envío al backend también usa POST para guardar en nuestra BD. No conecta directamente a la base de SAP ni registra consultas SQL.

## 7. Probar el puente operativo y programar cada dos minutos

Al terminar la importación, hacer una ejecución operativa:

```powershell
node --env-file=.env.puente puente/ejecutar.js --once
$LASTEXITCODE
```

Esperado: salida `0`. Una pausa por presupuesto es avance parcial; no significa que todos los datos terminaron. No forzar toda la información para comprobar únicamente la instalación.

Para la prueba acordada de cada 2 minutos, con la tarea todavía deshabilitada:

```powershell
$disparadorPuente = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
Set-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' -Trigger $disparadorPuente | Out-Null
(Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente').Triggers.Repetition | Select-Object Interval, Duration
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
```

Esperado: `Interval` = `PT2M`; empieza aproximadamente un minuto después de crear el disparador si la sesión y las condiciones de la tarea lo permiten. Se conservan acción, usuario y ajustes existentes. No instalar de nuevo la tarea. Confirmar `IgnoreNew`, revisar ejecuciones y rendimiento antes de dejar definitivo el intervalo. Conservar 35 consultas; no aumentar simultáneamente ambos límites.

## Lo que sigue pendiente

El selector de entidades del botón necesita un cambio separado de backend y frontend. Esta entrega financiera no lo implementa ni instala la mejora operativa descartada. Las frecuencias particulares de cada entidad siguen como estaban hasta acordarlas. La optimización de facturas/notas de crédito y el tratamiento robusto de cancelaciones son trabajos separados.
