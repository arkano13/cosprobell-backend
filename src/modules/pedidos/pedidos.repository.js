import { prisma } from "../../infrastructure/database/prisma.js";
export const pedidosRepository = {
  listar({ cursor, limit, estado }) {
    return prisma.pedido.findMany({
      where: { ...(cursor === undefined ? {} : { docEntry: { gt: cursor } }),
        ...(estado === "abiertos" ? { documentStatus: "bost_Open", cancelled: false,
          docType: "dDocument_Items", OR: [{ cancelStatus: null }, { cancelStatus: "csNo" }] } : {}) },
      select: { docEntry: true, docNum: true, cardCode: true, docDate: true, docDueDate: true,
        documentStatus: true, cancelled: true, sincronizadoEn: true,
        cliente: { select: { cardName: true } } },
      orderBy: { docEntry: "asc" }, take: limit + 1,
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
