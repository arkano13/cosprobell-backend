import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ErrorPuente } from "./http.js";

// Lectura local: no consulta SAP, el backend ni las bases SQLite de contenido.
export async function estadoPublico(config, entidades) {
  const estados = [];
  for (const e of entidades) {
    let s;
    try { s = JSON.parse(await readFile(join(config.directorio, `${e.nombre}.json`), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new ErrorPuente("ESTADO_LOCAL_INVALIDO", false, { entidad: e.nombre }); }
    if (s && s.origen !== config.origen) throw new ErrorPuente("ESTADO_LOCAL_INCOMPATIBLE", false, { entidad: e.nombre });
    estados.push({ entidad: e.nombre, pausada: (config.pausadas ?? []).includes(e.nombre),
      ultimaCompleta: s?.ultimoCompleto ?? null, secuencia: s?.secuencia ?? 0,
      trabajoPendiente: Boolean(s && (s.pendiente || s.cursor != null || s.inicioRecorrido || s.porRevisar || s.recorridoId || s.finalizando)) });
  }
  return { evento: "estado_local", generadoEn: new Date().toISOString(), entidades: estados,
    aviso: "Estado local por entidad; no confirma disponibilidad del backend ni del Service Layer." };
}
