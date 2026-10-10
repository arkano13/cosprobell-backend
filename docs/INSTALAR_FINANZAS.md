# Segunda etapa: instalar la carga financiera

Preparada el 9 de octubre de 2026. Esta entrega contiene código, migración aditiva,
pruebas con datos ficticios y un paquete del puente. Todavía requiere sondeo en el
SAP instalado y comparación de saldos con sus reportes. No se ha desplegado ni
aplicado la migración en Railway desde esta entrega.

## Qué trae

| Entidad financiera | Datos |
|---|---|
| empresa | Moneda local y moneda del sistema |
| clientes | Código, nombre, activo/bloqueado, moneda, saldo local/FC/sistema, límite de crédito, vendedor, condición, zona y ruta configuradas |
| vendedores | Código, nombre, activo |
| condicionesPago | Código, nombre, días, meses y cantidad de cuotas |
| facturas / facturaLineas | Identificador, número, serie, cliente, fechas, estado/anulación, total/pagado en tres monedas, vendedor, condición, asiento y líneas de artículos o servicios |
| cuotas | Factura, cuota, vencimiento, total/pagado en tres monedas y estado |
| pagos / aplicacionesPagos | Recibo, cliente, fecha, moneda, totales, medios de pago, anulación, asiento y aplicación por tipo de documento/línea/cuota |
| notasCredito / notaCreditoLineas | Cabecera monetaria, estado/anulación y documentos de origen por línea |
| conciliaciones | Conciliación y cancelación vinculada, cliente, asiento/línea, documento/tipo/cuota, sentido e importes aplicados |
| movimientos | Cargos y abonos contables del cliente, incluidos apertura, anticipos y ajustes, con referencias y monedas |
| partidas | Partidas abiertas y saldos deudores/acreedores actuales por asiento/línea, vencimiento y moneda |

Las aplicaciones de una nota de crédito se consultan en conciliaciones. Su factura
base explica el origen comercial, no necesariamente dónde se aplicó el dinero.
`sinAplicarOriginal` del pago es el importe registrado originalmente a cuenta;
su disponibilidad **actual** se obtiene de partidas y conciliaciones.

No se filtra la cartera por los nueve almacenes: hacerlo alteraría el saldo de los
clientes. Pedidos, existencias, cajas y picking mantienen el puente operativo actual.
Esta entrega no incorpora todavía precios, entregas, proveedores ni documentos de
movimiento de stock del plan comercial 2E.

## Cómo controla la carga

- Ejecutable independiente: `ejecutar-finanzas.cmd`. La tarea actual `Puente` no lo ejecuta.
- Comparte `.env.puente` y **la misma carpeta BRIDGE_STATE_DIR**. El candado impide
  consultar SAP al mismo tiempo que el puente operativo.
- Por defecto: 10 consultas como máximo, 60 segundos, pausa mínima de 1,5 segundos.
- Página de hasta 50 filas; una página por entidad en cada ronda, atendiendo
  primero las menos recientes. Repite las incompletas mientras queda presupuesto;
  una carga grande continúa en ejecuciones posteriores.
- Facturas, pagos, créditos, cuotas y líneas: primera carga desde la fecha elegida;
  también documentos abiertos antiguos. Después revisa nuevos/modificados usando
  fechas SAP y solapa dos días desde el inicio de la lectura anterior.
- Debe comprobarse con cambios reales que las fechas de actualización del SAP
  instalado cubren las modificaciones. `--reconciliar` vuelve a leer el alcance
  completo de una entidad; programar una revisión periódica después de medirla.
- Clientes, catálogos, conciliaciones y partidas: recorridos completos según su
  frecuencia. Las partidas se limitan a saldos abiertos, no a toda la contabilidad.
- Movimientos: primera carga de todas las líneas contables de clientes, incluyendo
  las anteriores a la fecha elegida para poder calcular saldo inicial. Puede ser
  la carga más larga. Luego usa fecha de creación/actualización del asiento.
- No cambia tablas, índices ni documentos de SAP. `--registrar` crea únicamente
  las definiciones SQLQueries de lectura. La tarea normal nunca las crea.

Las lecturas de varias páginas no forman una transacción en SAP: los datos pueden
cambiar durante el recorrido. La API informa comienzo y fin, última carga completa,
si se está actualizando y `validadoContraSap:false`. No equivale a cartera certificada.

## 1. Preparar el backend en la PC

Revisar y subir los archivos de esta entrega al repositorio. No usar `git add .`
sin revisar: existen archivos locales de trabajos anteriores.

```powershell
git status --short
git diff --check
```

Antes del despliegue, aplicar **solo la nueva migración aditiva** con la conexión de
Railway habitual. Esto crea `finanzas_control` y `finanzas_registros`; no vacía las
tablas del scanner. Verifica el destino antes de ejecutar:

```powershell
npx prisma migrate status --config=prisma7.config.js
npx prisma migrate deploy --config=prisma7.config.js
```

Después desplegar el backend de este cambio y esperar a que `/health` vuelva a
responder `status:ok` y `db:ok`. El receptor usa la clave existente del puente.

Para consultas de aplicaciones, Railway requiere `FINANZAS_APPS_AUTORIZADAS` con
el nombre exacto de una API key autorizada, por ejemplo `app-cartera`. Es un nombre,
no el secreto de la clave. Las claves del scanner no reciben acceso automáticamente.

## 2. Copiar el paquete al servidor

1. Desactivar la tarea `Puente` y esperar que termine cualquier ejecución activa.
2. Conservar respaldo de la instalación actual.
3. Reemplazar código del paquete completo: `puente`, `src/shared/finanzas`, contratos,
   scripts y los archivos nuevos `ejecutar-finanzas.cmd` y `ejecutar-finanzas-oculto.vbs`.
4. Conservar `.env.puente`, **toda la carpeta de estado que indica BRIDGE_STATE_DIR**,
   logs, certificado si existe y el `ejecutar-oculto.vbs` operativo.
5. No cambiar empresa SAP, clave del backend, huella TLS ni los nueve almacenes.

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Desactivar no interrumpe una ejecución que ya comenzó. Antes de reemplazar, comprobar
su finalización en el log. No borrar ni editar el candado o los archivos de estado.

## 3. Elegir la configuración financiera

Agregar estas variables a `.env.puente`, con valores confirmados. Las monedas son
los códigos exactos de SAP en OADM: `MainCurncy` y `SysCurrncy`; no asumirlos.
La fecha y ambas monedas quedan vinculadas a la instalación financiera.

```dotenv
BRIDGE_FINANCE_ENABLED=true
BRIDGE_FINANCE_SINCE=1900-01-01
BRIDGE_FINANCE_LOCAL_CURRENCY=HNL
BRIDGE_FINANCE_SYSTEM_CURRENCY=USD
BRIDGE_FINANCE_ZONE_FIELD=
BRIDGE_FINANCE_ROUTE_FIELD=U_ZONA
BRIDGE_FINANCE_FREQUENCIES_JSON={}
BRIDGE_FINANCE_MAX_REQUESTS=10
BRIDGE_FINANCE_MAX_SECONDS=60
```

**Las monedas anteriores son ejemplos.** Confirmarlas antes de copiar.
Se acordó traer todo el historial disponible: la fecha 1900-01-01 evita limitarlo
a los últimos años. También se confirmó que `U_ZONA` representa la ruta del cliente.
La zona independiente queda vacía y se guarda como `null`.

Comprobar configuración sin conectarse a SAP:

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente --input-type=module -e "import { configurarFinanzas } from './puente/finanzas.config.js'; configurarFinanzas(process.env); console.log('CONFIGURACION_FINANCIERA_OK');"
```

## 4. Registrar y sondear, una entidad a la vez

Primero la moneda de empresa:

```powershell
node --env-file=.env.puente puente/ejecutar-finanzas.js --registrar --entidad=empresa
$LASTEXITCODE
```

Esperado: `consulta_financiera` con `creada` o `existente`, `sondeo_financiero`
con un registro y salida `0`. `MONEDA_EMPRESA_DISTINTA` requiere corregir la
configuración; no se envía información monetaria con moneda supuesta.

Después ejecutar el registro y sondeo de las otras entidades. Este bloque se
detiene al primer error y deja dos segundos entre procesos:

```powershell
$entidadesFinancieras = @(
  'clientes','vendedores','condicionesPago','facturas','facturaLineas','cuotas',
  'notasCredito','notaCreditoLineas','pagos','aplicacionesPagos',
  'conciliaciones','movimientos','partidas'
)
foreach ($entidadFinanciera in $entidadesFinancieras) {
  node --env-file=.env.puente puente/ejecutar-finanzas.js --registrar "--entidad=$entidadFinanciera"
  if ($LASTEXITCODE -ne 0) { throw "Revisar la entidad $entidadFinanciera antes de continuar" }
  Start-Sleep -Seconds 2
}
```

`--registrar` sondea un registro y no escribe datos en Railway. Las consultas
requieren que Service Layer autorice las tablas/columnas: OADM, OCRD, OSLP, OCTG,
OINV/INV1/INV6, ORIN/RIN1, ORCT/RCT2, OITR/ITR1, OJDT/JDT1 y los UDF elegidos.
Si devuelve 400/403 o un campo incompatible, detener esta etapa y revisar ese
resultado con sistemas. No modificar automáticamente la allowlist del servidor.

Para repetir solo lectura, sin intentar registrar:

```powershell
node --env-file=.env.puente puente/ejecutar-finanzas.js --sondeo --entidad=facturas
```

Un sondeo vacío es válido si la entidad no tiene registros; una consulta denegada
o un importe ausente produce error, nunca se sustituye por cero.

## 5. Primera carga

```powershell
node --env-file=.env.puente puente/ejecutar-finanzas.js --once
$LASTEXITCODE
```

Esperado: `ciclo_financiero`, con la entidad y su avance. `completo:false` y
`pausa_por_presupuesto` indican continuación normal. Repetir manualmente o dejar
la tarea financiera continuar después de validar las primeras ejecuciones.
**No usar `--forzar` en cada continuación.**

Cada entidad debe completar al menos un recorrido. Una carga de partidas vacía
confirmada reemplaza la cartera anterior; un recorrido interrumpido conserva la
última cartera completa. Documentos/movimientos se actualizan gradualmente y la
API indica si siguen en actualización. El estado de cuenta espera al cierre.

## 6. Consultar y contrastar con SAP

Nuevas rutas: `/finanzas/estado`, `/finanzas/clientes`, `/finanzas/facturas`,
`/finanzas/pagos`, `/finanzas/aplicacionesPagos`, `/finanzas/notasCredito`,
`/finanzas/conciliaciones`, `/finanzas/cuotas`, `/finanzas/partidas`, etc.

- `/finanzas/cartera?cardCode=CODIGO`: saldo neto y antigüedad en moneda local;
  créditos separados, saldo de ficha SAP y diferencia. No consulta SAP en vivo.
- `/finanzas/estado-cuenta?cardCode=CODIGO&desde=2026-01-01&hasta=2026-10-09`:
  saldo inicial, cargos, abonos, saldo final y movimientos paginados.
- Listados: `cardCode`, `desde`, `hasta`, `limit` (hasta 100), `cursor`, `version`.
  Enviar `meta.siguienteCursor` y `meta.version` al pedir la página siguiente.
  Si cambia la versión, reiniciar la lectura.
- Las rutas antiguas `/facturas` y `/pagos` siguen ligadas al borrador anterior.
  Consumir `/finanzas/...` para esta entrega; no mezclar ambos modelos.

Los importes son strings decimales. FC es moneda extranjera de cada registro;
SC es moneda del sistema. No sumar saldos de monedas diferentes. Los pendientes
de cabecera son orientativos; la cartera usa el saldo contable abierto de JDT1.
La antigüedad usa la fecha de finalización publicada, no pretende reconstruir una
cartera histórica aplicando saldos actuales a fechas anteriores.

Casos que deben cuadrar contra SAP: factura abierta, abono parcial, pago completo,
anticipo, nota de crédito aplicada/sin aplicar, anulación, reapertura, cuotas,
documento de servicios, cliente en moneda extranjera y asiento manual/apertura.
Anotar el cliente, fecha de comparación, saldo SAP, saldo API y diferencia. Hacer
la comparación con el mismo criterio de contabilización y vencimiento.

## 7. Automatizar después de medir

Asignar frecuencias financieras acordadas en `BRIDGE_FINANCE_FREQUENCIES_JSON`.
No confundir intervalo de la tarea con intervalo de recorrido de cada entidad.
El mínimo financiero aceptado es 900 segundos; eso no significa que se recomiende
recorrer conciliaciones o toda la contabilidad cada 15 minutos.

Ejemplo inicial conservador para medir: catálogos/clientes cada 6 h, documentos
cada hora, conciliaciones cada día y partidas cada hora. Ajustar según duración:

```dotenv
BRIDGE_FINANCE_FREQUENCIES_JSON={"empresa":86400,"clientes":21600,"vendedores":21600,"condicionesPago":21600,"facturas":3600,"facturaLineas":3600,"cuotas":3600,"notasCredito":3600,"notaCreditoLineas":3600,"pagos":3600,"aplicacionesPagos":3600,"conciliaciones":86400,"movimientos":3600,"partidas":3600}
```

La continuación de una carga pendiente ocurre aunque no haya vencido su frecuencia.
Para crear una tarea **adicional**, conservando la identidad interactiva actual:

```powershell
$tareaOperativa = Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
if ($tareaOperativa.Principal.LogonType -ne 'Interactive') { throw 'Revisar el tipo de sesión antes de instalar' }
if (Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Finanzas' -ErrorAction SilentlyContinue) { throw 'La tarea Finanzas ya existe; revisar antes de reemplazar' }
$accionFinanzas = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' -Argument '//B //NoLogo "C:\puente-cosprobell\ejecutar-finanzas-oculto.vbs"' -WorkingDirectory 'C:\puente-cosprobell'
$inicioFinanzas = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 15)
$usuarioFinanzas = New-ScheduledTaskPrincipal -UserId $tareaOperativa.Principal.UserId -LogonType Interactive -RunLevel Limited
$opcionesFinanzas = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
Register-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Finanzas' -Action $accionFinanzas -Trigger $inicioFinanzas -Principal $usuarioFinanzas -Settings $opcionesFinanzas
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
```

La cuenta Windows todavía debe mantener sesión iniciada. Si el puente operativo
tiene el candado, finanzas informa `finanzas_omitidas / PUENTE_YA_BLOQUEADO` y deja
la continuación para otro turno; no crea una segunda sesión SAP paralela.

```powershell
Get-ScheduledTaskInfo -TaskPath '\Cosprobell\' -TaskName 'Finanzas' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
Get-Content ('.\logs\finanzas-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

## Detener solo la parte financiera

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Finanzas'
```

Esperar la finalización de la ejecución activa. No borrar estado ni datos al
deshabilitarla. El scanner mantiene su tarea `Puente` independiente.

## Referencias de implementación y límites

La estructura se contrastó con la referencia SAP B1 10.0 de
[JDT1](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/JDT1.html),
[OITR](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/OITR.html),
[ITR1](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/ITR1.html),
[RCT2](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/RCT2.html)
y [INV6](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/INV6.html).
Los permisos SQLQueries y la disponibilidad exacta en FP2111 se comprueban con
el sondeo, no se deducen de las pruebas locales SQLite/HTTP simulado.
