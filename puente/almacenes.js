import { loteAlmacenesSchema } from "../src/modules/sincronizacion/almacenes.schemas.js";
import { crearConstructorLote } from "./lote.js";
function nombreAlmacen(fila) {
  if (fila.WarehouseName == null || (typeof fila.WarehouseName === "string" && !fila.WarehouseName.trim())) {
    console.warn(JSON.stringify({ evento: "advertencia", codigo: "ALMACEN_SIN_NOMBRE", warehouseCode: fila.WarehouseCode }));
    return `Almacén ${fila.WarehouseCode}`;
  }
  return fila.WarehouseName;
}
export const construirLoteAlmacenes = crearConstructorLote({
  entidad: "almacenes", schema: loteAlmacenesSchema, codigoError: "ALMACEN_SAP_INVALIDO",
  claveSap: "WarehouseCode", claveLocal: "warehouseCode",
  camposSap: { warehouseCode: "WarehouseCode", warehouseName: "WarehouseName", inactive: "Inactive" },
  mapear: (fila, booleano) => ({ warehouseCode: fila.WarehouseCode, warehouseName: nombreAlmacen(fila),
    inactive: booleano(fila, "Inactive") }),
});
