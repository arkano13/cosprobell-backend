import test from "node:test";
import assert from "node:assert/strict";
import { ALMACENES, EXISTENCIAS, DOCUMENTOS, ENTIDADES } from "../../puente/entidades.js";
import { construirLoteAlmacenes } from "../../puente/almacenes.js";
import { construirLoteExistencias } from "../../puente/existencias.js";
import { crearConstructorDocumentos } from "../../puente/documentos.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { configurar } from "../../puente/config.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const { ENTIDADES_SINCRONIZABLES } = await import("../../src/modules/sincronizacion/sincronizacion.service.js");
const detalleDe = (fn) => { try { fn(); } catch (e) { return [e.code, e.detalle]; } assert.fail("debía fallar"); };
const fila = (codigo, inStock, extra = {}) => ({ WarehouseCode: codigo, InStock: inStock, Committed: 0, Ordered: 0, ...extra });

test("cada entidad del puente tiene su ruta en el backend", () => {
  for (const e of ENTIDADES) assert.ok(ENTIDADES_SINCRONIZABLES.includes(e.nombre), e.nombre);
  assert.equal(new Set(ENTIDADES.map((e) => e.nombre)).size, ENTIDADES.length);
});

test("almacenes: Warehouses con nombre vacío muestra el código", () => {
  assert.deepEqual(construirLoteAlmacenes([{ WarehouseCode: "01", WarehouseName: "Central", Inactive: "tNO" },
    { WarehouseCode: "V05", WarehouseName: "", Inactive: "tYES" }], "TEST", 1).almacenes,
  [{ warehouseCode: "01", warehouseName: "Central", inactive: false }, { warehouseCode: "V05", warehouseName: "V05", inactive: true }]);
  assert.deepEqual(detalleDe(() => construirLoteAlmacenes([{ WarehouseCode: "01", WarehouseName: "X", Inactive: null }], "TEST", 1)),
    ["ALMACEN_SAP_INVALIDO", { warehouseCode: "01", campo: "Inactive" }]);
});

test("existencias: solo los almacenes con algún valor, ordenados, y un artículo sin nada queda vacío", () => {
  const lote = construirLoteExistencias([
    { ItemCode: "P1", ItemWarehouseInfoCollection: [fila("V05", 7), fila("01", 0), fila("02", 0, { Ordered: 5 }), fila("01A", 100, { Committed: 3 })] },
    { ItemCode: "P2", ItemWarehouseInfoCollection: [fila("01", 0), fila("V05", 0)] },
  ], "TEST", 1);
  assert.deepEqual(lote.existencias, [
    { itemCode: "P1", almacenes: [{ warehouseCode: "01A", inStock: 100, committed: 3, ordered: 0 },
      { warehouseCode: "02", inStock: 0, committed: 0, ordered: 5 }, { warehouseCode: "V05", inStock: 7, committed: 0, ordered: 0 }] },
    { itemCode: "P2", almacenes: [] }]);
  // Mismo contenido en otro orden: misma huella.
  const otro = construirLoteExistencias([{ ItemCode: "P1", ItemWarehouseInfoCollection: [fila("01A", 100, { Committed: 3 }), fila("V05", 7), fila("02", 0, { Ordered: 5 })] }], "TEST", 1);
  assert.deepEqual(otro.existencias[0], lote.existencias[0]);
  assert.deepEqual(detalleDe(() => construirLoteExistencias([{ ItemCode: "P3" }], "TEST", 1)),
    ["EXISTENCIA_SAP_INVALIDA", { itemCode: "P3", campo: "ItemWarehouseInfoCollection" }]);
  assert.deepEqual(detalleDe(() => construirLoteExistencias([{ ItemCode: "P4", ItemWarehouseInfoCollection: [],
    "ItemWarehouseInfoCollection@odata.nextLink": "x" }], "TEST", 1))[0], "EXISTENCIA_SAP_INVALIDA");
  assert.deepEqual(detalleDe(() => construirLoteExistencias([{ ItemCode: "P5", ItemWarehouseInfoCollection: [fila("01", "7")] }], "TEST", 1)),
    ["EXISTENCIA_SAP_INVALIDA", { itemCode: "P5", campo: "ItemWarehouseInfoCollection" }]);
});

test("documentos: líneas de artículos con la cantidad de inventario; comentario recortado", () => {
  const construir = crearConstructorDocumentos("salidasInventario");
  const [doc] = construir([{ DocEntry: 77, DocNum: 1377, DocDate: "2026-09-30", Comments: `  Vencido, lote L2408-090${" ".repeat(3)}`, Cancelled: "tNO",
    DocumentLines: [
      { LineNum: 2, ItemCode: "P2", Quantity: 1, InventoryQuantity: 12, WarehouseCode: "01" },
      { LineNum: 0, ItemCode: "P1", Quantity: 100, InventoryQuantity: null, WarehouseCode: "" },
      { LineNum: 1, ItemCode: "", Quantity: 1, WarehouseCode: "01" },
    ] }], "TEST", 1).salidasInventario;
  assert.deepEqual(doc, { docEntry: 77, docNum: 1377, docDate: "2026-09-30", comentarios: "Vencido, lote L2408-090", cancelado: false,
    lineas: [{ lineNum: 0, itemCode: "P1", warehouseCode: null, cantidad: 100 }, { lineNum: 2, itemCode: "P2", warehouseCode: "01", cantidad: 12 }] });
  const largo = construir([{ DocEntry: 78, DocNum: 1, DocDate: "2026-09-30T00:00:00Z", Comments: "x".repeat(400), Cancelled: "tYES", DocumentLines: [] }], "TEST", 1).salidasInventario[0];
  assert.deepEqual([largo.comentarios.length, largo.docDate, largo.cancelado], [254, "2026-09-30", true]);
  assert.deepEqual(detalleDe(() => construir([{ DocEntry: 79, DocNum: 1, DocDate: "2026-09-30", Comments: null, Cancelled: "tNO" }], "TEST", 1)),
    ["DOCUMENTO_SAP_INVALIDO", { docEntry: 79, campo: "DocumentLines" }]);
  // El documento que revierte una cancelación llega sin Cancelled y con CancelStatus csCancellation.
  const base = { DocNum: 1, DocDate: "2026-09-30", Comments: null, DocumentLines: [] };
  assert.deepEqual(construir([{ ...base, DocEntry: 80, CancelStatus: "csCancellation" }, { ...base, DocEntry: 81, Cancelled: "tYES", CancelStatus: "csYes" },
    { ...base, DocEntry: 82, Cancelled: "tNO", CancelStatus: "csNo" }, { ...base, DocEntry: 83, Cancelled: "tNO" }], "TEST", 1).salidasInventario.map((d) => d.cancelado),
  [true, true, false, false]);
  assert.deepEqual(detalleDe(() => construir([{ ...base, DocEntry: 84 }], "TEST", 1)), ["DOCUMENTO_SAP_INVALIDO", { docEntry: 84, campo: "Cancelled" }]);
});

test("SAP: existencias por artículo de inventario y documentos desde hace N días", async () => {
  const urls = [];
  const config = { sapUrl: "https://sap.test/b1s/v1", empresa: "TEST", documentosDias: 7 };
  const sap = crearClienteSap(config, async (url, opciones) => {
    urls.push([url, opciones?.headers?.Prefer]);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticio" } });
    return Response.json({ value: [] });
  });
  await sap.pagina("P9", EXISTENCIAS);
  await sap.pagina(null, ALMACENES);
  const salidas = DOCUMENTOS.find((d) => d.nombre === "salidasInventario"), compras = DOCUMENTOS.find((d) => d.nombre === "entradasCompra");
  await sap.pagina(500, salidas); await sap.pagina(null, compras);
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(urls[1], ["https://sap.test/b1s/v1/Items?$select=ItemCode,ItemWarehouseInfoCollection&$orderby=ItemCode%20asc&$top=20&$filter="
    + encodeURIComponent("InventoryItem eq 'tYES' and ItemCode gt 'P9'"), "odata.maxpagesize=20"]);
  assert.equal(urls[2][0], "https://sap.test/b1s/v1/Warehouses?$select=WarehouseCode,WarehouseName,Inactive&$orderby=WarehouseCode%20asc&$top=50");
  assert.equal(urls[3][0], "https://sap.test/b1s/v1/InventoryGenExits?$select=DocEntry,DocNum,DocDate,Comments,Cancelled,CancelStatus,DocumentLines&$orderby=DocEntry%20asc&$top=10&$filter="
    + encodeURIComponent(`DocDate ge '${desde}' and DocEntry gt 500`));
  assert.ok(urls[4][0].includes(encodeURIComponent(`DocType eq 'dDocument_Items' and DocDate ge '${desde}'`)));
});

test("configuración: días de documentos entre 1 y 365, 30 por defecto", () => {
  const base = { SAP_COMPANY_DB: "TEST", SAP_USER: "u", SAP_PASSWORD: "p", BRIDGE_API_KEY: "x".repeat(32), BRIDGE_STATE_DIR: "estado",
    SAP_SERVICE_LAYER_URL: "https://sap.test/b1s/v1", BACKEND_URL: "https://api.test" };
  assert.equal(configurar(base).documentosDias, 30);
  assert.equal(configurar({ ...base, BRIDGE_DOCUMENTOS_DIAS: "90" }).documentosDias, 90);
  assert.throws(() => configurar({ ...base, BRIDGE_DOCUMENTOS_DIAS: "0" }), /BRIDGE_DOCUMENTOS_DIAS/);
  assert.equal(configurar({ ...base, BRIDGE_FREQUENCIES_JSON: JSON.stringify({ existencias: 600, salidasInventario: 900, almacenes: 86400 }) }).frecuencias.existencias, 600);
});
