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
  obtener(docEntry) {
    return prisma.pedido.findUnique({ where: { docEntry }, include: {
      cliente: { select: { cardName: true } }, lineas: { orderBy: { lineNum: "asc" } },
    } });
  },
};
