import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import { loteProductosSchema } from "./productos.schemas.js";
import { loteClientesSchema } from "./clientes.schemas.js";
import { lotePedidosSchema } from "./pedidos.schemas.js";
import { sincronizacionRepository as repo } from "./sincronizacion.repository.js";
const conflicto = (code, message) => new AppError({ code, message, statusCode: 409 });
const origenIncompatible = () => conflicto("ORIGEN_INCOMPATIBLE", "Esta base ya recibió datos de otra empresa SAP");

// Cada entidad tiene su contrato, su clave y su forma de guardar; la secuencia es independiente por entidad.
// guardar llama al repositorio en el momento para que las pruebas puedan sustituir sus métodos.
const DEFINICIONES = {
  productos: { schema: loteProductosSchema, clave: "itemCode", guardar: (r, tx) => repo.guardarProducto(r, tx) },
  clientes: { schema: loteClientesSchema, clave: "cardCode", guardar: (r, tx) => repo.guardarCliente(r, tx) },
  pedidos: { schema: lotePedidosSchema, clave: "docEntry", guardar: (r, tx) => repo.guardarPedido(r, tx) },
};
export const ENTIDADES_SINCRONIZABLES = Object.keys(DEFINICIONES);

function definicionDe(entidad) {
  const definicion = Object.hasOwn(DEFINICIONES, entidad) ? DEFINICIONES[entidad] : null;
  if (!definicion) throw new AppError({ code: "ENTIDAD_DESCONOCIDA", message: "Entidad de sincronización desconocida", statusCode: 404 });
  return definicion;
}
function exigirEmpresa(empresaAutorizada) {
  if (!empresaAutorizada) throw new AppError({ code: "EMPRESA_NO_AUTORIZADA", message: "Empresa no autorizada", statusCode: 403 });
}

export async function recibirLote(entidad, entrada, empresaAutorizada) {
  const { schema, clave, guardar } = definicionDe(entidad);
  const validacion = schema.safeParse(entrada);
  if (!validacion.success) throw new AppError({ code: "LOTE_INVALIDO", message: `El lote de ${entidad} no cumple el contrato`, statusCode: 400 });
  const lote = validacion.data;
  if (!empresaAutorizada || lote.empresa !== empresaAutorizada) {
    throw new AppError({ code: "EMPRESA_NO_AUTORIZADA", message: "Empresa no autorizada para este backend", statusCode: 403 });
  }
  // Mismo contenido con distinto orden conserva la identidad del lote.
  lote[entidad].sort((a, b) => a[clave] < b[clave] ? -1 : a[clave] > b[clave] ? 1 : 0);
  if (entidad === "pedidos") for (const pedido of lote.pedidos) pedido.lineas.sort((a, b) => a.lineNum - b.lineNum);
  const hash = createHash("sha256").update(JSON.stringify(lote)).digest("hex");
  return repo.conBloqueo(async (tx) => {
    // Una sola empresa SAP por base local, sin importar la entidad que llegue primero.
    if (await repo.existeOtraEmpresa(lote.empresa, tx)) throw origenIncompatible();
    const anterior = await repo.consultarEstado(entidad, tx);
    if (anterior && anterior.empresa !== lote.empresa) throw origenIncompatible();
    if (anterior && lote.secuencia === anterior.secuencia) {
      if (hash !== anterior.hash) throw conflicto("LOTE_MODIFICADO", "La secuencia ya fue utilizada con otro contenido");
      return { secuencia: anterior.secuencia, recibidos: anterior.cantidad, repetido: true };
    }
    if (lote.secuencia !== (anterior?.secuencia ?? 0) + 1) {
      throw conflicto("SECUENCIA_INVALIDA", "El lote está fuera de orden; consulte el estado de sincronización");
    }
    for (const registro of lote[entidad]) await guardar(registro, tx);
    await repo.guardarEstado({ entidad, empresa: lote.empresa, secuencia: lote.secuencia, hash, cantidad: lote[entidad].length }, tx);
    return { secuencia: lote.secuencia, recibidos: lote[entidad].length, repetido: false };
  });
}

export async function consultarEstadoLote(entidad, empresaAutorizada) {
  definicionDe(entidad);
  exigirEmpresa(empresaAutorizada);
  if (await repo.existeOtraEmpresa(empresaAutorizada)) throw origenIncompatible();
  const estado = await repo.consultarEstado(entidad);
  if (estado && estado.empresa !== empresaAutorizada) throw origenIncompatible();
  return { empresa: empresaAutorizada, ultimaSecuencia: estado?.secuencia ?? 0,
    ultimaRecepcion: estado?.actualizadoEn ?? null };
}
