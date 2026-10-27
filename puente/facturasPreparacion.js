import { construirLotePedidos } from "./pedidos.js";
import { loteFacturasPreparacionSchema } from "../src/modules/sincronizacion/facturasPreparacion.schemas.js";
import { ErrorPuente } from "./http.js";

export function construirLoteFacturasPreparacion(filas, empresa, secuencia) {
  if (filas.some(f => f.ReserveInvoice !== "tNO")) throw new ErrorPuente("FACTURA_RESERVA_NO_ADMITIDA");
  // En documentos de cancelación SAP puede omitir Cancelled. Conservar el
  // estado específico y bloquear su preparación en nuestro contrato local.
  const normalizadas = filas.map(f => f.Cancelled == null && f.CancelStatus === "csCancellation"
    ? { ...f, Cancelled: "tYES" } : f);
  const pedidos = construirLotePedidos(normalizadas, empresa, secuencia).pedidos;
  const resultado = loteFacturasPreparacionSchema.safeParse({ version: 1, empresa, secuencia,
    facturasPreparacion: pedidos.map((p, i) => ({ ...p, creditos: filas[i].CreditosPreparacion })) });
  if (!resultado.success) throw new ErrorPuente("FACTURA_PREPARACION_INVALIDA");
  return resultado.data;
}
