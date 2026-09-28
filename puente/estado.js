import { mkdir, readFile, open, rename, unlink, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { ErrorPuente } from "./http.js";
// Con la señal 0 solo se consulta si el proceso existe; también funciona en Windows.
function procesoActivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
async function leerPid(candado) {
  try {
    const pid = Number(await readFile(join(candado, "pid"), "utf8"));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}
// ejecucion.lock guarda el PID de quien lo tomó. Si ese proceso ya no existe (apagón,
// cierre forzado) el candado se aparta y se reemplaza. Un candado sin PID legible o de
// un proceso vivo se respeta: puede estar creándose o pertenecer a otra ejecución.
async function tomarCandado(candado) {
  for (let intento = 0; intento < 2; intento++) {
    try { await mkdir(candado); }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = await leerPid(candado);
      if (pid === null || procesoActivo(pid)) throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
      // Renombrar es atómico: si dos procesos intentan apartarlo, solo uno lo consigue.
      const apartado = `${candado}.huerfano-${randomUUID()}`;
      try { await rename(candado, apartado); }
      catch (error) {
        if (error.code === "ENOENT") continue; // otro proceso ya lo apartó
        // En Windows no se puede renombrar mientras otro proceso lee el PID: se considera ocupado.
        if (["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
        throw error;
      }
      if (await leerPid(apartado) !== pid) {
        // Se apartó el candado recién creado por otro proceso: se devuelve intacto.
        await rename(apartado, candado).catch(() => {});
        throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
      }
      await rm(apartado, { recursive: true, force: true });
      continue;
    }
    try { await writeFile(join(candado, "pid"), String(process.pid), { flag: "wx" }); }
    catch (error) {
      // rmdir solo borra una carpeta vacía: nunca retira un candado con PID de otro proceso.
      await rmdir(candado).catch(() => {});
      // ENOENT/EEXIST: otro proceso apartó o reemplazó el candado recién creado.
      if (["ENOENT", "EEXIST"].includes(error.code)) throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
      throw error;
    }
    return;
  }
  throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
}
async function soltarCandado(candado) {
  // Solo se retira el candado propio.
  if (await leerPid(candado) === process.pid) await rm(candado, { recursive: true, force: true });
}
export async function abrirEstado(config) {
  await mkdir(config.directorio, { recursive: true });
  const candado = join(config.directorio, "ejecucion.lock");
  await tomarCandado(candado);
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
    return { estado, guardar, cerrar: () => soltarCandado(candado) };
  } catch (error) { await soltarCandado(candado); throw error; }
}
