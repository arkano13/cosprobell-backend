import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearGestorCandado } from "../../puente/candado.js";
async function preparar(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), "candado-regresion-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return join(dir, "ejecucion.lock");
}
const diferida = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { resolve, promise }; };
test("tres intentos no pueden reemplazar el candado durante una recuperación pausada", async (t) => {
  const ruta = await preparar(t); await fs.mkdir(ruta); await fs.writeFile(join(ruta, "pid"), "2147483644");
  const leido = diferida(), continuar = diferida();
  const archivos = { ...fs, readFile: async (...args) => {
    const valor = await fs.readFile(...args);
    if (args[0] === join(ruta, "pid") && valor === "2147483644") { leido.resolve(); await continuar.promise; }
    return valor;
  } };
  const tomarA = crearGestorCandado(archivos, () => false);
  const tomarOtro = crearGestorCandado();
  const pendiente = tomarA(ruta); await leido.promise;
  try {
    await assert.rejects(tomarOtro(ruta), { code: "PUENTE_YA_BLOQUEADO" });
    await assert.rejects(tomarOtro(ruta), { code: "PUENTE_YA_BLOQUEADO" });
  } finally { continuar.resolve(); }
  const liberar = await pendiente;
  try { await assert.rejects(tomarOtro(ruta), { code: "PUENTE_YA_BLOQUEADO" }); }
  finally { await liberar(); }
  const nuevo = await tomarOtro(ruta); await nuevo();
});
test("cerrar una adquisición antigua no borra otra del mismo PID", async (t) => {
  const ruta = await preparar(t); const tomar = crearGestorCandado();
  const viejo = await tomar(ruta); await viejo();
  const nuevo = await tomar(ruta); await viejo();
  await assert.rejects(tomar(ruta), { code: "PUENTE_YA_BLOQUEADO" });
  await nuevo();
});
test("guardia abandonada bloquea sin modificar el candado ni el avance", async (t) => {
  const ruta = await preparar(t); await fs.mkdir(`${ruta}.guard`);
  await assert.rejects(crearGestorCandado()(ruta), { code: "PUENTE_YA_BLOQUEADO" });
  assert.equal((await fs.stat(`${ruta}.guard`)).isDirectory(), true);
});
test("error de disco al leer propietario no se interpreta como proceso muerto", async (t) => {
  const ruta = await preparar(t); await fs.mkdir(ruta); await fs.writeFile(join(ruta, "pid"), "2147483644");
  const tomar = crearGestorCandado({ ...fs, readFile: async () => { throw Object.assign(new Error("EIO"), { code: "EIO" }); } }, () => false);
  await assert.rejects(tomar(ruta), { code: "EIO" });
  assert.equal(await fs.readFile(join(ruta, "pid"), "utf8"), "2147483644");
  await assert.rejects(fs.stat(`${ruta}.guard`), { code: "ENOENT" });
});
