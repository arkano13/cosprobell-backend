import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UNIDADES, CODIGOS_BARRAS } from "../../puente/entidades.js";
import { construirLoteUnidades } from "../../puente/unidades.js";
import { construirLoteCodigosBarras } from "../../puente/codigosBarras.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { crearClienteBackend } from "../../puente/backend.client.js";
import { abrirAlmacen } from "../../puente/estado.js";
import { sincronizar } from "../../puente/sincronizar.js";

const codigoSap = (absEntry, cambios = {}) => ({ AbsEntry: absEntry, ItemNo: "P1", Barcode: `74${absEntry}`, UoMEntry: 1, ...cambios });
const detalleDe = (fn) => { try { fn(); } catch (e) { return [e.code, e.detalle]; } assert.fail("debía fallar"); };

test("unidades: convierte UnitOfMeasurements y el nombre vacío pasa a null", () => {
  assert.deepEqual(construirLoteUnidades([{ AbsEntry: 1, Code: "UN", Name: "" }, { AbsEntry: 2, Code: "CJ12", Name: "Caja 12" }], "TEST", 1).unidades,
    [{ absEntry: 1, code: "UN", name: null }, { absEntry: 2, code: "CJ12", name: "Caja 12" }]);
  assert.deepEqual(detalleDe(() => construirLoteUnidades([{ AbsEntry: 3, Code: null, Name: "x" }], "TEST", 1)),
    ["UNIDAD_SAP_INVALIDA", { absEntry: 3, campo: "Code" }]);
});

test("códigos de barras: convierte BarCodes e informa registro y campo SAP inválidos", () => {
  assert.deepEqual(construirLoteCodigosBarras([codigoSap(5)], "TEST", 1).codigosBarras, [{ absEntry: 5, itemCode: "P1", codigo: "745", uomEntry: 1 }]);
  assert.deepEqual(detalleDe(() => construirLoteCodigosBarras([codigoSap(6, { Barcode: "7401 " })], "TEST", 1)), ["CODIGO_BARRAS_SAP_INVALIDO", { absEntry: 6, campo: "Barcode" }]);
  assert.deepEqual(detalleDe(() => construirLoteCodigosBarras([codigoSap(7, { ItemNo: "" })], "TEST", 1)), ["CODIGO_BARRAS_SAP_INVALIDO", { absEntry: 7, campo: "ItemNo" }]);
  assert.deepEqual(detalleDe(() => construirLoteCodigosBarras([codigoSap(8), codigoSap(8)], "TEST", 1)), ["CODIGO_BARRAS_SAP_INVALIDO", { absEntry: 8, campo: "AbsEntry" }]);
});

test("SAP: BarCodes y UnitOfMeasurements se recorren por AbsEntry numérico", async () => {
  const urls = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1", empresa: "TEST" }, async (url) => {
    urls.push(url);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticio" } });
    return Response.json({ value: [] });
  });
  await sap.pagina(10, CODIGOS_BARRAS); await sap.pagina(null, UNIDADES);
  assert.equal(urls[1], "https://sap.test/b1s/v1/BarCodes?$select=AbsEntry,ItemNo,Barcode,UoMEntry&$orderby=AbsEntry%20asc&$top=50&$filter=AbsEntry%20gt%2010");
  assert.equal(urls[2], "https://sap.test/b1s/v1/UnitOfMeasurements?$select=AbsEntry,Code,Name&$orderby=AbsEntry%20asc&$top=50&$filter=AbsEntry%20ge%200");
});

async function almacenTemporal(t) {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-codigos-"));
  t.after(() => rm(directorio, { recursive: true, force: true }));
  const config = { directorio, origen: "origen-simulado", empresa: "TEST" };
  return { config, abrir: () => abrirAlmacen(config, CODIGOS_BARRAS) };
}
function backendSimulado() {
  let remoto = 0, reloj = 0; const llamadas = [];
  return { llamadas, backend: {
    estado: async () => remoto,
    hora: async () => { const h = new Date(Date.UTC(2026, 8, 29, 12, 0, ++reloj)).toISOString(); llamadas.push(["hora", h]); return h; },
    enviar: async (lote) => { remoto = lote.secuencia; llamadas.push(["enviar", lote.codigosBarras.map((c) => c.absEntry)]); },
    marcarRetirados: async (antesDe) => { llamadas.push(["retirados", antesDe]); return 0; },
  } };
}
test("códigos de barras: al terminar el recorrido pide retirar los no recibidos desde su inicio", async (t) => {
  const { config, abrir } = await almacenTemporal(t); const f = backendSimulado();
  const todos = Array.from({ length: 60 }, (_, i) => codigoSap(i + 1));
  const sap = { pagina: async (cursor) => todos.filter((c) => c.AbsEntry > (cursor ?? 0)).slice(0, 50) };
  const resultado = await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: CODIGOS_BARRAS });
  assert.deepEqual(resultado, { completo: true, lotes: 2, ultimaSecuencia: 2 });
  const [inicio] = f.llamadas.filter(([n]) => n === "hora").map(([, h]) => h);
  assert.deepEqual(f.llamadas.map(([n]) => n), ["hora", "enviar", "enviar", "retirados"]);
  assert.deepEqual(f.llamadas.at(-1), ["retirados", inicio]);
  const disco = (await abrir()).estado;
  assert.deepEqual([disco.cursor, disco.inicioRecorrido], [null, null]);
});
test("códigos de barras: un recorrido interrumpido conserva su hora de inicio", async (t) => {
  const { config, abrir } = await almacenTemporal(t); const f = backendSimulado();
  const todos = Array.from({ length: 60 }, (_, i) => codigoSap(i + 1));
  let paginas = 0;
  const sap = { pagina: async (cursor) => { if (++paginas === 2) throw Object.assign(new Error("corte"), { code: "CONEXION_O_TLS", temporal: true }); return todos.filter((c) => c.AbsEntry > (cursor ?? 0)).slice(0, 50); } };
  await assert.rejects(sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: CODIGOS_BARRAS }), { code: "CONEXION_O_TLS" });
  const inicio = (await abrir()).estado.inicioRecorrido;
  assert.ok(inicio);
  await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: CODIGOS_BARRAS });
  assert.equal(f.llamadas.filter(([n]) => n === "hora").length, 1);
  assert.deepEqual(f.llamadas.at(-1), ["retirados", inicio]);
});

test("backend: hora, retiro de códigos y código de error del backend en el detalle", async () => {
  const config = { backendUrl: "https://backend.test", clave: "x".repeat(40), empresa: "TEST" };
  const pedidos = [];
  const backend = crearClienteBackend(config, async (url, opciones) => {
    const ruta = new URL(url).pathname; pedidos.push([ruta, opciones.method ?? "GET", opciones.body]);
    if (ruta.endsWith("/hora")) return Response.json({ data: { ahora: "2026-09-29T12:00:00.000Z" } });
    if (ruta.endsWith("/retirados")) return Response.json({ data: { retirados: 3 } });
    return Response.json({ error: { code: "PRODUCTO_NO_SINCRONIZADO", message: "texto" } }, { status: 409 });
  });
  assert.equal(await backend.hora(), "2026-09-29T12:00:00.000Z");
  assert.equal(await backend.marcarRetirados("2026-09-29T12:00:00.000Z"), 3);
  assert.deepEqual(pedidos[1], ["/integracion/codigosBarras/retirados", "POST", JSON.stringify({ antesDe: "2026-09-29T12:00:00.000Z" })]);
  const lote = construirLoteCodigosBarras([codigoSap(1)], "TEST", 1);
  await assert.rejects(backend.enviar(lote, CODIGOS_BARRAS), (e) =>
    e.code === "HTTP_409" && e.temporal === false && e.detalle.codigoBackend === "PRODUCTO_NO_SINCRONIZADO");
});
