# Reportes de bodega (panel del supervisor)

Ocho reportes de solo lectura para **Panel del supervisor → Reportes**, además del Cuadre con SAP. Todo sale de lo que la
base ya guarda: no leen ni escriben SAP. Los días se cortan en la hora de Honduras (`America/Tegucigalpa`). Solo para
operadores con rol supervisor (`403` a los demás). Código: `src/modules/reportes/` (consultas en `reportes.repository.js`,
cálculos sin base en `reportes.calculo.js`, probados en `tests/unit/reportes.calculo.test.js`).

Cada respuesta trae `generadoEn`, el período (`periodo`, `desde`, `hasta` como días `AAAA-MM-DD`, `dias`), `filtros`,
`resumen` (las tarjetas), `destacados` (frases listas para mostrar) y las tablas del reporte.

| Reporte | Ruta | Filtros |
| --- | --- | --- |
| 1. Preparaciones | `GET /supervisor/reportes/preparaciones` | `periodo` (`hoy`, `7d`, `30d`, `60d`, `90d`, `mes`; 7d), `operador`, `documento` (`todos`, `facturas`, `traslados`) |
| 3. Detalle de una preparación | `GET /supervisor/reportes/preparaciones/:id` | — (`404 PICKING_NO_ENCONTRADO`) |
| 2. Errores evitados | `GET /supervisor/reportes/errores` | `periodo` (30d), `operador` |
| 4. Más salen | `GET /supervisor/reportes/salidas` | `periodo` (`7d`, `30d`, `90d`; 30d), `limite` (5 a 100; 20) |
| 5. Reposiciones | `GET /supervisor/reportes/reposiciones` | `periodo` (`30d`, `60d`, `90d`; 60d), `como` (`todas`, `sap`, `mano`) |
| 6. Correcciones | `GET /supervisor/reportes/correcciones` | `periodo` (30d), `tipo` (`todos`, `conteo`, `lote`, `anulada`, `codigo`), `persona` |
| 7. Pendientes atrasados | `GET /supervisor/reportes/pendientes` | `minDias` (`0`, `1`, `3`, `7`; 3) |
| 8. Actividad por operador | `GET /supervisor/reportes/actividad` | `dia` (`AAAA-MM-DD`; hoy), `persona` |

## Reglas

- **Preparaciones**: cuentan las terminadas (`completo` y `con_diferencias`) por su fecha de fin. Las unidades son lo
  preparado de cada línea (nunca más de lo pedido). El tiempo promedio deja afuera las preparaciones abiertas más de
  4 horas (`HORAS_MAXIMAS_PREPARACION`). Ritmo = unidades por hora de las preparaciones cronometradas. **Sin preparar**: las
  facturas y traslados que hoy esperan en la lista de la bodega, por días desde su fecha de SAP (hoy, 1–2, 3 o más).
  La tabla de atención lista las preparaciones con diferencias, en revisión y anuladas del período.
- **Errores evitados**: las lecturas del escáner (`picking_escaneos`) por quien preparaba. Motivos: producto equivocado
  (`PRODUCTO_FUERA_DEL_PEDIDO`), de más (`CANTIDAD_COMPLETADA`), cambió en SAP (`LINEA_MODIFICADA`), código de caja (un
  código no registrado que es el de una caja de `inventario_codigos_caja`: el escáner no lo distingue al leer, el reporte
  sí), código no registrado (sin etiqueta confirmada o ambigua) y otros. La tendencia muestra siempre las últimas 8
  semanas (ISO, de lunes a domingo). **Se confunde con**: el producto que se leyó bien justo después en la misma
  preparación (el que había que tomar).
- **Más salen**: unidades que salieron de la 02 por preparaciones (movimientos `picking`; lo devuelto por una
  anulación se resta). Por día hábil = de lunes a sábado. **Alcanza para** = unidades en la 02 ÷ salida por día hábil.
  Alcanzan para poco: menos de 3 días (`DIAS_REPONER_PRONTO`). Sin salidas: con unidades en la 02 y ninguna salida en
  el período, con la última salida y el lote que vence primero.
- **Reposiciones**: cada operación que pasó cajas de la 01 a la 02: traspaso de SAP aceptado (`traspaso`) o a mano
  (`reposicion`). Reponer pronto usa la salida de los últimos 30 días, sea cual sea el período, con las cajas que quedan
  en la 01 y su lote que vence primero. Cada cuánto = días entre la primera y la última ÷ (veces − 1).
- **Correcciones**: conteos editados (la 01, la 02 vuelta a contar, la 03 y la 04), lotes cambiados en salidas
  marcadas, preparaciones anuladas por el supervisor y códigos de barras o de caja quitados, con quién, cuándo, antes y
  ahora. Solo cambios hechos en la app.
- **Pendientes atrasados**: Falta guardar, Falta marcar salida y Traspasos por aceptar (los mismos de Pendientes del
  inventario), por días desde el último cambio de SAP del producto. Si SAP registra otro movimiento del producto, el
  pendiente parece más nuevo. Exige los almacenes elegidos y la comparación con SAP disponible (los mismos `409` que
  Pendientes).
- **Actividad**: lo que hizo cada persona en el día: preparaciones (por quien la preparó), lecturas, recepciones,
  productos contados, reposiciones, salidas marcadas, códigos registrados y correcciones. Con `persona`, además
  `detalle` con las acciones por hora y la lista de lo que hizo.

## Registro de cambios

Desde esta versión se guarda en la tabla `auditoria` (ya existía, sin migración), en la misma transacción de la operación:

| Qué | `entidad` / `accion` | `detalle` (JSON) |
| --- | --- | --- |
| El supervisor anula una preparación en revisión | `preparacion` / `anulada` | `pickingId`, `documento` |
| Se quita un código de barras o de caja | `codigo` / `quitado` | `clase` (`unidad`, `caja`), `codigo`, `itemCode` |
| Se edita un conteo (la 01, la 02 vuelta a contar, la 03 o la 04) | `conteo` / `editado` | `itemCode`, `bodega` o `almacen`, `antes`, `ahora` (texto: "11 cajas × 12 · L330"), `unidades` (cambio) |

`usuario` es quien lo hizo (`operador:Nombre`). Lo anterior a esta versión no se puede recuperar: las anulaciones viejas
salen sin quién, las ediciones viejas de la 01 salen con el total antes y después (de la foto de cuadre `edicion`) y los
códigos quitados antes no aparecen.

## Limitaciones conocidas

- No se puede medir el tiempo de un traspaso desde que aparece en SAP hasta que se acepta, ni la entrega al transportista.
- "Se confunde con" es una aproximación: si después de leer el producto equivocado se leyó otro producto que también
  faltaba, cuenta ese.
