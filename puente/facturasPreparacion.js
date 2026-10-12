import { construirLotePedidos } from "./pedidos.js";
import { loteFacturasPreparacionSchema } from "../src/modules/sincronizacion/facturasPreparacion.schemas.js";
import { ErrorPuente } from "./http.js";

export function construirLoteFacturasPreparacion(filas, empresa, secuencia) {
  if (filas.some(f => f.ReserveInvoice !== "tNO")) throw new ErrorPuente("FACTURA_RESERVA_NO_ADMITIDA");
  const pedidos = construirLotePedidos(filas, empresa, secuencia).pedidos;
  const resultado = loteFacturasPreparacionSchema.safeParse({ version: 1, empresa, secuencia,
    facturasPreparacion: pedidos.map((p, i) => ({ ...p, creditos: filas[i].CreditosPreparacion })) });
  if (!resultado.success) throw new ErrorPuente("FACTURA_PREPARACION_INVALIDA");
  return resultado.data;
}
