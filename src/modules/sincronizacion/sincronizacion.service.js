import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../shared/errors/AppError.js";
import { loteProductosSchema } from "./productos.schemas.js";
import { loteClientesSchema } from "./clientes.schemas.js";
import { lotePedidosSchema } from "./pedidos.schemas.js";
import { loteUnidadesSchema } from "./unidades.schemas.js";
import { loteCodigosBarrasSchema } from "./codigosBarras.schemas.js";
import { sincronizacionRepository as repo } from "./sincronizacion.repository.js";
const conflicto = (code, message) => new AppError({ code, message, statusCode: 409 });
const origenIncompatible = () => conflicto("ORIGEN_INCOMPATIBLE", "Esta base ya recibió datos de otra empresa SAP");

// Cada entidad tiene su contrato, su clave y su forma de guardar; la secuencia es independiente por entidad.
// guardar llama al repositorio en el momento para que las pruebas puedan sustituir sus métodos.
const DEFINICIONES = {
  productos: { schema: loteProductosSchema, clave: "itemCode", guardar: (r, tx) => repo.guardarProducto(r, tx) },
  clientes: { schema: loteClientesSchema, clave: "cardCode", guardar: (r, tx) => repo.guardarCliente(r, tx) },
  pedidos: { schema: lotePedidosSchema, clave: "docEntry", guardar: (r, tx) => repo.guardarPedido(r, tx) },
  unidades: { schema: loteUnidadesSchema, clave: "absEntry", guardar: (r, tx) => repo.guardarUnidad(r, tx) },
  codigosBarras: { schema: loteCodigosBarrasSchema, clave: "absEntry", guardar: (r, tx) => repo.guardarCodigoBarras(r, tx) },
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

// Pedidos abiertos en esta base y su última actualización. El puente compara esas fechas con la hora de
// inicio de su recorrido (ambas de este reloj) para pedir a SAP los que dejaron de estar abiertos.
export async function consultarPedidosAbiertos(empresaAutorizada) {
  exigirEmpresa(empresaAutorizada);
  const ahora = new Date().toISOString();
  if (await repo.existeOtraEmpresa(empresaAutorizada)) throw origenIncompatible();
  const pedidos = await repo.listarPedidosAbiertos();
  return { ahora, pedidos: pedidos.map((p) => ({ docEntry: p.docEntry, sincronizadoEn: p.sincronizadoEn.toISOString() })) };
}

// Hora del backend: el puente la usa como inicio de un recorrido completo.
export async function consultarHora(empresaAutorizada) {
  exigirEmpresa(empresaAutorizada);
  if (await repo.existeOtraEmpresa(empresaAutorizada)) throw origenIncompatible();
  return { ahora: new Date().toISOString() };
}

// Al terminar un recorrido completo de BarCodes, los códigos de SAP no recibidos desde su inicio
// ya no existen en SAP: se marcan como retirados. Repetir la llamada no cambia el resultado.
export async function retirarCodigosNoListados(entrada, empresaAutorizada) {
  exigirEmpresa(empresaAutorizada);
  const validacion = z.object({ antesDe: z.iso.datetime() }).strict().safeParse(entrada);
  if (!validacion.success) throw new AppError({ code: "SOLICITUD_INVALIDA", message: "Se requiere antesDe con fecha y hora ISO", statusCode: 400 });
  const antesDe = new Date(validacion.data.antesDe);
  if (antesDe.getTime() > Date.now()) throw new AppError({ code: "FECHA_FUTURA", message: "antesDe no puede ser posterior a la hora del backend", statusCode: 400 });
  return repo.conBloqueo(async (tx) => {
    if (await repo.existeOtraEmpresa(empresaAutorizada, tx)) throw origenIncompatible();
    return { retirados: await repo.marcarCodigosRetirados(antesDe, tx) };
  });
}
