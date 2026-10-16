# Instalar finanzas mediante GET — alcance parcial

Preparado el 13 de octubre de 2026. Cambios locales, sin commit ni publicación automática.

## Qué incluye

Clientes (con ruta U_ZONA y saldo de ficha), vendedores, condiciones de pago, facturas y sus líneas, cuotas, notas de crédito y sus líneas, pagos recibidos, aplicaciones de pagos y movimientos contables. La configuración de empresa contiene las monedas confirmadas manualmente: local LPS y sistema USD.

No incluye conciliaciones ni partidas abiertas. No ofrece cartera completa ni antigüedad verificada. El backend rechaza esas consultas en este modo. Los importes que el recurso no expone quedan como `null`, nunca como cero inventado: por ejemplo, total del pago, cheques/tarjetas agregados, saldo no aplicado, saldo FC/SC del cliente y pagos por cuota. Las aplicaciones de notas de crédito no quedan reconstruidas completamente sin conciliaciones.

Solo se leen datos por GET del Service Layer. Login y Logout conservan el mecanismo existente. No se conecta a la base SAP, no registra SQLQueries y no necesita modificar tablas permitidas. No ejecutar los scripts de registro del índice OITR.

## 1. Validar y publicar el backend primero

En la computadora de desarrollo, dentro del repositorio:

```powershell
node --test
git diff --check
git status --short
```

La suite completa está pendiente: la aprobación automática para ejecutarla fuera del aislamiento no pudo completarse por un límite de uso. Las pruebas focalizadas se ejecutaron por separado; revisar el resultado final entregado junto al paquete.

Antes de publicar, revisar los cambios del receptor financiero y los contratos compartidos. Este cambio usa las tablas financieras existentes; no incorpora una migración Prisma nueva. Si esas tablas aún no están instaladas, revisar las migraciones pendientes antes de desplegar.

Publicar el backend por el procedimiento habitual del proyecto y esperar que el despliegue esté saludable. No instalar el nuevo emisor contra el backend anterior: los contratos ahora admiten importes desconocidos como null y el perfil `get_parcial`.

## 2. Copiar el paquete manualmente

En el servidor, deshabilitar la tarea operativa para que no comience mientras se copian archivos:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Deshabilitar no termina una ejecución que ya comenzó. Esperar su evento `fin` antes de copiar. Si existe una tarea financiera separada, también debe estar detenida durante la copia.

Con el Explorador, guardar una copia de la instalación actual. Extraer el ZIP en una carpeta aparte y copiar su contenido a `C:\puente-cosprobell`, reemplazando los archivos de código.

Conservar `.env.puente`, `.bridge-state`, `.bridge-state-produccion`, `logs`, `ejecutar-oculto.vbs` y cualquier certificado existente. No borrar estados, no renombrar `.env.puente.example` sobre el archivo real y no ejecutar `instalar-tarea.cmd` para esta actualización.

## 3. Editar la configuración existente

En `.env.puente`, actualizar estas entradas sin duplicarlas:

```dotenv
BRIDGE_FINANCE_READER=get
BRIDGE_FINANCE_ENABLED=true
BRIDGE_FINANCE_SINCE=1900-01-01
BRIDGE_FINANCE_LOCAL_CURRENCY=LPS
BRIDGE_FINANCE_SYSTEM_CURRENCY=USD
BRIDGE_FINANCE_ROUTE_FIELD=U_ZONA
BRIDGE_FINANCE_ZONE_FIELD=
BRIDGE_FINANCE_FREQUENCIES_JSON={}
BRIDGE_FINANCE_MAX_REQUESTS=10
BRIDGE_FINANCE_MAX_SECONDS=60
```

Conservar las credenciales, TLS, URL del backend, configuración operativa y `BRIDGE_STATE_DIR` actuales. `FREQUENCIES_JSON={}` permite completar la primera carga financiera; después, no inicia recorridos periódicos nuevos. Configuraremos sus frecuencias tras validar la primera carga y su duración.

## 4. Probar cada entidad, sin enviar datos al backend

```powershell
cd C:\puente-cosprobell
foreach ($e in @('empresa','clientes','vendedores','condicionesPago','facturas','facturaLineas','cuotas','notasCredito','notaCreditoLineas','pagos','aplicacionesPagos','movimientos')) {
  node --env-file=.env.puente puente/ejecutar-finanzas.js --sondeo "--entidad=$e"
  if ($LASTEXITCODE -ne 0) { throw "Falló el sondeo de $e. Detener y revisar la salida." }
  Start-Sleep -Seconds 2
}
```

Esperado: `finanzas_alcance` con `get_parcial`, `sondeo_financiero` por entidad y código 0. Cero registros puede ser válido para una colección vacía. La advertencia TLS existente puede seguir apareciendo. El sondeo valida una muestra; no garantiza que todo el historial sea válido.

Si aparece HTTP_400, HTTP_401, `FINANZA_SAP_INVALIDA` o `COLECCION_FINANCIERA_INCOMPLETA`, detener la instalación financiera y conservar la salida. No repetir credenciales fallidas ni modificar permisos de SAP para intentar resolverlo a ciegas.

## 5. Primera carga real

Con todos los sondeos correctos y el backend actualizado:

```powershell
node --env-file=.env.puente puente/ejecutar-finanzas.js --once
$LASTEXITCODE
```

Esperado: `ciclo_financiero`, posiblemente `pausa_por_presupuesto`, `resumen_financiero` y 0. Repetir el mismo comando cuando termine para continuar donde quedó. No usar `--forzar`, no borrar estados y no lanzar varias ventanas a la vez.

La primera carga pide todo el historial disponible desde 1900; no lo termina necesariamente en una ejecución. Se limita a 10 solicitudes y 60 segundos, con pausas de al menos 1,5 segundos. Las colecciones de líneas se leen por documento; un historial grande puede requerir muchas ejecuciones. No hay un tiempo total confirmado.

Cada entidad se publica cuando termina su recorrido. Para confirmar la primera carga, todas las entidades deben haber informado `completo:true` y estar disponibles en el receptor. Si aparece `LECTOR_FINANCIERO_DISTINTO`, hay una carga previa con otro perfil: detenerse y revisar esa transición sin borrar tablas ni estados.

## 6. Comprobar contra SAP

Comparar un cliente conocido, una factura, una nota de crédito y un pago con aplicaciones. Confirmar ruta, fechas, números, monedas e importes. En movimientos, comparar un período y cliente conocidos. No interpretar `null` como cero ni presentar esta carga como cartera conciliada.

## 7. Reactivar la operación habitual

Después de terminar la copia y las pruebas manuales:

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
```

Esa tarea sigue siendo la operativa: facturas de preparación, combos e inventario. Las finanzas tienen ejecutor separado y comparten un candado para evitar lecturas simultáneas desde estos ejecutores. Este paquete no crea una tarea financiera automática.

Las cabeceras de facturas y notas de crédito admiten lectura incremental. Pagos, aplicaciones, cuotas, líneas y movimientos se vuelven a recorrer en las actualizaciones; no afirmar que todos sean incrementales. Antes de automatizarlos, medir duración y carga del servidor.

## Estado para continuar en otro chat

Decisión firme: dejar fuera OITR/conciliaciones y partidas; no modificar configuración del Service Layer. Implementación GET parcial preparada localmente. Falta validar suite completa, publicar backend, instalar paquete, ejecutar sondeos reales y completar/contrastar primera carga. No se ha creado interfaz financiera nueva ni se ha publicado automáticamente este cambio.
