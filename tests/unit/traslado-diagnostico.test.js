import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticarTrasladoSap } from "../../puente/diagnosticar-traslado.js";
const traslado = () => ({ DocEntry: 5015, DocNum: 99, CardCode: "NO_PUBLICAR", DocDate: "2026-10-26", FromWarehouse: "01", ToWarehouse: "02",
  StockTransferLines: [{ LineNum: 0, ItemCode: "NO_PUBLICAR", Quantity: 1, FromWarehouseCode: "01", WarehouseCode: "02", InventoryQuantity: 1 }] });
test("diagnóstico señala campo y tipo sin publicar valores del documento", () => {
  const t = traslado(); t.StockTransferLines[0].Quantity = "1";
  const r = diagnosticarTrasladoSap(t);
  assert.equal(r.valido, false);
  assert.deepEqual(r.problemas, [{ campo: "StockTransferLines.[0].Quantity", motivo: "invalid_type", tipoRecibido: "string" }]);
  assert.equal(JSON.stringify(r).includes("NO_PUBLICAR"), false);
});
test("diagnóstico distingue colección paginada y un documento válido", () => {
  assert.equal(diagnosticarTrasladoSap(traslado()).valido, true);
  const t = { ...traslado(), "StockTransferLines@odata.nextLink": "NO_PUBLICAR" };
  const r = diagnosticarTrasladoSap(t);
  assert.equal(r.valido, false); assert.equal(r.lineasPaginadas, true);
  assert.equal(r.problemas[0].motivo, "coleccion_paginada");
});
