import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { finanzasRepository: repo } = await import("../../src/modules/finanzas/finanzas.repository.js");
const { iniciarFinanzas, recibirFinanzas, finalizarFinanzas } = await import("../../src/modules/finanzas/finanzas.ingreso.js");
const { resumirAntiguedad, consultarEstadoCuenta, consultarCartera, listarFinanzas } = await import("../../src/modules/finanzas/finanzas.consultas.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
const inicio = () => ({ recorridoId: randomUUID(), empresa: "TEST", desde: "2026-01-01", fuente: "a".repeat(64),
  modo: "completo", ventana: "1900-01-01", monedaLocal: "HNL", monedaSistema: "USD" });

test("GET parcial: cuotas desconocidas no son cero y la cartera no se presenta como completa", async t => {
  const c = { activoId: randomUUID(), publicadoEn: new Date(), configuracion: { ...inicio(), lectura: "get_parcial" } };
  t.mock.method(repo, "control", async () => c);
  t.mock.method(repo, "listar", async where => {
    assert.equal(where.version, c.activoId);
    return [{ datos: { total: "100", pagado: null, totalFC: "0", pagadoFC: null, totalSC: null, pagadoSC: null } }];
  });
  const r = await listarFinanzas("cuotas", { limit: 1 });
  assert.equal(r.data[0].pendienteDocumentoLocal, null);
  assert.equal(r.meta.carteraCompleta, false);
  await assert.rejects(consultarCartera("C1"), { code: "CARTERA_NO_DISPONIBLE_GET" });
  await assert.rejects(listarFinanzas("conciliaciones", { limit: 1 }), { code: "CARTERA_NO_DISPONIBLE_GET" });
});

test("GET parcial: rechaza entidades excluidas y cambiar de lector sobre una carga publicada", async t => {
  preparar(t);
  const a = { ...inicio(), lectura: "get_parcial" };
  await assert.rejects(iniciarFinanzas("conciliaciones", a, "TEST"), { code: "ENTIDAD_NO_DISPONIBLE_GET" });
  await iniciarFinanzas("facturas", a, "TEST");
  await finalizarFinanzas("facturas", { recorridoId: a.recorridoId, secuencia: 0 }, "TEST");
  await assert.rejects(iniciarFinanzas("facturas", inicio(), "TEST"), { code: "LECTOR_FINANCIERO_DISTINTO" });
});
function preparar(t) {
  let control = null, guardados = 0, publicaciones = 0;
  t.mock.method(repo, "conBloqueo", fn => fn({}));
  t.mock.method(repo, "otraEmpresa", async () => false);
  t.mock.method(repo, "control", async () => control && structuredClone(control));
  t.mock.method(repo, "iniciar", async (entidad, entrada) => { control = { ...control, entidad, empresa: entrada.empresa,
    configuracion: entrada, recorridoId: entrada.recorridoId, secuencia: 0, finalizadoEn: null }; });
  t.mock.method(repo, "guardar", async () => { guardados++; });
  t.mock.method(repo, "confirmar", async (_e, n, hash) => { control.secuencia = n; control.ultimoHash = hash; });
  t.mock.method(repo, "publicar", async () => { publicaciones++; control.finalizadoEn = new Date(); control.activoId = control.recorridoId; control.publicadoEn = new Date(); });
  return { control: () => control, guardados: () => guardados, publicaciones: () => publicaciones };
}
test("finanzas: recepción idempotente, hash, secuencia y cierre", async t => {
  const e = preparar(t), a = inicio();
  await iniciarFinanzas("vendedores", a, "TEST");
  const lote = { recorridoId: a.recorridoId, secuencia: 1, registros: [{ codigo: -1, nombre: "Sin vendedor", activo: "Y" }] };
  assert.equal((await recibirFinanzas("vendedores", lote, "TEST")).repetido, false);
  assert.equal((await recibirFinanzas("vendedores", lote, "TEST")).repetido, true);
  assert.equal(e.guardados(), 1);
  await assert.rejects(recibirFinanzas("vendedores", { ...lote, registros: [{ codigo: 1, nombre: "Otro", activo: "Y" }] }, "TEST"), { code: "LOTE_MODIFICADO" });
  await assert.rejects(finalizarFinanzas("vendedores", { recorridoId: a.recorridoId, secuencia: 0 }, "TEST"), { code: "RECORRIDO_INVALIDO" });
  await finalizarFinanzas("vendedores", { recorridoId: a.recorridoId, secuencia: 1 }, "TEST");
  await finalizarFinanzas("vendedores", { recorridoId: a.recorridoId, secuencia: 1 }, "TEST");
  assert.equal(e.publicaciones(), 1);
  await assert.rejects(recibirFinanzas("vendedores", { ...lote, secuencia: 2 }, "TEST"), { code: "SECUENCIA_INVALIDA" });
});
test("finanzas: conserva versión publicada durante una carga y publica incluso saldo vacío", async t => {
  const e = preparar(t), a = inicio();
  await iniciarFinanzas("partidas", a, "TEST");
  await finalizarFinanzas("partidas", { recorridoId: a.recorridoId, secuencia: 0 }, "TEST");
  const b = inicio(); await iniciarFinanzas("partidas", b, "TEST");
  assert.equal(e.control().activoId, a.recorridoId);
  await assert.rejects(iniciarFinanzas("partidas", inicio(), "TEST"), { code: "RECORRIDO_EN_CURSO" });
  await finalizarFinanzas("partidas", { recorridoId: b.recorridoId, secuencia: 0 }, "TEST");
  assert.equal(e.control().activoId, b.recorridoId);
});
test("finanzas: otra empresa, importes Number y claves repetidas se rechazan", async t => {
  const e = preparar(t), a = inicio();
  await assert.rejects(iniciarFinanzas("pagos", a, "OTRA"), { code: "EMPRESA_NO_AUTORIZADA" });
  await iniciarFinanzas("vendedores", a, "TEST");
  const r = { codigo: 1, nombre: "V", activo: "Y" };
  await assert.rejects(recibirFinanzas("vendedores", { recorridoId: a.recorridoId, secuencia: 1, registros: [r, r] }, "TEST"), { code: "FINANZAS_CONTRATO_INVALIDO" });
  await assert.rejects(recibirFinanzas("pagos", { recorridoId: a.recorridoId, secuencia: 1, registros: [{ total: 10 }] }, "TEST"), { code: "FINANZAS_CONTRATO_INVALIDO" });
  assert.equal(e.guardados(), 0);
});
test("cartera: tramos, fecha exacta de vencimiento, crédito y céntimos", () => {
  const grupo = (fecha, saldo) => ({ vencimiento: fecha ? new Date(fecha) : null, _sum: { saldo } });
  const r = resumirAntiguedad([grupo("2026-10-09", "0.1"), grupo("2026-10-10", "0.2"), grupo("2026-10-08", "100"),
    grupo("2026-09-08", "20"), grupo("2026-08-09", "30"), grupo("2026-07-01", "40"), grupo(null, "5"), grupo(null, "-10")], "2026-10-09");
  assert.equal(r.porVencer, "0.300000"); assert.equal(r.dias1a30, "100.000000");
  assert.equal(r.dias31a60, "20.000000"); assert.equal(r.dias61a90, "30.000000");
  assert.equal(r.masDe90, "40.000000"); assert.equal(r.saldoAFavor, "-10.000000"); assert.equal(r.saldoNeto, "185.300000");
});
test("estado de cuenta: saldo inicial incluye apertura, cargos y abonos una sola vez", async t => {
  const c = { activoId: randomUUID(), recorridoId: randomUUID(), publicadoEn: new Date("2026-10-09"), finalizadoEn: new Date(), configuracion: inicio() };
  t.mock.method(repo, "control", async () => c);
  t.mock.method(repo, "sumar", async where => where.fecha.lt ? { _sum: { debe: "500", haber: "100" } } : { _sum: { debe: "100.10", haber: "50.20" } });
  t.mock.method(repo, "listar", async () => []);
  const r = await consultarEstadoCuenta("C1", { desde: "2026-01-01", hasta: "2026-10-09", limit: 50 });
  assert.equal(r.data.saldoInicial, "400.000000"); assert.equal(r.data.saldoFinal, "449.900000");
  assert.equal(r.meta.validadoContraSap, false);
});
test("cartera: falta de primera carga no se presenta como saldo cero", async t => {
  t.mock.method(repo, "control", async () => null);
  await assert.rejects(consultarCartera("C1"), { code: "FINANZAS_SIN_CARGA_COMPLETA" });
});
