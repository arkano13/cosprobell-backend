# Recepción de datos desde el puente

## Alcance de esta entrega

El backend recibe lotes normalizados. No inicia sesión en SAP ni instala un servicio de Windows. Solo sincroniza itemCode, itemName, barCode principal, valid y frozen. Clientes tiene su propio contrato (sección "Contrato de clientes v1"). Existencias, grupos, precios, unidades, códigos adicionales y pedidos quedan para contratos posteriores. No elimina productos por ausencia en un lote ni modifica escaneos, confirmaciones o relaciones.

Una empresa SAP por base local. Usar una base de desarrollo/pruebas para XPRUEBAS2026; no mezclarla con producción. El primer lote de cualquier entidad vincula el estado de recepción a la empresa; después se rechaza cualquier entidad de otra empresa (ORIGEN_INCOMPATIBLE). Esa comprobación no identifica el origen de productos antiguos ya presentes antes de implementar la sincronización.

## Configuración

En el .env del backend, fuera de Git:

```dotenv
SAP_COMPANY_DB=XPRUEBAS2026
BRIDGE_API_KEY=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO
```

Generar un secreto de 32 bytes con el siguiente comando y guardar el valor resultante en BRIDGE_API_KEY (no compartirlo por chat):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Debe coincidir con la credencial del futuro puente. Es distinta de la contraseña SAP y de las claves de las aplicaciones de consulta. No requiere credenciales SAP en el backend. Si falta configuración o la clave tiene menos de 32 caracteres, el receptor devuelve 503 y permanece cerrado. Reiniciar el backend después de editar el entorno. Usar HTTPS al desplegar; Authorization ya está oculto por la configuración de Pino. La clave requiere custodia y rotación operativa; no se implementó firma HMAC en este bloque.

## Contrato v1

POST /integracion/productos
Authorization: Bearer <BRIDGE_API_KEY>
Content-Type: application/json

```json
{
  "version": 1,
  "empresa": "XPRUEBAS2026",
  "secuencia": 1,
  "productos": [
    {
      "itemCode": "PROD-001",
      "itemName": "Producto de ejemplo",
      "barCode": "0012345678905",
      "valid": true,
      "frozen": false
    }
  ]
}
```

Los cinco campos del producto son obligatorios; barCode admite null. No se aceptan campos adicionales ni textos tYES/tNO en booleanos. El puente hará la transformación desde SAP. No se recortan identificadores silenciosamente; espacios externos o byte nulo se rechazan. Ceros iniciales se conservan. Entre 1 y 100 productos distintos por lote, cuerpo máximo 1 MB. El límite de 100 es provisional y debe medirse en el despliegue real.

Respuesta 200, después del commit:

```json
{"data":{"secuencia":1,"recibidos":1,"repetido":false}}
```

recibidos es la cantidad de productos del lote, no la cantidad de inserciones nuevas. Los existentes se actualizan por itemCode. El reintento del último lote, con mismo contenido, devuelve repetido:true y no escribe. El orden de propiedades JSON y productos no afecta la comprobación porque se valida y normaliza antes del hash.

## Contrato de clientes v1

POST /integracion/clientes y GET /integracion/clientes/estado, con la misma credencial y las mismas reglas de secuencia, repetición y empresa que productos. Cada entidad lleva su propia secuencia.

```json
{
  "version": 1,
  "empresa": "XPRUEBAS2026",
  "secuencia": 1,
  "clientes": [
    { "cardCode": "C0001", "cardName": "Cliente de ejemplo", "valid": true, "frozen": false }
  ]
}
```

Los cuatro campos son obligatorios. Inserta o actualiza por cardCode y solo toca esos campos: no modifica pedidos, facturas ni otros datos del cliente. El puente consulta únicamente socios de negocio con CardType = cCustomer. Saldos, contactos y demás datos personales no se sincronizan hasta que una función concreta los requiera. Existe para que los pedidos, próximo contrato, encuentren a su cliente.

## Contratos de unidades y códigos de barras v1

`POST /integracion/unidades` recibe el catálogo `UnitOfMeasurements`: `{ "absEntry": 1, "code": "UN", "name": "Unidad" }` (`name` admite null). Inserta o actualiza `unidades_medida` por `absEntry`. "Manual" (-1) no forma parte del catálogo.

`POST /integracion/codigosBarras` recibe `BarCodes`: `{ "absEntry": 9, "itemCode": "P1", "codigo": "7401234567890", "uomEntry": 1 }`. Reglas:

- Se identifica por `absEntry` (`sapAbsEntry`, único). Si cambia el código, el producto o la unidad, se actualiza la misma fila: su confirmación de picking se conserva y el picking la detecta como `CONFIRMACION_DESACTUALIZADA` hasta que se vuelva a confirmar.
- Una asociación creada a mano (sin `absEntry`) con el mismo producto, código y unidad se vincula a SAP en lugar de duplicarse, y conserva su confirmación.
- El producto debe estar sincronizado: si no, `409 PRODUCTO_NO_SINCRONIZADO` (el puente lo muestra en `detalle.codigoBackend`).

Códigos retirados: el puente pide `GET /integracion/hora` al empezar un recorrido completo de `BarCodes` y, al terminarlo, `POST /integracion/codigosBarras/retirados` con `{ "antesDe": "<hora de inicio>" }`. Los códigos de SAP no recibidos desde esa hora se marcan `retiradoEnSap = true`: no identifican productos ni sirven para picking, pero no se borran ni pierden su confirmación. Si vuelven a aparecer en SAP se reactivan. Repetir la llamada no cambia el resultado; `antesDe` no puede ser futura.

## Contratos del inventario v1: almacenes, existencias y documentos de stock

Solo lectura de SAP. Sirven para comparar el inventario de la bodega con SAP; el backend nunca escribe en SAP.

`POST /integracion/almacenes` recibe `Warehouses`: `{ "warehouseCode": "V05", "warehouseName": "Almacén de ventas", "inactive": false }`. Inserta o actualiza `bodegas`. La marca "de esta bodega" (`deEstaBodega`) la pone el supervisor en la app; la sincronización no la toca.

`POST /integracion/existencias` recibe la existencia de un artículo en cada almacén (`Items.ItemWarehouseInfoCollection`): `{ "itemCode": "P1", "almacenes": [{ "warehouseCode": "V05", "inStock": 10, "committed": 2, "ordered": 0 }] }`. Reglas:

- Reemplaza las filas del artículo: un almacén que no llega queda en cero (se borra su fila). El puente envía solo los almacenes con algún valor distinto de cero; un artículo sin ninguno llega con `almacenes: []`.
- El producto y los almacenes deben estar sincronizados: si no, `409 PRODUCTO_NO_SINCRONIZADO` o `409 ALMACEN_NO_SINCRONIZADO`.
- Si cambia lo que suman los almacenes marcados de esta bodega, avisa al inventario: el producto queda "SAP actualizándose" 15 minutos y, si subió, descuenta primero lo que la bodega recibió antes que SAP.
- Observar existencias sin cambios comprueba el producto y actualiza `actualizadoEn` de sus filas (lo usa el panel de Sincronización).

Documentos de stock, uno por tipo con su propia secuencia: `POST /integracion/entradasCompra` (PurchaseDeliveryNotes), `entradasInventario` (InventoryGenEntries), `salidasInventario` (InventoryGenExits), `devolucionesProveedor` (PurchaseReturns) y `devolucionesCliente` (Returns). Cada registro: `{ "docEntry": 77, "docNum": 1377, "docDate": "2026-09-30", "comentarios": "Vencido, lote L2408-090", "cancelado": false, "lineas": [{ "lineNum": 0, "itemCode": "P1", "warehouseCode": "V05", "cantidad": 100 }] }`. Reemplaza las líneas del documento. `cancelado` es verdadero para el documento cancelado y para el que revierte la cancelación (`CancelStatus` `csYes` o `csCancellation`); esos no se muestran como explicación de una diferencia. No se valida que el artículo exista: solo se usan para explicar.

## Orden y recuperación

GET /integracion/productos/estado utiliza la misma credencial y devuelve empresa, ultimaSecuencia y ultimaRecepcion. Antes de recibir datos devuelve 0 y null. ultimaRecepcion es la fecha del backend: no demuestra que los datos estuvieran actualizados en SAP.

La primera secuencia es 1; cada lote nuevo incrementa exactamente uno. Un solo emisor lógico, con un lote pendiente cada vez. Debe guardar de forma duradera el lote completo y su número antes de enviarlo, reintentar EXACTAMENTE ese lote y avanzar únicamente después de la confirmación. No se debe consultar de nuevo SAP y sustituir el contenido de un lote pendiente.

Solo se conserva la identidad del último lote. Los lotes anteriores y saltos se rechazan con 409; no se revierten productos a versiones antiguas. Tras perder el archivo de estado local, consultar el estado del servidor y reconciliar el avance; no saltar números automáticamente ni ignorar un conflicto. La secuencia controla orden de entrega, no detecta por sí sola lecturas antiguas de SAP o dos copias del puente mal coordinadas.

El número de secuencia y la empresa se almacenan junto con los productos en una transacción. Un bloqueo PostgreSQL coordina envíos concurrentes. No se marca el lote como recibido hasta confirmar todo. Los clientes pueden reintentar fallos temporales con espera creciente; un 400/401/403/409 requiere corregir configuración o reconciliar, no reintentar indefinidamente.

## Archivos

- middleware/bridgeAuth.js: verifica la credencial independiente y vincula la empresa desde configuración confiable.
- lote.schemas.js: estructura común de un lote (versión, empresa, secuencia, 1 a 100 registros sin claves repetidas).
- productos, clientes, pedidos, unidades, codigosBarras, almacenes, existencias y documentos `.schemas.js`: contrato de cada entidad.
- sincronizacion.service.js: comprueba empresa, secuencia y contenido de cualquier entidad registrada; coordina guardado.
- sincronizacion.repository.js: transacción, bloqueo y persistencia.
- sincronizacion.controller.js y sincronizacion.routes.js: publican una ruta fija por entidad.
- SincronizacionEstado y su migración: guardan el último lote confirmado.

## Verificación

190 pruebas automatizadas aprobadas en la copia de entrega. Prisma schema validado si se indica en la bitácora. La comprobación scripts/comprobar-recepcion-productos.js crea un esquema PostgreSQL temporal, prueba concurrencia, actualización, reintento, rechazo de conflicto y rollback SQL; lo elimina al terminar. No altera productos ni el avance de sincronización del esquema público. Requiere permiso CREATE SCHEMA en la base de pruebas; no concederlo al puente por este script.

## Siguiente paso

Construir el cliente de Service Layer y el emisor de lotes persistentes. Después añadir códigos adicionales, unidades y pedidos con sus propias reglas. No activar sincronización productiva ni operación offline de bodega por considerar que este primer contrato ya cubre esos casos.
