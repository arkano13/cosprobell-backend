import { guardarPedido } from "./pedidos.repository.js";

// Los traslados se guardan con los pedidos y las facturas, en su propio rango de claves negativas (las facturas usan
// -1 - DocEntry). El DocEntry real queda en sapDocEntry.
export const claveTrasladoPreparacion = (docEntry) => -1_000_000_001 - docEntry;

// Solo las líneas que salen de la 02 hacia un almacén que no es de esta bodega: lo que va de la 02 a la 01 no sale de la
// bodega. Un traslado sin esas líneas se guarda igual, sin líneas, y no aparece para preparar.
export async function proyectarTraslado(traslado, tx) {
  const internos = new Set((await tx.bodega.findMany({ where: { deEstaBodega: true }, select: { warehouseCode: true } }))
    .map((b) => b.warehouseCode));
  const cliente = traslado.cardCode
    ? await tx.cliente.findUnique({ where: { cardCode: traslado.cardCode }, select: { cardCode: true } }) : null;
  const lineas = traslado.lineas
    .filter((l) => (l.fromWarehouseCode ?? traslado.fromWarehouse) === "02" && !internos.has(l.warehouseCode ?? traslado.toWarehouse))
    .map((l) => {
      // Sin unidad de medida en SAP, el traslado está en la unidad de inventario (Manual = unidad).
      const sinUnidad = l.uomEntry === null;
      const inventario = sinUnidad ? l.quantity : l.inventoryQuantity;
      return { lineNum: l.lineNum, itemCode: l.itemCode, quantity: l.quantity, treeType: null, lineStatus: "bost_Close",
        warehouseCode: "02", uomEntry: sinUnidad ? -1 : l.uomEntry, uomCode: sinUnidad ? null : l.uomCode,
        remainingOpenQuantity: l.quantity, inventoryQuantity: inventario, remainingOpenInventoryQuantity: inventario };
    });
  return { docEntry: claveTrasladoPreparacion(traslado.docEntry), docNum: traslado.docNum, docType: "dDocument_Items",
    // Un socio que no es cliente sincronizado (por ejemplo, un proveedor) queda sin cliente en lugar de rechazar el lote.
    cardCode: cliente ? traslado.cardCode : null, docDate: traslado.docDate, docDueDate: null, docTotal: 0,
    documentStatus: "bost_Close", cancelled: false, cancelStatus: null,
    fuenteDocumento: "traslado", sapDocEntry: traslado.docEntry, almacenDestino: traslado.toWarehouse, lineas };
}
export async function guardarTrasladoPreparacion(traslado, tx) {
  await guardarPedido(await proyectarTraslado(traslado, tx), tx);
}
