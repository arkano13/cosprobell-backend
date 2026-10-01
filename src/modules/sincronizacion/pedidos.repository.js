import { AppError } from "../../shared/errors/AppError.js";
import { sesionCoincideConPedido } from "../picking/picking.pedido.js";
import { registrarCambioPedido } from "../inventario/inventario.sap.js";

// Solo campos que afectan a la preparación. Fechas y precios no invalidan escaneos.
export function contenidoPreparacion(pedido) {
  if (!pedido) return null;
  return JSON.stringify({ cardCode: pedido.cardCode, docType: pedido.docType,
    documentStatus: pedido.documentStatus, cancelled: pedido.cancelled, cancelStatus: pedido.cancelStatus,
    lineas: [...pedido.lineas].sort((a, b) => a.lineNum - b.lineNum).map(l => ({
      lineNum: l.lineNum, itemCode: l.itemCode, quantity: l.quantity, lineStatus: l.lineStatus,
      warehouseCode: l.warehouseCode, uomEntry: l.uomEntry, uomCode: l.uomCode,
      remainingOpenQuantity: l.remainingOpenQuantity, inventoryQuantity: l.inventoryQuantity,
      remainingOpenInventoryQuantity: l.remainingOpenInventoryQuantity,
    })) });
}

// El llamador proporciona la transacción que confirma también el checkpoint.
export async function guardarPedido(pedido, db) {
  const cliente = await db.cliente.findUnique({ where: { cardCode: pedido.cardCode }, select: { cardCode: true } });
  if (!cliente) throw new AppError({ code: "CLIENTE_NO_SINCRONIZADO",
    message: "Debe sincronizar el cliente antes de recibir su pedido", statusCode: 409 });

  // Mismo orden que iniciarPicking: pedido -> sesiones. Un escaneo solo bloquea
  // su sesión; termina antes de esta actualización o ve requiere_revision después.
  await db.$queryRaw`SELECT "docEntry" FROM pedidos WHERE "docEntry" = ${pedido.docEntry} FOR UPDATE`;
  const anterior = await db.pedido.findUnique({ where: { docEntry: pedido.docEntry }, include: { lineas: true } });
  await db.$queryRaw`SELECT id FROM picking_pedidos WHERE "pedidoDocEntry" = ${pedido.docEntry} ORDER BY id FOR UPDATE`;
  if (contenidoPreparacion(anterior) !== contenidoPreparacion(pedido)) {
    await db.pickingPedido.updateMany({ where: { pedidoDocEntry: pedido.docEntry, estado: "en_proceso" },
      data: { estado: "requiere_revision" } });
  } else {
    // También detecta sesiones creadas por versiones anteriores que usaban el total.
    const activas = await db.pickingPedido.findMany({ where: { pedidoDocEntry: pedido.docEntry, estado: "en_proceso" }, include: { lineas: true } });
    const ids = activas.filter(s => !sesionCoincideConPedido(s, pedido)).map(s => s.id);
    if (ids.length) await db.pickingPedido.updateMany({ where: { id: { in: ids }, estado: "en_proceso" }, data: { estado: "requiere_revision" } });
  }
  const { lineas, ...cabecera } = pedido;
  const datos = { ...cabecera, docDate: new Date(`${pedido.docDate}T00:00:00.000Z`),
    docDueDate: pedido.docDueDate === null ? null : new Date(`${pedido.docDueDate}T00:00:00.000Z`), sincronizadoEn: new Date() };
  await db.pedido.upsert({ where: { docEntry: pedido.docEntry }, create: datos, update: datos });
  for (const linea of lineas) {
    await db.pedidoLinea.upsert({
      where: { pedidoDocEntry_lineNum: { pedidoDocEntry: pedido.docEntry, lineNum: linea.lineNum } },
      create: { ...linea, pedidoDocEntry: pedido.docEntry }, update: linea,
    });
  }
  // Retira únicamente líneas del espejo SAP. Las de picking y su historial son independientes.
  await db.pedidoLinea.deleteMany({ where: { pedidoDocEntry: pedido.docEntry, lineNum: { notIn: lineas.map(l => l.lineNum) } } });
  await registrarCambioPedido(pedido.docEntry, [...(anterior?.lineas ?? []), ...lineas].map((l) => l.itemCode), db);
}
