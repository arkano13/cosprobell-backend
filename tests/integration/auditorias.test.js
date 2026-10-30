import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { operadoresRepository } = await import("../../src/modules/operadores/operadores.repository.js");
const { inventarioRepository } = await import("../../src/modules/inventario/inventario.repository.js");
const { auditoriasRepository: repo } = await import("../../src/modules/auditorias/auditorias.repository.js");
const { pickingEtiquetasRepository } = await import("../../src/modules/picking/picking.etiquetas.repository.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

const TOKEN = "d".repeat(64);
function conSesion(t, rol, nombre) {
  t.mock.method(operadoresRepository, "buscarSesion", async (tokenHash) => (tokenHash === hashApiKey(TOKEN)
    ? { id: 5, cerradaEn: null, expiraEn: new Date(Date.now() + 3600000), operador: { id: 9, nombre, activo: true, rol } } : null));
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}
const pedir = (ruta, headers, metodo = "GET", cuerpo) => fetch(`${url}${ruta}`, { method: metodo, headers,
  ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });

// Base en memoria: almacenes 01 (grande), 02 (pequeña), 03 (solo conteo) y V07 (otro).
function base(t) {
  const db = { auditorias: [], lecturas: [] };
  t.mock.method(inventarioRepository, "opcion", async (clave) => (clave === "almacenesPorBodega" ? { grande: "01", pequena: "02" }
    : clave === "almacenesSoloConteo" ? [{ almacen: "03", tipo: "sueltas" }] : null));
  t.mock.method(inventarioRepository, "almacenesDeEstaBodega", async () => ["01", "02"]);
  t.mock.method(inventarioRepository, "existenciasSapAl", async () => new Date("2026-10-30T15:00:00Z"));
  t.mock.method(inventarioRepository, "diferido", async () => [{ itemCode: "P1", porPreparar: 2, sinEntrega: 0 }]);
  t.mock.method(repo, "almacenes", async () => ["01", "02", "03", "V07"].map((c) => ({ warehouseCode: c, warehouseName: `Almacén ${c}` })));
  t.mock.method(repo, "estadoPorAlmacen", async () => ({
    enCurso: db.auditorias.filter((a) => a.estado === "en_curso").map((a) => ({ id: a.id, almacen: a.almacen, iniciadaPor: a.iniciadaPor,
      iniciadaEn: a.iniciadaEn, unidades: db.lecturas.filter((l) => l.auditoriaId === a.id).length, personas: 1 })),
    terminadas: [] }));
  t.mock.method(repo, "crear", async (almacen, iniciadaPor) => {
    if (db.auditorias.some((a) => a.almacen === almacen && a.estado === "en_curso")) return null;
    const a = { id: db.auditorias.length + 1, almacen, estado: "en_curso", iniciadaPor, iniciadaEn: new Date(), terminadaPor: null, terminadaEn: null };
    db.auditorias.push(a); return a;
  });
  t.mock.method(repo, "buscar", async (id) => db.auditorias.find((a) => a.id === id) ?? null);
  t.mock.method(repo, "agregarLectura", async (l) => {
    if (db.auditorias.find((a) => a.id === l.auditoriaId)?.estado !== "en_curso") return null;
    if (db.lecturas.some((x) => x.auditoriaId === l.auditoriaId && x.operacionId === l.operacionId)) return null;
    db.lecturas.push({ id: db.lecturas.length + 1, ...l }); return { id: db.lecturas.length };
  });
  t.mock.method(repo, "unidadesDe", async (id, itemCode) => ({ producto: db.lecturas.filter((l) => l.auditoriaId === id && l.itemCode === itemCode).length,
    total: db.lecturas.filter((l) => l.auditoriaId === id).length }));
  t.mock.method(repo, "quitarUltima", async (id, hechoPor) => {
    const i = db.lecturas.findLastIndex((l) => l.auditoriaId === id && l.hechoPor === hechoPor);
    return i < 0 ? null : { itemCode: db.lecturas.splice(i, 1)[0].itemCode };
  });
  t.mock.method(repo, "escaneado", async (id) => {
    const por = new Map();
    for (const l of db.lecturas.filter((x) => x.auditoriaId === id)) por.set(l.itemCode, (por.get(l.itemCode) ?? 0) + 1);
    return { productos: [...por].map(([itemCode, unidades]) => ({ itemCode, itemName: itemCode, unidades })),
      personas: [...new Set(db.lecturas.filter((x) => x.auditoriaId === id).map((l) => l.hechoPor))] };
  });
  t.mock.method(repo, "cerrar", async (id, datos) => {
    const a = db.auditorias.find((x) => x.id === id && x.estado === "en_curso");
    if (a) Object.assign(a, datos);
    return { count: a ? 1 : 0 };
  });
  t.mock.method(repo, "nombres", async (codigos) => new Map(codigos.map((c) => [c, `Producto ${c}`])));
  t.mock.method(repo, "appPequena", async () => new Map([["P1", 5], ["P2", 3]]));
  t.mock.method(repo, "sap", async (almacen) => (almacen === "02" ? new Map([["P1", 3], ["P2", 3]]) : null));
  t.mock.method(pickingEtiquetasRepository, "buscarProductos", async (codigo) => {
    const itemCode = { "111": "P1", "222": "P2" }[codigo];
    if (!itemCode) return [];
    return [{ itemCode, codigosBarras: [{ id: 1, itemCode, codigo, uomEntry: -1, confirmacionPicking: { codigoBarrasId: 1,
      esUnidadIndividual: true, itemCodeConfirmado: itemCode, codigoConfirmado: codigo, uomEntryConfirmado: -1 } }] }];
  });
  return db;
}

test("auditoría: el supervisor inicia, los operadores escanean sin ver el sistema y el resultado compara con la app y SAP", async (t) => {
  const db = base(t);
  const supervisor = conSesion(t, "supervisor", "Admin");
  const { data: almacenes } = await (await pedir("/inventario/auditorias", supervisor)).json();
  assert.deepEqual(almacenes.map((a) => [a.almacen, a.tipo, a.comparaApp]), [["01", "grande", true], ["02", "pequena", true],
    ["03", "conteo", true], ["V07", "otro", false]]);
  const creada = await pedir("/inventario/auditorias", supervisor, "POST", { almacen: "02" });
  assert.equal(creada.status, 201);
  const { data: auditoria } = await creada.json();
  const otra = await pedir("/inventario/auditorias", supervisor, "POST", { almacen: "02" });
  assert.deepEqual([otra.status, (await otra.json()).error.code], [409, "AUDITORIA_EN_CURSO"]);

  // Un operador no inicia ni termina, pero escanea.
  const operador = conSesion(t, "operador", "Isidro Hernandez");
  assert.equal((await pedir("/inventario/auditorias", operador, "POST", { almacen: "01" })).status, 403);
  const leer = (codigo, operacionId = randomUUID()) => pedir(`/inventario/auditorias/${auditoria.id}/lecturas`, operador, "POST", { codigo, operacionId });
  const repetida = randomUUID();
  for (const codigo of ["111", "111", "111", "222"]) assert.equal((await leer(codigo)).status, 201);
  const primera = await (await leer("111", repetida)).json();
  assert.deepEqual([primera.data.itemCode, primera.data.unidadesProducto, primera.data.unidades, primera.data.repetida], ["P1", 4, 5, false]);
  const reintento = await (await leer("111", repetida)).json();
  assert.deepEqual([reintento.data.unidadesProducto, reintento.data.repetida], [4, true], "un reintento no suma");
  const desconocida = await leer("999");
  assert.deepEqual([desconocida.status, (await desconocida.json()).error.code], [404, "ETIQUETA_NO_ENCONTRADA"]);
  // Quitar la última: la suya.
  const quitada = await (await pedir(`/inventario/auditorias/${auditoria.id}/quitar-ultima`, operador, "POST", {})).json();
  assert.deepEqual([quitada.data.itemCode, quitada.data.unidadesProducto], ["P1", 3]);
  // Lo escaneado se ve; lo que dice el sistema, no.
  const { data: vista } = await (await pedir(`/inventario/auditorias/${auditoria.id}`, operador)).json();
  // Como un pedido: cada producto con lo escaneado y lo que se espera (en la 02, lo que dice la app).
  assert.deepEqual([vista.fuente, vista.unidades, vista.esperadas, vista.productos.map((p) => [p.itemCode, p.unidades, p.esperadas])],
    ["app", 4, 8, [["P1", 3, 5], ["P2", 1, 3]]]);
  assert.equal(vista.filas, undefined);
  assert.equal((await pedir(`/inventario/auditorias/${auditoria.id}/terminar`, operador, "POST", {})).status, 403);
  assert.equal((await pedir(`/inventario/auditorias/${auditoria.id}/resultado`, operador)).status, 403);

  // El supervisor termina: la 02 de SAP se ajusta con lo facturado sin preparar (P1: 3 + 2 = 5).
  const supervisor2 = conSesion(t, "supervisor", "Admin");
  const terminada = await (await pedir(`/inventario/auditorias/${auditoria.id}/terminar`, supervisor2, "POST", {})).json();
  assert.deepEqual(terminada.data.filas.map((f) => [f.itemCode, f.escaneado, f.app, f.sap, f.diferenciaApp, f.diferenciaSap]),
    [["P1", 3, 5, 5, -2, -2], ["P2", 1, 3, 3, -2, -2]]);
  assert.equal(db.auditorias[0].estado, "terminada");
  const { data: resultado } = await (await pedir(`/inventario/auditorias/${auditoria.id}/resultado`, supervisor2)).json();
  assert.deepEqual(resultado.resumen.contraApp, { cumplen: 0, faltan: { productos: 2, unidades: 4 }, sobran: { productos: 0, unidades: 0 } });
  // Terminada: no se escanea más.
  conSesion(t, "operador", "Isidro Hernandez");
  const tarde = await leer("111");
  assert.deepEqual([tarde.status, (await tarde.json()).error.code], [409, "AUDITORIA_CERRADA"]);
});

test("auditoría: un almacén que la app no lleva y sin existencias de SAP muestra solo lo escaneado", async (t) => {
  base(t);
  const supervisor = conSesion(t, "supervisor", "Admin");
  const { data: a } = await (await pedir("/inventario/auditorias", supervisor, "POST", { almacen: "V07" })).json();
  await pedir(`/inventario/auditorias/${a.id}/lecturas`, supervisor, "POST", { codigo: "222", operacionId: randomUUID() });
  const { data: vista } = await (await pedir(`/inventario/auditorias/${a.id}`, supervisor)).json();
  assert.deepEqual([vista.fuente, vista.productos.map((p) => [p.itemCode, p.unidades, p.esperadas])], [null, [["P2", 1, 0]]]);
  const { data } = await (await pedir(`/inventario/auditorias/${a.id}/terminar`, supervisor, "POST", {})).json();
  assert.deepEqual([data.tipo, data.resumen.contraApp, data.resumen.contraSap, data.filas.map((f) => [f.itemCode, f.escaneado])],
    ["otro", null, null, [["P2", 1]]]);
  const sinAlmacen = await pedir("/inventario/auditorias", supervisor, "POST", { almacen: "ZZ" });
  assert.deepEqual([sinAlmacen.status, (await sinAlmacen.json()).error.code], [404, "ALMACEN_NO_ENCONTRADO"]);
});
