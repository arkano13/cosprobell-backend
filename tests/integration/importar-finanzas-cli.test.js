// Ejecuta el paquete desde la CLI contra dos servidores locales simulados.
// No usa SAP, Railway ni credenciales reales.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ejecutar = promisify(execFile);

test("CLI: sondeo sin envíos y carga puntual completa que no se repite", { timeout: 90000 }, async t => {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-importador-"));
  const controles = new Map(), lecturasSap = [], enviosBackend = [];
  let registros = 0;
  const responder = (res, dato) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(dato)); };
  const sap = createServer(async (req, res) => {
    lecturasSap.push([req.method, req.url]);
    if (req.url.endsWith("/Login")) { res.setHeader("Set-Cookie", "B1SESSION=prueba-local"); responder(res, {}); return; }
    if (req.url.endsWith("/Logout")) { res.writeHead(204).end(); return; }
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    const moneda = /Currencies\('([^']+)'\)/.exec(req.url);
    responder(res, moneda ? { Code: moneda[1] } : { value: [] });
  });
  const backend = createServer(async (req, res) => {
    enviosBackend.push([req.method, req.url]);
    const [, entidad, accion] = /^\/integracion\/finanzas\/([A-Za-z]+)\/([a-z]+)$/.exec(req.url) ?? [];
    let texto = ""; for await (const chunk of req) texto += chunk;
    const dato = texto ? JSON.parse(texto) : null;
    let c = controles.get(entidad), data;
    if (accion === "estado") data = c ?? null;
    else if (accion === "iniciar") {
      c ??= { ...dato, secuencia: 0 }; controles.set(entidad, c); data = { recorridoId: c.recorridoId };
    } else if (accion === "lote") {
      c.secuencia = dato.secuencia; registros += dato.registros.length;
      data = { secuencia: dato.secuencia, recibidos: dato.registros.length, repetido: false };
    } else if (accion === "finalizar") {
      c.finalizadoEn = new Date().toISOString(); data = { recorridoId: c.recorridoId, completo: true };
    } else { res.writeHead(404).end(); return; }
    responder(res, { data });
  });
  sap.listen(0, "127.0.0.1"); backend.listen(0, "127.0.0.1");
  await Promise.all([once(sap, "listening"), once(backend, "listening")]);
  t.after(async () => {
    sap.closeAllConnections(); backend.closeAllConnections();
    await Promise.all([new Promise(r => sap.close(r)), new Promise(r => backend.close(r))]);
    await rm(directorio, { recursive: true, force: true });
  });
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_ENV: "test", SAP_SERVICE_LAYER_URL: `http://127.0.0.1:${sap.address().port}/b1s/v1`,
    BACKEND_URL: `http://127.0.0.1:${backend.address().port}`, SAP_COMPANY_DB: "TEST", SAP_USER: "prueba", SAP_PASSWORD: "ficticia",
    BRIDGE_API_KEY: "ficticia-".repeat(5), BRIDGE_STATE_DIR: directorio, BRIDGE_FINANCE_ENABLED: "true",
    BRIDGE_FINANCE_SINCE: "1900-01-01", BRIDGE_FINANCE_LOCAL_CURRENCY: "LPS", BRIDGE_FINANCE_SYSTEM_CURRENCY: "USD",
    BRIDGE_FINANCE_MAX_REQUESTS: "100", BRIDGE_FINANCE_MAX_SECONDS: "120" };
  const cli = args => ejecutar(process.execPath, ["puente/importar-finanzas.js", ...args], { env, timeout: 65000 });
  const muestra = await cli(["--sondeo", "--entidad=empresa"]);
  assert.match(muestra.stdout, /sondeo_financiero/); assert.equal(enviosBackend.length, 0);
  assert.equal((await readFile(join(directorio, "sondeo-importacion-finanzas.json"), "utf8")).includes("Muestras sin enviar"), true);
  const carga = await cli(["--cargar"]);
  assert.match(carga.stdout, /"completo":true/);
  const informe = JSON.parse(await readFile(join(directorio, "informe-importacion-finanzas.json"), "utf8"));
  assert.equal(informe.completo, true); assert.equal(informe.entidades.length, 12);
  assert.equal(registros, 1); assert.equal(controles.size, 12);
  assert.equal([...controles.values()].every(c => c.lectura === "get_parcial"), true);
  assert.equal(lecturasSap.every(([m, u]) => m === "GET" || /\/(Login|Logout)$/.test(u)), true);
  const lecturasAntes = lecturasSap.length, backendAntes = enviosBackend.length;
  const repetida = await cli(["--cargar"]);
  assert.match(repetida.stdout, /sinNuevasConsultas/);
  assert.equal(lecturasSap.length, lecturasAntes); assert.equal(enviosBackend.length, backendAntes);
  const estado = await cli(["--estado"]);
  assert.match(estado.stdout, /"completo":true/);
  assert.equal(lecturasSap.length, lecturasAntes);
});
