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


## Recepción de productos del puente

El módulo src/modules/sincronizacion separa contrato, controlador, servicio y repositorio. Sus rutas /integracion se montan antes de la autenticación de aplicaciones y llevan autenticación propia obligatoria. La configuración vincula una empresa SAP; las credenciales SAP permanecen fuera del receptor.

La tabla sincronizacion_estados y el bloqueo transaccional permiten guardar catálogo y avance conjuntamente, reconocer el último lote repetido y rechazar desorden/conflictos. Detalles, instalación y límites en INTEGRACION_PUENTE.md. Entrega preparada con 190 pruebas aprobadas; falta incorporar al checkout y aplicar la migración aditiva.


## Emisor de productos

puente/ contiene configuración, clientes HTTP SAP/backend, transformación, persistencia local y coordinación del envío. Se ejecuta separado del servidor Express y no necesita conexión PostgreSQL. Comparte el contrato de productos del receptor. puente/ejecutar.js ofrece --once y --watch; el segundo no instala un servicio de Windows. Configuración y límites en PUENTE_PRODUCTOS.md. Verificación en copia preparada: 211 pruebas aprobadas, sin conexión real con SAP. Mejoras posteriores (detalle del producto inválido, candado con PID y consulta con página de 50): 217 pruebas y `scripts/comprobar-candado-puente.js` con procesos reales.

## Instalación del puente en Windows

`npm run empaquetar:puente` arma `dist/puente-cosprobell` (ignorado por Git): puente, contratos `*.schemas.js`, zod, scripts de Windows (`puente/windows/*.cmd`) y `scripts/ver-certificado.js`. El paquete se comprueba solo al armarse (carga sin el resto del proyecto). Pasos en `INSTALAR_PUENTE_WINDOWS.md`. Los `.cmd` se guardan con CRLF (`.gitattributes`).

## Pedidos y preparación de pruebas (2026-09-28)

- src/modules/pedidos: consulta paginada y detalle, separado en rutas, schemas, controlador, servicio y repositorio.
- src/modules/sincronizacion/pedidos.schemas.js: contrato compartido de la instantánea del pedido.
- src/modules/sincronizacion/pedidos.repository.js: persistencia transaccional y coordinación de cambios con sesiones activas.
- puente/pedidos.js: conversión de Orders; entidades.js incorpora pedidos después de clientes y productos.
- src/modules/picking/picking.pedido.js: elegibilidad, líneas pendientes y comparación con la sesión guardada.
- docs/PRUEBAS_PEDIDOS_SCANNER.md: alcance, rutas, comandos y casos pendientes de aceptación.

La suite actual tiene 275 pruebas aprobadas. La instalación y las pruebas reales están pendientes; no hay nueva migración en este bloque.

## Pantalla de bodega

`public/bodega/` contiene la pantalla del escáner: HTML, CSS y módulos JavaScript sin compilación (`js/api.js`, `js/lecturas.js`, `js/uuid.js`, `js/iconos.js`, `js/app.js`) y las fuentes en `fuentes/` (SIL OFL 1.1). `src/app.js` la sirve en `/bodega/` antes de la autenticación: los archivos son públicos y los datos se piden con la API key del equipo. `js/lecturas.js` y `js/api.js` no dependen del navegador y se prueban con `node --test`. Guía de uso en `PANTALLA_BODEGA.md`; datos ficticios con `scripts/datos-demo-bodega.js`.
