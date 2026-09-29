import { lotePedidosSchema } from "../src/modules/sincronizacion/pedidos.schemas.js";
import { crearConstructorLote } from "./lote.js";
import { ErrorPuente } from "./http.js";

// Solo órdenes de artículos; una instantánea debe incluir todas sus líneas.
export const construirLotePedidos = crearConstructorLote({
  entidad: "pedidos", schema: lotePedidosSchema, codigoError: "PEDIDO_SAP_INVALIDO",
  claveSap: "DocEntry", claveLocal: "docEntry",
  camposSap: { docEntry: "DocEntry", docNum: "DocNum", docType: "DocType",
    cardCode: "CardCode", docDate: "DocDate", docDueDate: "DocDueDate",
    docTotal: "DocTotal", documentStatus: "DocumentStatus", cancelled: "Cancelled",
    cancelStatus: "CancelStatus", lineas: "DocumentLines" },
  mapear: (p, booleano) => {
    if (Object.keys(p).some(k => k.startsWith("DocumentLines") && /nextlink/i.test(k))) {
      throw new ErrorPuente("PEDIDO_SAP_INVALIDO", false, { docEntry: p.DocEntry, campo: "DocumentLines" });
    }
    return ({
    docEntry: p.DocEntry, docNum: p.DocNum, docType: p.DocType,
    cardCode: p.CardCode, docDate: p.DocDate, docDueDate: p.DocDueDate,
    docTotal: p.DocTotal, documentStatus: p.DocumentStatus,
    cancelled: booleano(p, "Cancelled"), cancelStatus: p.CancelStatus,
    lineas: Array.isArray(p.DocumentLines) ? p.DocumentLines.map((l) => ({
      lineNum: l.LineNum, itemCode: l.ItemCode, quantity: l.Quantity,
      lineStatus: l.LineStatus, warehouseCode: l.WarehouseCode,
      uomEntry: l.UoMEntry, uomCode: l.UoMCode,
      remainingOpenQuantity: l.RemainingOpenQuantity,
      inventoryQuantity: l.InventoryQuantity,
      remainingOpenInventoryQuantity: l.RemainingOpenInventoryQuantity,
    })).sort((a, b) => a.lineNum - b.lineNum) : p.DocumentLines,
    });
  },
});
