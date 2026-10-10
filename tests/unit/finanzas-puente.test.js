import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { FINANZAS } from "../../src/shared/finanzas/contratos.js";
import { unidades, importe } from "../../src/shared/finanzas/decimal.js";
import { definicionesSqlFinanzas } from "../../puente/finanzas.sql.js";
import { lectorFinanciero, transformarFinanzas } from "../../puente/finanzas.transformar.js";
import { sincronizarPaginaFinanzas, parametrosFinanzas } from "../../puente/finanzas.sincronizar.js";
import { configurarFinanzas } from "../../puente/finanzas.config.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { abrirFinanzas } from "../../puente/finanzas.estado.js";

const config = { empresa: "TEST", desde: "2026-01-01", monedaLocal: "HNL", monedaSistema: "USD", campoZona: null, campoRuta: null };
const defs = definicionesSqlFinanzas(config);
const filaCliente = { cardCode: "C1", nombre: "Cliente", activo: "Y", bloqueado: "N", moneda: "HNL", saldo: "0.3", saldoFC: "0", saldoSC: "0",
  limiteCredito: "1000", vendedor: -1, condicionPago: -1, zona: null, ruta: null };
test("finanzas: conserva el texto decimal exacto y rechaza valores ya redondeados", async () => {
  const texto = JSON.stringify(filaCliente).replace('"0.3"', "9999999999999.123456");
  const leido = await lectorFinanciero("clientes")(new Response(`{"value":[${texto}]}`));
  assert.equal(transformarFinanzas("clientes", leido.value, null)[0].saldo, "9999999999999.123456");
  assert.throws(() => transformarFinanzas("clientes", [{ ...filaCliente, saldo: 0.3 }], null), { code: "FINANZA_SAP_INVALIDA" });
  assert.equal(importe(unidades("0.1") + unidades("0.2")), "0.300000");
  assert.equal(importe(unidades("-10.20") + unidades("1.10")), "-9.100000");
});
test("finanzas: notación científica exacta en JSON numérico y texto", async () => {
  for (const [entrada, esperado] of [
    ["1E-06", "0.000001"], ["-1.2300e+2", "-123"],
    ["9.999999999999123456e12", "9999999999999.123456"],
    ["10e-7", "0.000001"], ["1e+12", "1000000000000"], ["0e99999", "0"],
  ]) {
    for (const literal of [entrada, JSON.stringify(entrada)]) {
      const texto = JSON.stringify(filaCliente).replace('"0.3"', literal);
      const leido = await lectorFinanciero("clientes")(new Response(`{"value":[${texto}]}`));
      assert.equal(transformarFinanzas("clientes", leido.value, null)[0].saldo, esperado);
    }
  }
  const r = transformarFinanzas("clientes", [{ ...filaCliente, nombre: "1E-06", ruta: "1e3" }], null)[0];
  assert.equal(r.nombre, "1E-06");
  assert.equal(r.ruta, "1e3");
});
test("finanzas: científico fuera de rango no se redondea ni desborda", async () => {
  for (const entrada of ["1e-7", "1e13", "1e99999", "1e-99999", "1.2345678e0"]) {
    const texto = JSON.stringify(filaCliente).replace('"0.3"', entrada);
    const leido = await lectorFinanciero("clientes")(new Response(`{"value":[${texto}]}`));
    assert.throws(() => transformarFinanzas("clientes", leido.value, null), { code: "FINANZA_SAP_INVALIDA" });
  }
});
test("finanzas: no inventa zona, ruta ni datos ausentes", () => {
  assert.match(defs.clientes.consulta.SqlText, /NULL AS \[zona\], NULL AS \[ruta\]/);
  const falta = { ...filaCliente }; delete falta.saldo;
  assert.throws(() => transformarFinanzas("clientes", [falta], null), { code: "FINANZA_SAP_INVALIDA" });
  assert.throws(() => transformarFinanzas("clientes", [filaCliente, filaCliente], null), { code: "PAGINACION_SIN_AVANCE" });
});
test("finanzas: todas las consultas compilan y tienen contratos de columnas completos", () => {
  for (const [nombre, def] of Object.entries(defs)) {
    assert.deepEqual(Object.keys(def.columnas).sort(), Object.keys(FINANZAS[nombre].campos).sort());
    const sql = def.consulta.SqlText.replace("TOP 50 ", "") + " LIMIT 50";
    const db = new DatabaseSync(":memory:");
    try {
      const tablas = {};
      for (const [, tabla, alias] of sql.matchAll(/(?:FROM|JOIN) \[(\w+)\] (\w+)/g)) {
        tablas[tabla] ??= new Set();
        for (const m of sql.matchAll(new RegExp(`${alias}\\.\\[(\\w+)\\]`, "g"))) tablas[tabla].add(m[1]);
      }
      for (const [tabla, campos] of Object.entries(tablas)) db.exec(`CREATE TABLE [${tabla}] (${[...campos].map(c => `[${c}] TEXT`).join(",")})`);
      assert.deepEqual(db.prepare(sql).all(parametrosFinanzas(def, config, { ventana: "2026-01-01" }, null)), []);
      assert.doesNotMatch(sql, /\b(?:INSERT|DELETE|UPDATE|DROP|EXEC)\b/i);
      assert.doesNotMatch(sql, /WhsCode\]\s*(?:=|IN)/i);
    } finally { db.close(); }
  }
});
test("finanzas: pagina claves compuestas sin perder otras líneas del mismo asiento", () => {
  const d = defs.movimientos;
  const p = parametrosFinanzas(d, config, { ventana: "2026-10-01" }, [19, 2]);
  assert.deepEqual(p, { k0: 19, k1: 2, since: "2026-10-01" });
  assert.match(d.consulta.SqlText, /L\.\[TransId\] = :k0 AND L\.\[Line_ID\] > :k1/);
  assert.doesNotMatch(defs.partidas.consulta.SqlText, /:since|:history/);
});
test("finanzas: cambios incluyen documentos antiguos abiertos y actualizados", () => {
  const d = defs.facturas;
  const db = new DatabaseSync(":memory:");
  try {
    const campos = [...new Set([...d.consulta.SqlText.matchAll(/H\.\[(\w+)\]/g)].map(m => m[1]))];
    db.exec(`CREATE TABLE OINV (${campos.map(c => `[${c}] ${c === "DocEntry" ? "INTEGER" : "TEXT"}`).join(",")})`);
    const insertar = db.prepare("INSERT INTO OINV (DocEntry, DocDate, DocStatus, UpdateDate, CreateDate) VALUES (?, ?, ?, ?, ?)");
    insertar.run(1, "2020-01-01", "O", "2020-01-01", "2020-01-01");
    insertar.run(2, "2020-01-01", "C", "2026-10-09", "2020-01-01");
    insertar.run(3, "2020-01-01", "C", "2020-01-01", "2020-01-01");
    insertar.run(4, "2026-10-09", "O", "2026-10-09", "2026-10-09");
    const filas = db.prepare(d.consulta.SqlText.replace("TOP 50 ", "") + " LIMIT 50").all({ k0: -1, history: "2026-01-01", since: "2026-10-07" });
    assert.deepEqual(filas.map(f => f.docEntry), [1, 2, 4]);
  } finally { db.close(); }
});
test("finanzas: registro SQL ocurre solo cuando se solicita explícitamente", async () => {
  const llamadas = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1" }, async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (url.endsWith("Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=test" } });
    return new Response("{}", { status: 404 });
  });
  await assert.rejects(sap.prepararConsultaFinanciera(defs.facturas.consulta), { code: "HTTP_404" });
  assert.equal(llamadas.filter(c => c.opciones.method === "POST").length, 1);
});
function entorno() {
  const almacen = { nuevo: true, estado: { version: 1, origen: "x", recorrido: null, cursor: null, secuencia: 0, pendiente: null },
    async guardar(s) { this.estado = structuredClone(s); } };
  let control = null, envios = 0, consultas = 0, fallarConfirmacion = true;
  const backend = async (_e, accion, entrada) => {
    if (accion === "estado") return control;
    if (accion === "iniciar") {
      control ??= { ...entrada, secuencia: 0, finalizadoEn: null };
      return { recorridoId: control.recorridoId };
    }
    if (accion === "lote") {
      const repetido = control.secuencia === entrada.secuencia;
      control.secuencia = entrada.secuencia; envios++;
      if (fallarConfirmacion) { fallarConfirmacion = false; throw Object.assign(new Error(), { code: "CONEXION_O_TLS" }); }
      return { secuencia: entrada.secuencia, recibidos: entrada.registros.length, repetido };
    }
    control.finalizadoEn = "2026-10-09T12:00:00Z";
    return { recorridoId: control.recorridoId, completo: true };
  };
  const sap = { async paginaFinanciera() { consultas++; return consultas === 1 ? [filaCliente] : []; } };
  return { almacen, backend, sap, consultas: () => consultas, envios: () => envios };
}
test("finanzas: caída después de recibir conserva lote y reintenta sin releer SAP", async () => {
  const e = entorno();
  const argumentos = { ...e, config, def: defs.clientes };
  await assert.rejects(sincronizarPaginaFinanzas(argumentos), { code: "CONEXION_O_TLS" });
  assert.ok(e.almacen.estado.pendiente);
  e.almacen.nuevo = false;
  assert.equal((await sincronizarPaginaFinanzas(argumentos)).completo, false);
  assert.equal(e.consultas(), 1); assert.equal(e.envios(), 2);
  assert.equal((await sincronizarPaginaFinanzas(argumentos)).completo, true);
  assert.equal(e.almacen.estado.cursor, null);
});
test("finanzas: cambiar alcance durante un pendiente exige terminarlo", async () => {
  const e = entorno();
  await assert.rejects(sincronizarPaginaFinanzas({ ...e, config, def: defs.clientes }));
  e.almacen.nuevo = false;
  await assert.rejects(sincronizarPaginaFinanzas({ ...e, config: { ...config, desde: "2025-01-01" }, def: defs.clientes }), { code: "CAMBIO_FINANCIERO_CON_PENDIENTE" });
});
test("finanzas: un backend vaciado no permite continuar solo con cambios", async () => {
  const e = entorno();
  e.almacen.nuevo = false;
  e.almacen.estado.ultimoRecorrido = "11111111-1111-4111-8111-111111111111";
  e.almacen.estado.ultimoCompleto = "2026-10-08T12:00:00Z";
  await assert.rejects(sincronizarPaginaFinanzas({ ...e, config, def: defs.clientes }), { code: "REQUIERE_RECONCILIACION" });
  assert.equal(e.consultas(), 0);
});
test("finanzas: una fecha en la descripción no se recorta como fecha de documento", () => {
  const nombre = "2026-10-09TEXTO";
  assert.equal(transformarFinanzas("clientes", [{ ...filaCliente, nombre }], null)[0].nombre, nombre);
});
test("finanzas: activación, fecha, monedas y UDF se validan antes de conectar", () => {
  const v = { SAP_SERVICE_LAYER_URL: "https://sap.test/b1s/v1", SAP_COMPANY_DB: "TEST", SAP_USER: "test", SAP_PASSWORD: "test",
    BACKEND_URL: "https://backend.test", BRIDGE_API_KEY: "x".repeat(40), BRIDGE_STATE_DIR: ".bridge-state",
    BRIDGE_FINANCE_ENABLED: "true", BRIDGE_FINANCE_SINCE: "2026-01-01", BRIDGE_FINANCE_LOCAL_CURRENCY: "HNL", BRIDGE_FINANCE_SYSTEM_CURRENCY: "USD" };
  assert.equal(configurarFinanzas(v).maxConsultas, 10);
  assert.throws(() => configurarFinanzas({ ...v, BRIDGE_FINANCE_ENABLED: "false" }));
  assert.throws(() => configurarFinanzas({ ...v, BRIDGE_FINANCE_ROUTE_FIELD: "U_RUTA]; DROP TABLE" }));
  assert.throws(() => configurarFinanzas({ ...v, BRIDGE_FINANCE_SINCE: "2026-02-30" }));
});
test("finanzas: estado durable se recupera y rechaza cursor de pendiente alterado", async t => {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-finanzas-"));
  assert.equal(dirname(resolve(directorio)), resolve(tmpdir()));
  t.after(() => rm(directorio, { recursive: true, force: true }));
  const c = { ...config, directorio, origen: "origen-test" };
  const a = await abrirFinanzas(c, "clientes");
  await a.guardar({ ...a.estado, ultimaAtencion: "2026-10-09T12:00:00Z" });
  assert.equal((await abrirFinanzas(c, "clientes")).nuevo, false);
  await assert.rejects(abrirFinanzas({ ...c, origen: "otro" }, "clientes"), { code: "ESTADO_FINANCIERO_INVALIDO" });
  const recorrido = { recorridoId: "11111111-1111-4111-8111-111111111111", empresa: "TEST", desde: "2026-01-01",
    fuente: "a".repeat(64), modo: "completo", ventana: "2026-01-01", monedaLocal: "HNL", monedaSistema: "USD" };
  await writeFile(join(directorio, "finanzas-clientes.json"), JSON.stringify({ ...a.estado, recorrido,
    pendiente: { cursor: ["C999"], lote: { recorridoId: recorrido.recorridoId, secuencia: 1, registros: [filaCliente] } } }));
  await assert.rejects(abrirFinanzas(c, "clientes"), { code: "ESTADO_FINANCIERO_INVALIDO" });
});
