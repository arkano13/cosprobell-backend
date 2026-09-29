import { z } from "zod";
import { texto, loteDe } from "./lote.schemas.js";
// Catálogo UnitOfMeasurements de SAP. "Manual" (-1) no es parte del catálogo.
export const loteUnidadesSchema = loteDe("unidades", z.object({
  absEntry: z.number().int().min(0).max(2147483647),
  code: texto(20),
  name: texto(100).nullable(),
}), "absEntry", "Unidad repetida en el lote");
