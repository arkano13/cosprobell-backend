import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import { FINANZAS, inicioSchema, finalSchema, loteFinanzasSchema } from "../../shared/finanzas/contratos.js";
import { finanzasRepository as repo } from "./finanzas.repository.js";

export const falloFinanzas = (code, message, statusCode = 409) => new AppError({ code, message, statusCode });
export function exigirEntidad(entidad) {
  if (!Object.hasOwn(FINANZAS, entidad)) throw falloFinanzas("ENTIDAD_DESCONOCIDA", "Entidad financiera desconocida", 404);
}
function validar(schema, entrada) {
  const v = schema.safeParse(entrada);
  if (!v.success) throw falloFinanzas("FINANZAS_CONTRATO_INVALIDO", "Datos financieros inválidos", 400);
  return v.data;
}
async function comprobarEmpresa(empresa, tx) {
  if (!empresa) throw falloFinanzas("EMPRESA_NO_AUTORIZADA", "Empresa requerida", 403);
  if (await repo.otraEmpresa(empresa, tx)) throw falloFinanzas("ORIGEN_INCOMPATIBLE", "Empresa SAP distinta");
}
export async function estadoFinanzas(entidad, empresa) {
  exigirEntidad(entidad);
  return repo.conBloqueo(async tx => {
    await comprobarEmpresa(empresa, tx);
    return await repo.control(entidad, tx);
  });
}
export async function iniciarFinanzas(entidad, entrada, empresa) {
  exigirEntidad(entidad);
  const datos = validar(inicioSchema, entrada);
  if (datos.empresa !== empresa) throw falloFinanzas("EMPRESA_NO_AUTORIZADA", "Empresa SAP distinta", 403);
  return repo.conBloqueo(async tx => {
    await comprobarEmpresa(empresa, tx);
    const c = await repo.control(entidad, tx);
    if (c?.recorridoId === datos.recorridoId) {
      if (JSON.stringify(c.configuracion) !== JSON.stringify(datos)) {
        // PostgreSQL JSONB puede reordenar campos.
        if (Object.keys(datos).some(k => c.configuracion[k] !== datos[k])) throw falloFinanzas("RECORRIDO_MODIFICADO", "Cambió la configuración de un recorrido");
      }
      return { recorridoId: c.recorridoId, completo: Boolean(c.finalizadoEn) };
    }
    if (c && !c.finalizadoEn) throw falloFinanzas("RECORRIDO_EN_CURSO", "Termine la carga financiera pendiente");
    if (c && ["desde", "monedaLocal", "monedaSistema"].some(k => c.configuracion[k] !== datos[k])) throw falloFinanzas("ALCANCE_FINANCIERO_DISTINTO", "Conserve la fecha histórica y las monedas durante esta instalación");
    await repo.iniciar(entidad, datos, tx);
    return { recorridoId: datos.recorridoId, completo: false };
  });
}
export async function recibirFinanzas(entidad, entrada, empresa) {
  exigirEntidad(entidad);
  const lote = validar(loteFinanzasSchema(entidad), entrada);
  const hash = createHash("sha256").update(JSON.stringify(lote)).digest("hex");
  return repo.conBloqueo(async tx => {
    await comprobarEmpresa(empresa, tx);
    const c = await repo.control(entidad, tx);
    if (!c || c.recorridoId !== lote.recorridoId) throw falloFinanzas("RECORRIDO_INVALIDO", "Recorrido desconocido");
    if (lote.secuencia === c.secuencia) {
      if (hash !== c.ultimoHash) throw falloFinanzas("LOTE_MODIFICADO", "Lote ya recibido con otro contenido");
      return { secuencia: c.secuencia, recibidos: lote.registros.length, repetido: true };
    }
    if (c.finalizadoEn || lote.secuencia !== c.secuencia + 1) throw falloFinanzas("SECUENCIA_INVALIDA", "Lote fuera de orden");
    await repo.guardar(entidad, c, lote.registros, tx);
    await repo.confirmar(entidad, lote.secuencia, hash, lote.registros.length, tx);
    return { secuencia: lote.secuencia, recibidos: lote.registros.length, repetido: false };
  });
}
export async function finalizarFinanzas(entidad, entrada, empresa) {
  exigirEntidad(entidad);
  const fin = validar(finalSchema, entrada);
  return repo.conBloqueo(async tx => {
    await comprobarEmpresa(empresa, tx);
    const c = await repo.control(entidad, tx);
    if (c?.recorridoId !== fin.recorridoId || c.secuencia !== fin.secuencia) throw falloFinanzas("RECORRIDO_INVALIDO", "Recorrido o secuencia distintos");
    if (!c.finalizadoEn) await repo.publicar(entidad, c, tx);
    return { recorridoId: c.recorridoId, completo: true };
  });
}
