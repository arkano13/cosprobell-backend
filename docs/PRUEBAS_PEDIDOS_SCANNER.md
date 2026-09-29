# Pedidos y escáner: preparación para pruebas

## Qué queda preparado

El puente recorre clientes, productos y pedidos de artículos, en ese orden. Lee SAP y envía los datos al backend. No escribe en SAP.

Cada pedido incluye cabecera y todas sus líneas en una transacción, junto al avance de sincronización. Las líneas retiradas se eliminan únicamente del espejo de SAP; los escaneos y las líneas de picking se conservan. No se eliminan pedidos ausentes del recorrido.

Una actualización que cambie cliente, estado, cancelación, producto, bodega, cantidades o unidades de un pedido marca sus sesiones activas como `requiere_revision`. El bloqueo usa el mismo orden que iniciar picking: cabecera y después sesiones. Un escaneo simultáneo termina antes de la actualización o encuentra la sesión bloqueada después. La confirmación de un escaneo ya registrado sigue siendo recuperable con el mismo `operacionId`.

No hay una función para reanudar automáticamente una sesión en revisión. Tampoco se reinicia un pedido finalizado: conservar esa restricción hasta definir entregas parciales y revisión supervisada.

## Reglas de preparación

- Solo pedidos de artículos abiertos y no cancelados.
- Solo líneas abiertas con cantidad pendiente positiva y entera.
- Se usa `RemainingOpenQuantity`, no la cantidad original del pedido.
- Unidad conocida: `Manual`, ausente o negativa bloquea la preparación.
- Cantidad de venta e inventario deben coincidir, tanto total como pendiente. Una conversión diferente requiere una definición posterior; no se convierte automáticamente.
- Cada etiqueta todavía debe estar confirmada localmente como unidad individual y coincidir con la unidad de la línea.

Esto es deliberadamente conservador: los ejemplos actuales de SAP están cerrados y utilizan unidades Manual. Sirven para verificar la importación, pero no aprobarán un picking real sin datos adecuados.

## Consultas para la futura pantalla

Todas requieren `X-API-Key` de la aplicación; la clave del puente no sirve para estas rutas.

| Método y ruta | Uso |
|---|---|
| `GET /pedidos?estado=abiertos&limit=25` | Lista inicial por `docEntry` ascendente |
| `GET /pedidos?cursor=123&limit=25` | Página siguiente, usando `siguienteCursor` |
| `GET /pedidos?estado=todos` | Incluye cerrados y cancelados |
| `GET /pedidos/:docEntry` | Detalle y diagnóstico `preparacion` de los datos locales |
| `POST /picking` | Crear o retomar con `{ "pedidoDocEntry": 123 }` |
| `GET /picking/:id` | Avance y estado de la sesión |
| `POST /picking/:id/escanear` | `{ "codigo": "00123", "operacionId": "UUID" }` |
| `GET /picking/:id/escaneos` | Historial paginado |
| `POST /picking/:id/finalizar` | Finalización con o sin diferencias |

`preparacion.datosValidos` comprueba datos del pedido, no permisos de despacho ni disponibilidad de etiquetas ni sesiones previas. El inicio y el escaneo realizan sus propias comprobaciones.

Cada lectura física obtiene un UUID nuevo. Un reintento de esa misma solicitud debe conservar su UUID. Un segundo UUID representa otra lectura y puede contar otra unidad: la pantalla debe distinguir lectura y reintento.

Mostrar `sincronizadoEn`: corresponde a la recepción local, no garantiza que SAP siga igual. Al perder SAP se conserva el último estado conocido; sin conexión al backend, esta API no proporciona una aplicación offline en el navegador.

## Antes de las pruebas reales

1. Desplegar esta versión del backend antes de actualizar el puente. Este cambio no añade migraciones.
2. Confirmar `SAP_COMPANY_DB=XPRUEBAS2026`, URL del backend de pruebas y credencial compartida del puente. Mantener separados los secretos SAP y la API key de la app.
3. Resolver el certificado con sistemas y probar desde la red de Cosprobell. No desactivar TLS.
4. Confirmar datos de códigos de barras, catálogo de unidades y asociaciones locales. El puente actual sincroniza datos básicos de productos, no importa automáticamente las asociaciones de barras ni confirma etiquetas como individuales.
5. Preparar en la sociedad de pruebas un pedido abierto de artículos con cliente, líneas y unidades válidas. No editar producción para esta prueba.
6. Detener la tarea anterior antes de cambiar su paquete. Conservar `.bridge-state`, `.env.puente` y el certificado aprobado; no sustituirlos por archivos de ejemplo.

## Comandos para cuando se retomen las pruebas

Desde el repositorio:

```powershell
npm test
node scripts/comprobar-recepcion-pedidos.js --base-de-pruebas
npm run empaquetar:puente
```

La segunda orden usa `DATABASE_URL` del backend: comprobar su destino antes. Crea datos sintéticos dentro de una transacción y provoca ROLLBACK al terminar. No borra datos existentes; las secuencias autoincrementales pueden avanzar aunque los registros se reviertan. Esta prueba comprueba persistencia real, no demuestra concurrencia entre conexiones.

En Windows Server, tras instalar el paquete y configurar los secretos:

```powershell
.\ejecutar-puente.cmd
```

Revisar el log de las tres entidades y consultar `GET /integracion/pedidos/estado` con el Bearer del puente. Confirmar cantidades y líneas con SAP. No instalar la tarea recurrente hasta aprobar esta primera ejecución.

## Casos de aceptación pendientes

1. Importar pedido; comprobar cabecera, cliente, líneas y cantidades contra Service Layer.
2. Repetir ciclo: sin pedidos o líneas duplicados. Cortar la respuesta del backend y reintentar el lote pendiente.
3. Iniciar un pedido parcialmente atendido: preparar solo su pendiente y excluir líneas cerradas.
4. Escanear individual válido, caja, desconocido, ambiguo y exceso de cantidad.
5. Reenviar la misma operación: una sola unidad y el mismo resultado.
6. Cambiar cantidad, unidad o bodega en SAP de pruebas mientras hay una sesión activa; sincronizar: requiere revisión y conserva cantidades e historial.
7. Cerrar o cancelar en SAP de pruebas; sincronizar: ningún nuevo escaneo ni finalización de esa sesión.
8. En dos conexiones PostgreSQL, mantener bloqueada la sesión mientras llega la actualización: confirmar que espera y no pierde escaneos. Los mocks no demuestran ese bloqueo real.
9. Interrumpir SAP, red y proceso del puente; comprobar recuperación y fecha del último dato recibido.
10. Probar la futura pantalla con el lector físico, incluidos foco, terminador Enter y reintentos.

## Límites que siguen abiertos

La pantalla de bodega aún no forma parte de este backend. Falta completar la importación de asociaciones de códigos/unidades para un catálogo real y su proceso de confirmación. También quedan pendientes la política de datos desactualizados, revisión supervisada, entregas parciales y validación final del despacho.

Los pedidos se recorren completos, uno por solicitud, incluyendo cerrados y cancelados. Es un punto de partida verificable; medir duración y volumen antes de programar el intervalo definitivo o diseñar la sincronización incremental. Un pedido de más de 1000 líneas, un estado desconocido o un cliente ausente detiene ese avance con error; no se omite silenciosamente. La proyección `DocumentLines` y su entrega completa deben confirmarse en el Service Layer instalado.
