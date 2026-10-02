import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { crearConstructorLote } from "./lote.js";
function nombreProducto(p) {
  if (p.ItemName == null || (typeof p.ItemName === "string" && !p.ItemName.trim())) {
    console.warn(JSON.stringify({ evento: "advertencia", codigo: "PRODUCTO_SIN_NOMBRE", itemCode: p.ItemCode }));
    return `Producto ${p.ItemCode}`;
  }
  return p.ItemName;
}
export const construirLote = crearConstructorLote({
  entidad: "productos", schema: loteProductosSchema, codigoError: "PRODUCTO_SAP_INVALIDO", claveSap: "ItemCode", claveLocal: "itemCode",
  camposSap: { itemCode: "ItemCode", itemName: "ItemName", barCode: "BarCode", valid: "Valid", frozen: "Frozen" },
  mapear: (p, booleano) => ({ itemCode: p.ItemCode, itemName: nombreProducto(p),
    barCode: p.BarCode === "" ? null : p.BarCode,
    valid: booleano(p, "Valid"), frozen: booleano(p, "Frozen") }),
});
