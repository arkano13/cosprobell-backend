import { loteTrasladosPreparacionSchema } from "../src/modules/sincronizacion/trasladosPreparacion.schemas.js";
import { loteTrasladosEntradaSchema } from "../src/modules/sincronizacion/trasladosEntrada.schemas.js";
import { crearConstructorLote } from "./lote.js";
import { ErrorPuente } from "./http.js";

// Traslados de SAP (StockTransfers) que salen de la 02. El receptor deja solo las líneas que salen de la bodega.
const traslado = {
  codigoError: "TRASLADO_SAP_INVALIDO", claveSap: "DocEntry", claveLocal: "docEntry",
  camposSap: { docEntry: "DocEntry", docNum: "DocNum", cardCode: "CardCode", docDate: "DocDate",
    fromWarehouse: "FromWarehouse", toWarehouse: "ToWarehouse", lineas: "StockTransferLines" },
  mapear: (t) => {
    if (Object.keys(t).some(k => k.startsWith("StockTransferLines") && /nextlink/i.test(k))) {
      throw new ErrorPuente("TRASLADO_SAP_INVALIDO", false, { docEntry: t.DocEntry, campo: "StockTransferLines" });
    }
    return {
      docEntry: t.DocEntry, docNum: t.DocNum, cardCode: t.CardCode || null, docDate: t.DocDate,
      fromWarehouse: t.FromWarehouse, toWarehouse: t.ToWarehouse,
      lineas: Array.isArray(t.StockTransferLines) ? t.StockTransferLines.map((l) => ({
        lineNum: l.LineNum, itemCode: l.ItemCode, quantity: l.Quantity,
        fromWarehouseCode: l.FromWarehouseCode ?? null, warehouseCode: l.WarehouseCode ?? null,
        uomEntry: l.UoMEntry ?? null, uomCode: l.UoMCode ?? null, inventoryQuantity: l.InventoryQuantity ?? null,
      })).sort((a, b) => a.lineNum - b.lineNum) : t.StockTransferLines,
    };
  },
};
export const construirLoteTrasladosPreparacion = crearConstructorLote({ ...traslado,
  entidad: "trasladosPreparacion", schema: loteTrasladosPreparacionSchema });
// Los de la 01 a la 02 (se pasan en la bodega escaneando las cajas): el mismo registro, otra entidad.
export const construirLoteTrasladosEntrada = crearConstructorLote({ ...traslado,
  entidad: "trasladosEntrada", schema: loteTrasladosEntradaSchema });
