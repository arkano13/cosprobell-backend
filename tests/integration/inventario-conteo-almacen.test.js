import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { operadoresRepository } = await import("../../src/modules/operadores/operadores.repository.js");
const { inventarioRepository: repo } = await import("../../src/modules/inventario/inventario.repository.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

const TOKEN = "d".repeat(64);
function conSesion(t, rol = "operador") {
  t.mock.method(operadoresRepository, "buscarSesion", async (tokenHash) => (tokenHash === hashApiKey(TOKEN)
    ? { id: 5, cerradaEn: null, expiraEn: new Date(Date.now() + 3600000), operador: { id: 9, nombre: "Luis Pérez", activo: true, rol } } : null));
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}
const pedir = (ruta, headers, opciones = {}) => fetch(`${url}${ruta}`, { headers, ...opciones });
const enviar = (ruta, headers, metodo, cuerpo) => pedir(ruta, headers, { method: metodo, body: JSON.stringify(cuerpo) });

// La 03 (sueltas) y la 04 (cajas) elegidas para contar; conteos en memoria.
function almacenes(t, { soloConteo = [{ almacen: "03", tipo: "sueltas" }, { almacen: "04", tipo: "cajas" }] } = {}) {
  const conteos = new Map();
  const opciones = { almacenesSoloConteo: soloConteo, almacenesPorBodega: { grande: "01", pequena: "02" } };
  t.mock.method(repo, "opcion", async (clave) => opciones[clave] ?? null);
  t.mock.method(repo, "nombresDeAlmacenes", async (codigos) => new Map(codigos.map((c) => [c, `Almacén ${c}`])));
  t.mock.method(repo, "conProducto", async (_itemCodes, op) => op({}));
  t.mock.method(repo, "existeProducto", async (itemCode) => itemCode !== "NO-EXISTE");
  t.mock.method(repo, "conteoAlmacenProducto", async (almacen, itemCode) => conteos.get(`${almacen}|${itemCode}`) ?? null);
  t.mock.method(repo, "guardarConteoAlmacen", async (datos) => conteos.set(`${datos.almacen}|${datos.itemCode}`, { ...datos, lineas: datos.lineas }));
  t.mock.method(repo, "conteoAlmacen", async (almacen) => [
    { itemCode: "P1", itemName: "Shampoo", sap: 50, unidades: conteos.get(`${almacen}|P1`)?.unidades ?? 0, cajas: 0, contado: conteos.has(`${almacen}|P1`), codigos: 1 },
    { itemCode: "P2", itemName: "Acondicionador", sap: 12, unidades: 0, cajas: 0, contado: false, codigos: 0 },
  ]);
  return { conteos, opciones };
}

test("conteo de la 03: lista con avance, solo de almacenes elegidos para contar", async (t) => {
  const headers = conSesion(t);
  almacenes(t);
  const r = await pedir("/inventario/conteo-almacenes/03?estado=todos", headers);
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.deepEqual(cuerpo.almacen, { almacen: "03", nombre: "Almacén 03", tipo: "sueltas" });
  assert.deepEqual(cuerpo.avance, { total: 2, contados: 0 });
  assert.equal(cuerpo.sinCodigo, 1);
  const otro = await pedir("/inventario/conteo-almacenes/05", headers);
  assert.equal(otro.status, 404);
  assert.equal((await otro.json()).error.code, "ALMACEN_NO_ES_DE_CONTEO");
});

test("la 03 se cuenta por lote: cualquiera cuenta una vez y el supervisor corrige", async (t) => {
  const operador = conSesion(t);
  const { conteos } = almacenes(t);
  const cuerpo = { lotes: [{ unidades: 30, lote: "L1", vencimiento: "2027-03-31" }, { unidades: 10, lote: null }] };
  const r = await enviar("/inventario/conteo-almacenes/03/productos/P1", operador, "PUT", { operacionId: randomUUID(), ...cuerpo });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data, { almacen: "03", itemCode: "P1", unidades: 40, cajas: 0, antes: null });
  const guardado = conteos.get("03|P1");
  assert.equal(guardado.quien, "operador:Luis Pérez");
  assert.deepEqual(guardado.lineas.map((l) => [l.lote, l.vencimiento?.toISOString().slice(0, 10) ?? null, l.cajas, l.unidades]),
    [["L1", "2027-03-31", null, 30], [null, null, null, 10]]);
  const otraVez = await enviar("/inventario/conteo-almacenes/03/productos/P1", operador, "PUT", { operacionId: randomUUID(), lotes: [] });
  assert.equal(otraVez.status, 403);
  assert.equal((await otraVez.json()).error.code, "CONTEO_YA_HECHO");
  t.mock.restoreAll();
  const supervisor = conSesion(t, "supervisor");
  almacenes(t).conteos.set("03|P1", guardado);
  const corregido = await enviar("/inventario/conteo-almacenes/03/productos/P1", supervisor, "PUT", { operacionId: randomUUID(), lotes: [] });
  assert.equal(corregido.status, 200);
  assert.deepEqual((await corregido.json()).data, { almacen: "03", itemCode: "P1", unidades: 0, cajas: 0, antes: 40 });
});

test("la 04 se cuenta por cajas con bulto; mandar lotes a la 04 o cajas a la 03 se rechaza", async (t) => {
  const headers = conSesion(t);
  const { conteos } = almacenes(t);
  const r = await enviar("/inventario/conteo-almacenes/04/productos/P1", headers, "PUT", { operacionId: randomUUID(),
    grupos: [{ cajas: 3, unidadesPorCaja: 12, lote: "A", vencimiento: "2027-01-31" }, { cajas: 1, unidadesPorCaja: 6, lote: "B" }],
    bulto: { unidades: 4, lote: "B" } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data, { almacen: "04", itemCode: "P1", unidades: 46, cajas: 4, antes: null });
  assert.deepEqual(conteos.get("04|P1").lineas.map((l) => [l.lote, l.cajas, l.unidadesPorCaja, l.unidades]),
    [["A", 3, 12, 36], ["B", 1, 6, 6], ["B", null, null, 4]]);
  const mal = await enviar("/inventario/conteo-almacenes/04/productos/P2", headers, "PUT", { operacionId: randomUUID(), lotes: [{ unidades: 3 }] });
  assert.equal(mal.status, 400);
  assert.equal((await mal.json()).error.code, "CONTEO_NO_CORRESPONDE");
  const mal2 = await enviar("/inventario/conteo-almacenes/03/productos/P2", headers, "PUT", { operacionId: randomUUID(), grupos: [] });
  assert.equal(mal2.status, 400);
  const sinProducto = await enviar("/inventario/conteo-almacenes/03/productos/NO-EXISTE", headers, "PUT", { operacionId: randomUUID(), lotes: [] });
  assert.equal(sinProducto.status, 404);
  const anio = await enviar("/inventario/conteo-almacenes/03/productos/P2", headers, "PUT", { operacionId: randomUUID(), lotes: [{ unidades: 2, vencimiento: "0008-09-30" }] });
  assert.equal(anio.status, 400);
});

test("ficha del conteo: SAP del almacén, lo contado por lote y quién", async (t) => {
  const headers = conSesion(t);
  const { conteos } = almacenes(t);
  conteos.set("04|P1", { unidades: 40, cajas: 3, contadoPor: "operador:Ana", contadoEn: new Date("2026-10-09T15:00:00Z"),
    actualizadoPor: "operador:Ana", actualizadoEn: new Date("2026-10-09T15:00:00Z"),
    lineas: [{ lote: "A", vencimiento: new Date("2027-01-31T00:00:00Z"), cajas: 3, unidadesPorCaja: 12, unidades: 36 },
      { lote: null, vencimiento: null, cajas: null, unidadesPorCaja: null, unidades: 4 }] });
  t.mock.method(repo, "producto", async () => ({ itemCode: "P1", itemName: "Shampoo", codigosBarras: [{ id: 1, codigo: "779", origen: "sap" }], codigosCaja: [] }));
  t.mock.method(repo, "sapEnAlmacen", async (_item, almacen) => (almacen === "04" ? 48 : 0));
  t.mock.method(repo, "ultimaRecepcion", async () => ({ unidadesIniciales: 12 }));
  const r = await pedir("/inventario/conteo-almacenes/04/productos/P1", headers);
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.equal(data.sap, 48);
  assert.equal(data.contado, true);
  assert.equal(data.contadoPor, "Ana");
  assert.deepEqual(data.lineas, [{ lote: "A", vencimiento: "2027-01-31", cajas: 3, unidadesPorCaja: 12, unidades: 36 },
    { lote: null, vencimiento: null, cajas: null, unidadesPorCaja: null, unidades: 4 }]);
  assert.deepEqual(data.sugerencia, { unidadesPorCaja: 12 });
});

test("almacenes: la 03 y la 04 se eligen para contar, sin marcarlas como de esta bodega", async (t) => {
  const headers = conSesion(t, "supervisor");
  const { opciones } = almacenes(t, { soloConteo: [] });
  t.mock.method(repo, "almacenes", async () => ["01", "02", "03", "04"].map((c) => ({ warehouseCode: c, warehouseName: `Almacén ${c}`, deEstaBodega: ["01", "02"].includes(c) })));
  t.mock.method(repo, "almacenesDeEstaBodega", async () => ["01", "02"]);
  const guardadas = {};
  t.mock.method(repo, "transaccion", async (op) => op({}));
  t.mock.method(repo, "marcarAlmacenes", async () => {});
  t.mock.method(repo, "guardarOpcion", async (clave, valor) => { guardadas[clave] = valor; opciones[clave] = valor; });
  const base = { almacenes: ["01", "02"], pedidosSoloDeEstaBodega: false };
  const marcada = await enviar("/supervisor/almacenes", headers, "PUT", { ...base, almacenes: ["01", "02", "03"], soloConteo: [{ almacen: "03", tipo: "sueltas" }] });
  assert.equal(marcada.status, 400);
  assert.equal((await marcada.json()).error.code, "ALMACEN_SOLO_CONTEO_MARCADO");
  const r = await enviar("/supervisor/almacenes", headers, "PUT", { ...base, soloConteo: [{ almacen: "03", tipo: "sueltas" }, { almacen: "04", tipo: "cajas" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(guardadas.almacenesSoloConteo, [{ almacen: "03", tipo: "sueltas" }, { almacen: "04", tipo: "cajas" }]);
  assert.deepEqual((await r.json()).data.soloConteo, [{ almacen: "03", tipo: "sueltas" }, { almacen: "04", tipo: "cajas" }]);
  // Una app anterior no manda soloConteo: queda como estaba (salvo que ahora se marque como de esta bodega).
  await enviar("/supervisor/almacenes", headers, "PUT", { ...base, almacenes: ["01", "02", "04"] });
  assert.deepEqual(guardadas.almacenesSoloConteo, [{ almacen: "03", tipo: "sueltas" }]);
  const desconocido = await enviar("/supervisor/almacenes", headers, "PUT", { ...base, soloConteo: [{ almacen: "99", tipo: "cajas" }] });
  assert.equal(desconocido.status, 400);
});

test("la 04 con sueltas de varios lotes: una línea por lote", async (t) => {
  const headers = conSesion(t);
  const { conteos } = almacenes(t);
  const r = await enviar("/inventario/conteo-almacenes/04/productos/P1", headers, "PUT", { operacionId: randomUUID(),
    grupos: [{ cajas: 1, unidadesPorCaja: 72, lote: "MIX" }], bultos: [{ unidades: 18, lote: "T1", vencimiento: "2027-05-31" }, { unidades: 24, lote: "T2" }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data, { almacen: "04", itemCode: "P1", unidades: 114, cajas: 1, antes: null });
  assert.deepEqual(conteos.get("04|P1").lineas.map((l) => [l.lote, l.cajas, l.unidades]), [["MIX", 1, 72], ["T1", null, 18], ["T2", null, 24]]);
  const enLa03 = await enviar("/inventario/conteo-almacenes/03/productos/P2", headers, "PUT", { operacionId: randomUUID(), bultos: [{ unidades: 2 }] });
  assert.equal(enLa03.status, 400);
});
