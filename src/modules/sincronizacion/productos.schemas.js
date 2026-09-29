import { z } from "zod";
import { identificador, texto, loteDe } from "./lote.schemas.js";
export const loteProductosSchema = loteDe("productos", z.object({
  itemCode: identificador(50),
  itemName: texto(200),
  barCode: identificador(254).nullable(),
  valid: z.boolean(),
  frozen: z.boolean(),
}), "itemCode", "Producto repetido en el lote");
