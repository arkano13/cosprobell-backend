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
function baseProductos({ anterior = null, activo = null, retirado = null } = {}) {
  const operaciones = [];
  const db = {
    producto: { findUnique: async () => anterior, upsert: async (args) => { operaciones.push(["producto", args]); } },
    productoCodigoBarras: {
      updateMany: async (args) => operaciones.push(["retirarFicha", args.where]),
      findFirst: async (args) => (args.where.retiradoEnSap === false ? activo : retirado),
      update: async (args) => operaciones.push(["actualizarCodigo", args.where.id, args.data]),
      create: async (args) => operaciones.push(["crearCodigo", args.data]),
    },
    $executeRaw: async () => operaciones.push(["existencias"]),
  };
  return { db, operaciones };
}
test("repositorio solo actualiza campos permitidos sin tocar relaciones", async () => {
  const { db, operaciones } = baseProductos();
  await repo.guardarProducto(producto, db);
  const [, consulta] = operaciones.find((o) => o[0] === "producto");
  assert.deepEqual(Object.keys(consulta.update).sort(), [...Object.keys(producto), "sincronizadoEn"].sort());
  assert.deepEqual(consulta.where, { itemCode: "P1" });
});
test("repositorio: el código de la ficha del artículo queda como código Manual sin duplicarse", async () => {
  const conCodigo = { ...producto, barCode: "7501234567890" };
  let { db, operaciones } = baseProductos();
  await repo.guardarProducto(conCodigo, db);
  assert.deepEqual(operaciones.find((o) => o[0] === "retirarFicha")[1],
    { itemCode: "P1", origen: "ficha", retiradoEnSap: false, codigo: { not: "7501234567890" } });
  const creado = operaciones.find((o) => o[0] === "crearCodigo")[1];
  assert.deepEqual({ ...creado, sincronizadoEn: creado.sincronizadoEn instanceof Date },
    { itemCode: "P1", codigo: "7501234567890", uomEntry: -1, origen: "ficha", sincronizadoEn: true });
  ({ db, operaciones } = baseProductos({ activo: { id: 3, origen: "app" } }));
  await repo.guardarProducto(conCodigo, db);
  assert.ok(!operaciones.some((o) => o[0] === "crearCodigo" || o[0] === "actualizarCodigo"), "ya existe desde la app: no se duplica");
  ({ db, operaciones } = baseProductos({ retirado: { id: 8 } }));
  await repo.guardarProducto(conCodigo, db);
  assert.equal(operaciones.find((o) => o[0] === "actualizarCodigo")[2].retiradoEnSap, false);
  ({ db, operaciones } = baseProductos());
  await repo.guardarProducto({ ...producto, barCode: null }, db);
  assert.deepEqual(operaciones.find((o) => o[0] === "retirarFicha")[1], { itemCode: "P1", origen: "ficha", retiradoEnSap: false });
  assert.ok(!operaciones.some((o) => o[0] === "crearCodigo"));
});
test("repositorio: un cambio de existencias en SAP avisa al inventario", async () => {
  let { db, operaciones } = baseProductos({ anterior: { quantityOnStock: 10 } });
  await repo.guardarProducto({ ...producto, quantityOnStock: 110 }, db);
  assert.ok(operaciones.some((o) => o[0] === "existencias"));
  ({ db, operaciones } = baseProductos({ anterior: { quantityOnStock: 10 } }));
  await repo.guardarProducto({ ...producto, quantityOnStock: 10 }, db);
  assert.ok(!operaciones.some((o) => o[0] === "existencias"), "sin cambio no avisa");
  ({ db, operaciones } = baseProductos({ anterior: { quantityOnStock: 10 } }));
  await repo.guardarProducto(producto, db);
  assert.ok(!operaciones.some((o) => o[0] === "existencias"), "un puente anterior no envía existencias");
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

const autorizado = { Authorization: `Bearer ${process.env.BRIDGE_API_KEY}` };
test("HTTP recibe unidades y códigos de barras con sus propias secuencias", async (t) => {
  const f = preparar(t); const unidades = [], codigos = [];
  t.mock.method(repo, "guardarUnidad", async (u) => { unidades.push(u); });
  t.mock.method(repo, "guardarCodigoBarras", async (c) => { codigos.push(c); });
  const r1 = await enviarA("unidades", { version: 1, empresa, secuencia: 1, unidades: [{ absEntry: 1, code: "UN", name: null }] });
  assert.equal(r1.status, 200);
  f.estado(); t.mock.method(repo, "consultarEstado", async () => null);
  const r2 = await enviarA("codigosBarras", { version: 1, empresa, secuencia: 1, codigosBarras: [{ absEntry: 9, itemCode: "P1", codigo: "0012345", uomEntry: 1 }] });
  assert.equal(r2.status, 200);
  assert.deepEqual(unidades, [{ absEntry: 1, code: "UN", name: null }]);
  assert.deepEqual(codigos, [{ absEntry: 9, itemCode: "P1", codigo: "0012345", uomEntry: 1 }]);
  for (const cuerpo of [
    { version: 1, empresa, secuencia: 1, unidades: [{ absEntry: -1, code: "Manual", name: null }] },
    { version: 1, empresa, secuencia: 1, codigosBarras: [{ absEntry: 9, itemCode: "P1", codigo: " 0012345", uomEntry: 1 }] },
    { version: 1, empresa, secuencia: 1, codigosBarras: [{ absEntry: 9, itemCode: "P1", codigo: "1", uomEntry: -2 }] },
  ]) assert.equal((await enviarA(Object.keys(cuerpo).at(-1), cuerpo)).status, 400);
});
test("HTTP hora y retiro de códigos: validan fecha y exigen la credencial del puente", async (t) => {
  preparar(t); let antesDe;
  t.mock.method(repo, "marcarCodigosRetirados", async (fecha) => { antesDe = fecha; return 2; });
  const hora = await (await fetch(`${url}/integracion/hora`, { headers: autorizado })).json();
  assert.ok(Number.isFinite(Date.parse(hora.data.ahora)));
  const retirar = (body, headers = autorizado) => fetch(`${url}/integracion/codigosBarras/retirados`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ok = await retirar({ antesDe: "2026-09-01T10:00:00.000Z" });
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { data: { retirados: 2 } });
  assert.equal(antesDe.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal((await retirar({})).status, 400);
  assert.equal((await retirar({ antesDe: "ayer" })).status, 400);
  assert.equal((await retirar({ antesDe: new Date(Date.now() + 3600000).toISOString() })).status, 400);
  assert.equal((await retirar({ antesDe: "2026-09-01T10:00:00.000Z" }, {})).status, 401);
});
test("repositorio: guarda un código de SAP, adopta la asociación local y exige el producto", async () => {
  const operaciones = []; let productoExiste = true, porAbsEntry = null, local = null;
  const db = {
    producto: { findUnique: async () => (productoExiste ? { itemCode: "P1" } : null) },
    productoCodigoBarras: {
      findUnique: async () => porAbsEntry, findFirst: async (args) => { operaciones.push(["buscarLocal", args.where]); return local; },
      update: async (args) => operaciones.push(["actualizar", args.where.id, args.data]),
      create: async (args) => operaciones.push(["crear", args.data]),
    },
  };
  const registro = { absEntry: 9, itemCode: "P1", codigo: "0012345", uomEntry: 1 };
  const sinFecha = (op) => op.map((v) => (v && typeof v === "object" ? { ...v, sincronizadoEn: v.sincronizadoEn instanceof Date } : v));
  await repo.guardarCodigoBarras(registro, db);
  assert.deepEqual(sinFecha(operaciones.at(-1)), ["crear", { itemCode: "P1", codigo: "0012345", uomEntry: 1, sincronizadoEn: true, retiradoEnSap: false, origen: "sap", sapAbsEntry: 9 }]);
  assert.deepEqual(operaciones.at(-2)[1], { sapAbsEntry: null, itemCode: "P1", codigo: "0012345", uomEntry: 1 });
  local = { id: 4 }; await repo.guardarCodigoBarras(registro, db);
  assert.deepEqual(sinFecha(operaciones.at(-1)), ["actualizar", 4, { itemCode: "P1", codigo: "0012345", uomEntry: 1, sincronizadoEn: true, retiradoEnSap: false, origen: "sap", sapAbsEntry: 9 }]);
  porAbsEntry = { id: 7 }; await repo.guardarCodigoBarras({ ...registro, codigo: "999" }, db);
  assert.deepEqual(sinFecha(operaciones.at(-1)), ["actualizar", 7, { itemCode: "P1", codigo: "999", uomEntry: 1, sincronizadoEn: true, retiradoEnSap: false, origen: "sap" }]);
  productoExiste = false;
  await assert.rejects(repo.guardarCodigoBarras(registro, db), { code: "PRODUCTO_NO_SINCRONIZADO" });
});
