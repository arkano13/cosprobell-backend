import test from "node:test";
import assert from "node:assert/strict";
import { armarCuadre } from "../../src/modules/inventario/inventario.reporte.js";

const ahora = Date.parse("2026-10-09T15:00:00Z");
const fila = (itemCode, datos) => ({ itemCode, itemName: `Producto ${itemCode}`, sap: 0, grande: 0, pequena: 0, sinEntrega: 0, adelantado: 0,
  activo: true, sapCambioEn: null, ...datos });
const bodega = (itemCode, datos) => [itemCode, { itemCode, sapGrande: 0, sapPequena: 0, contadoGrande: true, contadoPequena: true, ...datos }];
const armar = (filas, bodegas) => armarCuadre({ filas, porBodega: new Map(bodegas), ahora });

test("separa lo que cuadra, lo que tiene menos y lo que tiene más, con la diferencia de cada bodega", () => {
  const r = armar([
    fila("A", { sap: 78, grande: 60, pequena: 18 }),
    fila("B", { sap: 149, pequena: 20 }),
    fila("C", { sap: 60 + 6, grande: 42, pequena: 6 }),
    fila("D", { sap: 19, pequena: 34 }),
  ], [bodega("A", { sapGrande: 60, sapPequena: 18 }), bodega("B", { sapPequena: 149 }), bodega("C", { sapGrande: 60, sapPequena: 6 }),
    bodega("D", { sapPequena: 19 })]);
  assert.deepEqual(r.resumen, { contados: 4, cuadran: 1, menos: { productos: 2, unidades: -147 }, mas: { productos: 1, unidades: 15 },
    pendientes: 0, actualizando: 0 });
  assert.deepEqual(r.menos.map((x) => [x.itemCode, x.diferencia]), [["B", -129], ["C", -18]]);
  assert.deepEqual(r.menos[1].grande, { contado: 42, sap: 60, diferencia: -18 });
  assert.deepEqual(r.menos[1].pequena, { contado: 6, sinEntrega: 0, sap: 6, diferencia: 0 });
  assert.deepEqual(r.mas.map((x) => [x.itemCode, x.diferencia]), [["D", 15]]);
});

test("lo que falta contar en alguna bodega no entra: solo se cuenta como pendiente", () => {
  const r = armar([
    fila("RD", { sap: 840 + 32, pequena: 21 }),
    fila("G9", { sap: 90 + 38, grande: 90 }),
    fila("SIN", { sap: 10, activo: false }),
  ], [bodega("RD", { sapGrande: 840, sapPequena: 32, contadoGrande: false }),
    bodega("G9", { sapGrande: 90, sapPequena: 38, contadoPequena: false })]);
  assert.equal(r.resumen.pendientes, 2);
  assert.equal(r.resumen.contados, 0);
  assert.deepEqual([r.menos, r.mas], [[], []]);
});

test("una bodega sin nada en SAP no hace falta contarla; con unidades registradas cuenta como contada", () => {
  const r = armar([fila("X", { sap: 12, pequena: 12 }), fila("Y", { sap: 30, grande: 24, pequena: 6 })],
    [bodega("X", { sapPequena: 12, contadoGrande: false }), bodega("Y", { sapGrande: 24, sapPequena: 6, contadoGrande: false, contadoPequena: false })]);
  assert.equal(r.resumen.cuadran, 2);
  assert.equal(r.resumen.pendientes, 0);
});

test("lo recibido antes que SAP no es sobrante y lo que SAP cambió recién se deja para después", () => {
  const r = armar([
    fila("ADE", { sap: 9, pequena: 12, adelantado: 3 }),
    fila("PAR", { sap: 10, pequena: 13, adelantado: 1 }),
    fila("NUEVO", { sap: 50, pequena: 20, sapCambioEn: new Date(ahora - 5 * 60_000) }),
  ], [bodega("ADE", { sapPequena: 9 }), bodega("PAR", { sapPequena: 10 }), bodega("NUEVO", { sapPequena: 50 })]);
  assert.equal(r.resumen.cuadran, 1);
  assert.equal(r.resumen.actualizando, 1);
  assert.deepEqual(r.mas.map((x) => [x.itemCode, x.diferencia, x.pequena.diferencia]), [["PAR", 2, 3]]);
});

test("lo preparado sin entregar en SAP cuenta como que ya salió de la pequeña", () => {
  const r = armar([fila("P", { sap: 20, pequena: 14, sinEntrega: 6 })], [bodega("P", { sapPequena: 20 })]);
  assert.equal(r.resumen.cuadran, 1);
});

test("ordena por la diferencia más grande y, si empatan, por nombre", () => {
  const r = armar([fila("B", { sap: 12, itemName: "Beta" }), fila("A", { sap: 12, itemName: "Alfa" }), fila("C", { sap: 1, itemName: "Ce" })],
    [bodega("A", { sapPequena: 12 }), bodega("B", { sapPequena: 12 }), bodega("C", { sapPequena: 1 })]);
  assert.deepEqual(r.menos.map((x) => x.itemName), ["Alfa", "Beta", "Ce"]);
});

test("almacén solo conteo: compara lo contado con SAP de ahora; lo no contado es pendiente y lo que SAP no tiene, sobrante", async () => {
  const { armarCuadreAlmacen } = await import("../../src/modules/inventario/inventario.reporte.js");
  const f = (itemCode, sap, unidades, contado = true, cajas = 0) => ({ itemCode, itemName: `Producto ${itemCode}`, sap, unidades, cajas, contado });
  const r = armarCuadreAlmacen([f("A", 50, 50), f("B", 50, 40), f("C", 0, 5), f("D", 30.4, 0, false), f("E", 12, 36, true, 3), f("F", 7, 0)]);
  assert.deepEqual(r.resumen, { contados: 5, cuadran: 1, menos: { productos: 2, unidades: -17 }, mas: { productos: 2, unidades: 29 }, pendientes: 1 });
  assert.deepEqual(r.menos.map((x) => [x.itemCode, x.diferencia]), [["B", -10], ["F", -7]]);
  assert.deepEqual(r.mas, [{ itemCode: "E", itemName: "Producto E", contado: 36, cajas: 3, sap: 12, diferencia: 24 },
    { itemCode: "C", itemName: "Producto C", contado: 5, cajas: 0, sap: 0, diferencia: 5 }]);
});
