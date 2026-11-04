# Pasar la importación financiera a sus tablas

Esta actualización pertenece al **backend**. No hay que copiar archivos al equipo del puente ni volver a extraer SAP.
La fuente es la carga que ya está en `finanzas_registros`; esa tabla se conserva, junto con `finanzas_control`.

## Dónde queda cada dato

| Entidad recibida | Tabla de destino |
| --- | --- |
| empresa | `empresa_financiera` (nueva) |
| clientes | `clientes` |
| vendedores | `vendedores` |
| condicionesPago | `condiciones_pago` (nueva) |
| facturas | `facturas` |
| facturaLineas | `facturas_lineas` |
| cuotas | `facturas_cuotas` (nueva) |
| notasCredito | `notas_credito` |
| notaCreditoLineas | `notas_credito_lineas` |
| pagos | `pagos` |
| aplicacionesPagos | `pagos_facturas` |
| movimientos | `movimientos_contables` (nueva) |

`finanzas_normalizacion` registra el avance de la conversión local. No es el cursor de SAP: no se borra ni modifica
el estado del puente. `finVersion` identifica la carga financiera de cada fila, y `finClave` conserva la clave estable
del registro original. No se mezcla una versión nueva con filas que ya no están en ella.

## 1. Publicar el backend y aplicar la migración

Después de revisar/publicar este cambio, desde el repositorio **cosprobell-backend**, con `DATABASE_URL` apuntando a
la misma base donde se recibió la importación:

```powershell
npx prisma migrate deploy --config=prisma7.config.js
npx prisma generate --config=prisma7.config.js
```

La migración es `20261103120000_normalizar_finanzas`. Añade campos y las nuevas tablas y convierte los importes
recibidos de `Float` a `Decimal(24,6)`. Conserva las filas existentes; no realiza la conversión del JSON automáticamente.
También añade dos columnas opcionales `almacenDestino` de facturas/entregas que ya declaraba Prisma pero faltaban
en el historial de migraciones. No modifica pedidos, picking ni inventario.

El backend nuevo requiere esta migración. Coordinar su aplicación con el despliegue.

## 2. Ver el estado (solo lectura)

```powershell
node scripts/normalizar-finanzas.js --estado
```

Ejemplo antes de convertir:

```json
{"evento":"estado_normalizacion","entidad":"facturas","cargaCompleta":true,"convertidos":0,"completo":false,"version":null}
```

Puede empezar con las entidades publicadas aunque movimientos continúe cargando. Una entidad sin carga finalizada
se informa como `esperando_carga`; no se convierte parcialmente su importación de SAP.

## 3. Convertir los datos recibidos

```powershell
node scripts/normalizar-finanzas.js --aplicar --lote=50
```

Convierte primero clientes/catálogos, después documentos y detalles, y finalmente movimientos. Cada tanda valida
el contrato, escribe los datos, vuelve a leerlos y compara **todos los campos**, incluidos importes y nulos. Las filas
y el cursor se confirman en una sola transacción. Al terminar una entidad compara también el número de registros.

```json
{"evento":"normalizacion_financiera","entidad":"facturas","estado":"en_curso","completo":false,"cantidad":50,"recibidos":50}
{"evento":"normalizacion_financiera","entidad":"facturas","estado":"completo","completo":true,"cantidad":17234,"recibidos":34}
{"evento":"normalizacion_fin","completo":true,"interrumpido":false}
```

Las cantidades anteriores son ejemplos; dependen de la carga real. El comando termina por sí solo.
Para detenerlo, `Ctrl+C`: espera que confirme la tanda actual. Repetir el mismo comando retoma desde el último cursor
confirmado y no duplica registros. No ejecutar varios conversores a la vez: comparten el bloqueo con el ingreso del puente.
El bloqueo se libera entre tandas; el puente operativo puede continuar.

Opciones para una prueba corta o una sola entidad (sus documentos padre deben estar convertidos):

```powershell
node scripts/normalizar-finanzas.js --aplicar --una-tanda --lote=25
node scripts/normalizar-finanzas.js --aplicar --entidad=movimientos --lote=50
```

`--una-tanda` procesa como máximo una tanda **por entidad**. Tamaños válidos: 1 a 200; por defecto 50.
Salida 0: todo lo seleccionado completo; 2: queda trabajo o alguna carga no terminó; 1: error.

Si se informa `RELACION_FINANCIERA_FALTANTE`, no se fabrica un cliente, pago o documento para continuar. Revisar que
la entidad padre esté convertida y que la carga histórica incluya ese documento. Las cargas se hicieron en momentos
distintos: una línea más reciente puede referirse a una cabecera todavía no recibida. Resolver el origen y repetir.
Aplicaciones a documentos no importados se conservan con `documentoSap` y `invoiceType`, sin inventar una factura.

Para el desfase entre cabeceras y líneas de octubre, seguir [COMPLETAR_CABECERAS_FINANCIERAS.md](COMPLETAR_CABECERAS_FINANCIERAS.md).

## 4. Verificar y consultar

```powershell
node scripts/normalizar-finanzas.js --estado
```

Las 12 entidades deben mostrar `completo:true` para sus versiones publicadas actuales. Si movimientos no terminó
en el puente, repetir `--aplicar` cuando termine; las demás entidades completas no se reprocesan.

Las rutas `/finanzas/:entidad` y `/finanzas/estado-cuenta` usan automáticamente las tablas cuando la conversión
correspondiente termina. Durante la conversión conservan la lectura del JSON publicado. Cursor y metadatos mantienen
su contrato; no se expone una tanda incompleta como si fuera la entidad entera.

Las rutas anteriores `/facturas`, `/pagos` y las consultas de clientes con importes también usan versiones convertidas
completas; si falta convertir una entidad necesaria devuelven `503 FINANZAS_TABLAS_PENDIENTES`.

**Permisos:** las aplicaciones que consulten datos financieros deben figurar por su nombre en
`FINANZAS_APPS_AUTORIZADAS` del backend. Esto ahora también protege `/facturas` y `/pagos` (403 para otras aplicaciones).
Las aplicaciones operativas conservan `/clientes` y `/clientes/:codigo` con código, nombre y estado, sin importes ni
documentos financieros. No introducir una clave del puente en una app para consultar finanzas.

## Qué se conserva y qué sigue pendiente

- No hay llamadas a SAP ni escrituras en SAP durante esta conversión.
- Los importes importados se guardan como decimales exactos de seis posiciones; en JSON se devuelven como **cadenas**.
- Un `null` sigue siendo desconocido: no se convierte en cero. Se conservan las anulaciones Y/N/C.
- Clientes conserva los nombres/estados operativos más recientes. Los campos `finNombre`, `finActivo` y
  `finBloqueado` conservan exactamente la ficha financiera recibida, aunque su nombre sea nulo.
- Una aplicación puede corresponder a una nota de crédito u otro tipo. `facturaDocEntry` puede ser nulo;
  `documentoSap` conserva el identificador real y `invoiceType` el tipo.
- `cardCode` en un movimiento también puede ser una cuenta de mayor (`_SYS...`), sin relación obligatoria con clientes.
- No se eliminan filas de tablas anteriores ni del JSON al terminar. Las consultas financieras filtran la versión activa.
- Se mantienen excluidas conciliaciones y partidas abiertas verificadas. Esta actualización **no convierte la carga
  en cartera completamente conciliada** ni recupera campos que SAP no proporcionó.
- No programa actualizaciones financieras periódicas. Cuando se publique otra carga completa, repetir `--aplicar`;
  detecta la nueva versión y vuelve a convertirla. Los datos anteriores siguen disponibles en el JSON según su retención.
- El conversor rechaza entidades con almacenamiento incremental mutable (`version:actual`); trabaja con instantáneas
  completas como las de la importación GET instalada.

## Pruebas locales

```powershell
node --test tests/unit/finanzas-normalizar.test.js tests/integration/finanzas-normalizacion-postgres.test.js tests/integration/finanzas.test.js
```

La prueba PostgreSQL inicia una base WASM efímera local, aplica todo el historial de migraciones, convierte las 12
entidades y prueba reintentos, cambios de versión, precisión, relaciones y rollback ante corrupción simulada.
No lee `DATABASE_URL` ni se conecta a Railway/SAP. Instalar dependencias de desarrollo para ejecutar las pruebas.
