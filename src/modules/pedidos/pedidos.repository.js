import { prisma } from "../../infrastructure/database/prisma.js";
import { conCombos } from "../picking/picking.repository.js";
import { articulosDelPedido } from "../picking/picking.combos.js";
import { fuentePreparacion } from "./preparacion.fuente.js";
// Cuánto quedan en la sección Preparados las facturas terminadas (como en la app).
export const HORAS_PREPARADAS = 24;
const SELECCION_LISTA = { docEntry: true, docNum: true, cardCode: true, docDate: true, docDueDate: true,
  fuenteDocumento: true, sapDocEntry: true, documentStatus: true, cancelled: true, sincronizadoEn: true,
  cliente: { select: { cardName: true } } };
export const pedidosRepository = {
  // almacenes: si viene, solo pedidos con alguna línea en esos almacenes de SAP.
  async listar({ cursor, limit, estado, almacenes = null }) {
    const fuenteDocumento = fuentePreparacion();
    if (fuenteDocumento === "factura") return this.listarFacturas({ cursor, limit });
    return prisma.pedido.findMany({
      where: { fuenteDocumento, ...(cursor === undefined ? {} : { docEntry: { gt: cursor } }),
        ...(estado === "abiertos" ? { documentStatus: "bost_Open", cancelled: false,
          docType: "dDocument_Items", OR: [{ cancelStatus: null }, { cancelStatus: "csNo" }] } : {}),
        ...(almacenes ? { lineas: { some: { warehouseCode: { in: almacenes } } } } : {}) },
      select: SELECCION_LISTA, orderBy: { docEntry: "asc" }, take: limit + 1,
    });
  },
  // Facturas para preparar: las que tienen algo pendiente en la 02 y no se terminaron de preparar, más las terminadas en
  // las últimas HORAS_PREPARADAS (la sección Preparados). Una factura no se cierra al despacharla: sin este límite la lista
  // crecería todos los días y las pendientes quedarían detrás de las ya preparadas. Las más nuevas primero (clave negativa).
  async listarFacturas({ cursor, limit }) {
    const desde = cursor ?? null;
    const filas = await prisma.$queryRaw`
      SELECT p."docEntry" FROM pedidos p
      WHERE p."fuenteDocumento" = 'factura' AND p."docType" = 'dDocument_Items'
        AND p.cancelled = false AND COALESCE(p."cancelStatus", 'csNo') = 'csNo'
        AND (${desde}::int IS NULL OR p."docEntry" > ${desde}::int)
        AND EXISTS (SELECT 1 FROM pedidos_lineas l WHERE l."pedidoDocEntry" = p."docEntry" AND l."warehouseCode" = '02'
          AND l."remainingOpenQuantity" > 0)
        AND NOT EXISTS (SELECT 1 FROM picking_pedidos s WHERE s."pedidoDocEntry" = p."docEntry"
          AND s.estado IN ('completo', 'con_diferencias')
          AND s."fechaFin" < (now() AT TIME ZONE 'UTC') - make_interval(hours => ${HORAS_PREPARADAS}))
      ORDER BY p."docEntry" LIMIT ${limit + 1}`;
    if (!filas.length) return [];
    return prisma.pedido.findMany({ where: { docEntry: { in: filas.map((f) => f.docEntry) } },
      select: SELECCION_LISTA, orderBy: { docEntry: "asc" } });
  },
  // Preparaciones finalizadas de los pedidos indicados, la más reciente primero, con las cantidades de cada línea.
  preparaciones(docEntries) {
    return prisma.pickingPedido.findMany({
      where: { pedidoDocEntry: { in: docEntries }, estado: { in: ["completo", "con_diferencias"] } },
      select: { id: true, pedidoDocEntry: true, estado: true, usuarioId: true, fechaFin: true,
        lineas: { select: { cantidadPedida: true, cantidadEscaneada: true } } },
      orderBy: [{ fechaFin: "desc" }, { id: "desc" }],
    });
  },
  async obtener(docEntry) {
    const pedido = await prisma.pedido.findUnique({ where: { docEntry }, include: {
      cliente: { select: { cardName: true } }, lineas: { orderBy: { lineNum: "asc" } },
    } });
    if (!pedido) return null;
    await conCombos(pedido);
    // Las líneas no tienen relación con productos: el nombre se agrega para mostrarlo en la bodega (también el de los
    // productos de cada combo).
    const productos = await prisma.producto.findMany({
      where: { itemCode: { in: articulosDelPedido(pedido.lineas, pedido.combos) } }, select: { itemCode: true, itemName: true } });
    const nombres = new Map(productos.map((p) => [p.itemCode, p.itemName]));
    return { ...pedido, nombres, lineas: pedido.lineas.map((l) => ({ ...l, itemName: nombres.get(l.itemCode) ?? null })) };
  },
};
