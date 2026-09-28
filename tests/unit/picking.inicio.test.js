import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { comprobarPedidoElegible } = await import("../../src/modules/picking/picking.pedido.js");
const { iniciarPicking } = await import("../../src/modules/picking/picking.service.js");
const { pickingRepository: repo } = await import("../../src/modules/picking/picking.repository.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const pedido = { docEntry: 1, documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo", lineas: [{ lineNum: 0, itemCode: "A", quantity: 3 }] };
for (const [nombre, cambios, codigo] of [
  ["cerrado", { documentStatus: "bost_Close" }, "PEDIDO_CERRADO"],
  ["cancelado", { cancelled: true }, "PEDIDO_CANCELADO"],
  ["csYes", { cancelStatus: "csYes" }, "PEDIDO_CANCELADO"],
  ["documento de cancelación", { cancelStatus: "csCancellation" }, "PEDIDO_CANCELADO"],
  ["estado ausente", { documentStatus: null }, "ESTADO_PEDIDO_DESCONOCIDO"],
  ["estado no reconocido", { documentStatus: "open" }, "ESTADO_PEDIDO_DESCONOCIDO"],
  ["cancelación ausente", { cancelled: null }, "ESTADO_PEDIDO_DESCONOCIDO"],
  ["cancelación sin convertir", { cancelled: "tNO" }, "ESTADO_PEDIDO_DESCONOCIDO"],
  ["cancelStatus desconocido", { cancelStatus: "otro" }, "ESTADO_PEDIDO_DESCONOCIDO"],
]) {
  test(`pedido ${nombre} no permite iniciar ni retomar`, async (t) => {
    t.mock.method(repo, "conPedidoBloqueado", async (_id, fn) => fn({}));
    t.mock.method(repo, "buscarPedidoConLineas", async () => ({ ...pedido, ...cambios }));
    const buscar = t.mock.method(repo, "buscarSesionesDelPedido", async () => { throw new Error("No debe consultar sesiones"); });
    await assert.rejects(iniciarPicking({ pedidoDocEntry: 1 }), { code: codigo });
    assert.equal(buscar.mock.callCount(), 0);
  });
}
test("admite cancelStatus ausente con cancelled explícitamente false", () => {
  assert.doesNotThrow(() => comprobarPedidoElegible({ ...pedido, cancelStatus: null }));
});
for (const [nombre, sesiones, codigo] of [
  ["duplicadas", [{ estado: "en_proceso" }, { estado: "en_proceso" }], "SESIONES_DUPLICADAS"],
  ["completo", [{ estado: "completo" }], "PEDIDO_CON_PICKING_FINALIZADO"],
  ["con diferencias", [{ estado: "con_diferencias" }], "PEDIDO_CON_PICKING_FINALIZADO"],
]) {
  test(`no crea otra sesión con historial ${nombre}`, async (t) => {
    t.mock.method(repo, "conPedidoBloqueado", async (_id, fn) => fn({}));
    t.mock.method(repo, "buscarPedidoConLineas", async () => pedido);
    t.mock.method(repo, "buscarSesionesDelPedido", async () => sesiones);
    const crear = t.mock.method(repo, "crearSesion", async () => { throw new Error("No debe crear"); });
    await assert.rejects(iniciarPicking({ pedidoDocEntry: 1 }), { code: codigo });
    assert.equal(crear.mock.callCount(), 0);
  });
}
test("todas las operaciones de inicio utilizan la misma transacción", async (t) => {
  const tx = {}; const orden = [];
  t.mock.method(repo, "conPedidoBloqueado", async (id, fn) => { assert.equal(id, 1); orden.push("bloqueo"); return fn(tx); });
  t.mock.method(repo, "buscarPedidoConLineas", async (_id, db) => { assert.equal(db, tx); orden.push("pedido"); return pedido; });
  t.mock.method(repo, "buscarSesionesDelPedido", async (_id, db) => { assert.equal(db, tx); orden.push("sesiones"); return []; });
  t.mock.method(repo, "crearSesion", async (_datos, db) => { assert.equal(db, tx); orden.push("crear"); return { id: 3 }; });
  assert.deepEqual(await iniciarPicking({ pedidoDocEntry: 1 }), { picking: { id: 3 }, creada: true });
  assert.deepEqual(orden, ["bloqueo", "pedido", "sesiones", "crear"]);
});
test("fallo del bloqueo no ejecuta el inicio y se propaga", async (t) => {
  const original = prisma.$transaction;
  prisma.$transaction = async () => { throw new Error("timeout"); };
  t.after(() => { prisma.$transaction = original; });
  let ejecuciones = 0;
  await assert.rejects(repo.conPedidoBloqueado(1, async () => { ejecuciones++; }), /timeout/);
  assert.equal(ejecuciones, 0);
});
