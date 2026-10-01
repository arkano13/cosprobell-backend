import { z } from "zod";
import { identificador, loteDe } from "./lote.schemas.js";
const cantidad = z.number().finite().min(-1e12).max(1e12);
// Existencia de cada artículo por almacén (ItemWarehouseInfoCollection). Llegan solo los almacenes con algún
// valor distinto de cero: un almacén que no llega queda en cero.
export const loteExistenciasSchema = loteDe("existencias", z.object({
  itemCode: identificador(50),
  almacenes: z.array(z.object({
    warehouseCode: identificador(8),
    inStock: cantidad,
    committed: cantidad,
    ordered: cantidad,
  }).strict()).max(500).refine((a) => new Set(a.map((x) => x.warehouseCode)).size === a.length, "Almacén repetido"),
}), "itemCode", "Artículo repetido en el lote");
