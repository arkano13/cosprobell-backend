import { prisma } from "../../infrastructure/database/prisma.js";
export const pedidosRepository = {
  // almacenes: si viene, solo pedidos con alguna línea en esos almacenes de SAP.
  listar({ cursor, limit, estado, almacenes = null }) {
    return prisma.pedido.findMany({
      where: { ...(cursor === undefined ? {} : { docEntry: { gt: cursor } }),
        ...(estado === "abiertos" ? { documentStatus: "bost_Open", cancelled: false,
          docType: "dDocument_Items", OR: [{ cancelStatus: null }, { cancelStatus: "csNo" }] } : {}),
        ...(almacenes ? { lineas: { some: { warehouseCode: { in: almacenes } } } } : {}) },
      select: { docEntry: true, docNum: true, cardCode: true, docDate: true, docDueDate: true,
        documentStatus: true, cancelled: true, sincronizadoEn: true,
        cliente: { select: { cardName: true } } },
      orderBy: { docEntry: "asc" }, take: limit + 1,
    });
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
    // Las líneas no tienen relación con productos: el nombre se agrega para mostrarlo en la bodega.
    const productos = await prisma.producto.findMany({
      where: { itemCode: { in: [...new Set(pedido.lineas.map((l) => l.itemCode))] } }, select: { itemCode: true, itemName: true } });
    const nombres = new Map(productos.map((p) => [p.itemCode, p.itemName]));
    return { ...pedido, lineas: pedido.lineas.map((l) => ({ ...l, itemName: nombres.get(l.itemCode) ?? null })) };
  },
};
