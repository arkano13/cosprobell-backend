import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { coordinarProduccion } from "../../puente/ejecutar-produccion.js";
import { ejecutarPeriodicas, paquetePeriodico } from "../../puente/finanzas.periodicas.js";
import { definicionesGetFinanzas } from "../../puente/finanzas.get.js";
import { GRUPOS_FINANCIEROS, actualizacionFinancieraSchema } from "../../src/shared/finanzas/periodicas.js";

const configBase = { empresa: "TEST", origen: "test", desde: "1900-01-01", monedaLocal: "LPS", monedaSistema: "USD",
  campoRuta: "U_ZONA", campoZona: null, maxConsultas: 4, maxDuracionMs: 10000, pausaMs: 0,
  frecuenciasPeriodicas: Object.fromEntries(Object.keys(GRUPOS_FINANCIEROS).map(g => [g, 3600])) };
const base = () => ({ protocolo: 1, listo: true, empresa: "TEST", desde: "1900-01-01", monedaLocal: "LPS", monedaSistema: "USD",
  versiones: Object.fromEntries(Object.values(GRUPOS_FINANCIEROS).flat().map(e => [e, randomUUID()])),
  ultimaLectura: Object.fromEntries(Object.values(GRUPOS_FINANCIEROS).flat().map(e => [e, "2026-11-04T12:00:00Z"])),
  maximos: { facturas: 100, notasCredito: 20, pagos: 30, movimientos: 200 } });
const factura = { DocEntry: 101, DocNum: 101, Series: 1, CardCode: "C1", DocDate: "2026-11-05", DocDueDate: "2026-12-05", TaxDate: "2026-11-05",
  DocCurrency: "LPS", DocTotal: "100", DocTotalFc: "0", DocTotalSys: "4", PaidToDate: "50", PaidToDateFC: "0", PaidToDateSys: "2",
  DocumentStatus: "bost_Open", SalesPersonCode: -1, PaymentGroupCode: -1, TransNum: 1, CancelStatus: "csCancellation",
  DocumentLines: [], DocumentInstallments: [] };

test("coordinador: producción primero; pendientes, fallos y comandos manuales aplazan finanzas", async () => {
  for (const [codigo, pendientes, args, esperado] of [[0, [], [], true], [1, [], [], false], [0, ["existencias"], [], false], [0, [], ["--forzar"], false]]) {
    const orden = [];
    const r = await coordinarProduccion({ args, entorno: { BRIDGE_FINANCE_PERIODIC_ENABLED: "true" }, informar: () => {},
      ejecutarOperativo: async () => { orden.push("operativo"); return { codigo, resumen: { pendientes } }; },
      ejecutarFinanciero: async () => { orden.push("financiero"); } });
    assert.equal(r, codigo); assert.deepEqual(orden, esperado ? ["operativo", "financiero"] : ["operativo"]);
  }
});

test("documento completo conserva más de cincuenta líneas y no acepta colecciones truncadas", () => {
  const defs = definicionesGetFinanzas(configBase), b = base();
  const dato = { ...factura, DocumentLines: Array.from({ length: 73 }, (_, LineNum) => ({ LineNum, ItemCode: "P", ItemDescription: null,
    Quantity: "1", Price: "583.6900000000001", LineTotal: "583.69", WarehouseCode: "99", BaseType: -1, BaseEntry: null, BaseLine: null })) };
  const p = paquetePeriodico(defs, "facturas", dato, configBase, b);
  assert.equal(p.registros.facturaLineas.length, 73);
  assert.equal(p.registros.facturaLineas[72].precio, "583.69");
  assert.equal(p.registros.facturas[0].cancelado, "C");
  assert.throws(() => paquetePeriodico(defs, "facturas", { ...dato, "DocumentLines@odata.nextLink": "otra" }, configBase, b), { code: "COLECCION_FINANCIERA_INCOMPLETA" });
  const incompleto = structuredClone(p); delete incompleto.registros.cuotas;
  assert.equal(actualizacionFinancieraSchema.safeParse(incompleto).success, false);
  const mezclado = structuredClone(p); mezclado.registros.facturaLineas[0].docEntry = 999;
  assert.equal(actualizacionFinancieraSchema.safeParse(mezclado).success, false);
});

test("periódico GET: nuevos primero, presupuesto propio y acuse perdido conserva exactamente el documento", async () => {
  const directorio = await mkdtemp(join(tmpdir(), "finanzas-periodicas-"));
  const b = base(), config = { ...configBase, directorio };
  const rutas = [], cuerpos = []; let perder = true;
  const crearSap = cfg => ({ async leerRecursoFinanciero(ruta) {
    await cfg.control.antesDeConsultar(); rutas.push(decodeURIComponent(ruta));
    return { value: ruta.startsWith("Invoices?") && !ruta.includes("%28101%29") ? [factura] : [] };
  }, async cerrar() {} });
  const crearBackend = () => async (_entidad, accion, cuerpo) => {
    if (accion === "estado") return b;
    cuerpos.push(structuredClone(cuerpo));
    if (perder) { perder = false; throw Object.assign(new Error("acuse perdido"), { code: "CONEXION_O_TLS" }); }
    return { operacionId: cuerpo.operacionId, normalizado: true, cambios: ["facturas"], repetido: true };
  };
  try {
    await assert.rejects(ejecutarPeriodicas({ config, crearSap, crearBackend, informar: () => {} }), { code: "CONEXION_O_TLS" });
    const guardado = JSON.parse(await readFile(join(directorio, "finanzas-periodicas.json"), "utf8"));
    assert.ok(guardado.pendiente);
    // La reanudación devuelve vacío al siguiente DocEntry; no reenvía otro cuerpo antes del pendiente.
    const sapVacio = cfg => ({ async leerRecursoFinanciero(ruta) { await cfg.control.antesDeConsultar(); rutas.push(decodeURIComponent(ruta)); return { value: [] }; }, async cerrar() {} });
    await ejecutarPeriodicas({ config, crearSap: sapVacio, crearBackend, informar: () => {} });
    assert.deepEqual(cuerpos[0], cuerpos[1]);
    assert.match(rutas[0], /DocEntry gt 100/);
    assert.equal(rutas.filter(r => !r.includes("UpdateDate")).length, 5);
    assert.equal(JSON.parse(await readFile(join(directorio, "finanzas-periodicas.json"), "utf8")).pendiente, null);
  } finally { await rm(directorio, { recursive: true, force: true }); }
});
