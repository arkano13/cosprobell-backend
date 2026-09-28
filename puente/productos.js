import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { ErrorPuente } from "./http.js";
// Nombres de SAP para que el administrador sepa qué campo corregir en el artículo.
const CAMPOS_SAP = { itemCode: "ItemCode", itemName: "ItemName", barCode: "BarCode", valid: "Valid", frozen: "Frozen" };
function booleano(p, campo) {
  if (p[campo] === "tYES") return true;
  if (p[campo] === "tNO") return false;
  throw new ErrorPuente("PRODUCTO_SAP_INVALIDO", false, { itemCode: p.ItemCode, campo });
}
export function construirLote(filas, empresa, secuencia) {
  let productos;
  try {
    productos = filas.map((p) => ({ itemCode: p.ItemCode, itemName: p.ItemName,
      barCode: p.BarCode === "" ? null : p.BarCode,
      valid: booleano(p, "Valid"), frozen: booleano(p, "Frozen") }));
  } catch (error) { throw error instanceof ErrorPuente ? error : new ErrorPuente("PRODUCTO_SAP_INVALIDO"); }
  const resultado = loteProductosSchema.safeParse({ version: 1, empresa, secuencia, productos });
  if (!resultado.success) {
    // Se informa el primer problema: código del producto y campo, nunca el valor recibido.
    const [raiz, indice, campo] = resultado.error.issues[0].path;
    const detalle = raiz === "productos" && Number.isInteger(indice)
      ? { itemCode: productos[indice].itemCode, campo: CAMPOS_SAP[campo] ?? campo } : undefined;
    throw new ErrorPuente("PRODUCTO_SAP_INVALIDO", false, detalle);
  }
  return resultado.data;
}
