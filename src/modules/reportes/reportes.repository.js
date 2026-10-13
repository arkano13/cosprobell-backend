// Consultas de solo lectura de los reportes de bodega. Las fechas de la base son UTC sin zona; los días se cortan en
// la hora de Honduras (ZONA).
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ZONA } from "./reportes.periodo.js";

// Un instante de JS como timestamp UTC sin zona, para comparar con las columnas de la base.
const ts = (d) => Prisma.sql`(${new Date(d).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
// Día ("YYYY-MM-DD") y semana ISO en Honduras de una columna.
const local = (col) => Prisma.sql`((${Prisma.raw(col)}) AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA}`;
const diaLocal = (col) => Prisma.sql`to_char(${local(col)}, 'YYYY-MM-DD')`;
const semanaLocal = (col) => Prisma.sql`to_char(${local(col)}, 'IYYY-"W"IW')`;
const sinPrefijo = (col) => Prisma.sql`regexp_replace(${Prisma.raw(col)}, '^operador:', '')`;

// Facturas y traslados que todavía no tienen una preparación terminada y tienen algo pendiente en la 02 (como la lista
// de la bodega, sin la sección Preparados).
const SIN_PREPARAR = Prisma.sql`
  p."fuenteDocumento" IN ('factura', 'traslado') AND p."docType" = 'dDocument_Items'
  AND p.cancelled = false AND COALESCE(p."cancelStatus", 'csNo') = 'csNo'
  AND EXISTS (SELECT 1 FROM pedidos_lineas l WHERE l."pedidoDocEntry" = p."docEntry" AND l."warehouseCode" = '02'
    AND l."remainingOpenQuantity" > 0)
  AND NOT EXISTS (SELECT 1 FROM picking_pedidos s WHERE s."pedidoDocEntry" = p."docEntry" AND s.estado IN ('completo', 'con_diferencias'))`;

export const reportesRepository = {
  // Preparaciones cerradas en el rango (terminadas, con diferencias, anuladas) y las que esperan revisión, con sus
  // unidades. Las que esperan revisión no tienen fin: cuentan por su inicio.
  preparaciones({ desde, hasta, operador = null, fuente = null }) {
    return prisma.$queryRaw`
      SELECT s.id, s.estado, s."usuarioId" AS operador, s."fechaInicio", s."fechaFin",
             p."fuenteDocumento" AS fuente, p."docNum", p."almacenDestino",
             COALESCE(SUM(LEAST(l."cantidadEscaneada", l."cantidadPedida")), 0)::float AS preparadas,
             COALESCE(SUM(l."cantidadPedida"), 0)::float AS pedidas,
             COUNT(l.id)::int AS lineas,
             (COUNT(l.id) FILTER (WHERE l."cantidadEscaneada" >= l."cantidadPedida"))::int AS "lineasCompletas"
      FROM picking_pedidos s
      LEFT JOIN pedidos p ON p."docEntry" = s."pedidoDocEntry"
      LEFT JOIN picking_pedidos_lineas l ON l."pickingId" = s.id
      WHERE s.estado <> 'en_proceso'
        AND COALESCE(s."fechaFin", s."fechaInicio") >= ${ts(desde)} AND COALESCE(s."fechaFin", s."fechaInicio") < ${ts(hasta)}
        AND (${operador}::text IS NULL OR s."usuarioId" = ${operador}::text)
        AND (${fuente}::text IS NULL OR p."fuenteDocumento" = ${fuente}::text)
      GROUP BY s.id, p."docEntry"
      ORDER BY COALESCE(s."fechaFin", s."fechaInicio") DESC, s.id DESC`;
  },
  // Lo que hoy espera preparación, con cuántas líneas de la 02 tiene y su fecha de SAP.
  sinPreparar({ fuente = null }) {
    return prisma.$queryRaw`
      SELECT p."docEntry", p."docNum", p."fuenteDocumento" AS fuente, to_char(p."docDate", 'YYYY-MM-DD') AS "docDate",
             (SELECT COUNT(*) FROM pedidos_lineas l WHERE l."pedidoDocEntry" = p."docEntry" AND l."warehouseCode" = '02')::int AS lineas
      FROM pedidos p
      WHERE ${SIN_PREPARAR} AND (${fuente}::text IS NULL OR p."fuenteDocumento" = ${fuente}::text)
      ORDER BY p."docDate" ASC, p."docNum" ASC`;
  },
  // Nombres de los operadores (para los filtros), activos o no.
  operadores() {
    return prisma.operador.findMany({ select: { nombre: true, rol: true, activo: true }, orderBy: { nombre: "asc" } });
  },

  // ---------- Detalle de una preparación ----------
  sesion(id) {
    return prisma.pickingPedido.findUnique({ where: { id }, include: { lineas: { orderBy: [{ pedidoLineNum: "asc" }, { id: "asc" }] } } });
  },
  documento(docEntry) {
    return prisma.pedido.findUnique({ where: { docEntry }, select: { docEntry: true, docNum: true, fuenteDocumento: true,
      almacenDestino: true, cancelled: true } });
  },
  escaneos(pickingId) {
    return prisma.pickingEscaneo.findMany({ where: { pickingId }, orderBy: { id: "desc" },
      select: { id: true, codigo: true, resultado: true, lineaId: true, itemCode: true, cantidadDespues: true,
        errorCode: true, errorMessage: true, creadoEn: true } });
  },
  nombres(itemCodes) {
    if (!itemCodes.length) return [];
    return prisma.producto.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, itemName: true } });
  },
  // Producto de cada código leído (código de unidad, el de la ficha o el de una caja).
  productosDeCodigos(codigos) {
    if (!codigos.length) return [];
    return prisma.$queryRaw`
      SELECT c.codigo, COALESCE(
        (SELECT b."itemCode" FROM productos_codigos_barras b WHERE b.codigo = c.codigo AND NOT b."retiradoEnSap" ORDER BY b.id LIMIT 1),
        (SELECT pr."itemCode" FROM productos pr WHERE pr."barCode" = c.codigo ORDER BY pr."itemCode" LIMIT 1),
        (SELECT k."itemCode" FROM inventario_codigos_caja k WHERE k.codigo = c.codigo)) AS "itemCode",
        EXISTS (SELECT 1 FROM inventario_codigos_caja k WHERE k.codigo = c.codigo) AS "esCaja"
      FROM unnest(${codigos}::text[]) AS c(codigo)`;
  },
  // Un código de barras de unidad para mostrar de cada producto: el confirmado más antiguo o el de la ficha.
  codigosPrincipales(itemCodes) {
    if (!itemCodes.length) return [];
    return prisma.$queryRaw`
      SELECT pr."itemCode", COALESCE(
        (SELECT b.codigo FROM productos_codigos_barras b JOIN confirmaciones_etiquetas_picking c ON c."codigoBarrasId" = b.id
          WHERE b."itemCode" = pr."itemCode" AND NOT b."retiradoEnSap" AND c."esUnidadIndividual" ORDER BY b.id LIMIT 1),
        pr."barCode",
        (SELECT b.codigo FROM productos_codigos_barras b WHERE b."itemCode" = pr."itemCode" AND NOT b."retiradoEnSap" ORDER BY b.id LIMIT 1)
      ) AS codigo
      FROM productos pr WHERE pr."itemCode" = ANY(${itemCodes})`;
  },
  // Quién anuló cada preparación (registrado desde que existe el registro de cambios).
  anuladoPor(pickingIds) {
    if (!pickingIds.length) return [];
    return prisma.$queryRaw`
      SELECT (a.detalle::jsonb->>'pickingId')::int AS "pickingId", a.usuario, a."creadoEn" FROM auditoria a
      WHERE a.entidad = 'preparacion' AND a.accion = 'anulada' AND (a.detalle::jsonb->>'pickingId')::int = ANY(${pickingIds})`;
  },

  // ---------- Errores evitados ----------
  // Lecturas por operador, resultado y motivo de rechazo. esCaja: un código no registrado que es el de una caja.
  lecturas({ desde, hasta, operador = null }) {
    return prisma.$queryRaw`
      SELECT s."usuarioId" AS operador, e.resultado::text AS resultado, e."errorCode",
             (e."errorCode" = 'ETIQUETA_NO_ENCONTRADA' AND EXISTS (SELECT 1 FROM inventario_codigos_caja k WHERE k.codigo = e.codigo)) AS "esCaja",
             COUNT(*)::int AS cantidad, COUNT(DISTINCT e."pickingId")::int AS preparaciones
      FROM picking_escaneos e JOIN picking_pedidos s ON s.id = e."pickingId"
      WHERE e."creadoEn" >= ${ts(desde)} AND e."creadoEn" < ${ts(hasta)}
        AND (${operador}::text IS NULL OR s."usuarioId" = ${operador}::text)
      GROUP BY 1, 2, 3, 4`;
  },
  preparacionesConLecturas({ desde, hasta, operador = null }) {
    return prisma.$queryRaw`
      SELECT COUNT(DISTINCT e."pickingId")::int AS cantidad
      FROM picking_escaneos e JOIN picking_pedidos s ON s.id = e."pickingId"
      WHERE e."creadoEn" >= ${ts(desde)} AND e."creadoEn" < ${ts(hasta)}
        AND (${operador}::text IS NULL OR s."usuarioId" = ${operador}::text)`;
  },
  lecturasPorSemana({ desde, hasta, operador = null }) {
    return prisma.$queryRaw`
      SELECT ${semanaLocal('e."creadoEn"')} AS semana, COUNT(*)::int AS lecturas,
             (COUNT(*) FILTER (WHERE e.resultado = 'rechazado'))::int AS rechazadas
      FROM picking_escaneos e JOIN picking_pedidos s ON s.id = e."pickingId"
      WHERE e."creadoEn" >= ${ts(desde)} AND e."creadoEn" < ${ts(hasta)}
        AND (${operador}::text IS NULL OR s."usuarioId" = ${operador}::text)
      GROUP BY 1`;
  },
  // Cada lectura de un producto que no iba, con el producto que se leyó bien justo después en esa preparación (el que
  // había que tomar).
  equivocados({ desde, hasta, operador = null }) {
    return prisma.$queryRaw`
      SELECT e.codigo, n."itemCode" AS "siguiente"
      FROM picking_escaneos e JOIN picking_pedidos s ON s.id = e."pickingId"
      LEFT JOIN LATERAL (SELECT x."itemCode" FROM picking_escaneos x
        WHERE x."pickingId" = e."pickingId" AND x.id > e.id AND x.resultado = 'aceptado' ORDER BY x.id LIMIT 1) n ON true
      WHERE e.resultado = 'rechazado' AND e."errorCode" = 'PRODUCTO_FUERA_DEL_PEDIDO'
        AND e."creadoEn" >= ${ts(desde)} AND e."creadoEn" < ${ts(hasta)}
        AND (${operador}::text IS NULL OR s."usuarioId" = ${operador}::text)`;
  },

  // ---------- Más salen ----------
  // Unidades que salieron de la bodega por preparaciones (lo devuelto por una anulación se resta), por producto.
  salidas({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT m."itemCode", (-SUM(m.cantidad))::int AS unidades,
             COUNT(DISTINCT m."pickingId") FILTER (WHERE m.tipo = 'picking')::int AS documentos
      FROM inventario_movimientos m
      WHERE m.tipo IN ('picking', 'anulacion') AND m."pickingId" IS NOT NULL
        AND m."creadoEn" >= ${ts(desde)} AND m."creadoEn" < ${ts(hasta)}
      GROUP BY m."itemCode" HAVING SUM(m.cantidad) < 0`;
  },
  // Productos con unidades en la 02: cuántas, la última salida y el lote que vence primero.
  enPequena() {
    return prisma.$queryRaw`
      SELECT ip."itemCode", pr."itemName", ip.pequena,
             (SELECT MAX(m."creadoEn") FROM inventario_movimientos m WHERE m."itemCode" = ip."itemCode" AND m.tipo = 'picking') AS "ultimaSalida",
             (SELECT to_char(MIN(l.vencimiento), 'YYYY-MM-DD') FROM inventario_pequena_lotes l
               WHERE l."itemCode" = ip."itemCode" AND l.unidades > 0) AS "vencePrimero"
      FROM inventario_productos ip JOIN productos pr ON pr."itemCode" = ip."itemCode"
      WHERE ip.pequena > 0`;
  },

  // ---------- Reposiciones ----------
  // Una fila por reposición (todas las cajas pasadas en una misma operación): traspaso de SAP aceptado o pasada a mano.
  reposiciones({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT m.grupo, MIN(m.tipo) AS tipo, MIN(m."itemCode") AS "itemCode", MIN(m."creadoEn") AS "creadoEn",
             MIN(${sinPrefijo('m."hechoPor"')}) AS persona,
             COUNT(DISTINCT m."cajaId")::int AS cajas, SUM(m.cantidad)::int AS unidades
      FROM inventario_movimientos m
      WHERE m.tipo IN ('reposicion', 'traspaso') AND m.bodega = 'pequena' AND m.cantidad > 0
        AND m."creadoEn" >= ${ts(desde)} AND m."creadoEn" < ${ts(hasta)}
      GROUP BY m.grupo
      ORDER BY MIN(m."creadoEn")`;
  },
  // Cajas con unidades en la 01 por producto, y el lote que vence primero.
  cajasEnGrande(itemCodes) {
    if (!itemCodes.length) return [];
    return prisma.$queryRaw`
      SELECT c."itemCode", COUNT(*)::int AS cajas,
             (ARRAY_AGG(c.lote ORDER BY c.vencimiento ASC NULLS LAST, c.id))[1] AS lote,
             to_char(MIN(c.vencimiento), 'YYYY-MM-DD') AS vencimiento
      FROM inventario_cajas c WHERE c.unidades > 0 AND c."itemCode" = ANY(${itemCodes})
      GROUP BY c."itemCode"`;
  },

  // ---------- Correcciones ----------
  cambiosRegistrados({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT a.id, a.entidad, a.accion, ${sinPrefijo("a.usuario")} AS persona, a.detalle, a."creadoEn" FROM auditoria a
      WHERE a.entidad IN ('conteo', 'preparacion', 'codigo') AND a."creadoEn" >= ${ts(desde)} AND a."creadoEn" < ${ts(hasta)}
      ORDER BY a."creadoEn" DESC`;
  },
  // Ediciones del conteo de la 01 anteriores al registro de cambios (sin una fila de auditoría de ese momento).
  edicionesAntiguas({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT c.id, c."itemCode", c.cantidad, c.registrado, ${sinPrefijo('c."hechoPor"')} AS persona, c."creadoEn"
      FROM inventario_cuadres c
      WHERE c.accion = 'edicion' AND c."creadoEn" >= ${ts(desde)} AND c."creadoEn" < ${ts(hasta)}
        AND NOT EXISTS (SELECT 1 FROM auditoria a WHERE a.entidad = 'conteo' AND a.detalle::jsonb->>'itemCode' = c."itemCode"
          AND a."creadoEn" BETWEEN c."creadoEn" - interval '5 seconds' AND c."creadoEn" + interval '5 seconds')`;
  },
  // Salidas marcadas a las que después se les cambió el lote, con lo que hoy tienen asignado.
  descuentosCorregidos({ desde, hasta }) {
    return prisma.inventarioDescuento.findMany({
      where: { corregidoEn: { gte: new Date(desde), lt: new Date(hasta) } },
      include: { movimientos: { include: { caja: { select: { codigo: true } } } } },
      orderBy: { corregidoEn: "desc" },
    });
  },
  // Preparaciones anuladas por el supervisor, con su documento y cuántas lecturas tenían.
  anuladas({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT s.id, s."usuarioId" AS operador, s."fechaFin", p."fuenteDocumento" AS fuente, p."docNum", p."almacenDestino",
             (SELECT COUNT(*) FROM picking_escaneos e WHERE e."pickingId" = s.id AND e.resultado = 'aceptado')::int AS lecturas,
             (SELECT ${sinPrefijo("a.usuario")} FROM auditoria a WHERE a.entidad = 'preparacion' AND a.accion = 'anulada'
               AND (a.detalle::jsonb->>'pickingId')::int = s.id ORDER BY a.id DESC LIMIT 1) AS persona
      FROM picking_pedidos s LEFT JOIN pedidos p ON p."docEntry" = s."pedidoDocEntry"
      WHERE s.estado = 'anulada' AND s."fechaFin" >= ${ts(desde)} AND s."fechaFin" < ${ts(hasta)}`;
  },

  // ---------- Actividad por operador ----------
  // Lecturas de preparación del día por persona y hora.
  lecturasPorHora({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT s."usuarioId" AS persona, EXTRACT(HOUR FROM ${local('e."creadoEn"')})::int AS hora, COUNT(*)::int AS cantidad,
             MIN(e."creadoEn") AS primera, MAX(e."creadoEn") AS ultima
      FROM picking_escaneos e JOIN picking_pedidos s ON s.id = e."pickingId"
      WHERE e."creadoEn" >= ${ts(desde)} AND e."creadoEn" < ${ts(hasta)} AND s."usuarioId" IS NOT NULL
      GROUP BY 1, 2`;
  },
  // Movimientos del día agrupados por operación (una recepción, una reposición, una salida marcada…).
  movimientosDelDia({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT m.grupo, MIN(m.tipo) AS tipo, MIN(m."itemCode") AS "itemCode", MIN(m."creadoEn") AS "creadoEn",
             MIN(${sinPrefijo('m."hechoPor"')}) AS persona, COUNT(DISTINCT m."cajaId")::int AS cajas,
             COUNT(DISTINCT m.lote)::int AS lotes, SUM(m.cantidad) FILTER (WHERE m.cantidad > 0)::int AS entra,
             (-SUM(m.cantidad) FILTER (WHERE m.cantidad < 0))::int AS sale, MIN(m.bodega) AS bodega, MAX(m.bodega) AS "otraBodega"
      FROM inventario_movimientos m
      WHERE m."creadoEn" >= ${ts(desde)} AND m."creadoEn" < ${ts(hasta)} AND m.tipo NOT IN ('picking', 'anulacion')
        AND m."hechoPor" IS NOT NULL
      GROUP BY m.grupo`;
  },
  // Conteos y recepciones del día (la foto de cuadre de cada uno).
  cuadresDelDia({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT c.id, c."itemCode", c.bodega, c.accion, c.cantidad, c.primero, ${sinPrefijo('c."hechoPor"')} AS persona, c."creadoEn"
      FROM inventario_cuadres c
      WHERE c."creadoEn" >= ${ts(desde)} AND c."creadoEn" < ${ts(hasta)} AND c."hechoPor" IS NOT NULL`;
  },
  // Conteos de la 03 y la 04 guardados en el día.
  conteosAlmacenDelDia({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT c.almacen, c."itemCode", c.unidades, c.cajas, ${sinPrefijo('c."actualizadoPor"')} AS persona, c."actualizadoEn" AS "creadoEn",
             (c."contadoEn" < c."actualizadoEn" - interval '1 second') AS editado
      FROM inventario_conteos_almacen c
      WHERE c."actualizadoEn" >= ${ts(desde)} AND c."actualizadoEn" < ${ts(hasta)} AND c."actualizadoPor" IS NOT NULL`;
  },
  // Salidas marcadas del día.
  descuentosDelDia({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT d.id, d."itemCode", d.unidades, ${sinPrefijo('d."hechoPor"')} AS persona, d."creadoEn"
      FROM inventario_descuentos d
      WHERE d."creadoEn" >= ${ts(desde)} AND d."creadoEn" < ${ts(hasta)} AND d."hechoPor" IS NOT NULL`;
  },
  // Códigos de barras (de unidad o de caja) registrados en el día desde la app.
  codigosDelDia({ desde, hasta }) {
    return prisma.$queryRaw`
      SELECT 'unidad' AS clase, b.codigo, b."itemCode", ${sinPrefijo('b."registradoPor"')} AS persona, b."creadoEn"
      FROM productos_codigos_barras b
      WHERE b.origen = 'app' AND b."creadoEn" >= ${ts(desde)} AND b."creadoEn" < ${ts(hasta)} AND b."registradoPor" IS NOT NULL
      UNION ALL
      SELECT 'caja' AS clase, k.codigo, k."itemCode", ${sinPrefijo('k."registradoPor"')} AS persona, k."creadoEn"
      FROM inventario_codigos_caja k
      WHERE k."creadoEn" >= ${ts(desde)} AND k."creadoEn" < ${ts(hasta)} AND k."registradoPor" IS NOT NULL`;
  },
};

// Escribe una fila del registro de cambios (tabla auditoria) dentro de la transacción de la operación. detalle va como
// JSON. Lo leen los reportes de Correcciones y Actividad.
export function registrarCambio(tx, { entidad, accion, usuario, detalle }) {
  return tx.auditoria.create({ data: { entidad, accion, usuario: usuario ?? null, detalle: JSON.stringify(detalle) } });
}
