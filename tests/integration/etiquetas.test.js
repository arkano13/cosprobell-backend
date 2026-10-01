import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.ETIQUETAS_APPS_AUTORIZADAS = "supervisor-etiquetas, otra-app";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { etiquetasRepository: repo } = await import("../../src/modules/etiquetas/etiquetas.repository.js");
const { autorizarApps } = await import("../../src/middleware/autorizarApps.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

// Los métodos de Prisma son dinámicos: se sustituyen a mano y se restauran al terminar cada prueba.
function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre]; objeto[nombre] = implementacion; t.after(() => { objeto[nombre] = original; });
}
function comoApp(t, nombre) {
  sustituir(t, prisma.apiKey, "findUnique", async () => ({ id: 1, activa: true, nombre }));
  sustituir(t, prisma.apiKey, "update", async () => ({}));
  return { "X-API-Key": "clave-ficticia", "Content-Type": "application/json" };
}
const fila = (cambios = {}) => ({ id: 3, itemCode: "P1", itemName: "Producto Uno", codigo: "7401", uomEntry: 1, uomCode: "UN", uomNombre: "Unidad",
  sapAbsEntry: 9, confirmada: false, esUnidadIndividual: null, confirmadaEn: null, confirmadaPor: null, observacion: null, desactualizada: false, ...cambios });
function simularBloqueo(t, etiqueta) {
  const guardadas = [], eliminadas = [];
  t.mock.method(repo, "conEtiquetaBloqueada", async (_id, operacion) => operacion({ tx: "tx", etiqueta }));
  t.mock.method(repo, "guardarConfirmacion", async (c, tx) => { assert.equal(tx, "tx"); guardadas.push(c); });
  t.mock.method(repo, "eliminarConfirmacion", async (id, tx) => { assert.equal(tx, "tx"); eliminadas.push(id); });
  return { guardadas, eliminadas };
}
const confirmar = (headers, id, body) => fetch(`${url}/etiquetas/${id}/confirmacion`, { method: "PUT", headers, body: JSON.stringify(body) });

test("lista etiquetas con su estado de confirmación y cursor", async (t) => {
  const headers = comoApp(t, "escaner-bodega"); let consulta;
  t.mock.method(repo, "listar", async (q) => { consulta = q; return [
    fila(), fila({ id: 4, confirmada: true, esUnidadIndividual: true, desactualizada: true }),
    fila({ id: 5, confirmada: true, esUnidadIndividual: true, confirmadaPor: "supervisor-etiquetas" }), fila({ id: 6, confirmada: true, esUnidadIndividual: false }), fila({ id: 7, uomCode: null, uomEntry: -1 }),
  ]; });
  const r = await fetch(`${url}/etiquetas?estado=todas&limit=4&itemCode=P1`, { headers });
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.deepEqual(consulta, { estado: "todas", itemCode: "P1", limit: 4 });
  assert.deepEqual(cuerpo.data.map((e) => e.estado), ["sin_confirmar", "desactualizada", "unidad_individual", "no_es_unidad"]);
  assert.deepEqual(cuerpo.data[0].unidad, { code: "UN", nombre: "Unidad" });
  assert.equal(cuerpo.data[2].confirmacion.confirmadaPor, "supervisor-etiquetas");
  assert.equal(cuerpo.siguienteCursor, 6);
  assert.equal((await fetch(`${url}/etiquetas?estado=otra`, { headers })).status, 400);
});

test("solo las aplicaciones autorizadas confirman o revocan", async (t) => {
  const headers = comoApp(t, "escaner-bodega"); const f = simularBloqueo(t, fila());
  const r = await confirmar(headers, 3, { esUnidadIndividual: true });
  assert.equal(r.status, 403); assert.equal((await r.json()).error.code, "APLICACION_NO_AUTORIZADA");
  assert.equal((await fetch(`${url}/etiquetas/3/confirmacion`, { method: "DELETE", headers })).status, 403);
  assert.deepEqual([f.guardadas, f.eliminadas], [[], []]);
});

test("confirmar guarda la foto actual del código y quién confirmó", async (t) => {
  const headers = comoApp(t, "supervisor-etiquetas");
  const f = simularBloqueo(t, { id: 3, itemCode: "P1", codigo: "7401", uomEntry: 1, retiradoEnSap: false });
  t.mock.method(repo, "obtener", async () => fila({ confirmada: true, esUnidadIndividual: true, confirmadaPor: "supervisor-etiquetas" }));
  const r = await confirmar(headers, 3, { esUnidadIndividual: true, observacion: "  revisada en bodega " });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.estado, "unidad_individual");
  const [guardada] = f.guardadas;
  assert.ok(guardada.confirmadaEn instanceof Date);
  delete guardada.confirmadaEn;
  assert.deepEqual(guardada, { codigoBarrasId: 3, esUnidadIndividual: true, itemCodeConfirmado: "P1", codigoConfirmado: "7401",
    uomEntryConfirmado: 1, confirmadaPor: "supervisor-etiquetas", observacion: "revisada en bodega" });
});

for (const [nombre, etiqueta, body, status, code] of [
  ["código sin unidad como individual", { id: 3, itemCode: "P1", codigo: "7401", uomEntry: null, retiradoEnSap: false }, { esUnidadIndividual: true }, 409, "UNIDAD_NO_DEFINIDA"],
  ["código retirado en SAP", { id: 3, itemCode: "P1", codigo: "7401", uomEntry: 1, retiradoEnSap: true }, { esUnidadIndividual: false }, 409, "ETIQUETA_RETIRADA"],
  ["código inexistente", null, { esUnidadIndividual: false }, 404, "ETIQUETA_NO_ENCONTRADA"],
]) {
  test(`confirmar rechaza ${nombre} sin guardar`, async (t) => {
    const headers = comoApp(t, "supervisor-etiquetas"); const f = simularBloqueo(t, etiqueta);
    const r = await confirmar(headers, 3, body);
    assert.equal(r.status, status); assert.equal((await r.json()).error.code, code);
    assert.deepEqual(f.guardadas, []);
  });
}

test("la unidad Manual se puede confirmar como unidad individual", async (t) => {
  const headers = comoApp(t, "supervisor-etiquetas");
  const f = simularBloqueo(t, { id: 3, itemCode: "P1", codigo: "7401", uomEntry: -1, retiradoEnSap: false });
  t.mock.method(repo, "obtener", async () => fila({ uomEntry: -1, confirmada: true, esUnidadIndividual: true }));
  const r = await confirmar(headers, 3, { esUnidadIndividual: true });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.estado, "unidad_individual");
  assert.equal(f.guardadas[0].uomEntryConfirmado, -1);
});

test("la unidad Manual sí puede marcarse como 'no es unidad'", async (t) => {
  const headers = comoApp(t, "supervisor-etiquetas");
  const f = simularBloqueo(t, { id: 3, itemCode: "P1", codigo: "7401", uomEntry: -1, retiradoEnSap: false });
  t.mock.method(repo, "obtener", async () => fila({ uomEntry: -1, confirmada: true, esUnidadIndividual: false }));
  const r = await confirmar(headers, 3, { esUnidadIndividual: false });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.estado, "no_es_unidad");
  assert.equal(f.guardadas[0].esUnidadIndividual, false);
});

test("revocar elimina la confirmación y devuelve la etiqueta sin confirmar", async (t) => {
  const headers = comoApp(t, "otra-app");
  const f = simularBloqueo(t, { id: 3, itemCode: "P1", codigo: "7401", uomEntry: 1, retiradoEnSap: false });
  t.mock.method(repo, "obtener", async () => fila());
  const r = await fetch(`${url}/etiquetas/3/confirmacion`, { method: "DELETE", headers });
  assert.equal(r.status, 200); assert.equal((await r.json()).data.estado, "sin_confirmar");
  assert.deepEqual(f.eliminadas, [3]);
});

test("confirmar valida el cuerpo y el identificador", async (t) => {
  const headers = comoApp(t, "supervisor-etiquetas"); const f = simularBloqueo(t, null);
  for (const [id, body] of [[3, {}], [3, { esUnidadIndividual: "si" }], [3, { esUnidadIndividual: true, extra: 1 }], [0, { esUnidadIndividual: true }], ["x", { esUnidadIndividual: true }]]) {
    assert.equal((await confirmar(headers, id, body)).status, 400, JSON.stringify([id, body]));
  }
  assert.deepEqual(f.guardadas, []);
});

test("sin aplicaciones configuradas la confirmación queda cerrada", () => {
  let error; autorizarApps([], "confirmar etiquetas")({ appNombre: "cualquiera" }, {}, (e) => { error = e; });
  assert.equal(error.statusCode, 403); assert.equal(error.code, "FUNCION_NO_HABILITADA");
});
