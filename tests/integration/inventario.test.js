import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { operadoresRepository } = await import("../../src/modules/operadores/operadores.repository.js");
const { inventarioRepository: repo } = await import("../../src/modules/inventario/inventario.repository.js");
const { codigosRepository } = await import("../../src/modules/etiquetas/codigos.service.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

const TOKEN = "c".repeat(64);
function conSesion(t, rol = "operador") {
  t.mock.method(operadoresRepository, "buscarSesion", async (tokenHash) => (tokenHash === hashApiKey(TOKEN)
    ? { id: 5, cerradaEn: null, expiraEn: new Date(Date.now() + 3600000), operador: { id: 9, nombre: "Luis Pérez", activo: true, rol } } : null));
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}
const pedir = (ruta, headers, opciones = {}) => fetch(`${url}${ruta}`, { headers, ...opciones });
const enviar = (ruta, headers, metodo, cuerpo) => pedir(ruta, headers, { method: metodo, body: JSON.stringify((ruta.startsWith("/inventario/") ? { operacionId: randomUUID(), ...cuerpo } : cuerpo)) });

test("recepción local: funciona sin almacenes SAP y conserva la operación para deduplicar", async (t) => {
  const hecho = inventario(t, { almacenes: [] });
  const operacionId = randomUUID();
  const r = await enviar("/inventario/recepciones", conSesion(t), "POST", {
    operacionId, itemCode: "P1", modo: "suelto", destino: "pequena", unidades: 12,
  });
  assert.equal(r.status, 201);
  assert.deepEqual(hecho.pequena, [12]);
  assert.deepEqual(hecho.adelantado, []);
  assert.equal(repo.conProducto.mock.calls[0].arguments[2].operacionId, operacionId);
});

test("conteo local: funciona sin almacenes ni existencias SAP", async (t) => {
  const hecho = inventario(t, { almacenes: [], pequena: 2 });
  const r = await enviar("/inventario/productos/P1/pequena", conSesion(t, "supervisor"), "PUT", { unidades: 8 });
  assert.equal(r.status, 200);
  assert.deepEqual(hecho.pequena, [6]);
});

test("movimiento sin operacionId se rechaza antes de tocar inventario", async (t) => {
  const hecho = inventario(t);
  const r = await pedir("/inventario/recepciones", conSesion(t), { method: "POST",
    body: JSON.stringify({ itemCode: "P1", modo: "suelto", destino: "pequena", unidades: 12 }) });
  assert.equal(r.status, 400);
  assert.deepEqual(hecho.movimientos, []);
});

test("comparación SAP: existencias no disponibles bloquean descuentos basados en diferencias", async (t) => {
  inventario(t);
  t.mock.method(repo, "comparacionDisponible", async () => false);
  const r = await pedir("/inventario/pendientes", conSesion(t));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "COMPARACION_SAP_NO_DISPONIBLE");
});

// Inventario falso: un producto con lo que SAP tiene en los almacenes elegidos y lo que hay en cada bodega.
function inventario(t, { sap = 0, grande = 0, pequena = 0, activo = true, sapCambioEn = null, cajas = [], almacenes = ["01"] } = {}) {
  const estado = { itemCode: "P1", itemName: "Shampoo", sap, activo, pequena, adelantado: 0, sapCambioEn, grande, sinEntrega: 0 };
  const hecho = { cajas: [], movimientos: [], pequena: [], adelantado: [], cajaCambios: [], descuentos: [] };
  const tx = {};
  t.mock.method(repo, "almacenesDeEstaBodega", async () => almacenes);
  t.mock.method(repo, "comparacionDisponible", async () => almacenes.length > 0);
  t.mock.method(repo, "conProducto", async (_itemCodes, op) => op(tx));
  t.mock.method(repo, "estados", async () => [estado]);
  t.mock.method(repo, "activar", async () => {});
  t.mock.method(repo, "sumarAdelantado", async (itemCode, unidades) => hecho.adelantado.push(unidades));
  let siguiente = 120;
  t.mock.method(repo, "reservarIdsCajas", async (n) => Array.from({ length: n }, () => ({ id: siguiente++ })));
  t.mock.method(repo, "crearCajas", async (lista) => hecho.cajas.push(...lista));
  t.mock.method(repo, "registrarMovimientos", async (lista) => hecho.movimientos.push(...lista));
  t.mock.method(repo, "cambiarPequena", async (itemCode, delta) => hecho.pequena.push(delta));
  t.mock.method(repo, "estadoProducto", async () => ({ itemCode: "P1", pequena }));
  const saldos = [{ id: 71, itemCode: "P1", lote: null, vencimiento: null, unidades: pequena }];
  t.mock.method(repo, "lotesPequena", async () => saldos.filter(s => s.unidades > 0).map(s => ({ ...s })));
  t.mock.method(repo, "sumarLotePequena", async (itemCode, lote, vencimiento, unidades) => {
    let fila = saldos.find(s => s.lote === (lote ?? null));
    if (!fila) { fila = { id: saldos.length + 71, itemCode, lote: lote ?? null, vencimiento, unidades: 0 }; saldos.push(fila); }
    fila.unidades += unidades; return { ...fila };
  });
  t.mock.method(repo, "cambiarLotePequena", async (id, itemCode, delta) => {
    const fila = saldos.find(s => s.id === id); if (!fila || fila.unidades + delta < 0) return null;
    fila.unidades += delta; return { ...fila };
  });
  t.mock.method(repo, "cajasDeLoteBloqueadas", async (itemCode, lote) => cajas.filter((c) => c.lote === lote));
  t.mock.method(repo, "cambiarUnidadesCaja", async (id, delta) => hecho.cajaCambios.push([id, delta]));
  t.mock.method(repo, "documentosRecientes", async () => [{ itemCode: "P1", tipo: "salidaInventario", docNum: 1377 }]);
  t.mock.method(repo, "crearDescuento", async (datos) => { hecho.descuentos.push(datos); return { id: 31, ...datos }; });
  return hecho;
}

test("inventario: requiere credenciales; un operador consulta y recibe", async (t) => {
  assert.equal((await pedir("/inventario/resumen")).status, 401);
  inventario(t, { sap: 100 });
  t.mock.method(repo, "resumenBodegas", async () => ({ grande: { cajas: 0 }, pequena: { unidades: 0 } }));
  t.mock.method(repo, "porVencer", async () => []);
  t.mock.method(repo, "movimientos", async () => []);
  const r = await pedir("/inventario/resumen", conSesion(t));
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.deepEqual(data.almacenes, ["01"]);
  assert.equal(data.pendientes.porUbicar, 1);
});

test("inventario: sin almacenes elegidos no se compara con SAP", async (t) => {
  inventario(t, { almacenes: [] });
  const r = await pedir("/inventario/pendientes", conSesion(t));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "ALMACENES_SIN_ELEGIR");
});

test("lista de productos: todo lo de las bodegas, con búsqueda, filtros y páginas", async (t) => {
  const fila = (itemCode, itemName, datos) => ({ itemCode, itemName, sap: 0, activo: true, pequena: 0, adelantado: 0, sapCambioEn: null,
    grande: 0, cajas: 0, sinEntrega: 0, ...datos });
  const filas = [
    fila("A1", "Acondicionador", { sap: 48, activo: false }),
    fila("C1", "Crema", { grande: 40, cajas: 2, pequena: 5, sap: 45 }),
    fila("J1", "Jabón", { pequena: -2 }),
    fila("S1", "Shampoo", { grande: 60, cajas: 3, pequena: 10, sap: 80 }),
    fila("Z1", "Sin nada", {}),
  ];
  let almacenes = ["01", "02"], comparar = true;
  t.mock.method(repo, "almacenesDeEstaBodega", async () => almacenes);
  t.mock.method(repo, "comparacionDisponible", async () => comparar);
  t.mock.method(repo, "existenciasSapAl", async () => new Date("2026-10-02T15:00:00Z"));
  t.mock.method(repo, "estados", async () => filas);
  const headers = conSesion(t);
  const r = await pedir("/inventario/existencias", headers);
  assert.equal(r.status, 200);
  const todo = await r.json();
  // Lo que no tiene nada en ninguna bodega ni en SAP no aparece.
  assert.deepEqual(todo.data.map((v) => v.itemCode), ["A1", "C1", "J1", "S1"]);
  assert.deepEqual(todo.conteos, { todos: 4, grande: 2, pequena: 3, solo_sap: 1, diferencia: 2 });
  assert.deepEqual(todo.data[3], { itemCode: "S1", itemName: "Shampoo", grande: 60, cajas: 3, pequena: 10, sinEntrega: 0, sap: 80,
    estado: "por_ubicar", diferencia: 10 });
  assert.equal(todo.data[0].estado, "conteo_inicial");
  assert.equal(todo.existenciasSapAl, "2026-10-02T15:00:00.000Z");
  const filtrar = async (query) => (await (await pedir(`/inventario/existencias?${query}`, headers)).json());
  assert.deepEqual((await filtrar("filtro=solo_sap")).data.map((v) => v.itemCode), ["A1"]);
  assert.deepEqual((await filtrar("filtro=diferencia")).data.map((v) => v.itemCode), ["J1", "S1"]);
  assert.deepEqual((await filtrar("buscar=CREM")).data.map((v) => v.itemCode), ["C1"]);
  const pagina = await filtrar("limit=2&pagina=1");
  assert.deepEqual([pagina.data.map((v) => v.itemCode), pagina.total], [["J1", "S1"], 4]);
  // Sin comparación: SAP se muestra (con su fecha) pero sin estado; sin almacenes marcados, sin SAP.
  comparar = false;
  const sinComparar = await filtrar("filtro=todos");
  assert.deepEqual([sinComparar.data[3].sap, sinComparar.data[3].estado, sinComparar.conteos.diferencia], [80, null, 0]);
  almacenes = [];
  const sinAlmacenes = await filtrar("filtro=todos");
  assert.deepEqual([sinAlmacenes.data[0].sap, sinAlmacenes.conteos.solo_sap], [null, 0]);
  assert.equal((await pedir("/inventario/existencias?filtro=otro", headers)).status, 400);
});

test("recibir en cajas: hasta lo que SAP tiene por ubicar; más, solo confirmando que llegó antes", async (t) => {
  const hecho = inventario(t, { sap: 100 });
  const headers = conSesion(t);
  const pedido = { itemCode: "P1", modo: "cajas", cajas: 6, unidadesPorCaja: 20, lote: "L2409", vencimiento: "2027-03-31" };
  const excede = await enviar("/inventario/recepciones", headers, "POST", pedido);
  assert.equal(excede.status, 409);
  assert.match((await excede.json()).error.message, /SAP tiene 100 por ubicar y estás recibiendo 120/);
  assert.equal(hecho.cajas.length, 0);

  const r = await enviar("/inventario/recepciones", headers, "POST", { ...pedido, adelantar: true });
  assert.equal(r.status, 201);
  const { data } = await r.json();
  assert.deepEqual(data.cajas.map((c) => c.codigo), ["CJ-000120", "CJ-000121", "CJ-000122", "CJ-000123", "CJ-000124", "CJ-000125"]);
  assert.equal(data.cajas[0].vencimiento, "2027-03-31");
  assert.ok(Number.isFinite(Date.parse(data.cajas[0].recibidaEn)), "la etiqueta lleva la fecha de recepción");
  assert.equal(data.adelantado, 20);
  assert.deepEqual(hecho.adelantado, [20]);
  assert.equal(hecho.movimientos.length, 6);
  assert.ok(hecho.movimientos.every((m) => m.hechoPor === "operador:Luis Pérez" && m.cantidad === 20 && m.bodega === "grande"));
});

test("recibir: datos inválidos se rechazan antes de tocar el inventario", async (t) => {
  const hecho = inventario(t, { sap: 100 });
  const headers = conSesion(t);
  for (const cuerpo of [
    { itemCode: "P1", modo: "cajas", cajas: 0, unidadesPorCaja: 20 },
    { itemCode: "P1", modo: "cajas", cajas: 2, unidadesPorCaja: 20, vencimiento: "2027-02-30" },
    { itemCode: "P1", modo: "suelto", unidades: 5 },
    { itemCode: "P1", modo: "suelto", unidades: 5, destino: "pequena", extra: 1 },
  ]) assert.equal((await enviar("/inventario/recepciones", headers, "POST", cuerpo)).status, 400, JSON.stringify(cuerpo));
  assert.equal(hecho.cajas.length + hecho.pequena.length, 0);
});

test("recibir suelto a la pequeña suma unidades sin crear cajas", async (t) => {
  const hecho = inventario(t, { sap: 12 });
  const r = await enviar("/inventario/recepciones", conSesion(t), "POST", { itemCode: "P1", modo: "suelto", unidades: 12, destino: "pequena" });
  assert.equal(r.status, 201);
  assert.deepEqual(hecho.pequena, [12]);
  assert.equal(hecho.cajas.length, 0);
});

test("descontar: la bodega elige los lotes; la cantidad tiene que ser la que SAP descontó", async (t) => {
  const cajas = [{ id: 1, codigo: "CJ-000001", lote: "L1", unidades: 20, unidadesIniciales: 20 },
    { id: 2, codigo: "CJ-000002", lote: "L1", unidades: 20, unidadesIniciales: 20 },
    { id: 3, codigo: "CJ-000003", lote: "L2", unidades: 20, unidadesIniciales: 20 }];
  const hecho = inventario(t, { sap: 30, grande: 60, pequena: 10, cajas });
  const headers = conSesion(t);
  const cambio = await enviar("/inventario/descuentos", headers, "POST", { itemCode: "P1", unidades: 30, asignaciones: [{ tipo: "lote", lote: "L1", unidades: 30 }] });
  assert.equal(cambio.status, 409);
  assert.equal((await cambio.json()).error.code, "CANTIDAD_CAMBIO");
  const incompleta = await enviar("/inventario/descuentos", headers, "POST", { itemCode: "P1", unidades: 40, asignaciones: [{ tipo: "lote", lote: "L1", unidades: 30 }] });
  assert.equal(incompleta.status, 400);
  const repetida = await enviar("/inventario/descuentos", headers, "POST", { itemCode: "P1", unidades: 40,
    asignaciones: [{ tipo: "lote", lote: "L1", unidades: 20 }, { tipo: "lote", lote: "L1", unidades: 20 }] });
  assert.equal(repetida.status, 400);

  const r = await enviar("/inventario/descuentos", headers, "POST", { itemCode: "P1", unidades: 40,
    asignaciones: [{ tipo: "lote", lote: "L1", unidades: 35 }, { tipo: "pequena", unidades: 5 }] });
  assert.equal(r.status, 201);
  assert.deepEqual((await r.json()).data.retirar, [{ codigo: "CJ-000001", unidades: 20, lote: "L1" }, { codigo: "CJ-000002", unidades: 15, lote: "L1" }]);
  assert.deepEqual(hecho.cajaCambios, [[1, -20], [2, -15]]);
  assert.deepEqual(hecho.pequena, [-5]);
  assert.equal(hecho.descuentos[0].documentos, "Salida de mercancías 1377");
  assert.ok(hecho.movimientos.every((m) => m.descuentoId === 31));
});

test("descontar mientras SAP se actualiza: esperar", async (t) => {
  inventario(t, { sap: 20, grande: 60, sapCambioEn: new Date() });
  const r = await enviar("/inventario/descuentos", conSesion(t), "POST", { itemCode: "P1", unidades: 40, asignaciones: [{ tipo: "pequena", unidades: 40 }] });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "SAP_ACTUALIZANDO");
});

test("cambiar lote, contar la pequeña y corregir una caja: solo el supervisor", async (t) => {
  inventario(t, { sap: 10, pequena: 10 });
  const operador = conSesion(t, "operador");
  assert.equal((await enviar("/inventario/descuentos/3/reasignacion", operador, "POST", { asignaciones: [{ tipo: "pequena", unidades: 1 }] })).status, 403);
  assert.equal((await enviar("/inventario/productos/P1/pequena", operador, "PUT", { unidades: 8 })).status, 403);
  assert.equal((await enviar("/inventario/cajas/4/unidades", operador, "PUT", { unidades: 19 })).status, 403);
  t.mock.restoreAll();

  const hecho = inventario(t, { sap: 10, pequena: 10 });
  const supervisor = conSesion(t, "supervisor");
  const r = await enviar("/inventario/productos/P1/pequena", supervisor, "PUT", { unidades: 8 });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data, { itemCode: "P1", pequena: 8, cambio: -2 });
  assert.deepEqual(hecho.pequena, [-2]);
  assert.equal(hecho.movimientos[0].tipo, "conteo");
  assert.equal(hecho.movimientos[0].hechoPor, "operador:Luis Pérez");
});

test("cambiar lote: devuelve lo restado y lo resta del lote elegido", async (t) => {
  const cajas = [{ id: 1, codigo: "CJ-000001", lote: "L1", unidades: 0, unidadesIniciales: 20 },
    { id: 3, codigo: "CJ-000003", lote: "L2", unidades: 20, unidadesIniciales: 20 }];
  const hecho = inventario(t, { cajas });
  const previo = { id: 31, itemCode: "P1", unidades: 20, movimientos: [{ bodega: "grande", cantidad: -20, cajaId: 1, lote: "L1", caja: { codigo: "CJ-000001" } }] };
  t.mock.method(repo, "descuento", async () => previo);
  const corregido = [];
  t.mock.method(repo, "corregirDescuento", async (id, datos) => corregido.push([id, datos]));
  const r = await enviar("/inventario/descuentos/31/reasignacion", conSesion(t, "supervisor"), "POST", { asignaciones: [{ tipo: "lote", lote: "L2", unidades: 20 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(hecho.cajaCambios, [[1, 20], [3, -20]]);
  assert.equal(corregido[0][1].anterior, "L1: 20");
  assert.equal(corregido[0][1].corregidoPor, "operador:Luis Pérez");
});

test("panel: elegir almacenes solo con códigos conocidos y guardar el filtro de pedidos", async (t) => {
  const headers = conSesion(t, "supervisor");
  t.mock.method(repo, "almacenes", async () => [{ warehouseCode: "01" }, { warehouseCode: "V05" }, { warehouseCode: "BOD-CENTRAL" }]);
  t.mock.method(repo, "opcion", async () => true);
  const marcados = [], opciones = [];
  t.mock.method(repo, "transaccion", async (op) => op({}));
  t.mock.method(repo, "marcarAlmacenes", async (codigos) => marcados.push(codigos));
  t.mock.method(repo, "guardarOpcion", async (...args) => opciones.push(args.slice(0, 3)));
  const malo = await enviar("/supervisor/almacenes", headers, "PUT", { almacenes: ["01", "ZZ"], pedidosSoloDeEstaBodega: true });
  assert.equal(malo.status, 400);
  assert.equal((await malo.json()).error.code, "ALMACEN_DESCONOCIDO");
  const r = await enviar("/supervisor/almacenes", headers, "PUT", { almacenes: ["V05"], pedidosSoloDeEstaBodega: true });
  assert.equal(r.status, 200);
  assert.deepEqual(marcados, [["V05"]]);
  assert.deepEqual(opciones, [["pedidosSoloDeEstaBodega", true, "operador:Luis Pérez"]]);
  assert.equal((await r.json()).data.pedidosSoloDeEstaBodega, true);
  // Un código de más de 8 caracteres que existe en la tabla también se puede marcar.
  const largo = await enviar("/supervisor/almacenes", headers, "PUT", { almacenes: ["BOD-CENTRAL"], pedidosSoloDeEstaBodega: false });
  assert.equal(largo.status, 200);
  assert.deepEqual(marcados.at(-1), ["BOD-CENTRAL"]);
  t.mock.restoreAll();
  assert.equal((await enviar("/supervisor/almacenes", conSesion(t, "operador"), "PUT", { almacenes: [], pedidosSoloDeEstaBodega: false })).status, 403);
});

test("panel: registrar un código de barras", async (t) => {
  assert.equal((await enviar("/supervisor/codigos", conSesion(t, "operador"), "POST", { codigo: "7401", itemCode: "P1" })).status, 403);
  t.mock.restoreAll();
  const headers = conSesion(t, "supervisor");
  const bloqueados = [];
  t.mock.method(codigosRepository, "conCodigoBloqueado", async (codigo) => { bloqueados.push(codigo);
    const { AppError } = await import("../../src/shared/errors/AppError.js");
    throw new AppError({ code: "CODIGO_EN_USO", statusCode: 409, message: "Ese código ya está registrado para Crema (P2)" });
  });
  assert.equal((await enviar("/supervisor/codigos", headers, "POST", { codigo: "  7401  ", itemCode: "P1" })).status, 409);
  assert.deepEqual(bloqueados, ["7401"]);
  assert.equal((await enviar("/supervisor/codigos", headers, "POST", { codigo: "74\u000101", itemCode: "P1" })).status, 400);
});
