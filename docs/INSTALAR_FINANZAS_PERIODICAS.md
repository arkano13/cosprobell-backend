# Activar las actualizaciones financieras junto al puente de producción

Preparado el 5 de noviembre de 2026. Este parche requiere el histórico GET y sus
12 entidades normalizadas. No incluye conciliaciones ni partidas verificadas.
No se ha desplegado ni ejecutado contra SAP o Railway durante su preparación.

## Qué cambia

- La misma tarea Windows ejecuta primero el puente operativo. Si hay errores o
  entidades pendientes, aplaza finanzas. No crea otra tarea ni cambia su intervalo.
- Después de una vuelta operativa sin pendientes, finanzas usa por defecto hasta
  8 consultas SAP y 25 segundos propios, con la pausa de al menos 1500 ms existente.
- Primero revisa nuevos DocEntry/JdtNum de facturas, notas de crédito, pagos y
  asientos. Parte de los máximos de las tablas ya importadas: no recarga el histórico.
- También revisa modificaciones de documentos existentes, con solapamiento de dos
  días desde el inicio de su revisión anterior. Comprueba por GET si SAP admite
  UpdateDate en cada recurso. Si no lo admite (HTTP 400), recorre el histórico
  de ese recurso por partes. Esa revisión puede tardar muchas ejecuciones;
  el log lo indica y las novedades conservan su turno prioritario.
- Lee clientes, vendedores y condiciones por páginas de hasta 20. Cada factura
  llega con todas sus líneas y cuotas; cada pago con sus aplicaciones. No se
  filtra la carga financiera por almacén ni por estado abierto.
- El backend guarda JSON y tablas normalizadas en una transacción. No hay que
  volver a ejecutar manualmente el normalizador después de cada actualización.
- Se conserva la fecha del histórico completo y se informa la última actualización
  parcial por separado. Los cambios invalidan cursores de consulta abiertos.
- El botón manual operativo y los comandos con --forzar conservan su alcance.
  No fuerzan finanzas ni vuelven a importar el histórico financiero.

Los límites de tiempo son comprobaciones entre consultas. Una consulta HTTP que
ya empezó puede demorar más; IgnoreNew debe seguir evitando tareas superpuestas.

## 1 Publicar primero el backend

El ZIP backend contiene solo archivos nuevos/modificados. Ya están también en
el repositorio de trabajo donde se preparó el parche. Revisar y publicar estos
cambios mediante el procedimiento habitual de Git/Railway; no mezclar el ZIP
backend con la carpeta del puente del servidor SAP.

La única tabla nueva es finanzas_actualizaciones, para conservar los acuses y
evitar que un reintento antiguo revierta un cambio posterior. La migración no
borra ni reinicia registros existentes.

En el repositorio del backend, con la conexión correcta de producción:

```powershell
npx prisma migrate deploy --config=prisma7.config.js
npx prisma generate --config=prisma7.config.js
```

Railway ya tiene preDeploy para migraciones. Comprobar que el despliegue del
backend nuevo termina correctamente. No usar migrate reset ni migrate dev.
La migración requerida es 20261105120000_finanzas_periodicas.

## 2 Deshabilitar la tarea y esperar que termine

En PowerShell del equipo Cosprobell:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,ProcessName
```

Deshabilitar impide nuevas ejecuciones, pero no corta la que ya corre. Esperar
su fin en el log y verificar que no quede el ejecutor del puente ni el importador
financiero manual trabajando. No matar otros procesos Node que no sean del puente.

## 3 Respaldar e instalar con el Explorador

Hacer copia de C:\puente-cosprobell antes de reemplazar archivos. Extraer
el ZIP del puente en una carpeta temporal. Copiar su contenido a
C:\puente-cosprobell, respetando las subcarpetas y reemplazando solo las coincidencias.

Archivos de ejecución del parche:

1. ejecutar-puente.cmd, en la raíz.
2. puente/ejecutar-produccion.js, nuevo coordinador.
3. puente/actualizar-finanzas-periodicas.js, comando manual de comprobación/ejecución.
4. puente/finanzas.periodicas.js, actualizador GET.
5. puente/finanzas.get.js, conversión de documentos completos.
6. src/shared/finanzas/periodicas.js, contrato compartido.

Conservar .env.puente, TODA .bridge-state-produccion, logs, node_modules,
ejecutar-oculto.vbs y el resto del puente instalado. No se incluye ninguno de
esos datos privados en los ZIP. El estado periódico nuevo se guarda en
.bridge-state-produccion/finanzas-periodicas.json; no modifica los cursores históricos.

## 4 Ajustar el env sin duplicar claves

Mantener las credenciales, URL, huella TLS, almacenes y frecuencias operativas.
Confirmar la ruta absoluta del estado y agregar estas claves una sola vez:

```dotenv
BRIDGE_STATE_DIR=C:\puente-cosprobell\.bridge-state-produccion
BRIDGE_FINANCE_ENABLED=true
BRIDGE_FINANCE_PERIODIC_ENABLED=false
BRIDGE_FINANCE_PERIODIC_MAX_REQUESTS=8
BRIDGE_FINANCE_PERIODIC_MAX_SECONDS=25
BRIDGE_FINANCE_PERIODIC_FREQUENCIES_JSON={"empresa":86400,"clientes":21600,"vendedores":21600,"condicionesPago":21600,"facturas":3600,"notasCredito":3600,"pagos":3600,"movimientos":3600}
```

Conservar además desde=1900-01-01, moneda local LPS, sistema USD y ruta U_ZONA
que ya se usaron en la carga. BRIDGE_FINANCE_FREQUENCIES_JSON puede seguir en {}:
las nuevas frecuencias son PERIODIC_FREQUENCIES_JSON. No ejecutar el antiguo
ejecutar-finanzas.js SQL ni registrar consultas financieras.

Las frecuencias anteriores programan la revisión de datos existentes desde su
último recorrido terminado. Las novedades se comprueban en cada turno financiero
disponible. Una revisión parcial continúa en las siguientes ejecuciones.

## 5 Comprobar compatibilidad sin leer SAP ni enviar documentos

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/actualizar-finanzas-periodicas.js --comprobar
$LASTEXITCODE
```

Esperado: finanzas_periodicas_listas, protocolo 1, normalizadas 12 y salida 0.
HTTP_404: falta desplegar el backend nuevo. FINANZAS_PERIODICAS_NO_LISTAS:
hay alguna carga o normalización pendiente. BASE_FINANCIERA_INCOMPATIBLE:
revisar empresa, fecha o monedas, sin borrar datos ni estados.

## 6 Probar una tanda financiera acotada

```powershell
node --env-file=.env.puente puente/actualizar-finanzas-periodicas.js --once
$LASTEXITCODE
```

Esperado: documento_financiero_actualizado y/o resumen_finanzas_periodicas.
finanzas_periodicas_pausadas con PRESUPUESTO_AGOTADO es normal: conserva el avance.
PUENTE_YA_BLOQUEADO indica que otro ejecutor posee el candado; esperar su fin.
Si hay error de datos/conexión, conservar la salida y no borrar el estado.

Comparar en nuestra BD/API una factura conocida, su pago/cancelación si existe,
sus líneas y un cliente antes de dejarlo automático. Un sondeo del servidor real
sigue siendo necesario: las pruebas incluidas usan SAP simulado y PostgreSQL efímero.

## 7 Activar el coordinador

Si las pruebas anteriores pasan, cambiar únicamente:

```dotenv
BRIDGE_FINANCE_PERIODIC_ENABLED=true
```

Probar una ejecución conjunta:

```powershell
node --env-file=.env.puente puente/ejecutar-produccion.js
$LASTEXITCODE
```

Esperado: primero configuracion_activa/resumen operativo; después los eventos
financieros. Si el resumen operativo tiene pendientes aparece
finanzas_aplazadas_por_operativa, que es la prioridad acordada.

## 8 Reactivar la misma tarea

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Start-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTaskInfo -TaskPath '\Cosprobell\' -TaskName 'Puente' |
  Select-Object LastRunTime,LastTaskResult,NextRunTime
Get-Content ('C:\puente-cosprobell\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 35
```

No cambia el intervalo Windows que ya tengan establecido ni las 35 consultas
operativas. Los 8 GET financieros son adicionales y solo se usan cuando no queda
trabajo operativo pendiente. No se incorpora finanzas al botón de la app en este parche.

## Volver al comportamiento anterior

Poner BRIDGE_FINANCE_PERIODIC_ENABLED=false. El mismo coordinador ejecutará solo
producción. No borrar la tabla nueva, ni la carpeta de estado, ni los datos financieros.
Los comandos directos puente/ejecutar.js siguen siendo exclusivamente operativos.

## Límites que se conservan

Sin conciliaciones ni partidas abiertas verificadas no hay cartera completamente
conciliada. Los campos desconocidos continúan null. Si SAP no ofrece UpdateDate,
las correcciones antiguas tardan en detectarse hasta que su revisión avance.
Los catálogos no retiran automáticamente fichas eliminadas de SAP: no inferir
inactividad por ausencia. Las lecturas no son una instantánea contable de toda SAP.
Un documento con más de 2000 líneas, una colección paginada o un cuerpo de más
de 950000 bytes se rechaza y conserva pendiente para revisión; no se trunca.
