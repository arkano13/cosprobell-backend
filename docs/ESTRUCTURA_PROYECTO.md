# Estructura del backend

Actualizado para la integración de picking del 28 de septiembre de 2026. Tras verificar la entrega en una copia temporal, el usuario la incorporó a su proyecto y compartió 128 pruebas aprobadas y la demo de PostgreSQL aprobada.

## Organización

- `src/app.js`: configura Express sin abrir un puerto al importarlo.
- `src/server.js`: inicia HTTP y coordina el cierre ordenado.
- `src/config/`: carga y validación del entorno.
- `src/infrastructure/`: Prisma, logs y cierre de recursos.
- `src/shared/`: errores, seguridad y validación común.
- `src/middleware/`: autenticación, validación HTTP y errores.
- `src/modules/productos/`: productos y búsqueda informativa de etiquetas.
- `src/modules/unidades-medida/`: consulta del catálogo; no interpreta automáticamente cajas o unidades individuales.
- `src/modules/picking/`: rutas, schemas, controlador, servicios, reglas, repositorios y transacción.
- Bodegas, clientes, facturas, pagos y health conservan su organización existente.
- `tests/unit/` y `tests/integration/`: reglas y HTTP con persistencia simulada.
- `scripts/`: comprobaciones manuales contra la base configurada.

## Picking

| Archivo | Responsabilidad |
|---|---|
| `picking.routes.js` | URLs, validación y controladores |
| `picking.schemas.js` | Entradas admitidas |
| `picking.controller.js` | Adaptación HTTP; mantiene temporalmente errores conocidos como texto |
| `picking.service.js` | Inicio, consulta, escaneo integrado y cierre |
| `picking.repository.js` | Lecturas, creación, incremento de la línea validada y finalización |
| `picking.transaction.js` | Transacción y bloqueo de sesión |
| `picking.etiquetas.repository.js` | Consulta de asociaciones y confirmaciones |
| `picking.etiquetas.service.js` | Resuelve una asociación única para picking |
| `picking.etiqueta.js` | Comprueba confirmación de unidad individual y datos vigentes |
| `picking.cantidades.js` | Comprueba producto, unidad y cantidades enteras compatibles |

El escaneo usa un código de barras, identifica el producto, valida su confirmación y compara la unidad con las líneas de la sesión. La escritura guarda el código realmente leído. El servicio no recibe `req` ni `res` y todas las consultas del escaneo reciben la misma transacción.

La búsqueda informativa de productos sigue disponible por separado. No autoriza un incremento por sí misma.

## Comandos

```bash
npm run dev
npm test
node scripts/demo-picking.js
node scripts/comprobar-picking-integrado.js
```

`npm test` no consulta una base real. La entrega pasó 128 pruebas en una copia temporal.

Los scripts de picking sí usan la base de `.env`; el usuario identificó la actual como base de pruebas. Crean datos ficticios y limpian sus registros. `scripts/helpers/datos-picking.js` centraliza esa preparación; no es un módulo de aplicación. El comando integrado ejecuta la demo y los scripts de concurrencia en procesos separados y se detiene si uno falla.

Los scripts de concurrencia conservan sus nombres, pero sus datos fueron adaptados a etiquetas confirmadas y unidades explícitas. No usar las versiones antiguas con el nuevo contrato.

## Límites

No hay conversión de cajas ni autorización por nombre de unidad. La entrega de la sección 13 añade idempotencia e historial por operación; sigue pendiente identificar al operador individual. Las referencias manuales o desconocidas bloquean el escaneo; las presentaciones mezcladas del mismo producto se rechazan. La confirmación de una etiqueta se administra todavía fuera de un flujo autenticado. La creación de sesiones conserva cantidades originales del pedido; quedan pendientes elegibilidad, parciales y políticas de cambios SAP.

Ver la sección 12 de la bitácora para evidencia de PostgreSQL y pendientes.


## Reintentos e historial — entrega posterior

- `picking.escaneos.repository.js`: obtiene una operación previa, guarda su resultado y pagina el historial.
- `picking.service.js`: coordina reintento, escaneo e historial bajo el bloqueo existente; confirma el rechazo antes de responderlo.
- `picking.schemas.js`: exige UUID en cada lectura y valida paginación.
- `picking.controller.js` y rutas: reciben `operacionId`, usan el nombre autenticado de aplicación y exponen `GET /picking/:id/escaneos`.
- `PickingEscaneo`: evento persistido y respuesta original; único por sesión/operación.
- `scripts/comprobar-reintentos-picking.js`: prueba doble envío, respuesta histórica, conflicto, rechazo persistido, reversión SQL, cierre y paginación. El script integrado también lo ejecuta.

La nueva entrega pasó 144 pruebas en la copia temporal y las comprobaciones PostgreSQL documentadas en la sección 13. Los scripts anteriores fueron actualizados para enviar un UUID nuevo por lectura física y limpiar sus eventos. No se añaden UUID automáticamente en el backend: el cliente debe conservarlos al reenviar.


## Inicio y reanudación de picking

`picking.pedido.js` valida el estado local del pedido. El servicio ejecuta el inicio dentro de `pickingRepository.conPedidoBloqueado`: bloquea la cabecera, comprueba elegibilidad y consulta las sesiones bloqueadas antes de crear. Los inicios del mismo pedido esperan su turno. Una activa se retoma con HTTP 200; una nueva responde 201. No se reinician avances ni se cambia el usuario guardado.

Se rechazan pedidos cerrados, cancelados o con estado desconocido, múltiples sesiones activas y un nuevo inicio si solo hay sesiones finalizadas. La regla sobre finalizadas es provisional hasta definir parciales/reapertura. No hay cambio de esquema; inserciones directas ajenas al servicio no quedan protegidas por un índice único.

La entrega pasa 162 pruebas. `scripts/comprobar-inicio-picking.js` verifica además el inicio concurrente, rollback y reanudación con PostgreSQL y datos temporales. El cálculo sigue basado en quantity; pendientes y cambios SAP durante una sesión quedan por implementar.
