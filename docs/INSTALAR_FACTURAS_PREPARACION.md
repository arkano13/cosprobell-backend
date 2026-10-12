# Preparación desde facturas de SAP

Preparado el 12 de octubre de 2026. Código local sin commit, despliegue ni
migraciones ejecutadas en producción. El paquete nuevo es
`puente-completo-facturas-combos.zip`; sustituye al paquete de preparación anterior.

## Reglas acordadas

- Se factura primero y se prepara la mercancía al final.
- Preparar solo líneas del almacén `02`, tanto facturas pagadas como pendientes.
- La preparación empieza con facturas emitidas desde **2026-10-12**, fecha fija.
  No cambiar esa fecha cada día: las facturas anteriores aún pendientes deben
  seguir disponibles. El historial financiero completo conserva su configuración
  independiente en `INSTALAR_FINANZAS.md`.
- Una factura se prepara completa. El backend impide finalizar con faltantes.
- Las notas de crédito vigentes basadas explícitamente en la factura y su línea
  descuentan cantidades antes de preparar. Si llegan durante el escaneo, la sesión
  pasa a revisión. Si llegan después del cierre, se conserva el historial preparado.
- Una anulación impide empezar y pone una preparación activa en revisión.
- Cobrar o cerrar financieramente la factura no equivale a prepararla.
- Las recetas de combos se siguen leyendo antes de preparar sus componentes.
- Las órdenes antiguas y sus lecturas se conservan. No aparecen en la lista nueva
  ni se mezclan con facturas que tengan el mismo DocEntry o DocNum.

## Alcance que debe comprobarse en SAP

Esta entrega admite facturas de artículos normales, no facturas de reserva. SAP
indica que las de reserva no descuentan inventario al facturar; requieren otro
tratamiento. Las facturas financieras pueden seguir consultándose completas.

La consulta de créditos usa `ORIN` y `RIN1`, `BaseType=13`, `BaseEntry` y `BaseLine`;
suma cantidades de venta e inventario por línea. Debe probarse la autorización de
esas tablas y columnas en SQLQueries del SAP instalado. No crea documentos SAP ni
modifica existencias: el registro solo crea una consulta SELECT.

Una nota sin referencia explícita a la línea de factura, una nota basada en una
devolución intermedia o un ajuste solo de dinero no se atribuyen por cliente,
nombre, importe o cercanía de fecha. Si usan esos casos, debemos revisar su vínculo
real antes de incorporarlos al descuento de unidades. No debe darse por validado
ese descuento mediante el historial financiero solamente.

El stock de una factura normal ya puede haber salido en SAP. La comparación de
inventario no vuelve a incluir estas preparaciones como pedidos sin entregar.
Mientras todavía no se prepare físicamente o falte sincronizar existencias,
puede haber diferencia temporal entre SAP y el conteo de la app.

Referencias SAP:
[API de Service Layer](https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html),
[campos de líneas de notas de crédito](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/RIN1.html),
[facturas de reserva](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~Documents~ReserveInvoice.html).

## 1. Publicar el backend antes de cambiar el servidor

Revisar los cambios, hacer commit y publicar solo cuando se decida hacerlo.
Comprobar las migraciones y aplicarlas desde la PC del proyecto:

```powershell
npx prisma migrate status --config=prisma7.config.js
npx prisma migrate deploy --config=prisma7.config.js
```

Las migraciones nuevas de esta preparación son:

- `20261010090000_combos`
- `20261011090000_combos_guardas`
- `20261012120000_preparacion_facturas`

Si quedan migraciones financieras pendientes, `migrate deploy` también las aplica:
revisar primero la salida de status. No usar reset ni vaciar datos.

Agregar en las variables **del backend en Railway**:

```dotenv
PREPARACION_FUENTE=facturas
```

Terminar o revisar las preparaciones de órdenes antiguas antes del cambio. Al
activar la fuente nueva, no se admiten nuevos escaneos ni cierres de la fuente vieja.
El historial permanece consultable. La app nueva identifica el tipo de documento.

## 2. Parar la tarea y actualizar los archivos

En PowerShell del servidor:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Esperar a que no esté Running y que terminen las ejecuciones manuales. Conservar
`.env.puente`, toda `.bridge-state`, `logs`, `ejecutar-oculto.vbs` y cualquier
carpeta `certificado`. No borrar el estado ni copiar configuración ficticia.
Copiar los archivos del paquete completo respetando las carpetas; no meter otra
carpeta contenedora dentro de `C:\puente-cosprobell`.

## 3. Configurar la fuente operativa en el servidor

Editar `.env.puente`, conservando las credenciales, TLS, límites y los nueve almacenes:

```dotenv
BRIDGE_PICKING_SOURCE=facturas
BRIDGE_PICKING_INVOICE_SINCE=2026-10-12
BRIDGE_BOM_ENABLED=true
```

Agregar `listasMateriales` al JSON de frecuencias existente, por ejemplo 3600.
Usar `facturasPreparacion` con el intervalo deseado, por ejemplo 600. Si no se
define, el puente hereda el intervalo existente de `pedidos`. La tarea de Windows
puede seguir cada cinco minutos; el presupuesto y la pausa permanecen iguales.

Se usa el archivo nuevo `.bridge-state\facturasPreparacion.json`; no reutilizar
ni renombrar `pedidos.json`. La clave real de SAP se guarda separada de la interna
de preparación. Las claves internas negativas nunca se mandan a SAP.

## 4. Registrar y comprobar la consulta de créditos

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/preparar-facturas.js --registrar
$LASTEXITCODE
```

Esperado: `consulta_facturas_lista`, resultado `creada` o `existente`, almacén `02`,
fecha `2026-10-12` y código 0. `registros:0` puede ser correcto si no hay facturas.
Un 403 requiere permiso para la consulta; un 400 requiere revisar el soporte de
columnas/sintaxis del SAP instalado. No habilitar la tarea si falla.

Después:

```powershell
node --env-file=.env.puente puente/ejecutar.js --once --sondeo
$LASTEXITCODE
```

Debe aparecer `sondeo` para `facturasPreparacion` y `listasMateriales`, código 0.
El sondeo lee SAP sin enviar datos al backend.

## 5. Primera carga y comprobaciones

```powershell
node --env-file=.env.puente puente/ejecutar.js --once
$LASTEXITCODE
```

Repetir cuando indique `pausa_por_presupuesto`. Esperar un ciclo completo de
`listasMateriales` y `facturasPreparacion`. No borrar huellas ni secuencias.

Instalar la app actualizada y comprobar una factura de la fecha inicial:

1. Número y cliente iguales a SAP; solo artículos de `02`.
2. Una factura pagada sigue disponible si no está preparada.
3. Un crédito vinculado de 2 sobre 5 deja 3 para preparar.
4. Un combo con crédito multiplica sus componentes por la cantidad neta.
5. Un crédito total no deja unidades para preparar.
6. Un crédito durante el escaneo exige revisión; no pierde las lecturas.
7. Finalizar exige todas las unidades y descuenta físicamente la bodega pequeña.
8. Un crédito después del cierre conserva la preparación original en el historial.
9. Una factura y una orden con el mismo DocEntry conservan identidades distintas.

Las pruebas con documentos reales deben hacerse en la empresa de pruebas; en
producción verificar documentos existentes, sin crear pruebas contables.

## 6. Reactivar y verificar una ejecución automática

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Start-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTaskInfo -TaskPath '\Cosprobell\' -TaskName 'Puente' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
Get-Content ('C:\puente-cosprobell\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

Esperado tras terminar: `LastTaskResult:0` y `fin` código 0. La tarea conserva
la condición actual de usuario05 conectado. El botón manual pedirá productos,
facturas de preparación y existencias en las siguientes ejecuciones.
La tarea financiera se configura aparte, según `INSTALAR_FINANZAS.md`.
