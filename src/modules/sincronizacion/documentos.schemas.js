import { z } from "zod";
import { identificador, loteDe } from "./lote.schemas.js";
// Documentos de SAP que mueven existencias. Se guardan solo para explicar diferencias del inventario.
export const TIPOS_DOCUMENTO = {
  entradasCompra: "entradaCompra", // PurchaseDeliveryNotes
  entradasInventario: "entradaInventario", // InventoryGenEntries
  salidasInventario: "salidaInventario", // InventoryGenExits
  devolucionesProveedor: "devolucionProveedor", // PurchaseReturns
  devolucionesCliente: "devolucionCliente", // Returns
};
const entero = z.number().int().min(0).max(2147483647);
const documento = z.object({
  docEntry: entero,
  docNum: entero,
  docDate: z.iso.date(),
  comentarios: z.string().max(254).refine((v) => !v.includes("\0")).nullable(),
  cancelado: z.boolean(),
  lineas: z.array(z.object({
    lineNum: entero,
    itemCode: identificador(50),
    warehouseCode: identificador(8).nullable(),
    cantidad: z.number().finite().min(0).max(1e12),
  }).strict()).max(500),
});
export const loteDocumentosSchema = (entidad) => loteDe(entidad, documento, "docEntry", "Documento repetido en el lote");
