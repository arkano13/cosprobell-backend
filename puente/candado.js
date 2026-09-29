import * as fs from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { ErrorPuente } from "./http.js";

function procesoActivo(pid) {
  try { process.kill(pid, 0); return true; }
  // Ante un error desconocido no asumimos que sea seguro retirar el candado.
  catch (error) { return error.code !== "ESRCH"; }
}

export function crearGestorCandado(archivos = fs, activo = procesoActivo) {
  async function leer(candado, nombre) {
    try { return await archivos.readFile(join(candado, nombre), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async function conGuardia(candado, operacion, intentos = 1) {
    const guardia = `${candado}.guard`;
    for (let i = 0; ; i++) {
      try { await archivos.mkdir(guardia); break; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (i + 1 >= intentos) throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
        await esperar(10);
      }
    }
    // La guardia nunca se recupera automáticamente: hacerlo reintroduciría
    // la carrera que protege. Un apagón aquí exige revisión manual.
    try { return await operacion(); }
    finally { await archivos.rmdir(guardia); }
  }
  return async function tomarCandado(candado) {
    const token = randomUUID();
    await conGuardia(candado, async () => {
      try { await archivos.mkdir(candado); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const pid = Number(await leer(candado, "pid"));
        if (!Number.isSafeInteger(pid) || pid <= 0 || activo(pid)) throw new ErrorPuente("PUENTE_YA_BLOQUEADO");
        await archivos.rm(candado, { recursive: true, force: true });
        await archivos.mkdir(candado);
      }
      // Si una escritura falla, el candado incompleto queda cerrado por seguridad.
      await archivos.writeFile(join(candado, "token"), token, { flag: "wx" });
      await archivos.writeFile(join(candado, "pid"), String(process.pid), { flag: "wx" });
    });
    let cerrado = false;
    return async function liberar() {
      if (cerrado) return;
      await conGuardia(candado, async () => {
        if (await leer(candado, "token") === token && await leer(candado, "pid") === String(process.pid)) {
          await archivos.rm(candado, { recursive: true, force: true });
        }
        cerrado = true;
      }, 50);
    };
  };
}
export const tomarCandado = crearGestorCandado();
