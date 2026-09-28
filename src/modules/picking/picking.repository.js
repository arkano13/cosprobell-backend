import { prisma } from "../../infrastructure/database/prisma.js";

export const pickingRepository = {
  buscarPedidoConLineas(pedidoDocEntry) {
    return prisma.pedido.findUnique({
      where: {
        docEntry: pedidoDocEntry,
      },
      include: {
        lineas: true,
      },
    });
  },

  crearSesion({ pedidoDocEntry, usuarioId, lineas }) {
    return prisma.pickingPedido.create({
      data: {
        pedidoDocEntry,
        usuarioId: usuarioId ?? null,
        estado: "en_proceso",
        lineas: {
          create: lineas.map((linea) => ({
            pedidoLineNum: linea.pedidoLineNum,
            itemCode: linea.itemCode,
            cantidadPedida: linea.cantidadPedida,
          })),
        },
      },
      include: {
        lineas: true,
      },
    });
  },

  buscarSesionConLineas(id) {
    return prisma.pickingPedido.findUnique({
      where: {
        id,
      },
      include: {
        lineas: true,
      },
    });
  },
};