export function pedidoSap(cambios = {}) {
  return { DocEntry: 9, DocNum: 99, DocType: "dDocument_Items", CardCode: "C1",
    DocDate: "2026-09-28", DocDueDate: null, DocTotal: 100, DocumentStatus: "bost_Open",
    Cancelled: "tNO", CancelStatus: "csNo", DocumentLines: [{ LineNum: 0,
      ItemCode: "P1", Quantity: 5, LineStatus: "bost_Open", WarehouseCode: "01",
      UoMEntry: 1, UoMCode: "UN", RemainingOpenQuantity: 3,
      InventoryQuantity: 5, RemainingOpenInventoryQuantity: 3 }], ...cambios };
}
