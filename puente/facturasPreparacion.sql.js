import { createHash } from "node:crypto";
// Solo créditos basados explícitamente en una línea de factura (objeto SAP 13).
// Los créditos anulados y sus documentos de cancelación no descuentan unidades.
const SqlText = `SELECT L.[BaseLine] AS [lineNum], L.[ItemCode] AS [itemCode],
 SUM(L.[Quantity]) AS [quantity], SUM(L.[InvQty]) AS [inventoryQuantity]
 FROM [ORIN] H INNER JOIN [RIN1] L ON H.[DocEntry] = L.[DocEntry]
 WHERE H.[CANCELED] = 'N' AND L.[BaseType] = 13 AND L.[BaseEntry] = :entry AND L.[BaseLine] > :after
 GROUP BY L.[BaseLine], L.[ItemCode] ORDER BY L.[BaseLine]`;
export const consultaCreditosPreparacion = { SqlCode: `CP_FIN_${createHash("sha256").update(SqlText).digest("hex").slice(0, 20)}`,
  SqlName: "Cosprobell créditos por factura para preparación", SqlText };
