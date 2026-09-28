import { prisma } from "../../infrastructure/database/prisma.js";

export const pickingRepository = {
  buscarPedidoConLineas(pedidoDocEntry) {
    return prisma.pedido.findUnique({
      where: { docEntry: pedidoDocEntry },
      include: { lineas: true },
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
      include: { lineas: true },
    });
  },

  buscarSesionConLineas(id) {
    return prisma.pickingPedido.findUnique({
      where: { id },
      include: { lineas: true },
    });
  },

  buscarEstadoSesion(id) {
    return prisma.pickingPedido.findUnique({
      where: { id },
      select: { estado: true },
    });
  },

  incrementarLinea(pickingId, codigo) {
    return prisma.$queryRaw`
      UPDATE picking_pedidos_lineas
      SET "cantidadEscaneada" = "cantidadEscaneada" + 1,
          "codigoBarrasEscaneado" = ${codigo},
          "timestampEscaneo" = now()
      WHERE id = (
        SELECT id
        FROM picking_pedidos_lineas
        WHERE "pickingId" = ${pickingId}
          AND "itemCode" = ${codigo}
          AND "cantidadEscaneada" < "cantidadPedida"
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;
  },

  buscarLineaProducto(pickingId, itemCode) {
    return prisma.pickingPedidoLinea.findFirst({
      where: {
        pickingId,
        itemCode,
      },
    });
  },

  guardarFinalizacion(id, estado, fechaFin) {
    return prisma.pickingPedido.update({
      where: { id },
      data: {
        estado,
        fechaFin,
      },
      include: { lineas: true },
    });
  },
};