import test from "node:test";
import assert from "node:assert/strict";
import { definicionesGetFinanzas, leerPaginaGet, leerJsonFinancieroGet } from "../../puente/finanzas.get.js";
import { transformarFinanzas, normalizarPrecioSap } from "../../puente/finanzas.transformar.js";
import { sincronizarPaginaFinanzas, fuenteFinanzas } from "../../puente/finanzas.sincronizar.js";
import { importarTanda, informeImportacion } from "../../puente/finanzas.importar.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { snapshotFinanciero } from "../../src/shared/finanzas/contratos.js";

const config = { empresa: "TEST", desde: "1900-01-01", monedaLocal: "LPS", monedaSistema: "USD", campoRuta: "U_ZONA", campoZona: null };
const defs = definicionesGetFinanzas(config), recorrido = { ventana: config.desde };
const factura = { DocEntry: 17065, DocNum: 5, Series: 1, CardCode: "C1", DocDate: "2020-01-01", DocDueDate: "2020-02-01", TaxDate: "2020-01-01",
  DocCurrency: "LPS", DocTotal: "100", DocTotalFc: "0", DocTotalSys: "4", PaidToDate: "50", PaidToDateFC: "0", PaidToDateSys: "2",
  DocumentStatus: "bost_Open", SalesPersonCode: -1, PaymentGroupCode: -1, TransNum: 1, Cancelled: "tNO", CancelStatus: "csNo" };
const fake = value => ({ leerRecursoFinanciero: async (_ruta, lector) => lector(Response.json({ value })) });
const almacen = (estado = {}) => ({ nuevo: true, estado: { secuencia: 0, cursor: null, recorrido: null, pendiente: null, ...estado }, async guardar(s) { this.estado = structuredClone(s); } });

test("precios: admite residuos mínimos sin redondear precisión real ni totales", async () => {
  for (const [entrada, esperado] of [["583.6900000000001", "583.69"], ["-583.6900000000001", "-583.69"],
    ["1.0000000000000002", "1"], ["583.6900000000000", "583.69"], ["0.000000000", "0"]]) {
    assert.equal(normalizarPrecioSap(entrada), esperado);
  }
  for (const entrada of ["583.6900001", "583.6900012", "0.0000000000001", "9999999999999.1234567", "1e1000000", null]) {
    assert.equal(normalizarPrecioSap(entrada), entrada);
  }
  const linea = { LineNum: 0, ItemCode: "P", ItemDescription: "Producto", Quantity: 1, Price: 583.6900000000001,
    LineTotal: 583.69, WarehouseCode: "02", BaseType: -1, BaseEntry: null, BaseLine: null };
  for (const entidad of ["notaCreditoLineas", "facturaLineas"]) {
    const pagina = await leerPaginaGet({ sap: fake([{ ...factura, DocumentLines: [linea] }]), def: defs[entidad], config, recorrido });
    assert.equal(transformarFinanzas(entidad, pagina.filas, null)[0].precio, "583.69");
    assert.throws(() => transformarFinanzas(entidad, [{ ...pagina.filas[0], precio: "583.6900001" }], null), { code: "FINANZA_SAP_INVALIDA" });
    assert.throws(() => transformarFinanzas(entidad, [{ ...pagina.filas[0], total: "583.6900000000001" }], null), { code: "FINANZA_SAP_INVALIDA" });
  }
});

test("GET: transporta importes exactos, incluye cancelaciones y no incluye conciliaciones", async () => {
  const dato = await leerJsonFinancieroGet(new Response('{"DocEntry":1,"DocTotal":9999999999999.123456,"Quantity":1E-06}'));
  assert.deepEqual(dato, { DocEntry: 1, DocTotal: "9999999999999.123456", Quantity: "0.000001" });
  assert.equal(defs.conciliaciones, undefined); assert.equal(defs.partidas, undefined);
  const p = await leerPaginaGet({ sap: fake([{ ...factura, Cancelled: undefined, CancelStatus: "csCancellation" }]), def: defs.facturas, config, recorrido });
  assert.equal(transformarFinanzas("facturas", p.filas, null)[0].cancelado, "C");
});
test("GET: historial completo sin filtro de almacén, pago o fechas incrementales", async () => {
  let ruta;
  await leerPaginaGet({ sap: { leerRecursoFinanciero: async r => { ruta = decodeURIComponent(r); return { value: [] }; } }, def: defs.facturas, config, recorrido });
  assert.match(ruta, /DocDate ge '1900-01-01'/);
  assert.doesNotMatch(ruta, /Warehouse|bost_Open|UpdateDate|CreationDate/);
});
test("GET: importes desconocidos permanecen null en pagos y cuotas", async () => {
  const p = await leerPaginaGet({ sap: fake([{ DocEntry: 1, DocNum: 2, Series: 1, CardCode: "C1", DocDate: "2020-01-01", DocCurrency: "LPS", CashSum: "100", TransferSum: "0", Cancelled: "tNO" }]), def: defs.pagos, config, recorrido });
  assert.equal(transformarFinanzas("pagos", p.filas, null)[0].total, null);
  const c = await leerPaginaGet({ sap: fake([{ ...factura, DocumentInstallments: [{ InstallmentId: 1, DueDate: "2020-02-01", Total: "100", TotalFC: "0" }] }]), def: defs.cuotas, config, recorrido });
  assert.equal(transformarFinanzas("cuotas", c.filas, null)[0].pagado, null);
  for (const entidad of Object.keys(defs)) assert.equal(snapshotFinanciero(entidad, { lectura: "get_parcial" }), true);
});

test("GET: cuota con TotalFC null conserva el desconocido y mantiene el contrato del receptor", async () => {
  for (const totalFC of [null, "0", "14.25"]) {
    const pagina = await leerPaginaGet({ sap: fake([{ ...factura, DocumentInstallments: [{ InstallmentId: 1,
      DueDate: "2020-02-01", Total: "390.0", TotalFC: totalFC }] }]), def: defs.cuotas, config, recorrido });
    const registros = transformarFinanzas("cuotas", pagina.filas, null);
    assert.equal(registros[0].totalFC, totalFC);
    assert.equal(registros[0].total, "390.0");
  }
  const pagina = await leerPaginaGet({ sap: fake([{ ...factura, DocumentInstallments: [{ InstallmentId: 1,
    DueDate: "2020-02-01", Total: "390.0" }] }]), def: defs.cuotas, config, recorrido });
  assert.throws(() => transformarFinanzas("cuotas", pagina.filas, null), { code: "FINANZA_SAP_INVALIDA" });
});
test("GET: divide 73 líneas y rechaza una colección parcial o un cursor que retrocede", async () => {
  const f = { ...factura, DocumentLines: Array.from({ length: 73 }, (_, LineNum) => ({ LineNum, ItemCode: "P1", ItemDescription: "Producto", Quantity: "1", Price: "2", LineTotal: "2", WarehouseCode: "02", BaseType: -1, BaseEntry: null, BaseLine: null })) };
  const entrada = { sap: fake([f]), def: defs.facturaLineas, config, recorrido };
  const a = await leerPaginaGet(entrada);
  const b = await leerPaginaGet({ ...entrada, cursorSap: a.cursorSap });
  assert.equal(a.filas.length, 50); assert.equal(b.filas.length, 23);
  assert.equal(transformarFinanzas("facturaLineas", [...a.filas, ...b.filas], null).at(-1).linea, 72);
  assert.deepEqual(b.cursorSap, { id: 17065, linea: null });
  await assert.rejects(leerPaginaGet({ ...entrada, sap: fake([{ ...f, "DocumentLines@odata.nextLink": "otra" }]) }), { code: "COLECCION_FINANCIERA_INCOMPLETA" });
  await assert.rejects(leerPaginaGet({ ...entrada, cursorSap: { id: 17066, linea: 1 } }), { code: "PAGINACION_SIN_AVANCE" });
});
test("GET: documento sin aplicaciones no cierra el historial y asientos sin tipo no se inventan", async () => {
  const p = await leerPaginaGet({ sap: fake([{ DocEntry: 2, PaymentInvoices: [] }]), def: defs.aplicacionesPagos, config, recorrido });
  assert.deepEqual(p, { filas: [], cursorSap: { id: 2, linea: null }, completo: false });
  await assert.rejects(leerPaginaGet({ sap: fake([{ JdtNum: 1, JournalEntryLines: [{ Line_ID: 0 }] }]), def: defs.movimientos, config, recorrido }), { code: "FINANZA_SAP_INVALIDA" });
});
test("GET: agrupa documentos pequeños y retoma exactamente dentro del último", async () => {
  const documentos = [1,2,3].map(DocEntry => ({ ...factura, DocEntry, DocumentLines: Array.from({ length: 23 }, (_, LineNum) => ({
    LineNum, ItemCode: "P1", ItemDescription: "Producto", Quantity: "1", Price: "2", LineTotal: "2", WarehouseCode: "02", BaseType: -1, BaseEntry: null, BaseLine: null })) }));
  const a = await leerPaginaGet({ sap: fake(documentos), def: defs.facturaLineas, config, recorrido });
  assert.equal(a.filas.length, 50); assert.deepEqual(a.cursorSap, { id: 3, linea: 3 });
  const b = await leerPaginaGet({ sap: fake([documentos[2]]), def: defs.facturaLineas, config, recorrido, cursorSap: a.cursorSap });
  assert.equal(b.filas.length, 19); assert.deepEqual(b.cursorSap, { id: 3, linea: null });
  assert.equal(transformarFinanzas("facturaLineas", [...a.filas, ...b.filas], null).length, 69);
});
test("GET: un acuse perdido reenvía el mismo lote antes de avanzar el cursor", async () => {
  const a = almacen(); let lecturas = 0, envios = 0, remoto;
  const sap = { leerRecursoFinanciero: async () => { lecturas++; return { value: [factura] }; } };
  const backend = async (_e, accion, dato) => {
    if (accion === "estado") return remoto;
    if (accion === "iniciar") { remoto ??= { ...dato, secuencia: 0 }; return { recorridoId: dato.recorridoId }; }
    if (accion === "lote") { remoto.secuencia = dato.secuencia; if (++envios === 1) throw new Error("acuse perdido");
      return { secuencia: dato.secuencia, recibidos: dato.registros.length, repetido: true }; }
  };
  await assert.rejects(sincronizarPaginaFinanzas({ config, def: defs.facturas, almacen: a, sap, backend }));
  assert.equal(a.estado.cursorSap, null);
  await sincronizarPaginaFinanzas({ config, def: defs.facturas, almacen: a, sap, backend });
  assert.equal(lecturas, 1); assert.equal(a.estado.cantidadConfirmada, 1);
  assert.deepEqual(a.estado.cursorSap, { id: 17065, linea: null });
});
test("GET: el cliente solo permite GET de recursos admitidos además de Login/Logout", async () => {
  const llamadas = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1", empresa: "TEST" }, async (url, o) => {
    llamadas.push([url, o.method ?? "GET"]);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticia" } });
    if (url.endsWith("/Logout")) return new Response(null, { status: 204 });
    return Response.json({ value: [] });
  });
  await sap.leerRecursoFinanciero("Invoices?$top=1", leerJsonFinancieroGet);
  await assert.rejects(sap.leerRecursoFinanciero("SQLQueries?$top=1", leerJsonFinancieroGet), { code: "RECURSO_FINANCIERO_INVALIDO" });
  await sap.cerrar();
  assert.deepEqual(llamadas.map(x => x[1]), ["POST", "GET", "POST"]);
});
test("tandas: reparten atención, respetan presupuesto y no vuelven a cargar lo terminado", async () => {
  const trabajos = ["empresa", "clientes", "facturas"].map(nombre => ({ def: defs[nombre], almacen: almacen() }));
  const llamadas = [];
  const r = await importarTanda({ config, trabajos, sincronizar: async ({ def, almacen: a }) => {
    llamadas.push(def.nombre);
    if (llamadas.length === 3) throw Object.assign(new Error(), { code: "PRESUPUESTO_AGOTADO" });
    if (def.nombre === "empresa") {
      await a.guardar({ ...a.estado, fuente: fuenteFinanzas(def, config), ultimoCompleto: new Date().toISOString(), cantidadConfirmada: 1 });
      return { completo: true };
    }
    return { completo: false };
  } });
  assert.equal(r.completo, false); assert.deepEqual(llamadas, ["empresa", "clientes", "facturas"]);
  const siguientes = [];
  await importarTanda({ config, trabajos, sincronizar: async ({ def, almacen: a }) => {
    siguientes.push(def.nombre);
    await a.guardar({ ...a.estado, fuente: fuenteFinanzas(def, config), ultimoCompleto: new Date().toISOString() });
    return { completo: true };
  } });
  assert.equal(siguientes.includes("empresa"), false);
  assert.equal(informeImportacion(config, trabajos).completo, true);
  assert.equal(informeImportacion(config, trabajos).carteraCompleta, false);
});
test("tandas: un error conserva el contexto y detiene el resto de las entidades", async () => {
  const trabajos = ["clientes", "facturas"].map(nombre => ({ def: defs[nombre], almacen: almacen() }));
  let n = 0;
  await assert.rejects(importarTanda({ config, trabajos, sincronizar: async () => {
    n++; throw Object.assign(new Error(), { code: "HTTP_401" });
  } }), e => e.code === "HTTP_401" && e.entidadFinanciera === "clientes");
  assert.equal(n, 1);
});
