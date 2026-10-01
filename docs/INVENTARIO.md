# Inventario de la bodega

Dos cuartos, uno al lado del otro:

- **Bodega grande**: las cajas tal como llegan, cada una con su lote, su vencimiento (si lo trae) y una etiqueta propia **CJ-000123** que imprime la app.
- **Bodega pequeña**: las unidades sueltas que se sacan de las cajas y se apilan. De acá salen los pedidos.

**SAP manda.** El backend solo lee de SAP (por el puente) y nunca escribe. SAP no tiene lotes ni cajas: existen solo en esta base. No hay "dar de baja" en la app: lo vencido, dañado o devuelto se registra primero en SAP.

## Contra qué se compara

SAP de Cosprobell tiene muchos almacenes (en la muestra, unos 100 códigos por artículo). El supervisor marca en la app cuáles son de esta bodega (**Panel → Almacenes**, `PUT /supervisor/almacenes`). Hasta que marque alguno, el inventario no se compara y no se puede recibir (`409 ALMACENES_SIN_ELEGIR`).

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
| Recibir en cajas (a la grande) o suelto (a la pequeña o como bulto a la grande) | `POST /inventario/recepciones` | Operador o aplicación |
| Reponer: de una caja a la pequeña | `POST /inventario/reposiciones` | Operador o aplicación |
| Elegir de qué lotes (o de la pequeña) salió lo que SAP descontó | `POST /inventario/descuentos` | Operador o aplicación |
| Cambiar el lote de un descuento ya hecho | `POST /inventario/descuentos/:id/reasignacion` | Supervisor |
| Contar la pequeña | `PUT /inventario/productos/:itemCode/pequena` | Supervisor |
| Corregir las unidades de una caja | `PUT /inventario/cajas/:id/unidades` | Supervisor |
| Registrar un código de barras que SAP no tiene | `POST /supervisor/codigos` | Supervisor |

Reglas:

- **Recibir**: si se recibe más de lo que SAP tiene por ubicar, responde `409 EXCEDE_POR_UBICAR`; con `adelantar: true` se acepta y se anota como recibido antes que SAP. Cada caja recibe su código al crearse; la respuesta trae los datos para las etiquetas.
- **Descontar**: solo con la diferencia estable y exacta (`409 SAP_ACTUALIZANDO` o `409 CANTIDAD_CAMBIO`); hay que asignar exactamente lo que SAP descontó. Dentro de un lote se resta primero de la caja abierta y después de las cerradas en orden de llegada. La respuesta dice qué cajas sacar del estante.
- **Cambiar lote**: devuelve lo restado a sus cajas (o a la pequeña) y resta según lo nuevo. Guarda quién, cuándo y cuál era la asignación anterior.
- **Picking**: al finalizar una preparación, lo escaneado sale de la pequeña, en la misma transacción que cierra la preparación (solo productos que ya están en el inventario).
- **Conteo y corrección** dejan el número contado; si no coincide con SAP, queda como diferencia visible.
- Cada cambio de un producto toma su candado (`pg_advisory_xact_lock`): dos operaciones del mismo producto no se pisan. La base impide cajas con unidades negativas.
- **Movimientos**: cada operación queda registrada con tipo, bodega, cantidad, caja, lote, quién y cuándo, agrupada por operación.

## Pedidos por almacén

Con **En Pedidos, mostrar solo los pedidos que salen de los almacenes marcados** (opción `pedidosSoloDeEstaBodega`), la lista de pedidos abiertos muestra solo los que tienen alguna línea en esos almacenes. Sin almacenes marcados no se filtra.

## Datos que necesita del puente

Almacenes (`Warehouses`), existencias por almacén (`Items.ItemWarehouseInfoCollection`, solo artículos de inventario) y los documentos que mueven stock de los últimos 30 días (entradas por compra, entradas y salidas de mercancías, devoluciones). Frecuencias sugeridas y detalle en `INSTALAR_PUENTE_WINDOWS.md` y `INTEGRACION_PUENTE.md`.

## Tablas

`inventario_productos` (pequeña, adelantado, último cambio en SAP), `inventario_cajas`, `inventario_movimientos`, `inventario_descuentos`, `documentos_stock`, `documentos_stock_lineas`, `configuracion`; en `bodegas`, `deEstaBodega` y `sincronizadoEn`; en `productos_codigos_barras`, `origen` (`sap`, `ficha` o `app`), `registradoPor` y `creadoEn`. Migración `20261002090000_inventario_bodegas` (solo agrega).

## Códigos de barras

- **Ficha del artículo**: el código de `Items.BarCode` se guarda como código con unidad Manual (`origen: "ficha"`). Si cambia en SAP, el anterior se retira.
- **Desde la app**: el supervisor escanea el envase y elige el producto. Queda con unidad Manual y ya confirmado como unidad (`origen: "app"`); la sincronización no lo retira. Un código que ya es de otro producto (o está en la ficha de otro) se rechaza con `409 CODIGO_EN_USO`.
