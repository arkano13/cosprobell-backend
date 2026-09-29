import test from "node:test";
import assert from "node:assert/strict";
import { construirLotePedidos } from "../../puente/pedidos.js";

const ejemplo = () => ({
  DocEntry: 1202, DocNum: 1202, DocType: "dDocument_Items", CardCode: "C001",
  DocDate: "2026-05-27", DocDueDate: null, DocTotal: 630,
  DocumentStatus: "bost_Open", Cancelled: "tNO", CancelStatus: "csNo",
  DocumentLines: [{ LineNum: 0, ItemCode: "PROD-001", Quantity: 12,
    LineStatus: "bost_Open", WarehouseCode: "01", UoMEntry: -1, UoMCode: "Manual",
    RemainingOpenQuantity: 3, InventoryQuantity: 144, RemainingOpenInventoryQuantity: 36 }],
});
const convertir = (p) => construirLotePedidos([p], "PRUEBA", 1).pedidos[0];

test("pedidos conserva cantidades y Manual sin inferir unidades individuales", () => {
  const p = convertir(ejemplo());
  assert.equal(p.cancelled, false);
  assert.deepEqual(p.lineas[0], { lineNum: 0, itemCode: "PROD-001", quantity: 12,
    lineStatus: "bost_Open", warehouseCode: "01", uomEntry: -1, uomCode: "Manual",
    remainingOpenQuantity: 3, inventoryQuantity: 144, remainingOpenInventoryQuantity: 36 });
});
test("pedidos conserva cierres y cancelaciones para sincronizarlos", () => {
  const p = ejemplo(); p.DocumentStatus = "bost_Close"; p.Cancelled = "tYES";
  p.CancelStatus = "csYes"; p.DocumentLines[0].LineStatus = "bost_Close";
  assert.equal(convertir(p).cancelled, true);
  assert.equal(convertir(p).documentStatus, "bost_Close");
});
test("pedidos conserva pendiente nulo y rechaza el campo omitido", () => {
  const p = ejemplo(); p.DocumentLines[0].RemainingOpenQuantity = null;
  assert.equal(convertir(p).lineas[0].remainingOpenQuantity, null);
  delete p.DocumentLines[0].RemainingOpenQuantity;
  assert.throws(() => convertir(p), { code: "PEDIDO_SAP_INVALIDO" });
});
test("pedidos rechaza estados, fechas y cantidades inválidos", () => {
  for (const modificar of [p => p.Cancelled = "desconocido",
    p => p.DocumentStatus = "otro", p => p.DocDate = "2026-02-30",
    p => p.DocumentLines[0].Quantity = -1,
    p => p.DocumentLines[0].RemainingOpenInventoryQuantity = Infinity]) {
    const p = ejemplo(); modificar(p);
    assert.throws(() => convertir(p), { code: "PEDIDO_SAP_INVALIDO" });
  }
});
test("pedidos rechaza líneas y documentos duplicados", () => {
  const p = ejemplo(); p.DocumentLines.push({ ...p.DocumentLines[0] });
  assert.throws(() => convertir(p), { code: "PEDIDO_SAP_INVALIDO" });
  assert.throws(() => construirLotePedidos([ejemplo(), ejemplo()], "PRUEBA", 1), { code: "PEDIDO_SAP_INVALIDO" });
});
test("pedidos ordena líneas sin modificar la respuesta original", () => {
  const p = ejemplo(); p.DocumentLines.unshift({ ...p.DocumentLines[0], LineNum: 2 });
  assert.deepEqual(convertir(p).lineas.map(l => l.lineNum), [0, 2]);
  assert.deepEqual(p.DocumentLines.map(l => l.LineNum), [2, 0]);
});
