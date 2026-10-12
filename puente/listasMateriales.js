import { loteListasMaterialesSchema } from "../src/modules/sincronizacion/listasMateriales.schemas.js";
import { crearConstructorLote } from "./lote.js";
import { ErrorPuente } from "./http.js";

export const construirLoteListasMateriales = crearConstructorLote({
  entidad: "listasMateriales", schema: loteListasMaterialesSchema, codigoError: "LISTA_MATERIALES_SAP_INVALIDA",
  claveSap: "TreeCode", claveLocal: "itemCode",
  camposSap: { itemCode: "TreeCode", tipo: "TreeType", cantidad: "Quantity", lineas: "ProductTreeLines" },
  mapear: p => {
    if (Object.keys(p).some(k => k.startsWith("ProductTreeLines") && /nextlink/i.test(k))) {
      throw new ErrorPuente("LISTA_MATERIALES_SAP_INVALIDA", false, { itemCode: p.TreeCode, campo: "ProductTreeLines" });
    }
    return { itemCode: p.TreeCode, tipo: p.TreeType, cantidad: p.Quantity,
      lineas: Array.isArray(p.ProductTreeLines) ? p.ProductTreeLines
        .filter(l => l.ItemType !== "pit_Text" && l.ItemType !== "pit_Resource")
        .map(l => ({ itemCode: l.ItemCode, cantidad: l.Quantity, tipo: l.ItemType ?? null })) : p.ProductTreeLines };
  },
});
