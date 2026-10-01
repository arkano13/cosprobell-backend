import { z } from "zod";
import { identificador, texto, loteDe } from "./lote.schemas.js";
export const loteProductosSchema = loteDe("productos", z.object({
  itemCode: identificador(50),
  itemName: texto(200),
  barCode: identificador(254).nullable(),
  valid: z.boolean(),
  frozen: z.boolean(),
  // Existencia total en SAP (una sola bodega). Opcional: los puentes anteriores no la envían.
  quantityOnStock: z.number().finite().nullable().optional(),
}), "itemCode", "Producto repetido en el lote");
