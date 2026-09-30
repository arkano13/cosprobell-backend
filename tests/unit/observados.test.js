import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { observarRegistros } = await import("../../src/modules/sincronizacion/observados.service.js");
const { sincronizacionRepository: repo } = await import("../../src/modules/sincronizacion/sincronizacion.repository.js");
function preparar(t, count = 1) {
  const escrituras = [];
  const modelo = { count: async () => count, updateMany: async q => escrituras.push(q) };
  t.mock.method(repo, "conBloqueo", async fn => fn({ productoCodigoBarras: modelo, pedido: modelo, unidadMedida: modelo }));
  t.mock.method(repo, "consultarEstado", async () => ({ empresa: "TEST", secuencia: 1 }));
  t.mock.method(repo, "existeOtraEmpresa", async () => false);
  return escrituras;
}
test("observar barras actualiza presencia sin cambiar asociaciones ni confirmaciones", async t => {
  const escrituras = preparar(t);
  assert.deepEqual(await observarRegistros("codigosBarras", { claves: [1] }, "TEST"), { observados: 1 });
  assert.deepEqual(Object.keys(escrituras[0].data).sort(), ["retiradoEnSap", "sincronizadoEn"]);
  assert.equal(escrituras[0].data.retiradoEnSap, false);
});
test("observar pedidos no modifica líneas ni sesiones", async t => {
  const escrituras = preparar(t); await observarRegistros("pedidos", { claves: [1] }, "TEST");
  assert.deepEqual(Object.keys(escrituras[0].data), ["sincronizadoEn"]);
});
test("registro ausente exige reconciliación antes de escribir", async t => {
  const escrituras = preparar(t, 0);
  await assert.rejects(observarRegistros("pedidos", { claves: [1] }, "TEST"), { code: "REQUIERE_RECONCILIACION" });
  assert.equal(escrituras.length, 0);
});
test("observación rechaza duplicados y origen distinto", async t => {
  preparar(t);
  await assert.rejects(observarRegistros("pedidos", { claves: [1, 1] }, "TEST"), { code: "SOLICITUD_INVALIDA" });
  await assert.rejects(observarRegistros("pedidos", { claves: [1] }, "OTRA"), { code: "REQUIERE_RECONCILIACION" });
});
