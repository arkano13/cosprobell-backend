import { createHash, randomUUID } from "node:crypto";
import { FINANZAS, cursorRegistro } from "../src/shared/finanzas/contratos.js";
import { ErrorPuente } from "./http.js";
import { lectorFinanciero, transformarFinanzas } from "./finanzas.transformar.js";

export function parametrosFinanzas(def, config, recorrido, cursor) {
  const inicial = FINANZAS[def.nombre].claves.map(k => FINANZAS[def.nombre].campos[k].safeParse(0).success ? -2147483648 : "");
  return { ...Object.fromEntries((cursor ?? inicial).map((v, i) => [`k${i}`, v])),
    ...(def.incremental ? { since: recorrido.ventana } : {}),
    ...(def.incremental && !def.historialContable ? { history: config.desde } : {}) };
}
export function fuenteFinanzas(def, config) {
  return createHash("sha256").update(JSON.stringify([def.hash, config.desde, config.monedaLocal, config.monedaSistema])).digest("hex");
}
export async function sincronizarPaginaFinanzas({ config, def, almacen, sap, backend, ahora = () => new Date() }) {
  const entidad = def.nombre;
  let s = almacen.estado;
  const guardar = async datos => { await almacen.guardar(datos); s = almacen.estado; };
  const remoto = await backend(entidad, "estado");
  if (almacen.nuevo && remoto) throw new ErrorPuente("FALTA_ESTADO_FINANCIERO_LOCAL");
  if (!remoto && (s.ultimoRecorrido || s.secuencia > 0)) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  if (s.recorrido && remoto && remoto.recorridoId !== s.recorrido.recorridoId &&
    (remoto.recorridoId !== s.ultimoRecorrido || !remoto.finalizadoEn)) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  if (remoto && remoto.empresa !== config.empresa) throw new ErrorPuente("ORIGEN_INCOMPATIBLE");
  const fuente = fuenteFinanzas(def, config);
  if (s.recorrido && s.recorrido.fuente !== fuente) throw new ErrorPuente("CAMBIO_FINANCIERO_CON_PENDIENTE");
  if (!s.recorrido) {
    if (remoto && (!remoto.finalizadoEn || remoto.recorridoId !== s.ultimoRecorrido)) throw new ErrorPuente("REQUIERE_RECONCILIACION");
    const completo = !s.ultimoCompleto || config.reconciliar || s.fuente !== fuente;
    // Solapamiento de dos días desde el INICIO anterior: incluye cambios durante
    // una carga de varias ejecuciones y diferencia de zona horaria con SAP.
    const ventana = completo ? (def.historialContable ? "1900-01-01" : config.desde)
      : new Date(Date.parse(s.ultimoInicio) - 2 * 86400000).toISOString().slice(0, 10);
    const recorrido = { recorridoId: randomUUID(), empresa: config.empresa, desde: config.desde, fuente,
      ventana, modo: completo ? "completo" : "cambios", monedaLocal: config.monedaLocal, monedaSistema: config.monedaSistema };
    await guardar({ ...s, recorrido, secuencia: 0, cursor: null, iniciadoEn: ahora().toISOString(), fuente });
  } else if (remoto?.recorridoId === s.recorrido.recorridoId &&
    remoto.secuencia !== s.secuencia && remoto.secuencia !== s.pendiente?.lote.secuencia) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  const inicio = await backend(entidad, "iniciar", s.recorrido);
  if (inicio.recorridoId !== s.recorrido.recorridoId) throw new ErrorPuente("CONFIRMACION_INVALIDA");
  almacen.nuevo = false;
  if (!s.finalizando) {
    if (!s.pendiente) {
      const filas = await sap.paginaFinanciera(def.consulta, parametrosFinanzas(def, config, s.recorrido, s.cursor), lectorFinanciero(entidad));
      const registros = transformarFinanzas(entidad, filas, s.cursor);
      if (entidad === "empresa" && (registros.length !== (s.cursor ? 0 : 1) || registros.some(r =>
        r.monedaLocal !== config.monedaLocal || r.monedaSistema !== config.monedaSistema))) throw new ErrorPuente("MONEDA_EMPRESA_DISTINTA");
      if (!registros.length) await guardar({ ...s, finalizando: true });
      else await guardar({ ...s, pendiente: { lote: { recorridoId: s.recorrido.recorridoId, secuencia: s.secuencia + 1, registros },
        cursor: cursorRegistro(entidad, registros.at(-1)) } });
    }
    if (s.pendiente) {
      const { lote, cursor } = s.pendiente;
      const confirmacion = await backend(entidad, "lote", lote);
      if (confirmacion.secuencia !== lote.secuencia || confirmacion.recibidos !== lote.registros.length || typeof confirmacion.repetido !== "boolean") throw new ErrorPuente("CONFIRMACION_INVALIDA");
      await guardar({ ...s, secuencia: lote.secuencia, cursor, pendiente: null });
      return { completo: false, registros: lote.registros.length, secuencia: s.secuencia };
    }
  }
  const fin = await backend(entidad, "finalizar", { recorridoId: s.recorrido.recorridoId, secuencia: s.secuencia });
  if (fin.completo !== true || fin.recorridoId !== s.recorrido.recorridoId) throw new ErrorPuente("CONFIRMACION_INVALIDA");
  await guardar({ ...s, ultimoRecorrido: s.recorrido.recorridoId, ultimoInicio: s.iniciadoEn, ultimoCompleto: ahora().toISOString(),
    recorrido: null, finalizando: false, cursor: null });
  return { completo: true, secuencia: s.secuencia };
}
