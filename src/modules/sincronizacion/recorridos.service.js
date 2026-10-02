import { z } from "zod";
import { AppError } from "../../shared/errors/AppError.js";
import { sincronizacionRepository as repo } from "./sincronizacion.repository.js";

const fallo = (code, message, statusCode = 409) => new AppError({ code, message, statusCode });
export async function registrarRecorrido(entidad, accion, entrada, empresa) {
  if (!["almacenes", "existencias"].includes(entidad) || !["iniciar", "finalizar"].includes(accion)) {
    throw fallo("RECURSO_NO_ENCONTRADO", "Recorrido desconocido", 404);
  }
  if (!empresa) throw fallo("EMPRESA_NO_AUTORIZADA", "Empresa no autorizada", 403);
  const schema = z.object({ recorridoId: z.string().uuid().transform(v => v.toLowerCase()),
    ...(accion === "finalizar" ? { secuencia: z.number().int().min(0).max(2147483647) } : {}) }).strict();
  const v = schema.safeParse(entrada);
  if (!v.success) throw fallo("SOLICITUD_INVALIDA", "Datos del recorrido inválidos", 400);
  const { recorridoId, secuencia } = v.data;
  return repo.conBloqueo(async tx => {
    if (await repo.existeOtraEmpresa(empresa, tx)) throw fallo("ORIGEN_INCOMPATIBLE", "Esta base pertenece a otra empresa SAP");
    const anterior = await repo.consultarRecorrido(entidad, tx);
    if (accion === "iniciar") {
      if (anterior?.recorridoId === recorridoId) return { recorridoId, completo: anterior.finalizadoEn !== null };
      if (anterior && !anterior.finalizadoEn) throw fallo("RECORRIDO_EN_CURSO", "Hay otro recorrido sin terminar; conserve su estado local");
      await repo.iniciarRecorrido(entidad, empresa, recorridoId, tx);
      return { recorridoId, completo: false };
    }
    if (anterior?.recorridoId !== recorridoId) throw fallo("RECORRIDO_INVALIDO", "No coincide el recorrido iniciado");
    const estado = await repo.consultarEstado(entidad, tx);
    if ((estado?.secuencia ?? 0) !== secuencia || (anterior.finalizadoEn && anterior.secuencia !== secuencia)) {
      throw fallo("SECUENCIA_INVALIDA", "El recorrido no coincide con la última secuencia confirmada");
    }
    if (!anterior.finalizadoEn) await repo.finalizarRecorrido(entidad, secuencia, tx);
    return { recorridoId, completo: true };
  });
}
