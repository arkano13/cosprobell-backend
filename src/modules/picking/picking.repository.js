import { prisma } from "../../infrastructure/database/prisma.js";
import { cargarCombos, cargarNoInventario } from "./picking.combos.js";

// Deja en el pedido sus combos (pedido.combos), para que lineasParaPreparar los cambie por sus productos.
export async function conCombos(pedido, db = prisma) {
  if (!pedido) return pedido;
  pedido.combos = await cargarCombos(pedido.lineas.map((l) => l.itemCode), db);
  pedido.noInventario = await cargarNoInventario(pedido.lineas.map((l) => l.itemCode), db);
  return pedido;
}

export const pickingRepository = {
  // Bloquear la cabecera serializa inicios del mismo pedido, incluso sin sesiones.
  conPedidoBloqueado(pedidoDocEntry, operacion) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "docEntry" FROM pedidos
        WHERE "docEntry" = ${pedidoDocEntry} FOR UPDATE
      `;
      return operacion(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
  },

  async buscarSesionesDelPedido(pedidoDocEntry, db = prisma) {
    // Coordina también con finalizarPicking, que bloquea la sesión.
    await db.$queryRaw`
      SELECT id FROM picking_pedidos
      WHERE "pedidoDocEntry" = ${pedidoDocEntry} ORDER BY id FOR UPDATE
    `;
    return db.pickingPedido.findMany({
      where: { pedidoDocEntry }, include: { lineas: true }, orderBy: { id: "asc" },
    });
  },
  // Con sus combos (pedido.combos): lineasParaPreparar los cambia por sus productos.
  async buscarPedidoConLineas(pedidoDocEntry, db = prisma) {
    const pedido = await db.pedido.findUnique({
      where: {
        docEntry: pedidoDocEntry,
      },
      include: {
        lineas: true,
      },
    });
    return conCombos(pedido, db);
  },

  crearSesion({ pedidoDocEntry, usuarioId, lineas }, db = prisma) {
    return db.pickingPedido.create({
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
            ...(linea.comboItemCode ? { comboItemCode: linea.comboItemCode, comboFactor: linea.comboFactor } : {}),
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