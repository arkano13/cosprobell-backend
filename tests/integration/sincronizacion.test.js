import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.BRIDGE_API_KEY = "clave-ficticia-de-integracion-123456789";
process.env.SAP_COMPANY_DB = "XPRUEBAS2026";
const { default: app } = await import("../../src/app.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { sincronizacionProductosRepository: repo } = await import("../../src/modules/sincronizacion/productos.repository.js");
const { recibirProductos, consultarEstadoProductos } = await import("../../src/modules/sincronizacion/productos.service.js");
const { crearAutenticacionPuente } = await import("../../src/middleware/bridgeAuth.js");
logger.level = "silent";
let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });
const producto = { itemCode: "P1", itemName: "Champú", barCode: "001234", valid: true, frozen: false };
const lote = (extra = {}) => ({ version: 1, empresa: "XPRUEBAS2026", secuencia: 1, productos: [{ ...producto }], ...extra });
const empresa = "XPRUEBAS2026";
function preparar(t) {
  let estado = null; const productos = new Map(); const tx = {}; let escrituras = 0;
  t.mock.method(repo, "conBloqueo", async (fn) => {
    const copia = structuredClone([...productos]); const anterior = estado;
    try { return await fn(tx); } catch (e) { productos.clear(); for (const [k,v] of copia) productos.set(k,v); estado = anterior; throw e; }
  });
  t.mock.method(repo, "consultarEstado", async () => estado);
  t.mock.method(repo, "guardarProducto", async (p, db) => { assert.equal(db, tx); escrituras++; productos.set(p.itemCode, { ...p }); });
  t.mock.method(repo, "guardarEstado", async (e, db) => { assert.equal(db, tx); estado = { ...e, actualizadoEn: new Date() }; });
  return { productos, estado: () => estado, escrituras: () => escrituras };
}
const enviar = (body, token = process.env.BRIDGE_API_KEY) => fetch(`${url}/integracion/productos`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test("HTTP autentica puente, conserva ceros y acepta reintento sin duplicar", async (t) => {
  const f = preparar(t);
  const primera = await enviar(lote()); assert.equal(primera.status, 200);
  assert.deepEqual(await primera.json(), { data: { secuencia: 1, recibidos: 1, repetido: false } });
  const repetida = await enviar(lote()); assert.equal(repetida.status, 200);
  assert.equal((await repetida.json()).data.repetido, true);
  assert.equal(f.productos.get("P1").barCode, "001234"); assert.equal(f.escrituras(), 1);
  const estado = await fetch(`${url}/integracion/productos/estado`, { headers: { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` } });
  assert.equal(estado.status, 200); assert.equal((await estado.json()).data.ultimaSecuencia, 1);
});
for (const token of [null, "incorrecta"]) {
  test(`rechaza token ${token} sin acceder a persistencia`, async (t) => {
    const f = preparar(t); assert.equal((await enviar(lote(), token)).status, 401); assert.equal(f.escrituras(), 0);
  });
}
test("API key de la aplicación no autoriza enviar datos", async () => {
  const r = await fetch(`${url}/integracion/productos`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": "clave-app" }, body: JSON.stringify(lote()) });
  assert.equal(r.status, 401);
});
test("credencial de puente no autoriza rutas de negocio", async () => {
  const r = await fetch(`${url}/productos`, { headers: { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` } }); assert.equal(r.status, 401);
});
for (const config of [{}, { sapCompanyDb: empresa, bridgeApiKey: "corta" }]) {
  test("integración sin configuración segura queda cerrada", () => {
    let error; crearAutenticacionPuente(config)({}, {}, (e) => { error = e; }); assert.equal(error.statusCode, 503);
  });
}
for (const [nombre, cambio] of [
  ["otro origen", { empresa: "PRODUCCION" }],
  ["duplicados", { productos: [producto, producto] }],
  ["campos desconocidos", { productos: [{ ...producto, cantidadEscaneada: 4 }] }],
  ["booleano incorrecto", { productos: [{ ...producto, valid: "tYES" }] }],
  ["campo ausente", { productos: [{ itemCode: "P1", itemName: "A" }] }],
  ["código numérico", { productos: [{ ...producto, barCode: 1234 }] }],
  ["lote vacío", { productos: [] }],
  ["lote grande", { productos: Array.from({ length: 101 }, (_,i) => ({ ...producto, itemCode: `P${i}` })) }],
  ["secuencia fraccionaria", { secuencia: 1.2 }],
  ["versión desconocida", { version: 2 }],
]) {
  test(`HTTP rechaza ${nombre} antes de escribir`, async (t) => {
    const f = preparar(t); const r = await enviar(lote(cambio)); assert.equal(r.status, nombre === "otro origen" ? 403 : 400); assert.equal(f.escrituras(), 0);
  });
}
test("mismo número con otro contenido y saltos no cambian el catálogo", async (t) => {
  const f = preparar(t); await recibirProductos(lote(), empresa);
  await assert.rejects(recibirProductos(lote({ productos: [{ ...producto, itemName: "Otro" }] }), empresa), { code: "LOTE_MODIFICADO" });
  await assert.rejects(recibirProductos(lote({ secuencia: 3 }), empresa), { code: "SECUENCIA_INVALIDA" });
  assert.equal(f.escrituras(), 1);
});
test("lote siguiente actualiza producto y un lote antiguo se rechaza", async (t) => {
  const f = preparar(t); await recibirProductos(lote(), empresa);
  await recibirProductos(lote({ secuencia: 2, productos: [{ ...producto, itemName: "Nuevo", frozen: true, barCode: null }] }), empresa);
  assert.equal(f.productos.size, 1); assert.equal(f.productos.get("P1").barCode, null);
  await assert.rejects(recibirProductos(lote(), empresa), { code: "SECUENCIA_INVALIDA" });
  assert.equal(f.estado().secuencia, 2);
});
test("orden de productos no cambia la identidad del lote", async (t) => {
  const f = preparar(t); const productos = [producto, { ...producto, itemCode: "P2" }];
  await recibirProductos(lote({ productos }), empresa);
  assert.equal((await recibirProductos(lote({ productos: [...productos].reverse() }), empresa)).repetido, true);
  assert.equal(f.escrituras(), 2);
});
test("fallo de guardado de estado no confirma el lote ni sus productos", async (t) => {
  const f = preparar(t); t.mock.method(repo, "guardarEstado", async () => { throw new Error("Fallo privado"); });
  const r = await enviar(lote()); assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  assert.equal(f.productos.size, 0); assert.equal(f.estado(), null);
});
test("base vinculada a otra empresa no permite mezclar origen", async (t) => {
  preparar(t); t.mock.method(repo, "consultarEstado", async () => ({ empresa: "OTRA", secuencia: 1 }));
  await assert.rejects(recibirProductos(lote(), empresa), { code: "ORIGEN_INCOMPATIBLE" });
  await assert.rejects(consultarEstadoProductos(empresa), { code: "ORIGEN_INCOMPATIBLE" });
});
test("repositorio solo actualiza campos permitidos sin tocar relaciones", async (t) => {
  let consulta; await repo.guardarProducto(producto, { producto: { upsert: async (args) => { consulta = args; } } });
  assert.deepEqual(Object.keys(consulta.update).sort(), [...Object.keys(producto), "sincronizadoEn"].sort());
  assert.deepEqual(consulta.where, { itemCode: "P1" });
});

for (const [nombre, body, status, code] of [
  ["JSON dañado", "{", 400, "JSON_INVALIDO"],
  ["cuerpo excesivo", JSON.stringify({ texto: "x".repeat(1100000) }), 413, "CUERPO_DEMASIADO_GRANDE"],
]) {
  test(`HTTP identifica ${nombre} sin exponer su contenido`, async () => {
    const r = await fetch(`${url}/integracion/productos`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` }, body });
    assert.equal(r.status, status); assert.equal((await r.json()).error.code, code);
  });
}
