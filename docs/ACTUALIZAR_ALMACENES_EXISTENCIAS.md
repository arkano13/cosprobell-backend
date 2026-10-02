# Agregar almacenes y existencias al puente instalado

## Qué incorpora

- `almacenes`: código, nombre e inactividad de `Warehouses`. No cambia qué almacenes eligió el supervisor.
- `existencias`: cantidades en stock, comprometidas y pedidas por producto/almacén de `Items.ItemWarehouseInfoCollection`.
- Una cantidad que pasa a cero llega al backend. Si todas quedan en cero se envía el producto con `almacenes: []`.
- Se recorren los artículos para detectar también los que dejan de ser inventariables; estos envían lista vacía para limpiar su saldo SAP anterior. No se convierten en stock los artículos de servicio.
- Se conserva el inventario físico de grande/pequeña y sus lotes. Solo se actualiza la copia de existencias SAP y los avisos de diferencias.
- No incluye documentos de stock. SAP recibe GET de consulta más Login/Logout; no se escriben productos, existencias ni documentos en SAP.

A SAP se le consultan páginas para detectar cambios; al backend se envía el contenido modificado. Lo que no cambia se confirma por su código. No es una suscripción a eventos de SAP ni una consulta incremental por fecha. Los dos módulos comparten el presupuesto actual: 25 peticiones, 120 segundos y 500 ms entre consultas. Existencias pide cinco artículos por página por el tamaño de las colecciones de almacenes.

## 1. Preparación en la PC de desarrollo

En la raíz de `cosprobell-backend`:

```powershell
npx prisma generate --config=prisma7.config.js
npm test
npm run empaquetar:puente -- --destino=puente-inventario
```

El paquete queda en `dist/puente-inventario`. El destino alternativo conserva el paquete anterior, que puede contener configuración. Nunca empaquetar encima de una instalación configurada. El nuevo paquete no incluye credenciales, estado ni certificados.

## 2. Pausar la tarea y actualizar primero el backend

En PowerShell del servidor, con permisos para administrar la tarea:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Si está `Running`, esperar a que termine la ejecución actual. Continuar cuando ya no esté ejecutándose; deshabilitar la programación no detiene una ejecución iniciada.

En la PC de desarrollo, comprobar que `DATABASE_URL` corresponde a la base del backend que se actualizará y aplicar:

```powershell
npx prisma migrate status --config=prisma7.config.js
npx prisma migrate deploy --config=prisma7.config.js
```

Esto modifica nuestra PostgreSQL, no la base SAP. La migración nueva es `20261002120000_recorridos_inventario`; también deben estar aplicadas las anteriores. Después desplegar este código del backend en Railway y comprobar `/health`. El nuevo emisor necesita las rutas `/integracion/almacenes/recorrido/*` y `/integracion/existencias/recorrido/*`; no activarlo contra un backend anterior.

## 3. Copiar el paquete al servidor conservando la configuración

Copiar y descomprimir el paquete nuevo en `C:\puente-cosprobell-actualizacion`. Dentro deben verse `ejecutar-puente.cmd`, `puente`, `src` y `node_modules`, sin otra carpeta intermedia.

Con la tarea detenida, crear un respaldo de la instalación actual:

```powershell
$respaldoPuente = 'C:\puente-cosprobell-respaldo-' + (Get-Date -Format yyyyMMdd-HHmmss)
Copy-Item -LiteralPath 'C:\puente-cosprobell' -Destination $respaldoPuente -Recurse
```

Actualizar el código, conservando `.env.puente`, `.bridge-state`, `logs` y `certificado`:

```powershell
robocopy C:\puente-cosprobell-actualizacion C:\puente-cosprobell /E /XF .env.puente /XD .bridge-state logs certificado
if ($LASTEXITCODE -ge 8) { throw 'No se completó la copia. Revisar antes de continuar.' }
```

No usar `/MIR`. No borrar ni restaurar un estado anterior después de enviar nuevos lotes: sus secuencias deben coincidir con el backend. La tarea conserva su ruta y su cuenta actuales; no hay que reinstalarla.

## 4. Activar las dos entidades

Abrir `C:\puente-cosprobell\.env.puente` y añadir una sola vez:

```dotenv
BRIDGE_INVENTORY_ENABLED=true
```

En `BRIDGE_FREQUENCIES_JSON` conservar las frecuencias actuales y agregar `"almacenes":3600,"existencias":900`. Ejemplo completo, solo si coincide con los intervalos elegidos:

```dotenv
BRIDGE_FREQUENCIES_JSON={"clientes":3600,"productos":1800,"unidades":3600,"codigosBarras":1800,"pedidos":300,"almacenes":3600,"existencias":900}
BRIDGE_MAX_REQUESTS=25
BRIDGE_MAX_SECONDS=120
BRIDGE_REQUEST_DELAY_MS=500
```

Los segundos se cuentan entre recorridos completos. Los recorridos pendientes se retoman en la siguiente ejecución. Con una tarea que se ejecuta cada minuto, las entidades usan sus propias frecuencias; no se consulta todo cada minuto. Mantener el resto del `.env.puente`, sociedad, clave, certificado y estado que ya funcionan.

## 5. Sondeo sin enviar datos

```powershell
cd C:\puente-cosprobell
.\ejecutar-puente.cmd --sondeo
Get-Content ('.\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

Deben aparecer `sondeo` para `almacenes` y `existencias` y terminar con `codigo: 0`. El sondeo verifica un registro de cada entidad habilitada, no el catálogo entero. Un almacén sin nombre genera `ALMACEN_SIN_NOMBRE` y usa el código como nombre visible. Cantidades o colecciones ausentes/inválidas detienen esa entidad; no se convierten en cero.

## 6. Primera carga

```powershell
.\ejecutar-puente.cmd
Get-Content ('.\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 30
```

Repetir hasta ver `"entidad":"almacenes","completo":true` y después `"entidad":"existencias","completo":true`. `pausa_por_presupuesto` es una continuación normal. `espera_carga_inicial` indica que primero deben terminar productos y almacenes. No borrar archivos para acelerar.

Si aparece `PRODUCTO_NO_SINCRONIZADO` o `ALMACEN_NO_SINCRONIZADO`, hay una referencia nueva que todavía no llegó del catálogo: completar esos catálogos, pudiendo ejecutar manualmente `--forzar`, y reintentar. Si aparece `RECORRIDO_EN_CURSO` o `REQUIERE_RECONCILIACION`, conservar el estado y revisar el log antes de editar nada.

Medir `consultasSap`, `duracionMs` y cuántas ejecuciones necesita existencias. No aumentar el presupuesto automáticamente. La comparación exige un recorrido de existencias iniciado hace menos de 30 minutos: una carga que tarde más requiere revisar frecuencia/presupuesto con esas mediciones.

## 7. Comprobaciones y automatización

1. Verificar un almacén y dos o tres productos contra la consulta de SAP de pruebas.
2. Verificar un producto sin stock: no debe conservar la cantidad anterior. La prueba automática local ya cubre la transición positiva a cero.
3. En el panel elegir los almacenes SAP que corresponden a la bodega. No asumir que grande y pequeña son dos almacenes distintos de SAP.
4. La ficha y el resumen de inventario informan `comparacionDisponible`. Requiere ambas cargas completas, almacenes elegidos, almacenes con recorrido iniciado en las últimas 48 horas y existencias en los últimos 30 minutos. Se deshabilita durante el recorrido siguiente, ante carga inconclusa o si quedaron existencias sin observar; el inventario físico local sigue funcionando.

Reactivar la tarea existente y probarla:

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Start-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTaskInfo -TaskPath '\Cosprobell\' -TaskName 'Puente' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

Consultar nuevamente al terminar: resultado 0 y log reciente. Confirmar después que las entidades respetan sus intervalos.

Para pausar solo esta ampliación, establecer `BRIDGE_INVENTORY_ENABLED=false`: las cinco entidades anteriores seguirán funcionando. No borrar los archivos nuevos de estado; al reactivar se retomarán. Una carga inconclusa mantiene deshabilitada la comparación hasta completarse.

## Alcance de la verificación

Se verifican localmente las transformaciones con las muestras de metadatos, recuperación de estado, confirmación del fin de recorrido y transición a cero. La conexión a SAP instalada, duración real y permisos del usuario de la tarea se verifican con los pasos del servidor. Los recorridos no son una fotografía transaccional de SAP: el stock puede cambiar mientras se leen sus páginas.
