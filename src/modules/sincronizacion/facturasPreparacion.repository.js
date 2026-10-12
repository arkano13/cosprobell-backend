import { guardarPedido } from "./pedidos.repository.js";
import { devolverPorAnulacion } from "../inventario/inventario.service.js";

// Claves negativas reservadas a facturas; órdenes SAP conservan las positivas.
// El DocEntry real se conserva aparte: nunca se envía la clave interna a SAP.
export const claveFacturaPreparacion = docEntry => -docEntry - 1;
export function proyectarFactura(factura) {
  const { creditos, ...cabecera } = factura;
  const porLinea = new Map(creditos.map(c => [c.lineNum, c]));
  return { ...cabecera, docEntry: claveFacturaPreparacion(factura.docEntry),
    fuenteDocumento: "factura", sapDocEntry: factura.docEntry,
    lineas: factura.lineas.filter(l => l.warehouseCode === "02").map(l => {
      const c = porLinea.get(l.lineNum);
      return { ...l, cantidadCredito: c?.quantity ?? 0,
        remainingOpenQuantity: l.quantity - (c?.quantity ?? 0),
        remainingOpenInventoryQuantity: l.inventoryQuantity == null ? null : l.inventoryQuantity - (c?.inventoryQuantity ?? 0) };
    }) };
}
const anulada = (f) => f.cancelled === true || ["csYes", "csCancellation"].includes(f.cancelStatus);
// Una factura anulada que ya se preparó devuelve su mercadería a la pequeña (una sola vez, ver devolverPorAnulacion).
export async function guardarFacturaPreparacion(factura, tx) {
  const proyectada = proyectarFactura(factura);
  await guardarPedido(proyectada, tx);
  if (!anulada(proyectada)) return;
  const terminadas = await tx.pickingPedido.findMany({ where: { pedidoDocEntry: proyectada.docEntry,
    estado: { in: ["completo", "con_diferencias"] } }, select: { id: true } });
  for (const { id } of terminadas) await devolverPorAnulacion({ pickingId: id, docNum: proyectada.docNum }, tx);
}
