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

No hay conversión de cajas, autorización por nombre de unidad, idempotencia por lectura ni historial individual completo. Las referencias manuales o desconocidas bloquean el escaneo; las presentaciones mezcladas del mismo producto se rechazan. La confirmación de una etiqueta se administra todavía fuera de un flujo autenticado. La creación de sesiones conserva cantidades originales del pedido; quedan pendientes elegibilidad, parciales y políticas de cambios SAP.

Ver la sección 12 de la bitácora para evidencia de PostgreSQL y pendientes.
