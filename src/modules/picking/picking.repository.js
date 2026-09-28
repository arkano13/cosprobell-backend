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
            uomEntry: linea.uomEntry ?? null,
            uomCode: linea.uomCode ?? null,
          })),
        },
      },
      include: {
        lineas: true,
      },
    });
  },

  buscarSesionConLineas(id, db = prisma) {
    return db.pickingPedido.findUnique({
      where: {
        id,
      },
      include: {
        lineas: true,
      },
    });
  },

  buscarEstadoSesion(id, db = prisma) {
    return db.pickingPedido.findUnique({
      where: {
        id,
      },
      select: {
        estado: true,
      },
    });
  },

  incrementarLinea({ pickingId, lineaId, itemCode, codigo, uomEntry }, db = prisma) {
    // La sesión ya está bloqueada por conSesionBloqueada.
    // Actualizamos exactamente la línea que validó el servicio.
    return db.$queryRaw`
      UPDATE picking_pedidos_lineas
      SET "cantidadEscaneada" = "cantidadEscaneada" + 1,
          "codigoBarrasEscaneado" = ${codigo},
          "timestampEscaneo" = now()
      WHERE id = ${lineaId}
        AND "pickingId" = ${pickingId}
        AND "itemCode" = ${itemCode}
        AND "uomEntry" = ${uomEntry}
        AND "cantidadEscaneada" + 1 <= "cantidadPedida"
      RETURNING *;
    `;
  },

  buscarLineaProducto(pickingId, itemCode, db = prisma) {
    return db.pickingPedidoLinea.findFirst({
      where: {
        pickingId,
        itemCode,
      },
    });
  },

  guardarFinalizacion(id, estado, fechaFin, db = prisma) {
    return db.pickingPedido.update({
      where: {
        id,
      },
      data: {
        estado,
        fechaFin,
      },
      include: {
        lineas: true,
      },
    });
  },
};