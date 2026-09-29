import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { crearConstructorLote } from "./lote.js";
export const construirLote = crearConstructorLote({
  entidad: "productos", schema: loteProductosSchema, codigoError: "PRODUCTO_SAP_INVALIDO", claveSap: "ItemCode", claveLocal: "itemCode",
  camposSap: { itemCode: "ItemCode", itemName: "ItemName", barCode: "BarCode", valid: "Valid", frozen: "Frozen" },
  mapear: (p, booleano) => ({ itemCode: p.ItemCode, itemName: p.ItemName,
    barCode: p.BarCode === "" ? null : p.BarCode,
    valid: booleano(p, "Valid"), frozen: booleano(p, "Frozen") }),
});
