import test from "node:test";
import assert from "node:assert/strict";
import { lineasDeEntrada, guardarTrasladoEntrada } from "../../src/modules/sincronizacion/trasladosEntrada.repository.js";
import { loteTrasladosEntradaSchema } from "../../src/modules/sincronizacion/trasladosEntrada.schemas.js";

const traslado = { docEntry: 900, docNum: 4695, cardCode: null, docDate: "2026-10-16", fromWarehouse: "01", toWarehouse: "02", lineas: [
  { lineNum: 0, itemCode: "ER10033", quantity: 60, fromWarehouseCode: "01", warehouseCode: "02", uomEntry: null, uomCode: null, inventoryQuantity: null },
  { lineNum: 1, itemCode: "RD10054", quantity: 2, fromWarehouseCode: "01", warehouseCode: "02", uomEntry: 5, uomCode: "CJ12", inventoryQuantity: 24 },
  { lineNum: 2, itemCode: "X1", quantity: 5, fromWarehouseCode: "01", warehouseCode: "03", uomEntry: null, uomCode: null, inventoryQuantity: null },
  { lineNum: 3, itemCode: "X2", quantity: 5, fromWarehouseCode: "04", warehouseCode: "02", uomEntry: null, uomCode: null, inventoryQuantity: null },
] };

test("traslados de la 01 a la 02: solo las líneas de la grande a la pequeña, en unidades de inventario", () => {
  assert.equal(loteTrasladosEntradaSchema.safeParse({ version: 1, empresa: "E", secuencia: 1, trasladosEntrada: [traslado] }).success, true);
  assert.deepEqual(lineasDeEntrada(traslado, { grande: "01", pequena: "02" }),
    [{ lineNum: 0, itemCode: "ER10033", unidades: 60 }, { lineNum: 1, itemCode: "RD10054", unidades: 24 }]);
  assert.deepEqual(lineasDeEntrada(traslado, { grande: "04", pequena: "02" }), [{ lineNum: 3, itemCode: "X2", unidades: 5 }]);
});

test("traslados de la 01 a la 02: la cancelación (cantidades negativas) se recibe y no deja nada por pasar", async () => {
  const { construirLoteTrasladosEntrada, construirLoteTrasladosPreparacion } = await import("../../puente/trasladosPreparacion.js");
  const linea = { LineNum: 0, ItemCode: "ER10017", Quantity: -1, FromWarehouseCode: "01", WarehouseCode: "02", UoMEntry: -1, UoMCode: "Manual", InventoryQuantity: -1 };
  const sap = { DocEntry: 5015, DocNum: 4727, DocDate: "2026-10-26", CardCode: null, FromWarehouse: "01", ToWarehouse: "02", StockTransferLines: [linea] };
  const lote = construirLoteTrasladosEntrada([sap], "E", 1);
  assert.deepEqual(lineasDeEntrada(lote.trasladosEntrada[0], { grande: "01", pequena: "02" }), []);
  // Los que salen de la 02 siguen sin aceptar cantidades negativas.
  assert.throws(() => construirLoteTrasladosPreparacion([{ ...sap, FromWarehouse: "02", ToWarehouse: "C64" }], "E", 1), { code: "TRASLADO_SAP_INVALIDO" });
});

test("traslados de la 01 a la 02: al volver a recibirlo no se pierde lo ya pasado", async () => {
  const guardadas = new Map([["900|0", { id: 1, aceptadas: 60 }]]);
  const hecho = { traslados: [], creadas: [], actualizadas: [] };
  const tx = {
    configuracion: { findUnique: async () => ({ valor: { grande: "01", pequena: "02" } }) },
    trasladoEntrada: { upsert: async (a) => hecho.traslados.push(a.create.docNum) },
    trasladoEntradaLinea: {
      findUnique: async ({ where }) => guardadas.get(`${where.docEntry_lineNum.docEntry}|${where.docEntry_lineNum.lineNum}`) ?? null,
      create: async ({ data }) => hecho.creadas.push([data.lineNum, data.unidades]),
      update: async ({ where, data }) => hecho.actualizadas.push([where.id, data.unidades]),
    },
  };
  await guardarTrasladoEntrada(traslado, tx);
  assert.deepEqual(hecho, { traslados: [4695], creadas: [[1, 24]], actualizadas: [[1, 60]] });
});
