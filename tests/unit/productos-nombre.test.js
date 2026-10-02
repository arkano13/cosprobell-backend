import test from "node:test";
import assert from "node:assert/strict";
import { construirLote } from "../../puente/productos.js";
const producto = { ItemCode: "ER10598", BarCode: "00123", Valid: "tYES", Frozen: "tNO" };
test("producto sin nombre usa etiqueta provisional sin alterar código ni barras", t => {
  const avisos = [];
  t.mock.method(console, "warn", valor => avisos.push(JSON.parse(valor)));
  for (const ItemName of [null, undefined, "", "   "]) {
    const p = construirLote([{ ...producto, ItemName }], "TEST", 1).productos[0];
    assert.equal(p.itemName, "Producto ER10598");
    assert.equal(p.itemCode, producto.ItemCode);
    assert.equal(p.barCode, "00123");
  }
  assert.equal(avisos.length, 4);
  assert.equal(avisos[0].codigo, "PRODUCTO_SIN_NOMBRE");
});
test("producto conserva nombre real y rechaza tipo incorrecto o caracteres nulos", () => {
  assert.equal(construirLote([{ ...producto, ItemName: "Real" }], "TEST", 1).productos[0].itemName, "Real");
  for (const ItemName of [42, "a\0b"]) assert.throws(() => construirLote([{ ...producto, ItemName }], "TEST", 1), { code: "PRODUCTO_SAP_INVALIDO" });
});
