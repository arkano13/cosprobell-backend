// Comprueba el candado local del puente con procesos reales: recuperación tras un
// cierre forzado y varios procesos que intentan recuperar el mismo candado huérfano.
// No usa SAP, el backend ni PostgreSQL. Trabaja en una carpeta temporal que elimina al final.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirEstado } from "../puente/estado.js";

const estadoUrl = new URL("../puente/estado.js", import.meta.url).href;
const PID_TERMINADO = 2147483644;
const RONDAS = Number(process.argv[2] ?? 40);
const PROCESOS = 6;

// Proceso hijo: intenta tomar el candado, lo mantiene un momento y lo libera.
const hijo = (directorio, esperaMs) => `
  const { abrirEstado } = await import(${JSON.stringify(estadoUrl)});
  try {
    const a = await abrirEstado({ directorio: ${JSON.stringify(directorio)}, origen: "prueba", empresa: "PRUEBA" });
    console.log("TOMADO");
    await new Promise((r) => setTimeout(r, ${esperaMs}));
    await a.cerrar();
  } catch (e) { console.log(e.code ?? e.message); }
`;
function lanzar(directorio, esperaMs) {
  const proceso = spawn(process.execPath, ["--input-type=module", "-e", hijo(directorio, esperaMs)]);
  let salida = "";
  proceso.stdout.on("data", (d) => { salida += d; });
  const fin = new Promise((resolve) => proceso.on("exit", () => resolve(salida.trim())));
  return { proceso, fin, salida: () => salida };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const base = await mkdtemp(join(tmpdir(), "cosprobell-candado-"));
try {
  // 1. Un proceso toma el candado y se termina a la fuerza (como un apagón).
  const directorio = join(base, "cierre-forzado");
  const victima = lanzar(directorio, 60_000);
  const limite = Date.now() + 10_000;
  while (!victima.salida().includes("TOMADO")) {
    if (Date.now() > limite) { victima.proceso.kill("SIGKILL"); throw new Error(`el proceso de prueba no tomó el candado: ${victima.salida()}`); }
    await esperar(20);
  }
  victima.proceso.kill("SIGKILL"); await victima.fin;
  assert.deepEqual((await readdir(directorio)).sort(), ["ejecucion.lock", "productos.json"]);
  const recuperado = await abrirEstado({ directorio, origen: "prueba", empresa: "PRUEBA" });
  await recuperado.cerrar();
  console.log("APROBADO: tras un cierre forzado, la siguiente ejecución recupera el candado.");

  // 2. Varios procesos intentan recuperar a la vez el mismo candado huérfano.
  let sinGanador = 0;
  for (let ronda = 1; ronda <= RONDAS; ronda++) {
    const dir = join(base, `ronda-${ronda}`);
    await mkdir(join(dir, "ejecucion.lock"), { recursive: true });
    await writeFile(join(dir, "ejecucion.lock", "pid"), String(PID_TERMINADO));
    const salidas = await Promise.all(Array.from({ length: PROCESOS }, () => lanzar(dir, 300).fin));
    const tomados = salidas.filter((s) => s === "TOMADO").length;
    // Lo esencial: nunca dos a la vez. Si ninguno lo tomó (posible en Windows cuando un
    // renombrado coincide con una lectura), el candado huérfano sigue y la próxima ejecución lo recupera.
    assert.ok(tomados <= 1, `ronda ${ronda}: ${salidas.join(", ")}`);
    assert.ok(salidas.every((s) => s === "TOMADO" || s === "PUENTE_YA_BLOQUEADO"), `ronda ${ronda}: ${salidas.join(", ")}`);
    const restante = (await readdir(dir)).sort();
    assert.deepEqual(restante, tomados === 1 ? ["productos.json"] : ["ejecucion.lock"], `ronda ${ronda}: ${restante.join(", ")}`);
    if (tomados === 0) sinGanador++;
  }
  console.log(`APROBADO: en ${RONDAS} rondas con ${PROCESOS} procesos, nunca hubo dos con el candado (rondas sin ganador: ${sinGanador}).`);
} catch (error) {
  console.error("FALLÓ la comprobación del candado:", error.message);
  process.exitCode = 1;
} finally {
  await rm(base, { recursive: true, force: true });
}
