import { z } from "zod";
import { identificador, texto, loteDe } from "./lote.schemas.js";
export const loteProductosSchema = loteDe("productos", z.object({
  itemCode: identificador(50),
  itemName: texto(200),
  barCode: identificador(254).nullable(),
  valid: z.boolean(),
  frozen: z.boolean(),
  // Opcional: un puente anterior no lo manda y el producto queda como estaba.
  esInventario: z.boolean().optional(),
}), "itemCode", "Producto repetido en el lote");
