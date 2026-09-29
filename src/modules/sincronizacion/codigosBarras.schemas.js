import { z } from "zod";
import { identificador, loteDe } from "./lote.schemas.js";
// BarCodes de SAP: cada código con su producto y su unidad. absEntry identifica el registro en SAP.
export const loteCodigosBarrasSchema = loteDe("codigosBarras", z.object({
  absEntry: z.number().int().min(0).max(2147483647),
  itemCode: identificador(50),
  codigo: identificador(254),
  uomEntry: z.number().int().min(-1).max(2147483647),
}), "absEntry", "Código de barras repetido en el lote");
