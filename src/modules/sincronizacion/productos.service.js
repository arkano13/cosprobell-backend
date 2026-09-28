import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import { loteProductosSchema } from "./productos.schemas.js";
import { sincronizacionProductosRepository as repo } from "./productos.repository.js";
const conflicto = (code, message) => new AppError({ code, message, statusCode: 409 });

export async function recibirProductos(entrada, empresaAutorizada) {
  const validacion = loteProductosSchema.safeParse(entrada);
  if (!validacion.success) throw new AppError({ code: "LOTE_INVALIDO", message: "El lote de productos no cumple el contrato", statusCode: 400 });
  const lote = validacion.data;
  if (!empresaAutorizada || lote.empresa !== empresaAutorizada) {
    throw new AppError({ code: "EMPRESA_NO_AUTORIZADA", message: "Empresa no autorizada para este backend", statusCode: 403 });
  }
  // Mismo contenido con distinto orden conserva la identidad del lote.
  lote.productos.sort((a, b) => a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0);
  const hash = createHash("sha256").update(JSON.stringify(lote)).digest("hex");
  return repo.conBloqueo(async (tx) => {
    const anterior = await repo.consultarEstado(tx);
    if (anterior && anterior.empresa !== lote.empresa) {
      throw conflicto("ORIGEN_INCOMPATIBLE", "Esta base ya recibió productos de otra empresa SAP");
    }
    if (anterior && lote.secuencia === anterior.secuencia) {
      if (hash !== anterior.hash) throw conflicto("LOTE_MODIFICADO", "La secuencia ya fue utilizada con otro contenido");
      return { secuencia: anterior.secuencia, recibidos: anterior.cantidad, repetido: true };
    }
    if (lote.secuencia !== (anterior?.secuencia ?? 0) + 1) {
      throw conflicto("SECUENCIA_INVALIDA", "El lote está fuera de orden; consulte el estado de sincronización");
    }
    for (const producto of lote.productos) await repo.guardarProducto(producto, tx);
    await repo.guardarEstado({ empresa: lote.empresa, secuencia: lote.secuencia, hash, cantidad: lote.productos.length }, tx);
    return { secuencia: lote.secuencia, recibidos: lote.productos.length, repetido: false };
  });
}

export async function consultarEstadoProductos(empresaAutorizada) {
  if (!empresaAutorizada) throw new AppError({ code: "EMPRESA_NO_AUTORIZADA", message: "Empresa no autorizada", statusCode: 403 });
  const estado = await repo.consultarEstado();
  if (estado && estado.empresa !== empresaAutorizada) throw conflicto("ORIGEN_INCOMPATIBLE", "Esta base ya recibió productos de otra empresa SAP");
  return { empresa: empresaAutorizada, ultimaSecuencia: estado?.secuencia ?? 0,
    ultimaRecepcion: estado?.actualizadoEn ?? null };
}
