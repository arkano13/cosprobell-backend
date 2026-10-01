import { z } from "zod";
import { identificador, texto, loteDe } from "./lote.schemas.js";
// Warehouses de SAP: código, nombre y si está inactivo. "Esta bodega" lo decide el supervisor, no SAP.
export const loteAlmacenesSchema = loteDe("almacenes", z.object({
  warehouseCode: identificador(8),
  warehouseName: texto(100),
  inactive: z.boolean(),
}), "warehouseCode", "Almacén repetido en el lote");
