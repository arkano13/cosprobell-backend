import { guardarPedido } from "./pedidos.repository.js";

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
export async function guardarFacturaPreparacion(factura, tx) {
  return guardarPedido(proyectarFactura(factura), tx);
}
