import test from "node:test";
import assert from "node:assert/strict";
import { construirLotePedidos } from "../../puente/pedidos.js";
import { pedidoSap } from "../fixtures/pedido.js";
import { lineasParaPreparar, sesionCoincideConPedido } from "../../src/modules/picking/picking.pedido.js";
import { productosDelCombo, articulosDelPedido, cargarCombos, TIPO_COMBO } from "../../src/modules/picking/picking.combos.js";
import { validarCompatibilidadLinea } from "../../src/modules/picking/picking.cantidades.js";
import { loteListasMaterialesSchema } from "../../src/modules/sincronizacion/listasMateriales.schemas.js";

// Promo.01 Smooth (ER10474) en SAP: lista de materiales tipo Conjunto con 1 de cada producto.
const promo = { itemCode: "ER10474", tipo: TIPO_COMBO, cantidad: 1, lineas: [
  { itemCode: "ER10028", cantidad: 1, tipo: "pit_Item" },
  { itemCode: "ER10030", cantidad: 1, tipo: "pit_Item" },
  { itemCode: "ER10032", cantidad: 1, tipo: "pit_Item" },
] };
// Pedido con 2 combos pendientes (línea 0) y un producto suelto (línea 1). El combo usa la unidad Manual.
function pedido(combos = new Map([["ER10474", promo]])) {
  const p = construirLotePedidos([pedidoSap({ DocumentLines: [
    { LineNum: 0, ItemCode: "ER10474", Quantity: 2, LineStatus: "bost_Open", WarehouseCode: "02", UoMEntry: -1, UoMCode: "Manual",
      RemainingOpenQuantity: 2, InventoryQuantity: 2, RemainingOpenInventoryQuantity: 2 },
    { LineNum: 1, ItemCode: "P1", Quantity: 5, LineStatus: "bost_Open", WarehouseCode: "02", UoMEntry: 1, UoMCode: "UN",
      RemainingOpenQuantity: 5, InventoryQuantity: 5, RemainingOpenInventoryQuantity: 5 },
  ] })], "TEST", 1).pedidos[0];
  return { ...p, combos };
}

test("el combo se prepara como sus productos: cantidad de combos × lo que lleva cada uno", () => {
  assert.deepEqual(lineasParaPreparar(pedido()), [
    { pedidoLineNum: 0, itemCode: "ER10028", cantidadPedida: 2, uomEntry: -1, uomCode: null, comboItemCode: "ER10474", comboFactor: 1 },
    { pedidoLineNum: 0, itemCode: "ER10030", cantidadPedida: 2, uomEntry: -1, uomCode: null, comboItemCode: "ER10474", comboFactor: 1 },
    { pedidoLineNum: 0, itemCode: "ER10032", cantidadPedida: 2, uomEntry: -1, uomCode: null, comboItemCode: "ER10474", comboFactor: 1 },
    { pedidoLineNum: 1, itemCode: "P1", cantidadPedida: 5, uomEntry: 1, uomCode: "UN" },
  ]);
  // Sin lista de materiales (todavía no llegó del puente), el combo queda como una línea más.
  assert.deepEqual(lineasParaPreparar(pedido(new Map())).map((l) => l.itemCode), ["ER10474", "P1"]);
});

test("productos del combo: suma filas repetidas, ignora recursos y textos, y la lista vale para su cantidad", () => {
  assert.deepEqual(productosDelCombo({ itemCode: "C", cantidad: 2, lineas: [
    { itemCode: "A", cantidad: 2, tipo: "pit_Item" }, { itemCode: "B", cantidad: 4, tipo: null },
    { itemCode: "A", cantidad: 2, tipo: "pit_Item" }, { itemCode: "MANO", cantidad: 1, tipo: "pit_Resource" },
    { itemCode: "NOTA", cantidad: 1, tipo: "pit_Text" },
  ] }), [{ itemCode: "A", factor: 2 }, { itemCode: "B", factor: 2 }]);
  assert.throws(() => productosDelCombo({ itemCode: "C", cantidad: 2, lineas: [{ itemCode: "A", cantidad: 1, tipo: null }] }),
    { code: "COMBO_CANTIDAD_NO_ENTERA" });
  assert.throws(() => productosDelCombo({ itemCode: "C", cantidad: 1, lineas: [{ itemCode: "N", cantidad: 1, tipo: "pit_Text" }] }),
    { code: "COMBO_SIN_PRODUCTOS" });
  assert.throws(() => lineasParaPreparar(pedido(new Map([["ER10474", { ...promo, lineas: [] }]]))), { code: "COMBO_SIN_PRODUCTOS" });
});

test("la sesión coincide con el pedido solo si el combo sigue igual", () => {
  const sesion = { lineas: lineasParaPreparar(pedido()).reverse() };
  assert.equal(sesionCoincideConPedido(sesion, pedido()), true);
  const cambiado = new Map([["ER10474", { ...promo, lineas: [...promo.lineas, { itemCode: "ER10099", cantidad: 1, tipo: "pit_Item" }] }]]);
  assert.equal(sesionCoincideConPedido(sesion, pedido(cambiado)), false);
  assert.equal(sesionCoincideConPedido(sesion, pedido(new Map())), false);
});

test("producto de un combo: se acepta cualquier código confirmado como unidad individual del producto", () => {
  const linea = { itemCode: "ER10028", uomEntry: -1, cantidadPedida: 2, cantidadEscaneada: 0, comboItemCode: "ER10474" };
  const etiqueta = { itemCode: "ER10028", uomEntry: 1, cantidadUnidades: 1 };
  assert.doesNotThrow(() => validarCompatibilidadLinea(linea, etiqueta));
  assert.throws(() => validarCompatibilidadLinea({ ...linea, comboItemCode: null }, etiqueta), { code: "UNIDAD_INCOMPATIBLE" });
  assert.throws(() => validarCompatibilidadLinea(linea, { ...etiqueta, itemCode: "ER10030" }), { code: "PRODUCTO_FUERA_DE_LINEA" });
});

test("artículos del pedido incluyen los productos de sus combos; cargarCombos pide solo los Conjunto", async () => {
  const p = pedido();
  assert.deepEqual(articulosDelPedido(p.lineas, p.combos), ["ER10474", "ER10028", "ER10030", "ER10032", "P1"]);
  let consulta;
  const db = { listaMateriales: { findMany: async (q) => { consulta = q; return [promo]; } } };
  const combos = await cargarCombos(["ER10474", "P1", "ER10474"], db);
  assert.deepEqual(consulta, { where: { itemCode: { in: ["ER10474", "P1"] }, tipo: TIPO_COMBO } });
  assert.equal(combos.get("ER10474"), promo);
  assert.equal((await cargarCombos([], db)).size, 0);
});

test("contrato de las listas de materiales que manda el puente", () => {
  const lote = { version: 1, empresa: "SAP", secuencia: 1, listasMateriales: [promo] };
  assert.equal(loteListasMaterialesSchema.safeParse(lote).success, true);
  for (const malo of [
    { ...promo, cantidad: 0 }, { ...promo, tipo: "" }, { ...promo, extra: 1 },
    { ...promo, lineas: [{ itemCode: "A", cantidad: -1, tipo: null }] }, { ...promo, lineas: [{ itemCode: " A", cantidad: 1, tipo: null }] },
  ]) assert.equal(loteListasMaterialesSchema.safeParse({ ...lote, listasMateriales: [malo] }).success, false, JSON.stringify(malo));
  assert.equal(loteListasMaterialesSchema.safeParse({ ...lote, listasMateriales: [promo, promo] }).success, false, "repetida");
});
