import { loteDocumentosSchema } from "../src/modules/sincronizacion/documentos.schemas.js";
import { crearConstructorLote } from "./lote.js";
import { ErrorPuente } from "./http.js";
// Documentos de SAP que mueven existencias (entradas, salidas y devoluciones). Solo las líneas de artículos;
// la cantidad es la de inventario (unidades), o la del documento si SAP no la informa.
// Anulado: el documento cancelado (csYes) y el que lo revierte (csCancellation, que llega sin Cancelled) se
// compensan entre sí; ninguno de los dos explica una diferencia.
const ESTADOS_CANCELACION = { csNo: false, csYes: true, csCancellation: true };
function anulado(d, booleano) {
  if (Object.hasOwn(ESTADOS_CANCELACION, d.CancelStatus)) return ESTADOS_CANCELACION[d.CancelStatus];
  return booleano(d, "Cancelled");
}
export function crearConstructorDocumentos(entidad) {
  return crearConstructorLote({
    entidad, schema: loteDocumentosSchema(entidad), codigoError: "DOCUMENTO_SAP_INVALIDO", claveSap: "DocEntry", claveLocal: "docEntry",
    camposSap: { docEntry: "DocEntry", docNum: "DocNum", docDate: "DocDate", comentarios: "Comments", cancelado: "Cancelled", lineas: "DocumentLines" },
    mapear: (d, booleano) => {
      if (!Array.isArray(d.DocumentLines) || Object.keys(d).some((k) => k.startsWith("DocumentLines") && /nextlink/i.test(k))) {
        throw new ErrorPuente("DOCUMENTO_SAP_INVALIDO", false, { docEntry: d.DocEntry, campo: "DocumentLines" });
      }
      const comentarios = typeof d.Comments === "string" ? d.Comments.replaceAll("\0", "").trim().slice(0, 254) : null;
      return { docEntry: d.DocEntry, docNum: d.DocNum, docDate: typeof d.DocDate === "string" ? d.DocDate.slice(0, 10) : d.DocDate,
        comentarios: comentarios || null, cancelado: anulado(d, booleano),
        lineas: d.DocumentLines.filter((l) => typeof l.ItemCode === "string" && l.ItemCode !== "")
          .map((l) => ({ lineNum: l.LineNum, itemCode: l.ItemCode, warehouseCode: l.WarehouseCode || null,
            cantidad: l.InventoryQuantity ?? l.Quantity }))
          .sort((a, b) => a.lineNum - b.lineNum) };
    },
  });
}
