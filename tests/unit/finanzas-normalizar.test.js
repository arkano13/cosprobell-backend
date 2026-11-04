import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ENTIDADES_NORMALIZABLES, datosParaTabla, datosDesdeTabla } from "../../src/modules/finanzas/finanzas.tablas.js";
import { equivalentes, normalizarTanda } from "../../src/modules/finanzas/finanzas.normalizar.js";
import { opcionesNormalizacion, resumenErrorNormalizacion } from "../../scripts/normalizar-finanzas.js";
import { ejemploFinanciero } from "../helpers/finanzas-normalizadas.js";

test("normalización: todas las entidades preservan campos, fechas, nulos y decimales", () => {
  for (const entidad of ENTIDADES_NORMALIZABLES) {
    const datos = ejemploFinanciero(entidad);
    assert.deepEqual(datosDesdeTabla(entidad, datosParaTabla(entidad, datos, randomUUID())), datos, entidad);
  }
  assert.equal(equivalentes("movimientos", ejemploFinanciero("movimientos", { debe: "8682903.86" }),
    ejemploFinanciero("movimientos", { debe: "8682903.860000" })), true);
  assert.equal(equivalentes("movimientos", ejemploFinanciero("movimientos", { debe: "8682903.86" }),
    ejemploFinanciero("movimientos", { debe: "8682903.860001" })), false);
});

test("normalización: CLI exige una acción explícita y limita entidad/tamaño", () => {
  for (const args of [[], ["--aplicar", "--estado"], ["--aplicar", "--entidad=conciliaciones"],
    ["--aplicar", "--lote=0"], ["--aplicar", "--lote=201"], ["--estado", "--lote=2"], ["--aplicar", "--borrar"]]) {
    assert.throws(() => opcionesNormalizacion(args));
  }
  assert.equal(opcionesNormalizacion(["--aplicar", "--lote=25"]).limite, 25);
});

test("normalización: no inicia sobre una entidad sin publicar ni sobre un origen mutable", async () => {
  const tx = { $queryRaw: async () => [], finanzaControl: { findUnique: async () => null } };
  const db = { $transaction: fn => fn(tx) };
  assert.equal((await normalizarTanda(db, "movimientos")).estado, "esperando_carga");
  const id = randomUUID();
  tx.finanzaControl.findUnique = async () => ({ activoId: id, recorridoId: id, finalizadoEn: new Date(), configuracion: {} });
  await assert.rejects(normalizarTanda(db, "movimientos"), { code: "NORMALIZACION_REQUIERE_SNAPSHOT" });
});

test("normalización: el diagnóstico identifica la entidad y campos sin revelar SQL, importes ni credenciales", () => {
  const secreto = "postgresql://usuario:clave-privada@servidor/produccion";
  const error = Object.assign(new Error(secreto), { name: "PrismaClientUnknownRequestError", meta: { query: secreto } });
  const informe = resumenErrorNormalizacion(error, "movimientos");
  assert.equal(informe.entidad, "movimientos");
  assert.equal(informe.tipo, "PrismaClientUnknownRequestError");
  assert.ok(!JSON.stringify(informe).includes(secreto));
  const contrato = { name: "ZodError", message: secreto, issues: [{ path: ["totalSC"], input: secreto }] };
  assert.deepEqual(resumenErrorNormalizacion(contrato, "facturas").camposInvalidos, ["totalSC"]);
  assert.equal(resumenErrorNormalizacion(contrato, "facturas").codigo, "CONTRATO_FINANCIERO_INVALIDO");
  assert.throws(() => opcionesNormalizacion([]), { code: "INDIQUE_ESTADO_O_APLICAR" });
});
