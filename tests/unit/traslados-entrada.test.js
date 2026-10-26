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
    trasladoEntrada: { findUnique: async () => null, upsert: async (a) => hecho.traslados.push(a.create.docNum) },
    trasladoEntradaLinea: {
      findUnique: async ({ where }) => guardadas.get(`${where.docEntry_lineNum.docEntry}|${where.docEntry_lineNum.lineNum}`) ?? null,
      create: async ({ data }) => hecho.creadas.push([data.lineNum, data.unidades]),
      update: async ({ where, data }) => hecho.actualizadas.push([where.id, data.unidades]),
    },
  };
  await guardarTrasladoEntrada(traslado, tx);
  assert.deepEqual(hecho, { traslados: [4695], creadas: [[1, 24]], actualizadas: [[1, 60]] });
});

test("traslados de la 01 a la 02: la cancelación cierra solo un original único, una sola vez", async () => {
  const linea = (docEntry, lineNum, itemCode, unidades, extra = {}) => ({ id: docEntry * 100 + lineNum, docEntry, lineNum, itemCode, unidades,
    aceptadas: 0, cerradaPor: null, ...extra });
  const tx = (lineas, recibidos = new Map()) => ({
    configuracion: { findUnique: async () => null },
    trasladoEntrada: { findUnique: async ({ where }) => recibidos.get(where.docEntry) ?? null,
      upsert: async ({ where, create }) => { if (!recibidos.has(where.docEntry)) recibidos.set(where.docEntry, create); } },
    trasladoEntradaLinea: {
      findUnique: async () => null, create: async () => {}, update: async () => {},
      findMany: async ({ where }) => {
        if (where.itemCode) {
          const vistos = lineas.filter((l) => l.docEntry < where.docEntry.lt && where.itemCode.in.includes(l.itemCode) && l.aceptadas === 0 && !l.cerradaPor)
            .map((l) => l.docEntry);
          return [...new Set(vistos)].map((docEntry) => ({ docEntry }));
        }
        return lineas.filter((l) => l.docEntry === where.docEntry);
      },
      updateMany: async ({ where, data }) => lineas.filter((l) => l.docEntry === where.docEntry && l.aceptadas === 0 && !l.cerradaPor)
        .forEach((l) => Object.assign(l, data)),
    },
  });
  const cancelacion = { docEntry: 5015, docNum: 4727, cardCode: null, docDate: "2026-10-26", fromWarehouse: "01", toWarehouse: "02", lineas: [
    { lineNum: 0, itemCode: "ER10017", quantity: -1, fromWarehouseCode: "01", warehouseCode: "02", uomEntry: -1, uomCode: "Manual", inventoryQuantity: -1 },
    { lineNum: 1, itemCode: "ER10020", quantity: -12, fromWarehouseCode: "01", warehouseCode: "02", uomEntry: -1, uomCode: "Manual", inventoryQuantity: -12 },
  ] };
  const cerrados = (lineas) => [...new Set(lineas.filter((l) => l.cerradaPor).map((l) => `${l.docEntry}:${l.cerradaPor}`))];
  // Un solo original idéntico y anterior: se cierra (el rehecho 5016 es posterior y el 4990 es distinto).
  const unico = [linea(5014, 0, "ER10020", 12), linea(5014, 1, "ER10017", 1), linea(5016, 0, "ER10017", 1), linea(5016, 1, "ER10020", 12),
    linea(4990, 0, "ER10017", 1), linea(4990, 1, "ER10020", 6)];
  const recibidos = new Map();
  await guardarTrasladoEntrada(cancelacion, tx(unico, recibidos));
  assert.deepEqual(cerrados(unico), ["5014:cancelado en SAP (4727)"]);
  assert.deepEqual([recibidos.get(5015).cancelacion, recibidos.get(5015).cancelaDocEntry], ["vinculada", 5014]);
  // Al volver a recibirla no se busca otra vez, aunque ahora haya otro idéntico anterior sin cerrar.
  unico.push(linea(5000, 0, "ER10017", 1), linea(5000, 1, "ER10020", 12));
  await guardarTrasladoEntrada(cancelacion, tx(unico, recibidos));
  assert.deepEqual(cerrados(unico), ["5014:cancelado en SAP (4727)"]);
  // Dos originales idénticos y la misma cancelación recibida dos veces: no se sabe cuál canceló SAP. Queda "ambigua" para
  // el supervisor y la segunda vez no se decide otra cosa, aunque para entonces uno de los dos ya tenga algo pasado.
  const dos = [linea(5014, 0, "ER10020", 12), linea(5014, 1, "ER10017", 1), linea(5010, 0, "ER10017", 1), linea(5010, 1, "ER10020", 12)];
  const recibidosDos = new Map();
  await guardarTrasladoEntrada(cancelacion, tx(dos, recibidosDos));
  assert.deepEqual(cerrados(dos), []);
  assert.deepEqual([recibidosDos.get(5015).cancelacion, recibidosDos.get(5015).cancelaDocEntry], ["ambigua", null]);
  dos[2].aceptadas = 1;
  await guardarTrasladoEntrada(cancelacion, tx(dos, recibidosDos));
  assert.deepEqual(cerrados(dos), []);
  assert.equal(recibidosDos.get(5015).cancelacion, "ambigua");
  // Con algo ya pasado del original, tampoco se toca.
  const pasado = [linea(5014, 0, "ER10020", 12, { aceptadas: 6 }), linea(5014, 1, "ER10017", 1)];
  const recibidosPasado = new Map();
  await guardarTrasladoEntrada(cancelacion, tx(pasado, recibidosPasado));
  assert.deepEqual(cerrados(pasado), []);
  assert.equal(recibidosPasado.get(5015).cancelacion, "sin_original");
});
