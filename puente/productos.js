import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { ErrorPuente } from "./http.js";
function booleano(valor) {
  if (valor === "tYES") return true;
  if (valor === "tNO") return false;
  throw new ErrorPuente("ESTADO_PRODUCTO_INVALIDO");
}
export function construirLote(filas, empresa, secuencia) {
  let productos;
  try {
    productos = filas.map((p) => ({ itemCode: p.ItemCode, itemName: p.ItemName,
      barCode: p.BarCode === "" ? null : p.BarCode,
      valid: booleano(p.Valid), frozen: booleano(p.Frozen) }));
  } catch { throw new ErrorPuente("PRODUCTO_SAP_INVALIDO"); }
  const resultado = loteProductosSchema.safeParse({ version: 1, empresa, secuencia, productos });
  if (!resultado.success) throw new ErrorPuente("PRODUCTO_SAP_INVALIDO");
  return resultado.data;
}
