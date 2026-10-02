import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { registrarRecorrido } = await import("../../src/modules/sincronizacion/recorridos.service.js");
const { sincronizacionRepository: repo } = await import("../../src/modules/sincronizacion/sincronizacion.repository.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
function preparar(t) {
  let recorrido = null, secuencia = 0, escrituras = 0;
  t.mock.method(repo, "conBloqueo", fn => fn({}));
  t.mock.method(repo, "existeOtraEmpresa", async () => false);
  t.mock.method(repo, "consultarRecorrido", async () => recorrido);
  t.mock.method(repo, "consultarEstado", async () => secuencia ? { secuencia } : null);
  t.mock.method(repo, "iniciarRecorrido", async (entidad, empresa, recorridoId) => { escrituras++; recorrido = { entidad, empresa, recorridoId, finalizadoEn: null }; });
  t.mock.method(repo, "finalizarRecorrido", async (_e, n) => { escrituras++; recorrido.finalizadoEn = new Date(); recorrido.secuencia = n; });
  return { setSecuencia: n => { secuencia = n; }, escrituras: () => escrituras, recorrido: () => recorrido };
}
const iniciar = id => registrarRecorrido("existencias", "iniciar", { recorridoId: id }, "TEST");
const finalizar = (id, secuencia) => registrarRecorrido("existencias", "finalizar", { recorridoId: id, secuencia }, "TEST");
test("recorridos: iniciar y finalizar son idempotentes sin rejuvenecer la fecha", async t => {
  const f = preparar(t), id = randomUUID();
  await iniciar(id); await iniciar(id); assert.equal(f.escrituras(), 1);
  f.setSecuencia(3);
  await finalizar(id, 3); const fecha = f.recorrido().finalizadoEn;
  await finalizar(id, 3); await iniciar(id);
  assert.equal(f.escrituras(), 2); assert.equal(f.recorrido().finalizadoEn, fecha);
});
test("recorridos: otra ejecución no suplanta un recorrido incompleto", async t => {
  preparar(t); await iniciar(randomUUID());
  await assert.rejects(iniciar(randomUUID()), { code: "RECORRIDO_EN_CURSO" });
});
test("recorridos: fin exige identificador y secuencia exactos", async t => {
  const f = preparar(t), id = randomUUID();
  await assert.rejects(finalizar(id, 0), { code: "RECORRIDO_INVALIDO" });
  await iniciar(id); f.setSecuencia(2);
  await assert.rejects(finalizar(id, 1), { code: "SECUENCIA_INVALIDA" });
  await assert.rejects(finalizar(randomUUID(), 2), { code: "RECORRIDO_INVALIDO" });
  assert.equal(f.recorrido().finalizadoEn, null);
});
test("recorridos: carga vacía completa y siguiente inicio invalida disponibilidad", async t => {
  const f = preparar(t), id = randomUUID();
  await iniciar(id); assert.equal((await finalizar(id, 0)).completo, true);
  await iniciar(randomUUID()); assert.equal(f.recorrido().finalizadoEn, null);
});
test("recorridos: empresa distinta se rechaza antes de escribir", async t => {
  const f = preparar(t);
  t.mock.method(repo, "existeOtraEmpresa", async () => true);
  await assert.rejects(iniciar(randomUUID()), { code: "ORIGEN_INCOMPATIBLE" });
  assert.equal(f.escrituras(), 0);
});
test("recorridos: UUID y secuencia inválidos no abren transacciones", async t => {
  t.mock.method(repo, "conBloqueo", () => assert.fail("No debe consultar"));
  await assert.rejects(iniciar("mal"), { code: "SOLICITUD_INVALIDA" });
  await assert.rejects(finalizar(randomUUID(), -1), { code: "SOLICITUD_INVALIDA" });
});
