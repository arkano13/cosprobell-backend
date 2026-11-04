import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { operadoresRepository } = await import("../../src/modules/operadores/operadores.repository.js");
const { conteosRepository: repo } = await import("../../src/modules/conteos/conteos.repository.js");
const { pickingEtiquetasRepository } = await import("../../src/modules/picking/picking.etiquetas.repository.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

const TOKEN = "e".repeat(64);
let sesion = null;
const como = (id, rol, nombre) => { sesion = { id, rol, nombre }; return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }; };
const pedir = (ruta, headers, metodo = "GET", cuerpo) => fetch(`${url}${ruta}`, { method: metodo, headers,
  ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });

// Base en memoria: dos productos con su código de unidad confirmado (111 → P1 "Shampoo", 222 → P2 "Crema").
function base(t) {
  const db = { conteos: [], lecturas: [] };
  t.mock.method(operadoresRepository, "buscarSesion", async (tokenHash) => (tokenHash === hashApiKey(TOKEN) && sesion
    ? { id: 5, cerradaEn: null, expiraEn: new Date(Date.now() + 3600000), operador: { ...sesion, activo: true } } : null));
  t.mock.method(repo, "crear", async ({ nombre, operadorId, iniciadoPor }) => {
    const c = { id: db.conteos.length + 1, nombre, estado: "en_curso", operadorId, iniciadoPor, iniciadoEn: new Date(), terminadoEn: null };
    db.conteos.push(c); return c;
  });
  t.mock.method(repo, "buscar", async (id) => db.conteos.find((c) => c.id === id) ?? null);
  t.mock.method(repo, "listar", async ({ operadorId }) => {
    const de = db.conteos.filter((c) => operadorId === undefined || c.operadorId === operadorId)
      .map((c) => ({ ...c, unidades: db.lecturas.filter((l) => l.conteoId === c.id).length, productos: 0 }));
    return { enCurso: de.filter((c) => c.estado === "en_curso"), terminados: de.filter((c) => c.estado === "terminado") };
  });
  t.mock.method(repo, "agregarLectura", async (l) => {
    if (db.conteos.find((c) => c.id === l.conteoId)?.estado !== "en_curso") return null;
    if (db.lecturas.some((x) => x.conteoId === l.conteoId && x.operacionId === l.operacionId)) return null;
    db.lecturas.push({ id: db.lecturas.length + 1, ...l }); return { id: db.lecturas.length };
  });
  t.mock.method(repo, "unidadesDe", async (id, itemCode) => ({ producto: db.lecturas.filter((l) => l.conteoId === id && l.itemCode === itemCode).length,
    total: db.lecturas.filter((l) => l.conteoId === id).length }));
  t.mock.method(repo, "quitarUltima", async (id) => {
    const i = db.lecturas.findLastIndex((l) => l.conteoId === id);
    return i < 0 ? null : { itemCode: db.lecturas.splice(i, 1)[0].itemCode };
  });
  const nombres = { P1: "Shampoo", P2: "Crema" };
  t.mock.method(repo, "escaneado", async (id) => {
    const por = new Map();
    for (const l of db.lecturas.filter((x) => x.conteoId === id).reverse()) por.set(l.itemCode, (por.get(l.itemCode) ?? 0) + 1);
    return [...por].map(([itemCode, unidades]) => ({ itemCode, itemName: nombres[itemCode], unidades }));
  });
  t.mock.method(repo, "cerrar", async (id, datos) => {
    const c = db.conteos.find((x) => x.id === id && x.estado === "en_curso");
    if (c) Object.assign(c, datos);
    return { count: c ? 1 : 0 };
  });
  t.mock.method(repo, "nombres", async (codigos) => new Map(codigos.map((c) => [c, nombres[c] ?? c])));
  t.mock.method(pickingEtiquetasRepository, "buscarProductos", async (codigo) => {
    const itemCode = { "111": "P1", "222": "P2" }[codigo];
    if (!itemCode) return [];
    return [{ itemCode, codigosBarras: [{ id: 1, itemCode, codigo, uomEntry: -1, confirmacionPicking: { codigoBarrasId: 1,
      esUnidadIndividual: true, itemCodeConfirmado: itemCode, codigoConfirmado: codigo, uomEntryConfirmado: -1 } }] }];
  });
  return db;
}

test("conteo: un operador le pone nombre, escanea unidad por unidad y al finalizar queda la lista por producto", async (t) => {
  const db = base(t);
  const isidro = como(9, "operador", "Isidro Hernandez");
  const creado = await pedir("/conteos", isidro, "POST", { nombre: "  Devolución cliente X  " });
  assert.equal(creado.status, 201);
  const { data: conteo } = await creado.json();
  assert.deepEqual([conteo.nombre, conteo.estado, conteo.iniciadoPor], ["Devolución cliente X", "en_curso", "Isidro Hernandez"]);
  assert.equal(db.conteos[0].operadorId, 9);

  const leer = (codigo, operacionId = randomUUID()) => pedir(`/conteos/${conteo.id}/lecturas`, isidro, "POST", { codigo, operacionId });
  for (const codigo of ["111", "111", "222"]) assert.equal((await leer(codigo)).status, 201);
  const repetida = randomUUID();
  const r1 = await (await leer("111", repetida)).json();
  assert.deepEqual([r1.data.itemCode, r1.data.itemName, r1.data.unidadesProducto, r1.data.unidades, r1.data.repetida], ["P1", "Shampoo", 3, 4, false]);
  const r2 = await (await leer("111", repetida)).json();
  assert.deepEqual([r2.data.unidadesProducto, r2.data.repetida], [3, true], "un reintento no suma");
  // Un código que no es de un producto nuestro no se cuenta.
  const ajeno = await leer("999");
  assert.deepEqual([ajeno.status, (await ajeno.json()).error.code], [404, "ETIQUETA_NO_ENCONTRADA"]);
  const quitada = await (await pedir(`/conteos/${conteo.id}/quitar-ultima`, isidro, "POST", {})).json();
  assert.deepEqual([quitada.data.itemCode, quitada.data.unidadesProducto, quitada.data.unidades], ["P1", 2, 3]);

  const { data: vista } = await (await pedir(`/conteos/${conteo.id}`, isidro)).json();
  assert.deepEqual([vista.unidades, vista.productos.map((p) => [p.itemCode, p.unidades])], [3, [["P2", 1], ["P1", 2]]], "lo último arriba");

  // Otro operador no lo ve ni lo toca; el supervisor sí lo ve.
  const ana = como(10, "operador", "Ana");
  assert.equal((await pedir(`/conteos/${conteo.id}`, ana)).status, 404);
  assert.equal((await pedir(`/conteos/${conteo.id}/lecturas`, ana, "POST", { codigo: "111", operacionId: randomUUID() })).status, 404);
  assert.deepEqual((await (await pedir("/conteos", ana)).json()).data, { enCurso: [], terminados: [] });
  const supervisor = como(1, "supervisor", "Admin");
  assert.equal((await (await pedir("/conteos", supervisor)).json()).data.enCurso.length, 1);

  // Finaliza el operador: la lista sale por nombre y ya no se escanea más.
  como(9, "operador", "Isidro Hernandez");
  const { data: final } = await (await pedir(`/conteos/${conteo.id}/terminar`, isidro, "POST", {})).json();
  assert.deepEqual([final.estado, final.unidades, final.productos.map((p) => [p.itemName, p.unidades])], ["terminado", 3, [["Crema", 1], ["Shampoo", 2]]]);
  const tarde = await leer("111");
  assert.deepEqual([tarde.status, (await tarde.json()).error.code], [409, "CONTEO_CERRADO"]);
  const { data: lista } = await (await pedir("/conteos", isidro)).json();
  assert.deepEqual([lista.enCurso.length, lista.terminados.map((c) => [c.nombre, c.unidades])], [0, [["Devolución cliente X", 3]]]);
});

test("conteo: se puede descartar; sin nombre no empieza", async (t) => {
  base(t);
  const isidro = como(9, "operador", "Isidro Hernandez");
  assert.equal((await pedir("/conteos", isidro, "POST", { nombre: "   " })).status, 400);
  const { data: c } = await (await pedir("/conteos", isidro, "POST", { nombre: "Estante 4" })).json();
  const sinLecturas = await pedir(`/conteos/${c.id}/quitar-ultima`, isidro, "POST", {});
  assert.deepEqual([sinLecturas.status, (await sinLecturas.json()).error.code], [409, "SIN_LECTURAS"]);
  assert.deepEqual((await (await pedir(`/conteos/${c.id}/anular`, isidro, "POST", {})).json()).data, { id: c.id, estado: "anulado" });
  const otra = await pedir(`/conteos/${c.id}/terminar`, isidro, "POST", {});
  assert.deepEqual([otra.status, (await otra.json()).error.code], [409, "CONTEO_CERRADO"]);
});
