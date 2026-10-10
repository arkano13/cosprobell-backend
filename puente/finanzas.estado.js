import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ErrorPuente } from "./http.js";
import { nombresFinanzas, inicioSchema, loteFinanzasSchema, validarCursor, cursorRegistro } from "../src/shared/finanzas/contratos.js";

export async function abrirFinanzas(config, entidad) {
  if (!nombresFinanzas.includes(entidad)) throw new ErrorPuente("ENTIDAD_DESCONOCIDA");
  await mkdir(config.directorio, { recursive: true });
  const ruta = join(config.directorio, `finanzas-${entidad}.json`);
  let estado;
  try { estado = JSON.parse(await readFile(ruta, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw new ErrorPuente("ESTADO_FINANCIERO_INVALIDO"); }
  const nuevo = !estado;
  estado ??= { version: 1, origen: config.origen, recorrido: null, secuencia: 0, cursor: null, pendiente: null };
  if (estado.version !== 1 || estado.origen !== config.origen || !Number.isInteger(estado.secuencia) || estado.secuencia < 0 ||
    (estado.cursor !== null && !validarCursor(entidad, estado.cursor)) ||
    (estado.recorrido !== null && !inicioSchema.safeParse(estado.recorrido).success) ||
    (estado.pendiente !== null && (!loteFinanzasSchema(entidad).safeParse(estado.pendiente.lote).success ||
      !validarCursor(entidad, estado.pendiente.cursor) || estado.pendiente.lote.secuencia !== estado.secuencia + 1 ||
      JSON.stringify(estado.pendiente.cursor) !== JSON.stringify(cursorRegistro(entidad, estado.pendiente.lote.registros.at(-1))) ||
      estado.pendiente.lote.recorridoId !== estado.recorrido?.recorridoId))) throw new ErrorPuente("ESTADO_FINANCIERO_INVALIDO");
  if ((estado.finalizando !== undefined && typeof estado.finalizando !== "boolean") ||
    (estado.finalizando && (!estado.recorrido || estado.pendiente)) ||
    (estado.ultimoCompleto && !estado.ultimoInicio)) throw new ErrorPuente("ESTADO_FINANCIERO_INVALIDO");
  for (const campo of ["ultimaAtencion", "ultimoCompleto", "ultimoInicio", "iniciadoEn"]) {
    if (estado[campo] !== undefined && !Number.isFinite(Date.parse(estado[campo]))) throw new ErrorPuente("ESTADO_FINANCIERO_INVALIDO");
  }
  return { estado, nuevo, async guardar(siguiente) {
    const temporal = join(config.directorio, `finanzas-${randomUUID()}.tmp`);
    try {
      const archivo = await open(temporal, "wx", 0o600);
      try { await archivo.writeFile(JSON.stringify(siguiente), "utf8"); await archivo.sync(); }
      finally { await archivo.close(); }
      await rename(temporal, ruta);
    } finally { await unlink(temporal).catch(e => { if (e.code !== "ENOENT") throw e; }); }
    this.estado = siguiente;
  } };
}
