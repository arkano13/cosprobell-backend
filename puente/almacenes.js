import { loteAlmacenesSchema } from "../src/modules/sincronizacion/almacenes.schemas.js";
import { crearConstructorLote } from "./lote.js";
// Almacenes de SAP. Sin nombre, se muestra el código.
export const construirLoteAlmacenes = crearConstructorLote({
  entidad: "almacenes", schema: loteAlmacenesSchema, codigoError: "ALMACEN_SAP_INVALIDO", claveSap: "WarehouseCode", claveLocal: "warehouseCode",
  camposSap: { warehouseCode: "WarehouseCode", warehouseName: "WarehouseName", inactive: "Inactive" },
  mapear: (a, booleano) => ({ warehouseCode: a.WarehouseCode,
    warehouseName: typeof a.WarehouseName === "string" && a.WarehouseName.trim() ? a.WarehouseName : a.WarehouseCode,
    inactive: booleano(a, "Inactive") }),
});
