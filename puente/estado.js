import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
import { tomarCandado } from "./candado.js";
import { crearCache } from "./cache.js";
// Toma el candado de la carpeta y abre el estado de una entidad. Las demás entidades del mismo
// proceso se abren con abrirAlmacen, bajo el mismo candado.
export async function abrirEstado(config, entidad = PRODUCTOS) {
  await mkdir(config.directorio, { recursive: true });
  const candado = join(config.directorio, "ejecucion.lock");
  const liberar = await tomarCandado(candado);
  try {
    const almacen = await abrirAlmacen(config, entidad);
    almacen.cerrar = liberar;
    return almacen;
  } catch (error) { await liberar(); throw error; }
}
// Estado local de una entidad (<nombre>.json): avance confirmado y lote pendiente. No toma el candado.
export async function abrirAlmacen(config, entidad) {
  const archivo = join(config.directorio, `${entidad.nombre}.json`);
  async function guardar(estado) {
    const temporal = join(config.directorio, `estado-${randomUUID()}.tmp`);
    try {
      const f = await open(temporal, "wx", 0o600);
      try { await f.writeFile(JSON.stringify(estado), "utf8"); await f.sync(); } finally { await f.close(); }
      await rename(temporal, archivo);
    } finally { await unlink(temporal).catch((e) => { if (e.code !== "ENOENT") throw e; }); }
  }
  let estado;
  try { estado = JSON.parse(await readFile(archivo, "utf8")); }
  catch (e) {
    if (e.code !== "ENOENT") throw new ErrorPuente("ESTADO_LOCAL_INVALIDO");
    estado = { version: 1, origen: config.origen, secuencia: 0, cursor: null, pendiente: null };
    await guardar(estado);
  }
  if ((estado.recorridoId != null && (typeof estado.recorridoId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(estado.recorridoId))) ||
      (estado.finalizando !== undefined && typeof estado.finalizando !== "boolean") ||
      (estado.reiniciarRecorrido !== undefined && typeof estado.reiniciarRecorrido !== "boolean") ||
      (estado.finalizando && (!estado.recorridoId || estado.pendiente))) throw new ErrorPuente("ESTADO_LOCAL_INCOMPATIBLE");
  if (estado.version !== 1 || estado.origen !== config.origen || !Number.isSafeInteger(estado.secuencia) || estado.secuencia < 0 ||
      !(estado.cursor === null || (entidad.claveNumerica
        ? Number.isInteger(estado.cursor) && estado.cursor >= 0 && estado.cursor <= 2147483647
        : typeof estado.cursor === "string"))) throw new ErrorPuente("ESTADO_LOCAL_INCOMPATIBLE");
  // Revisión de cierres (solo pedidos): hora de inicio del recorrido y claves pendientes de revisar.
  const { inicioRecorrido = null, porRevisar = null } = estado;
  const claveValida = (c) => entidad.claveNumerica ? Number.isSafeInteger(c) && c >= 0 : typeof c === "string";
  const huellasValidas = h => h && typeof h === "object" && !Array.isArray(h) && Object.entries(h).every(([k, v]) =>
    k.startsWith("k:") && typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
  if ((estado.huellas !== undefined && !huellasValidas(estado.huellas)) ||
      (estado.ultimaAtencion !== undefined && !Number.isFinite(Date.parse(estado.ultimaAtencion))) ||
      (estado.ultimoCompleto !== undefined && !Number.isFinite(Date.parse(estado.ultimoCompleto)))) throw new ErrorPuente("ESTADO_LOCAL_INCOMPATIBLE");
  if (!(inicioRecorrido === null || (typeof inicioRecorrido === "string" && Number.isFinite(Date.parse(inicioRecorrido)))) ||
      !(porRevisar === null || (Array.isArray(porRevisar) && porRevisar.every(claveValida)))) throw new ErrorPuente("ESTADO_LOCAL_INCOMPATIBLE");
  if (estado.pendiente !== null) {
    const p = estado.pendiente;
    const valido = entidad.schema.safeParse(p?.lote);
    if (!valido.success || p.lote.empresa !== config.empresa || p.lote.secuencia !== estado.secuencia + 1 ||
        !claveValida(p.cursor) ||
        (p.huellas === undefined ? p.cursor !== p.lote[entidad.nombre].at(-1)[entidad.claveLocal] : !huellasValidas(p.huellas)) ||
        (p.observados !== undefined && (!Array.isArray(p.observados) || p.observados.length > 100 || !p.observados.every(claveValida)))) throw new ErrorPuente("PENDIENTE_INVALIDO");
  }
  const cache = crearCache(join(config.directorio, `${entidad.nombre}-${config.origen}.sqlite`));
  return { estado, guardar, leerHuellas: claves => cache.leer(claves), confirmarHuellas: huellas => cache.confirmar(huellas) };
}
