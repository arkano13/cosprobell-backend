// Consultas del inventario. Los cambios de un producto se hacen con su candado tomado (conProducto).
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ejecutarUnaVez } from "./inventario.operacion.js";

const literal = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

// Un producto ya se contó en una bodega si tuvo una recepción o un conteo ahí (aunque haya sido "no hay").
const CONTADOS = (bodega) => Prisma.sql`
  SELECT DISTINCT "itemCode" FROM inventario_movimientos WHERE bodega = ${bodega} AND tipo IN ('recepcion', 'conteo')`;

// Existencia en SAP sumando solo los almacenes que el supervisor marcó como de esta bodega.
const EN_SAP = Prisma.sql`
  SELECT e."itemCode", SUM(e."inStock")::float AS sap
  FROM productos_existencias e JOIN bodegas b ON b."warehouseCode" = e."warehouseCode" AND b."deEstaBodega"
  GROUP BY e."itemCode"`;

// Unidades preparadas y finalizadas cuyo pedido sigue abierto en SAP y todavía no se entregaron: ya salieron
// de la bodega pequeña, pero SAP las sigue contando. Lo entregado se deduce de lo que SAP dejó pendiente.
// Solo cuentan las líneas de los almacenes de esta bodega.
const SIN_ENTREGA = Prisma.sql`
  SELECT l."itemCode", SUM(GREATEST(0, l."cantidadEscaneada" - GREATEST(0, l."cantidadPedida"
    - COALESCE(pl."remainingOpenInventoryQuantity", pl."remainingOpenQuantity", 0))))::int AS "sinEntrega"
  FROM picking_pedidos s
  JOIN pedidos p ON p."docEntry" = s."pedidoDocEntry" AND p."documentStatus" = 'bost_Open' AND p.cancelled = false
  JOIN picking_pedidos_lineas l ON l."pickingId" = s.id
  JOIN pedidos_lineas pl ON pl."pedidoDocEntry" = s."pedidoDocEntry" AND pl."lineNum" = l."pedidoLineNum"
  JOIN bodegas b ON b."warehouseCode" = pl."warehouseCode" AND b."deEstaBodega"
  WHERE s.estado IN ('completo', 'con_diferencias')
  GROUP BY l."itemCode"`;

export const inventarioRepository = {
  lotesPequena(itemCode, db = prisma) {
    return db.$queryRaw`SELECT * FROM inventario_pequena_lotes WHERE "itemCode" = ${itemCode} AND unidades > 0
      ORDER BY vencimiento ASC NULLS LAST, id`;
  },
  async sumarLotePequena(itemCode, lote, vencimiento, unidades, tx) {
    const fecha = vencimiento ? new Date(vencimiento).toISOString().slice(0, 10) : null;
    const clave = JSON.stringify([itemCode, lote ?? null, fecha]);
    const [fila] = await tx.$queryRaw`
      INSERT INTO inventario_pequena_lotes (clave, "itemCode", lote, vencimiento, unidades)
      VALUES (${clave}, ${itemCode}, ${lote ?? null}, ${fecha}::date, ${unidades})
      ON CONFLICT (clave) DO UPDATE SET unidades = inventario_pequena_lotes.unidades + EXCLUDED.unidades
      RETURNING *`;
    return fila;
  },
  async cambiarLotePequena(id, itemCode, delta, tx) {
    const filas = await tx.$queryRaw`UPDATE inventario_pequena_lotes SET unidades = unidades + ${delta}
      WHERE id = ${id} AND "itemCode" = ${itemCode} AND unidades + ${delta} >= 0 RETURNING *`;
    return filas[0] ?? null;
  },
  // Cuándo se confirmó por última vez lo que SAP tiene: el fin del último recorrido completo de existencias (el puente
  // solo manda lo que cambió, así que el último lote puede ser viejo) o el último lote recibido, lo más reciente.
  async existenciasSapAl(db = prisma) {
    const [fila] = await db.$queryRaw`SELECT GREATEST(
      (SELECT "finalizadoEn" FROM sincronizacion_recorridos WHERE entidad = 'existencias'),
      (SELECT "actualizadoEn" FROM sincronizacion_estados WHERE entidad = 'existencias')) AS al`;
    return fila?.al ?? null;
  },
  async comparacionDisponible(db = prisma) {
    // La edad se mide desde el inicio: terminar un recorrido lento no rejuvenece sus primeras páginas.
    const [fila] = await db.$queryRaw`
      SELECT EXISTS (SELECT 1 FROM bodegas WHERE "deEstaBodega")
        AND (SELECT COUNT(*) = 2 FROM sincronizacion_recorridos
             WHERE "finalizadoEn" IS NOT NULL AND (
               (entidad = 'almacenes' AND "iniciadoEn" >= now() - interval '48 hours') OR
               (entidad = 'existencias' AND "iniciadoEn" >= now() - interval '30 minutes')))
        AND NOT EXISTS (SELECT 1 FROM productos_existencias e, sincronizacion_recorridos r
          WHERE r.entidad = 'existencias' AND e."actualizadoEn" < r."iniciadoEn") AS disponible`;
    return fila?.disponible === true;
  },
  // Una operación por producto a la vez: recepciones, reposiciones, descuentos y picking no se pisan.
  conProducto(itemCodes, operacion, solicitud = null) {
    const lista = [...new Set([].concat(itemCodes))].sort();
    return prisma.$transaction(async (tx) => {
      const ejecutar = async () => {
        for (const itemCode of lista) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventario:${itemCode}`}))::text`;
        return operacion(tx);
      };
      return solicitud ? ejecutarUnaVez(tx, solicitud, ejecutar) : ejecutar();
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 });
  },
  transaccion(operacion) {
    return prisma.$transaction(operacion, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 });
  },
  bloquearProductos(itemCodes, tx) {
    return [...new Set(itemCodes)].sort().reduce((p, itemCode) =>
      p.then(() => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventario:${itemCode}`}))::text`), Promise.resolve());
  },

  // Datos para la diferencia con SAP, de todos los productos con existencia o en el inventario, o de algunos.
  estados({ itemCodes = null } = {}, db = prisma) {
    const filtro = itemCodes ? Prisma.sql`pr."itemCode" = ANY(${itemCodes})`
      : Prisma.sql`(ip."itemCode" IS NOT NULL OR COALESCE(s.sap, 0) <> 0 OR g.grande IS NOT NULL)`;
    return db.$queryRaw`
      WITH g AS (SELECT "itemCode", SUM(unidades)::int AS grande, (COUNT(*) FILTER (WHERE unidades > 0))::int AS cajas
                 FROM inventario_cajas GROUP BY "itemCode"),
           s AS (${EN_SAP}), se AS (${SIN_ENTREGA})
      SELECT pr."itemCode", pr."itemName", COALESCE(s.sap, 0) AS sap, (ip."itemCode" IS NOT NULL) AS activo,
             COALESCE(ip.pequena, 0) AS pequena, COALESCE(ip.adelantado, 0) AS adelantado, ip."sapCambioEn",
             COALESCE(g.grande, 0) AS grande, COALESCE(g.cajas, 0) AS cajas, COALESCE(se."sinEntrega", 0) AS "sinEntrega"
      FROM productos pr
      LEFT JOIN inventario_productos ip ON ip."itemCode" = pr."itemCode"
      LEFT JOIN g ON g."itemCode" = pr."itemCode"
      LEFT JOIN s ON s."itemCode" = pr."itemCode"
      LEFT JOIN se ON se."itemCode" = pr."itemCode"
      WHERE ${filtro}
      ORDER BY pr."itemName", pr."itemCode"`;
  },

  // Lo que SAP tiene en el almacén de cada bodega frente a lo que hay en ella, para los productos que ya están en el
  // inventario (para los traspasos de la 01 a la 02 que falta marcar).
  pases(almacenGrande, almacenPequena, { itemCodes = null } = {}, db = prisma) {
    const sap = (almacen) => Prisma.sql`SELECT "itemCode", SUM("inStock")::float AS sap FROM productos_existencias
      WHERE "warehouseCode" = ${almacen} GROUP BY "itemCode"`;
    const filtro = itemCodes ? Prisma.sql`AND pr."itemCode" = ANY(${itemCodes})` : Prisma.empty;
    return db.$queryRaw`
      WITH g AS (SELECT "itemCode", SUM(unidades)::int AS grande, (COUNT(*) FILTER (WHERE unidades > 0))::int AS cajas
                 FROM inventario_cajas GROUP BY "itemCode"),
           s1 AS (${sap(almacenGrande)}), s2 AS (${sap(almacenPequena)}), se AS (${SIN_ENTREGA})
      SELECT pr."itemCode", pr."itemName", COALESCE(s1.sap, 0) AS "sapGrande", COALESCE(s2.sap, 0) AS "sapPequena",
             COALESCE(g.grande, 0) AS grande, COALESCE(g.cajas, 0) AS cajas, ip.pequena, COALESCE(se."sinEntrega", 0) AS "sinEntrega"
      FROM productos pr
      JOIN inventario_productos ip ON ip."itemCode" = pr."itemCode"
      LEFT JOIN g ON g."itemCode" = pr."itemCode"
      LEFT JOIN s1 ON s1."itemCode" = pr."itemCode"
      LEFT JOIN s2 ON s2."itemCode" = pr."itemCode"
      LEFT JOIN se ON se."itemCode" = pr."itemCode"
      WHERE COALESCE(g.grande, 0) > COALESCE(s1.sap, 0) ${filtro}
      ORDER BY pr."itemName", pr."itemCode"`;
  },

  // Lo que hay en una bodega, por producto y lote, con lo que SAP tiene en el almacén asignado a esa bodega (si hay).
  // Incluye los productos que SAP tiene en ese almacén y en la bodega no están registrados.
  contenidoBodega(bodega, almacen, db = prisma) {
    const lotes = bodega === "grande"
      ? Prisma.sql`SELECT "itemCode", lote, vencimiento, SUM(unidades)::int AS unidades, COUNT(*)::int AS cajas
          FROM inventario_cajas WHERE unidades > 0 GROUP BY "itemCode", lote, vencimiento`
      : Prisma.sql`SELECT "itemCode", lote, vencimiento, unidades, 0 AS cajas FROM inventario_pequena_lotes WHERE unidades > 0`;
    const totales = bodega === "grande"
      ? Prisma.sql`SELECT "itemCode", SUM(unidades)::int AS unidades, SUM(cajas)::int AS cajas FROM l GROUP BY "itemCode"`
      : Prisma.sql`SELECT "itemCode", pequena AS unidades, 0 AS cajas FROM inventario_productos WHERE pequena <> 0
          UNION SELECT l."itemCode", 0, 0 FROM l WHERE NOT EXISTS (SELECT 1 FROM inventario_productos ip WHERE ip."itemCode" = l."itemCode")`;
    return db.$queryRaw`
      WITH l AS (${lotes}), t AS (${totales}),
           s AS (SELECT "itemCode", SUM("inStock")::float AS sap FROM productos_existencias WHERE "warehouseCode" = ${almacen} GROUP BY "itemCode")
      SELECT pr."itemCode", pr."itemName", COALESCE(t.unidades, 0)::int AS unidades, COALESCE(t.cajas, 0)::int AS cajas, s.sap,
             (COALESCE(t.unidades, 0) <> 0 OR pr."itemCode" IN (${CONTADOS(bodega)})) AS contado,
             COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('lote', l.lote, 'vencimiento', l.vencimiento, 'unidades', l.unidades, 'cajas', l.cajas)
                       ORDER BY l.vencimiento NULLS LAST, l.lote NULLS LAST) FROM l WHERE l."itemCode" = pr."itemCode"), '[]'::jsonb) AS lotes
      FROM productos pr
      LEFT JOIN t ON t."itemCode" = pr."itemCode"
      LEFT JOIN s ON s."itemCode" = pr."itemCode"
      WHERE t."itemCode" IS NOT NULL OR COALESCE(s.sap, 0) <> 0
      ORDER BY pr."itemName", pr."itemCode"`;
  },

  // Conteo de una bodega: los productos que SAP tiene en su almacén, con lo registrado y si ya se contaron.
  conteoBodega(bodega, almacen, db = prisma) {
    const registrado = bodega === "grande"
      ? Prisma.sql`SELECT "itemCode", SUM(unidades)::int AS unidades, (COUNT(*) FILTER (WHERE unidades > 0))::int AS cajas
          FROM inventario_cajas GROUP BY "itemCode"`
      : Prisma.sql`SELECT "itemCode", pequena AS unidades, 0 AS cajas FROM inventario_productos`;
    return db.$queryRaw`
      WITH s AS (SELECT "itemCode", SUM("inStock")::float AS sap FROM productos_existencias WHERE "warehouseCode" = ${almacen}
                 GROUP BY "itemCode" HAVING SUM("inStock") > 0),
           u AS (${registrado}), c AS (${CONTADOS(bodega)})
      SELECT p."itemCode", p."itemName", s.sap, COALESCE(u.unidades, 0)::int AS unidades, COALESCE(u.cajas, 0)::int AS cajas,
             (c."itemCode" IS NOT NULL OR COALESCE(u.unidades, 0) <> 0) AS contado,
             (SELECT COUNT(*) FROM productos_codigos_barras b WHERE b."itemCode" = p."itemCode" AND b."retiradoEnSap" = false)::int AS codigos
      FROM s JOIN productos p ON p."itemCode" = s."itemCode"
      LEFT JOIN u ON u."itemCode" = s."itemCode"
      LEFT JOIN c ON c."itemCode" = s."itemCode"
      ORDER BY p."itemName", p."itemCode"`;
  },
  // Lo que SAP tiene de un producto en cada almacén pedido.
  async sapDeProducto(itemCode, almacenes, db = prisma) {
    if (!almacenes.length) return new Map();
    const filas = await db.$queryRaw`SELECT "warehouseCode", SUM("inStock")::float AS sap FROM productos_existencias
      WHERE "itemCode" = ${itemCode} AND "warehouseCode" = ANY(${almacenes}) GROUP BY "warehouseCode"`;
    return new Map(filas.map((f) => [f.warehouseCode, f.sap]));
  },
  // En qué bodegas ya se contó un producto.
  async contadoEn(itemCode, db = prisma) {
    const filas = await db.$queryRaw`SELECT DISTINCT bodega FROM inventario_movimientos
      WHERE "itemCode" = ${itemCode} AND tipo IN ('recepcion', 'conteo')`;
    return new Set(filas.map((f) => f.bodega));
  },
  async nombresDeAlmacenes(codigos, db = prisma) {
    if (!codigos.length) return new Map();
    const filas = await db.bodega.findMany({ where: { warehouseCode: { in: codigos } }, select: { warehouseCode: true, warehouseName: true } });
    return new Map(filas.map((f) => [f.warehouseCode, f.warehouseName]));
  },

  // Lo que SAP tiene en un almacén, producto por producto (en stock, comprometido y pedido).
  productosDeAlmacen(codigo, db = prisma) {
    return db.$queryRaw`
      SELECT e."itemCode", p."itemName", e."inStock"::float AS "enStock", e.committed::float AS comprometido, e.ordered::float AS pedido
      FROM productos_existencias e JOIN productos p ON p."itemCode" = e."itemCode"
      WHERE e."warehouseCode" = ${codigo} AND (e."inStock" <> 0 OR e.committed <> 0 OR e.ordered <> 0)
      ORDER BY p."itemName", e."itemCode"`;
  },

  // Almacenes de SAP con lo que sirve para reconocerlos: productos con existencia, unidades y líneas de pedidos abiertos.
  almacenes(db = prisma) {
    return db.$queryRaw`
      SELECT b."warehouseCode", b."warehouseName", b.inactive, b."deEstaBodega", b."sincronizadoEn",
             COALESCE(e.productos, 0)::int AS productos, COALESCE(e.unidades, 0)::float AS unidades,
             COALESCE(l.lineas, 0)::int AS "lineasAbiertas"
      FROM bodegas b
      LEFT JOIN (SELECT "warehouseCode", COUNT(*) FILTER (WHERE "inStock" <> 0) AS productos, SUM("inStock") AS unidades
                 FROM productos_existencias GROUP BY "warehouseCode") e ON e."warehouseCode" = b."warehouseCode"
      LEFT JOIN (SELECT pl."warehouseCode", COUNT(*) AS lineas FROM pedidos_lineas pl
                 JOIN pedidos p ON p."docEntry" = pl."pedidoDocEntry" AND p."documentStatus" = 'bost_Open' AND p.cancelled = false
                 GROUP BY pl."warehouseCode") l ON l."warehouseCode" = b."warehouseCode"
      ORDER BY b."deEstaBodega" DESC, COALESCE(l.lineas, 0) DESC, COALESCE(e.unidades, 0) DESC, b."warehouseCode"`;
  },
  async almacenesDeEstaBodega(db = prisma) {
    const filas = await db.bodega.findMany({ where: { deEstaBodega: true }, select: { warehouseCode: true }, orderBy: { warehouseCode: "asc" } });
    return filas.map((f) => f.warehouseCode);
  },
  marcarAlmacenes(codigos, tx) {
    return tx.$executeRaw`UPDATE bodegas SET "deEstaBodega" = ("warehouseCode" = ANY(${codigos}))`;
  },
  async opcion(clave, db = prisma) {
    const fila = await db.configuracion.findUnique({ where: { clave } });
    return fila?.valor ?? null;
  },
  guardarOpcion(clave, valor, actualizadoPor, tx) {
    return tx.configuracion.upsert({ where: { clave }, create: { clave, valor, actualizadoPor }, update: { valor, actualizadoPor } });
  },

  async resumenBodegas(db = prisma) {
    const [[grande], [pequena]] = await Promise.all([
      db.$queryRaw`
        SELECT COUNT(*) FILTER (WHERE unidades > 0)::int AS cajas,
               COUNT(*) FILTER (WHERE unidades > 0 AND unidades < "unidadesIniciales")::int AS abiertas,
               COUNT(DISTINCT "itemCode") FILTER (WHERE unidades > 0)::int AS productos,
               COUNT(DISTINCT "itemCode" || '|' || COALESCE(lote, '')) FILTER (WHERE unidades > 0)::int AS lotes,
               COALESCE(SUM(unidades), 0)::int AS unidades
        FROM inventario_cajas`,
      db.$queryRaw`
        SELECT COALESCE(SUM(pequena) FILTER (WHERE pequena > 0), 0)::int AS unidades,
               COUNT(*) FILTER (WHERE pequena > 0)::int AS productos,
               COUNT(*) FILTER (WHERE pequena < 0)::int AS negativos
        FROM inventario_productos`,
    ]);
    return { grande, pequena };
  },

  buscarProductos(buscar, limite = 20, db = prisma) {
    const patron = `%${literal(buscar)}%`;
    return db.$queryRaw`
      SELECT p."itemCode", p."itemName",
             COALESCE(ARRAY_AGG(DISTINCT c.codigo) FILTER (WHERE c.codigo IS NOT NULL), '{}') AS codigos
      FROM productos p
      LEFT JOIN productos_codigos_barras c ON c."itemCode" = p."itemCode" AND c."retiradoEnSap" = false
      WHERE p."itemCode" ILIKE ${patron} OR p."itemName" ILIKE ${patron}
         OR EXISTS (SELECT 1 FROM productos_codigos_barras b WHERE b."itemCode" = p."itemCode" AND b.codigo = ${buscar} AND b."retiradoEnSap" = false)
      GROUP BY p."itemCode", p."itemName"
      ORDER BY (p."itemCode" = ${buscar} OR EXISTS (SELECT 1 FROM productos_codigos_barras b WHERE b."itemCode" = p."itemCode" AND b.codigo = ${buscar})) DESC,
               p."itemName"
      LIMIT ${limite}`;
  },

  producto(itemCode, db = prisma) {
    return db.producto.findUnique({ where: { itemCode }, select: { itemCode: true, itemName: true, quantityOnStock: true,
      sincronizadoEn: true, inventario: true,
      codigosBarras: { where: { retiradoEnSap: false }, select: { id: true, codigo: true, origen: true, registradoPor: true, confirmacionPicking: { select: { esUnidadIndividual: true } } }, orderBy: { id: "asc" } } } });
  },

  cajasDe(itemCode, { conUnidades = true } = {}, db = prisma) {
    return db.inventarioCaja.findMany({ where: { itemCode, ...(conUnidades ? { unidades: { gt: 0 } } : {}) },
      orderBy: [{ vencimiento: { sort: "asc", nulls: "last" } }, { id: "asc" }] });
  },
  cajaPorId(id, db = prisma) {
    return db.inventarioCaja.findUnique({ where: { id } });
  },
  cajaPorCodigo(codigo, db = prisma) {
    return db.inventarioCaja.findUnique({ where: { codigo }, include: { producto: { select: { itemName: true } } } });
  },
  async cajaBloqueada(id, tx) {
    const [caja] = await tx.$queryRaw`SELECT * FROM inventario_cajas WHERE id = ${id} FOR UPDATE`;
    return caja ?? null;
  },
  cajasDeProductoBloqueadas(itemCode, tx) {
    return tx.$queryRaw`SELECT * FROM inventario_cajas WHERE "itemCode" = ${itemCode} AND unidades > 0 ORDER BY id FOR UPDATE`;
  },
  cajasDeLoteBloqueadas(itemCode, lote, tx) {
    return tx.$queryRaw`
      SELECT * FROM inventario_cajas WHERE "itemCode" = ${itemCode} AND lote IS NOT DISTINCT FROM ${lote} AND unidades > 0
      ORDER BY id FOR UPDATE`;
  },
  reservarIdsCajas(cantidad, tx) {
    return tx.$queryRaw`SELECT nextval(pg_get_serial_sequence('inventario_cajas', 'id'))::int AS id FROM generate_series(1, ${cantidad})`;
  },
  crearCajas(cajas, tx) {
    return tx.inventarioCaja.createMany({ data: cajas });
  },
  cambiarUnidadesCaja(id, delta, tx) {
    return tx.$executeRaw`UPDATE inventario_cajas SET unidades = unidades + ${delta} WHERE id = ${id}`;
  },
  fijarUnidadesCaja(id, unidades, tx) {
    return tx.$executeRaw`UPDATE inventario_cajas SET unidades = ${unidades} WHERE id = ${id}`;
  },

  async estadoProducto(itemCode, tx) {
    const [fila] = await tx.$queryRaw`SELECT * FROM inventario_productos WHERE "itemCode" = ${itemCode} FOR UPDATE`;
    return fila ?? null;
  },
  activar(itemCode, tx) {
    return tx.$executeRaw`
      INSERT INTO inventario_productos ("itemCode", "actualizadoEn") VALUES (${itemCode}, now()) ON CONFLICT ("itemCode") DO NOTHING`;
  },
  cambiarPequena(itemCode, delta, tx) {
    return tx.$executeRaw`UPDATE inventario_productos SET pequena = pequena + ${delta}, "actualizadoEn" = now() WHERE "itemCode" = ${itemCode}`;
  },
  sumarAdelantado(itemCode, unidades, tx) {
    return tx.$executeRaw`UPDATE inventario_productos SET adelantado = adelantado + ${unidades}, "actualizadoEn" = now() WHERE "itemCode" = ${itemCode}`;
  },

  registrarMovimientos(movimientos, tx) {
    return movimientos.length ? tx.inventarioMovimiento.createMany({ data: movimientos }) : null;
  },
  crearDescuento(datos, tx) {
    return tx.inventarioDescuento.create({ data: datos });
  },
  descuento(id, tx = prisma) {
    return tx.inventarioDescuento.findUnique({ where: { id }, include: { movimientos: { include: { caja: { select: { codigo: true } } } } } });
  },
  corregirDescuento(id, datos, tx) {
    return tx.inventarioDescuento.update({ where: { id }, data: datos });
  },

  // Movimientos agrupados por operación, del más reciente al más viejo.
  movimientos({ itemCode = null, limite = 20, antesDe = null } = {}, db = prisma) {
    const condiciones = [Prisma.sql`true`];
    if (itemCode) condiciones.push(Prisma.sql`m."itemCode" = ${itemCode}`);
    return db.$queryRaw`
      SELECT m.grupo, MAX(m.id) AS id, MIN(m.tipo) AS tipo, MIN(m."itemCode") AS "itemCode", MIN(p."itemName") AS "itemName",
             COALESCE(SUM(m.cantidad) FILTER (WHERE m.bodega = 'grande'), 0)::int AS grande,
             COALESCE(SUM(m.cantidad) FILTER (WHERE m.bodega = 'pequena'), 0)::int AS pequena,
             COUNT(DISTINCT m."cajaId")::int AS cajas, MIN(m.lote) AS lote, COUNT(DISTINCT m.lote)::int AS lotes,
             COALESCE(JSONB_AGG(jsonb_build_object('pequenaLoteId', m."pequenaLoteId", 'lote', m.lote,
               'vencimiento', lp.vencimiento, 'cantidad', m.cantidad) ORDER BY m.id)
               FILTER (WHERE m."pequenaLoteId" IS NOT NULL), '[]'::jsonb) AS "lotesPequena",
             MAX(m."creadoEn") AS "creadoEn", MIN(m."hechoPor") AS "hechoPor", MIN(pe."docNum") AS "docNum", MIN(m.observacion) AS observacion
      FROM inventario_movimientos m
      JOIN productos p ON p."itemCode" = m."itemCode"
      LEFT JOIN inventario_pequena_lotes lp ON lp.id = m."pequenaLoteId"
      LEFT JOIN picking_pedidos pp ON pp.id = m."pickingId"
      LEFT JOIN pedidos pe ON pe."docEntry" = pp."pedidoDocEntry"
      WHERE ${Prisma.join(condiciones, " AND ")}
      GROUP BY m.grupo
      HAVING ${antesDe === null ? Prisma.sql`true` : Prisma.sql`MAX(m.id) < ${antesDe}`}
      ORDER BY MAX(m.id) DESC
      LIMIT ${limite}`;
  },

  descuentos({ limite = 30, antesDe = null } = {}, db = prisma) {
    return db.inventarioDescuento.findMany({ where: antesDe ? { id: { lt: antesDe } } : {}, orderBy: { id: "desc" }, take: limite,
      include: { movimientos: { include: { caja: { select: { codigo: true } } } } } });
  },

  // Documentos de SAP recientes que mueven existencias de estos productos (para explicar una diferencia).
  // Los anulados no cuentan: el cancelado y el que lo revierte se compensan.
  documentosRecientes(itemCodes, { dias = 30, porProducto = 3 } = {}, db = prisma) {
    if (!itemCodes.length) return [];
    return db.$queryRaw`
      SELECT "itemCode", tipo, "docEntry", "docNum", "docDate", comentarios, cancelado, cantidad FROM (
        SELECT l."itemCode", d.tipo, d."docEntry", d."docNum", d."docDate", d.comentarios, d.cancelado, SUM(l.cantidad)::float AS cantidad,
               ROW_NUMBER() OVER (PARTITION BY l."itemCode" ORDER BY d."docDate" DESC, d."docEntry" DESC) AS n
        FROM documentos_stock_lineas l JOIN documentos_stock d ON d.tipo = l.tipo AND d."docEntry" = l."docEntry"
        WHERE l."itemCode" = ANY(${itemCodes}) AND d."docDate" >= now() - make_interval(days => ${dias}) AND NOT d.cancelado
        GROUP BY l."itemCode", d.tipo, d."docEntry", d."docNum", d."docDate", d.comentarios, d.cancelado
      ) x WHERE n <= ${porProducto} ORDER BY "itemCode", "docDate" DESC`;
  },

  porVencer(dias, db = prisma) {
    return db.$queryRaw`
      WITH saldos AS (
        SELECT "itemCode", lote, vencimiento, unidades, 1 AS cajas, 0 AS pequena FROM inventario_cajas WHERE unidades > 0
        UNION ALL
        SELECT "itemCode", lote, vencimiento, 0 AS unidades, 0 AS cajas, unidades AS pequena
        FROM inventario_pequena_lotes WHERE unidades > 0
      )
      SELECT c."itemCode", p."itemName", c.lote, c.vencimiento, SUM(c.cajas)::int AS cajas, SUM(c.unidades)::int AS unidades,
             SUM(c.pequena)::int AS pequena, (c.vencimiento < CURRENT_DATE) AS vencido,
             (c.vencimiento - CURRENT_DATE)::int AS dias
      FROM saldos c
      JOIN productos p ON p."itemCode" = c."itemCode"
      WHERE c.vencimiento IS NOT NULL AND c.vencimiento <= CURRENT_DATE + ${dias}::int
      GROUP BY c."itemCode", p."itemName", c.lote, c.vencimiento
      ORDER BY c.vencimiento, p."itemName"`;
  },

  // Unidades por caja de la última recepción del producto (para sugerirla).
  async ultimaRecepcion(itemCode, db = prisma) {
    return db.inventarioCaja.findFirst({ where: { itemCode, suelto: false }, orderBy: { id: "desc" },
      select: { unidadesIniciales: true, lote: true, vencimiento: true } });
  },

};
