import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { pedidoSap } from "../fixtures/pedido.js";
import { construirLotePedidos } from "../../puente/pedidos.js";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.BRIDGE_API_KEY = "clave-ficticia-de-integracion-123456789";
process.env.SAP_COMPANY_DB = "XPRUEBAS2026";
const { default: app } = await import("../../src/app.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { sincronizacionRepository: repo } = await import("../../src/modules/sincronizacion/sincronizacion.repository.js");
const { recibirLote, consultarEstadoLote } = await import("../../src/modules/sincronizacion/sincronizacion.service.js");
const recibirProductos = (lote, empresa) => recibirLote("productos", lote, empresa);
const consultarEstadoProductos = (empresa) => consultarEstadoLote("productos", empresa);
const { crearAutenticacionPuente } = await import("../../src/middleware/bridgeAuth.js");
logger.level = "silent";
let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });
const producto = { itemCode: "P1", itemName: "Champú", barCode: "001234", valid: true, frozen: false };
const lote = (extra = {}) => ({ version: 1, empresa: "XPRUEBAS2026", secuencia: 1, productos: [{ ...producto }], ...extra });
const empresa = "XPRUEBAS2026";

test("HTTP recibe pedidos, confirma reintento y rechaza otra empresa o contrato incompleto", async (t) => {
  preparar(t);
  let guardados = 0;
  t.mock.method(repo, "guardarPedido", async () => { guardados++; });
  const lote = construirLotePedidos([pedidoSap()], empresa, 1);
  assert.equal((await enviarA("pedidos", lote)).status, 200);
  const repetir = await enviarA("pedidos", lote);
  assert.equal((await repetir.json()).data.repetido, true);
  assert.equal(guardados, 1);
  assert.equal((await enviarA("pedidos", { ...lote, empresa: "OTRA" })).status, 403);
  const incompleto = structuredClone(lote); delete incompleto.pedidos[0].lineas;
  assert.equal((await enviarA("pedidos", incompleto)).status, 400);
  assert.equal(guardados, 1);
});
test("fallo del receptor de pedidos no avanza secuencia", async (t) => {
  const f = preparar(t);
  t.mock.method(repo, "guardarPedido", async () => { throw new Error("fallo privado"); });
  const r = await enviarA("pedidos", construirLotePedidos([pedidoSap()], empresa, 1));
  assert.equal(r.status, 500); assert.equal(f.estado(), null);
  assert.ok(!(await r.text()).includes("privado"));
});
function preparar(t) {
  let estado = null; const productos = new Map(); const tx = {}; let escrituras = 0;
  t.mock.method(repo, "conBloqueo", async (fn) => {
    const copia = structuredClone([...productos]); const anterior = estado;
    try { return await fn(tx); } catch (e) { productos.clear(); for (const [k,v] of copia) productos.set(k,v); estado = anterior; throw e; }
  });
  t.mock.method(repo, "consultarEstado", async () => estado);
  t.mock.method(repo, "existeOtraEmpresa", async () => false);
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

const cliente = { cardCode: "C0001", cardName: "Cliente de prueba", valid: true, frozen: false };
const loteClientes = (extra = {}) => ({ version: 1, empresa, secuencia: 1, clientes: [{ ...cliente }], ...extra });
const enviarA = (entidad, body) => fetch(`${url}/integracion/${entidad}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` }, body: JSON.stringify(body) });
function prepararClientes(t) {
  const f = preparar(t); const clientes = new Map();
  t.mock.method(repo, "guardarCliente", async (c) => { clientes.set(c.cardCode, { ...c }); });
  return { ...f, clientes };
}
test("HTTP recibe clientes con su propia secuencia y reintento sin duplicar", async (t) => {
  const f = prepararClientes(t);
  const r = await enviarA("clientes", loteClientes()); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { data: { secuencia: 1, recibidos: 1, repetido: false } });
  assert.equal((await (await enviarA("clientes", loteClientes())).json()).data.repetido, true);
  assert.deepEqual(f.clientes.get("C0001"), cliente); assert.equal(f.estado().entidad, "clientes");
  const estado = await fetch(`${url}/integracion/clientes/estado`, { headers: { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` } });
  assert.equal((await estado.json()).data.ultimaSecuencia, 1);
});
for (const [nombre, cambio] of [
  ["cliente repetido", { clientes: [cliente, cliente] }],
  ["campos de otra entidad", { clientes: [{ ...cliente, itemCode: "P1" }] }],
  ["nombre vacío", { clientes: [{ ...cliente, cardName: "  " }] }],
  ["código con espacios", { clientes: [{ ...cliente, cardCode: " C0001" }] }],
  ["lote con productos", { clientes: undefined, productos: [producto] }],
]) {
  test(`HTTP rechaza clientes: ${nombre}`, async (t) => {
    const f = prepararClientes(t); assert.equal((await enviarA("clientes", loteClientes(cambio))).status, 400); assert.equal(f.clientes.size, 0);
  });
}
test("una base vinculada a otra empresa rechaza cualquier entidad", async (t) => {
  prepararClientes(t); t.mock.method(repo, "existeOtraEmpresa", async () => true);
  await assert.rejects(recibirLote("clientes", loteClientes(), empresa), { code: "ORIGEN_INCOMPATIBLE" });
  await assert.rejects(consultarEstadoLote("clientes", empresa), { code: "ORIGEN_INCOMPATIBLE" });
});
test("entidad sin contrato no tiene ruta y el servicio la rechaza", async (t) => {
  prepararClientes(t);
  assert.equal((await enviarA("sin-contrato", { version: 1 })).status, 404);
  await assert.rejects(recibirLote("constructor", loteClientes(), empresa), { code: "ENTIDAD_DESCONOCIDA" });
});
test("repositorio de clientes solo actualiza campos del contrato", async () => {
  let consulta; await repo.guardarCliente(cliente, { cliente: { upsert: async (args) => { consulta = args; } } });
  assert.deepEqual(Object.keys(consulta.update).sort(), [...Object.keys(cliente), "sincronizadoEn"].sort());
  assert.deepEqual(consulta.where, { cardCode: "C0001" });
});
test("HTTP informa los pedidos abiertos con la hora del backend y exige la credencial del puente", async (t) => {
  preparar(t);
  const en = new Date("2026-09-28T10:00:00.000Z");
  t.mock.method(repo, "listarPedidosAbiertos", async () => [{ docEntry: 7, sincronizadoEn: en }]);
  const antes = Date.now();
  const r = await fetch(`${url}/integracion/pedidos/abiertos`, { headers: { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` } });
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.deepEqual(data.pedidos, [{ docEntry: 7, sincronizadoEn: en.toISOString() }]);
  assert.ok(Date.parse(data.ahora) >= antes - 1000 && Date.parse(data.ahora) <= Date.now());
  assert.equal((await fetch(`${url}/integracion/pedidos/abiertos`)).status, 401);
  t.mock.method(repo, "existeOtraEmpresa", async () => true);
  assert.equal((await fetch(`${url}/integracion/pedidos/abiertos`, { headers: { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` } })).status, 409);
});
