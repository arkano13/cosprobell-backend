# Inventario de la bodega

Dos cuartos, uno al lado del otro:

- **Bodega grande**: las cajas tal como llegan, cada una con su lote, su vencimiento (si lo trae) y una etiqueta propia **CJ-000123** que imprime la app.
- **Bodega pequeña**: las unidades sueltas que se sacan de las cajas, conservando lote y vencimiento. De acá salen los pedidos. Los lotes deben seguir identificables físicamente.

**SAP manda.** El backend solo lee de SAP (por el puente) y nunca escribe. SAP no tiene lotes ni cajas: existen solo en esta base. No hay "dar de baja" en la app: lo vencido, dañado o devuelto se registra primero en SAP.

## Contra qué se compara

El supervisor marca en la app cuáles almacenes de SAP corresponden a esta bodega (**Panel → Almacenes**, `PUT /supervisor/almacenes`). Las recepciones, reposiciones, conteos y correcciones funcionan con el inventario local aunque no haya almacenes elegidos o existencias de SAP disponibles.

El resumen y la ficha indican `comparacionDisponible`. La comparación requiere almacenes elegidos y recorridos completos: almacenes iniciado en las últimas 48 horas y existencias en los últimos 30 minutos por defecto. `INVENTARIO_SAP_MAX_AGE_MINUTES` permite una tolerancia explícita entre 5 y 240 minutos; aumentarla acepta datos más antiguos, no los hace más recientes. `INVENTARIO_SAP_WAREHOUSES=01,02` bloquea la comparación si el supervisor selecciona otros almacenes. Los pendientes y descuentos basados en diferencias se rechazan con `ALMACENES_SIN_ELEGIR` o `COMPARACION_SAP_NO_DISPONIBLE`. La ausencia de datos no representa existencias cero.

El puente confirma el inicio y el fin de cada recorrido. Durante una actualización incompleta o si quedan existencias sin observar, la comparación permanece deshabilitada. Activación y actualización de la instalación: `ACTUALIZAR_ALMACENES_EXISTENCIAS.md`.

Para cada producto:

```
SAP (almacenes marcados) = grande + pequeña + preparado sin entregar + diferencia
```

- **preparado sin entregar**: unidades de preparaciones finalizadas de pedidos que SAP sigue teniendo abiertos y que todavía no se entregaron (`max(0, escaneado − max(0, pedido − pendiente en SAP))`), solo de líneas de los almacenes marcados. Ya salieron de la pequeña, pero SAP las sigue contando.
- **diferencia > 0**: SAP tiene mercadería que la bodega no ubicó. Estado `por_ubicar`, o `conteo_inicial` si el producto nunca entró al inventario.
- **diferencia < 0**: SAP descontó y la bodega no eligió de qué lote. Estado `por_descontar`.
- **Recibido antes que SAP** (`adelantado`): cuando la bodega recibe más de lo que SAP tiene por ubicar y lo confirma, se anota. Cubre la diferencia negativa hasta que SAP registra la entrada; cuando la existencia de SAP sube, se descuenta solo.
- **SAP actualizándose**: durante 15 minutos después de un cambio de existencias, o de un cambio en un pedido ya preparado, el producto no avisa. Las existencias y los pedidos llegan en recorridos distintos del puente.

## Operaciones

| Operación | Ruta | Quién |
|---|---|---|
| Resumen, buscar, producto, caja, pendientes, conteo inicial, por vencer, movimientos, descuentos | `GET /inventario/...` | Operador o aplicación |
| Lista de productos de las bodegas; `solo_sap` = falta contar en las dos (`?buscar=&filtro=todos\|grande\|pequena\|solo_sap\|diferencia\|por_vencer&pagina=&limit=`) | `GET /inventario/existencias` | Operador o aplicación |
| Lo que hay en una bodega, por producto y lote (`?buscar=&filtro=todos\|registrados\|sin_registrar\|por_vencer&pagina=&limit=`) | `GET /inventario/bodegas/grande` o `/pequena` | Operador o aplicación |
| Almacenes de SAP para elegir (marcados y con existencia, con qué bodega es cada uno) | `GET /inventario/almacenes` | Operador o aplicación |
| Productos que SAP tiene en un almacén: en stock, comprometido, pedido y disponible; si es la bodega grande o la pequeña, también lo registrado en la app (`enBodega`, `cajas`, `resumen.enBodega`), incluidos los productos que SAP no tiene ahí (`?buscar=&pagina=&limit=`). Lo usa la sección Bodegas de la app | `GET /inventario/almacenes/:codigo/productos` | Operador o aplicación |
| Conteo de una bodega: lo que SAP tiene en su almacén, si ya se contó y cuántos códigos de barras tiene, con el avance (`?estado=falta\|contados\|sin_codigo\|todos&buscar=&pagina=&limit=`) | `GET /inventario/conteo/grande` o `/pequena` | Operador o aplicación |
| Contado: no hay (deja anotado que en esa bodega no había ninguno) | `POST /inventario/productos/:itemCode/sin-existencia` | Operador o aplicación |
| Recibir en cajas (a la grande), por grupos (varios lotes y un bulto, a la grande) o suelto (a la pequeña o como bulto a la grande) | `POST /inventario/recepciones` | Operador o aplicación |
| Reponer: de una caja a la pequeña | `POST /inventario/reposiciones` | Operador o aplicación |
| Aceptar un traspaso de la 01 a la 02 que SAP ya registró (de qué lotes salió) | `POST /inventario/traspasos` | Operador o aplicación |
| Elegir de qué lotes (o de la pequeña) salió lo que SAP descontó | `POST /inventario/descuentos` | Operador o aplicación |
| Cambiar el lote de un descuento ya hecho | `POST /inventario/descuentos/:id/reasignacion` | Supervisor |
| Contar la pequeña | `PUT /inventario/productos/:itemCode/pequena` | Supervisor |
| Corregir las unidades de una caja | `PUT /inventario/cajas/:id/unidades` | Supervisor |
| Registrar un código de barras que SAP no tiene (al contar o desde la ficha) | `POST /inventario/codigos` (o `POST /supervisor/codigos`) | Operador o aplicación |
| Quitar un código registrado desde la app | `DELETE /supervisor/codigos/:id` | Supervisor |

Reglas:

- **Recibir**: sin comparación disponible, registra la entrada física local. Con comparación disponible, si se recibe más de lo que SAP tiene por ubicar, responde `409 EXCEDE_POR_UBICAR`; con `adelantar: true` se acepta y se anota como recibido antes que SAP. Cada caja recibe su código al crearse; la respuesta trae los datos para las etiquetas.
- **Descontar**: solo con la diferencia estable y exacta (`409 SAP_ACTUALIZANDO` o `409 CANTIDAD_CAMBIO`); hay que asignar exactamente lo que SAP descontó. Dentro de un lote se resta primero de la caja abierta y después de las cerradas en orden de llegada. La respuesta dice qué cajas sacar del estante.
- **Cambiar lote**: devuelve lo restado a sus cajas (o a la pequeña) y resta según lo nuevo. Guarda quién, cuándo y cuál era la asignación anterior.
- **Picking**: al finalizar, todos los productos escaneados deben tener suficientes unidades registradas en la pequeña. Si faltan, responde 409 y exige reponer desde la grande; la preparación permanece abierta. No se descuenta automáticamente de la grande ni se omiten productos sin inventario. Si hay varios lotes, se exige indicar cuáles salieron; un lote único se identifica automáticamente. El cierre y los descuentos se confirman juntos.
- **Recibir por grupos** (`modo: "grupos"`): `grupos: [{ cajas, unidadesPorCaja, lote, vencimiento }]` y un `bulto` opcional `{ unidades, lote, vencimiento }` con lo que sobra suelto, que queda en la grande como una caja con etiqueta. Todo en una sola operación; el control de lo que SAP tiene por ubicar es sobre el total. Hasta 50 grupos y 500 cajas.
- **Recibir por lotes a la pequeña** (`modo: "lotes"`): `lotes: [{ unidades, lote, vencimiento }]` (hasta 50, sin repetir lote y vencimiento), todo junto. Es el conteo de la 02.
- **Contado**: un producto se considera contado en una bodega si tiene unidades ahí o tuvo una recepción o un conteo en ella. "No hay" registra un conteo de 0 unidades (solo si la bodega no tiene unidades registradas de ese producto) y lo activa en el inventario. El resumen trae `bodegas` (almacén y nombre de cada una), `existenciasSapAl` y `conteo` (total y contados por bodega). La ficha trae `sapPorBodega` y `contadoEn`.
- **Traspasos de la 01 a la 02**: los registra SAP (otra persona, antes de mover la mercadería), sin lotes ni cajas: solo "se movieron 25". La comparación general suma las dos bodegas, así que un traspaso no la cambia; se detecta bodega por bodega con las existencias de cada almacén: `porPasar` = lo menor entre lo que SAP tiene de más en el almacén de la pequeña (frente a la pequeña + lo preparado sin entregar) y lo que tiene de menos en el de la grande (frente a sus cajas). Solo con comparación disponible y las dos bodegas asignadas. El resumen trae `pendientes.porPasar` (productos), `GET /inventario/pendientes` la lista `porPasar` (`unidades`, `cajas`, SAP y local de cada bodega) y la ficha `porPasar` y `traspaso: { unidades, sugerencia }`.
  - **Sugerencia**: los lotes de las cajas que se pasan enteras (en la bodega no se dejan cajas a medias): la combinación de cajas enteras que suma justo lo que pasó SAP, tomando primero las que vencen antes. Si ninguna da justo, se toman enteras las que entren y lo que falta sale de una caja más (la abierta, si vence igual). `sugerencia` es `[{ lote, vencimiento, unidades, cajas }]`.
  - **Aceptar** (`POST /inventario/traspasos`, `{ itemCode, unidades, lotes? }`): `unidades` tiene que ser justo lo que SAP tiene por pasar (`409 CANTIDAD_CAMBIO` si cambió). Sin `lotes` se aplica la sugerencia; con `lotes: [{ lote, unidades }]` (los que se eligieron, sumando `unidades`) se reparte dentro de cada lote con la misma regla. Resta de las cajas de la grande y suma a la pequeña con el lote y el vencimiento de cada caja (movimientos `traspaso`). La respuesta trae `lotes` y `cajas` (`codigo`, `unidades`, `entera`). No usa documentos de traspaso del puente.
  - Al terminar un pedido, si falta en la pequeña y hay un traspaso sin aceptar de ese producto, el `409 PEQUENA_INSUFICIENTE` lo dice.
- **Códigos de barras al contar**: el conteo trae `codigos` (cuántos códigos activos tiene cada producto) y `sinCodigo` (cuántos de la lista no tienen ninguno). Quien cuenta, operador o supervisor, puede registrar el código del envase (`POST /inventario/codigos`); queda con la unidad Manual, confirmado como unidad y con quién lo registró (`registradoPor`, que la ficha muestra). Un código mal asignado lo quita el supervisor (`DELETE /supervisor/codigos/:id`, solo los registrados desde la app; los de SAP se cambian en SAP).
- **Búsquedas** de las listas: sin distinguir mayúsculas ni tildes.
- **Contenido por bodega**: lo registrado en la bodega (grande: cajas por lote; pequeña: lotes) y lo que SAP tiene en el almacén asignado a esa bodega, incluidos los productos que SAP tiene ahí y la bodega no registró (`sin_registrar`). Trae `resumen` (productos, unidades y cajas de la bodega) y `existenciasSapAl`. Sin almacén asignado, `sap` es `null`.
- **Almacén de cada bodega**: en `PUT /supervisor/almacenes`, `almacenGrande` y `almacenPequena` (opcionales) dicen qué almacén marcado es cada bodega; se guardan en la configuración `almacenesPorBodega`. Tienen que estar marcados y ser distintos; si no se envían quedan como estaban, y si se desmarca el almacén se quita la asignación. La comparación general con SAP sigue siendo sobre el total de los almacenes marcados.
- **Lista de productos**: todo lo registrado en la grande o la pequeña y lo que SAP tiene en los almacenes de esta bodega, por nombre, con cuántos hay por filtro (`conteos`). Lo de SAP viene con la fecha en que se confirmaron por última vez las existencias, el fin del último recorrido completo o el último lote, lo más reciente (`existenciasSapAl`); el estado y la diferencia, solo con comparación disponible. Sin almacenes marcados, `sap` es `null`.
- **Conteo y corrección** dejan el número contado. La diferencia con SAP solo se muestra cuando la comparación está disponible.
- Cada cambio de un producto toma su candado (`pg_advisory_xact_lock`): dos operaciones del mismo producto no se pisan. La base impide cajas con unidades negativas.
- **Movimientos**: cada operación queda registrada con tipo, bodega, cantidad, caja, lote, quién y cuándo, agrupada por operación.

## Lotes en la pequeña y existencias anteriores

`inventario_pequena_lotes` conserva cantidades por producto, lote y vencimiento. Reponer desde una caja conserva esos datos. La ficha del producto devuelve `lotesPequena` con los identificadores que usa la selección de despacho. El historial de movimientos también incluye `lotesPequena`; los vencimientos separan las unidades de la grande y las de la pequeña de ese lote.

Al finalizar picking, el cuerpo puede incluir:

```json
{
  "lotes": [
    { "itemCode": "P1", "lotes": [
      { "pequenaLoteId": 12, "unidades": 3 },
      { "pequenaLoteId": 15, "unidades": 2 }
    ] }
  ]
}
```

La suma debe coincidir con lo escaneado por producto. `LOTES_REQUERIDOS` pide selección física; `LOTE_INSUFICIENTE` pide actualizar las existencias. No se elige un lote por vencimiento sin confirmación del trabajador.

Para contar, `PUT /inventario/productos/:itemCode/pequena` admite `lotes: [{ lote, vencimiento, unidades }]` junto al total `unidades` y `operacionId`. Con varios lotes, el detalle es obligatorio. Un conteo puede corregir la distribución aunque el total no cambie. En descuentos y reasignaciones, una asignación `tipo: "pequena"` admite `lotes: [{ pequenaLoteId, unidades }]`.

La migración `20261002110000_lotes_pequena_sin_negativos` conserva los saldos positivos anteriores como lote desconocido (`lote: null`). Hace falta un conteo para distribuirlos cuando corresponda; no reconstruye lotes históricos. Los negativos antiguos se conservan para conciliarlos mediante conteo y se bloquean nuevos negativos con una restricción de base. Las recepciones a la pequeña y reposiciones exigen corregir un negativo antiguo antes de continuar. Los descuentos antiguos sin identificación de lote no se reasignan automáticamente.

La app necesita incorporar la selección y conteo por lotes, además de los identificadores de operación descritos abajo. Estas modificaciones se hicieron en el backend; los comandos de migración no actualizan la interfaz.

## Reintentos y contrato del frontend

Las seis operaciones físicas (recepción, reposición, descuento, reasignación, conteo y corrección) requieren `operacionId`, un UUID generado por la app, por ejemplo con `crypto.randomUUID()`. Se genera **una vez por acción**, y se conservan el UUID y el cuerpo al reintentar por pérdida de conexión. Una nueva acción lleva otro UUID. No generar uno nuevo automáticamente en cada petición HTTP.

El backend guarda el resultado en `inventario_operaciones` dentro de la misma transacción que modifica las cantidades. Dos envíos simultáneos con el mismo UUID y datos reciben el resultado de una sola operación. Reutilizarlo con otros datos, otra ruta de operación o usuario responde `409 OPERACION_REUTILIZADA`. Un conteo repetido devuelve su respuesta original: no vuelve a fijar la cantidad ni borra movimientos posteriores. Las operaciones se conservan sin caducidad automática.

La confirmación masiva de etiquetas exige `cantidadEsperada` y `versionEsperada`: usar `manualSinConfirmar` y `versionManual` del resumen de etiquetas que revisó el supervisor. Si cambió el conjunto, aunque tenga la misma cantidad, se devuelve `409 ETIQUETAS_CAMBIARON`; actualizar la revisión antes de confirmar otra vez.

**Despliegue coordinado:** aplicar `20261002100000_operaciones_inventario_y_codigos_ficha` antes de usar el backend actualizado y adaptar la app a estos campos. Una app anterior recibirá 400 en estas operaciones. La migración también recupera códigos principales de productos ya sincronizados sin crear asociaciones activas duplicadas ni confirmar etiquetas automáticamente. No requiere reenviar todo el catálogo desde SAP.

## Pedidos por almacén

Con **En Pedidos, mostrar solo los pedidos que salen de los almacenes marcados** (opción `pedidosSoloDeEstaBodega`), la lista de pedidos abiertos muestra solo los que tienen alguna línea en esos almacenes. Sin almacenes marcados no se filtra.

## Datos que necesita del puente

Almacenes (`Warehouses`) y existencias por almacén (`Items.ItemWarehouseInfoCollection`) se habilitan con `BRIDGE_INVENTORY_ENABLED=true`. Los artículos que dejan de ser inventariables limpian su copia anterior de existencias. Los documentos que mueven stock pueden explicar diferencias; su envío desde el puente sigue pendiente. Contratos en `INTEGRACION_PUENTE.md`.

## Tablas

`inventario_productos` (pequeña, adelantado, último cambio en SAP), `inventario_cajas`, `inventario_movimientos`, `inventario_descuentos`, `documentos_stock`, `documentos_stock_lineas`, `configuracion`; en `bodegas`, `deEstaBodega` y `sincronizadoEn`; en `productos_codigos_barras`, `origen` (`sap`, `ficha` o `app`), `registradoPor` y `creadoEn`. Migración `20261002090000_inventario_bodegas` (solo agrega).

## Códigos de barras

- **Ficha del artículo**: el código de `Items.BarCode` se guarda como código con unidad Manual (`origen: "ficha"`). Si cambia en SAP, el anterior se retira.
- **Desde la app**: el supervisor escanea el envase y elige el producto. Queda con unidad Manual y ya confirmado como unidad (`origen: "app"`); la sincronización no lo retira. Un código que ya es de otro producto (o está en la ficha de otro) se rechaza con `409 CODIGO_EN_USO`.
