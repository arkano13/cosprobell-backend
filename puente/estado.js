import { mkdir, readFile, open, rename, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { ErrorPuente } from "./http.js";
export async function abrirEstado(config) {
  await mkdir(config.directorio, { recursive: true });
  const candado = join(config.directorio, "ejecucion.lock");
  try { await mkdir(candado); }
  catch (e) { if (e.code === "EEXIST") throw new ErrorPuente("PUENTE_YA_BLOQUEADO"); throw e; }
  const archivo = join(config.directorio, "productos.json");
  async function guardar(estado) {
    const temporal = join(config.directorio, `estado-${randomUUID()}.tmp`);
    try {
      const f = await open(temporal, "wx", 0o600);
      try { await f.writeFile(JSON.stringify(estado), "utf8"); await f.sync(); } finally { await f.close(); }
      await rename(temporal, archivo);
    } finally { await unlink(temporal).catch((e) => { if (e.code !== "ENOENT") throw e; }); }
  }
  try {
    let estado;
    try { estado = JSON.parse(await readFile(archivo, "utf8")); }
    catch (e) {
      if (e.code !== "ENOENT") throw new ErrorPuente("ESTADO_LOCAL_INVALIDO");
      estado = { version: 1, origen: config.origen, secuencia: 0, cursor: null, pendiente: null };
      await guardar(estado);
    }
    if (estado.version !== 1 || estado.origen !== config.origen || !Number.isSafeInteger(estado.secuencia) || estado.secuencia < 0 ||
        !(estado.cursor === null || typeof estado.cursor === "string")) throw new ErrorPuente("ESTADO_LOCAL_INCOMPATIBLE");
    if (estado.pendiente !== null) {
      const p = estado.pendiente;
      const valido = loteProductosSchema.safeParse(p?.lote);
      if (!valido.success || p.lote.empresa !== config.empresa || p.lote.secuencia !== estado.secuencia + 1 ||
          p.cursor !== p.lote.productos.at(-1).itemCode) throw new ErrorPuente("PENDIENTE_INVALIDO");
    }
    return { estado, guardar, cerrar: () => rmdir(candado) };
  } catch (error) { await rmdir(candado); throw error; }
}
