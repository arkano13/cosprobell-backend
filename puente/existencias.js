import { loteExistenciasSchema } from "../src/modules/sincronizacion/existencias.schemas.js";
import { crearConstructorLote } from "./lote.js";
import { ErrorPuente } from "./http.js";
// Existencia de cada artículo por almacén. SAP lista todos los almacenes de la empresa en cada artículo (la
// mayoría en cero); solo se envían los que tienen algún valor, ordenados para que la huella no cambie sola.
export const construirLoteExistencias = crearConstructorLote({
  entidad: "existencias", schema: loteExistenciasSchema, codigoError: "EXISTENCIA_SAP_INVALIDA", claveSap: "ItemCode", claveLocal: "itemCode",
  camposSap: { itemCode: "ItemCode", almacenes: "ItemWarehouseInfoCollection" },
  mapear: (p) => {
    const filas = p.ItemWarehouseInfoCollection;
    if (!Array.isArray(filas) || Object.keys(p).some((k) => k.startsWith("ItemWarehouseInfoCollection") && /nextlink/i.test(k))) {
      throw new ErrorPuente("EXISTENCIA_SAP_INVALIDA", false, { itemCode: p.ItemCode, campo: "ItemWarehouseInfoCollection" });
    }
    return { itemCode: p.ItemCode, almacenes: filas
      .map((a) => ({ warehouseCode: a.WarehouseCode, inStock: a.InStock, committed: a.Committed, ordered: a.Ordered }))
      .filter((a) => a.inStock !== 0 || a.committed !== 0 || a.ordered !== 0)
      .sort((a, b) => (a.warehouseCode < b.warehouseCode ? -1 : a.warehouseCode > b.warehouseCode ? 1 : 0)) };
  },
});
