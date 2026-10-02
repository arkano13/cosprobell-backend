import { loteExistenciasSchema } from "../src/modules/sincronizacion/existencias.schemas.js";
import { crearConstructorLote } from "./lote.js";
import { ErrorPuente } from "./http.js";

export const construirLoteExistencias = crearConstructorLote({
  entidad: "existencias", schema: loteExistenciasSchema, codigoError: "EXISTENCIA_SAP_INVALIDA",
  claveSap: "ItemCode", claveLocal: "itemCode",
  camposSap: { itemCode: "ItemCode", almacenes: "ItemWarehouseInfoCollection" },
  mapear: (fila, booleano) => {
    const inventario = booleano(fila, "InventoryItem");
    if (!inventario) return { itemCode: fila.ItemCode, almacenes: [] };
    const lista = fila.ItemWarehouseInfoCollection;
    // Una colección ausente o parcial no equivale a stock cero.
    if (!Array.isArray(lista) || Object.keys(fila).some(k => k.startsWith("ItemWarehouseInfoCollection") && /nextlink|__next/i.test(k))) {
      throw new ErrorPuente("EXISTENCIA_SAP_INVALIDA", false, { itemCode: fila.ItemCode, campo: "ItemWarehouseInfoCollection" });
    }
    const almacenes = lista.map(a => ({ warehouseCode: a?.WarehouseCode, inStock: a?.InStock, committed: a?.Committed, ordered: a?.Ordered }));
    // Validar ANTES de omitir ceros: no transformar datos incompletos en una baja de existencias.
    const validacion = loteExistenciasSchema.safeParse({ version: 1, empresa: "validacion", secuencia: 1,
      existencias: [{ itemCode: fila.ItemCode, almacenes }] });
    if (!validacion.success) throw new ErrorPuente("EXISTENCIA_SAP_INVALIDA", false,
      { itemCode: fila.ItemCode, campo: "ItemWarehouseInfoCollection" });
    return { itemCode: fila.ItemCode, almacenes: almacenes.filter(a => a.inStock !== 0 || a.committed !== 0 || a.ordered !== 0)
      .sort((a, b) => a.warehouseCode < b.warehouseCode ? -1 : 1) };
  },
});
