# Recepción de productos desde el puente

## Alcance de esta entrega

El backend recibe lotes normalizados. No inicia sesión en SAP ni instala un servicio de Windows. Solo sincroniza itemCode, itemName, barCode principal, valid y frozen. Existencias, grupos, precios, unidades, códigos adicionales, clientes y pedidos quedan para contratos posteriores. No elimina productos por ausencia en un lote ni modifica escaneos, confirmaciones o relaciones.

Una empresa SAP por base local. Usar una base de desarrollo/pruebas para XPRUEBAS2026; no mezclarla con producción. El primer lote vincula el estado de recepción a la empresa. Esa comprobación no identifica el origen de productos antiguos ya presentes antes de implementar la sincronización.

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

## Orden y recuperación

GET /integracion/productos/estado utiliza la misma credencial y devuelve empresa, ultimaSecuencia y ultimaRecepcion. Antes de recibir datos devuelve 0 y null. ultimaRecepcion es la fecha del backend: no demuestra que los datos estuvieran actualizados en SAP.

La primera secuencia es 1; cada lote nuevo incrementa exactamente uno. Un solo emisor lógico, con un lote pendiente cada vez. Debe guardar de forma duradera el lote completo y su número antes de enviarlo, reintentar EXACTAMENTE ese lote y avanzar únicamente después de la confirmación. No se debe consultar de nuevo SAP y sustituir el contenido de un lote pendiente.

Solo se conserva la identidad del último lote. Los lotes anteriores y saltos se rechazan con 409; no se revierten productos a versiones antiguas. Tras perder el archivo de estado local, consultar el estado del servidor y reconciliar el avance; no saltar números automáticamente ni ignorar un conflicto. La secuencia controla orden de entrega, no detecta por sí sola lecturas antiguas de SAP o dos copias del puente mal coordinadas.

El número de secuencia y la empresa se almacenan junto con los productos en una transacción. Un bloqueo PostgreSQL coordina envíos concurrentes. No se marca el lote como recibido hasta confirmar todo. Los clientes pueden reintentar fallos temporales con espera creciente; un 400/401/403/409 requiere corregir configuración o reconciliar, no reintentar indefinidamente.

## Archivos

- middleware/bridgeAuth.js: verifica la credencial independiente y vincula la empresa desde configuración confiable.
- productos.schemas.js: valida el contrato.
- productos.service.js: comprueba empresa, secuencia y contenido; coordina guardado.
- productos.repository.js: transacción, bloqueo y persistencia.
- productos.controller.js y sincronizacion.routes.js: publican los endpoints HTTP.
- SincronizacionEstado y su migración: guardan el último lote confirmado.

## Verificación

190 pruebas automatizadas aprobadas en la copia de entrega. Prisma schema validado si se indica en la bitácora. La comprobación scripts/comprobar-recepcion-productos.js crea un esquema PostgreSQL temporal, prueba concurrencia, actualización, reintento, rechazo de conflicto y rollback SQL; lo elimina al terminar. No altera productos ni el avance de sincronización del esquema público. Requiere permiso CREATE SCHEMA en la base de pruebas; no concederlo al puente por este script.

## Siguiente paso

Construir el cliente de Service Layer y el emisor de lotes persistentes. Después añadir códigos adicionales, unidades y pedidos con sus propias reglas. No activar sincronización productiva ni operación offline de bodega por considerar que este primer contrato ya cubre esos casos.
