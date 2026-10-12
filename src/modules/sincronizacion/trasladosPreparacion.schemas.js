import { z } from "zod";
import { identificador, loteDe } from "./lote.schemas.js";

// Traslado de SAP (StockTransfers) que sale de la 02. El número recibido es el DocEntry de SAP; la clave de preparación se
// asigna en el receptor (ver trasladosPreparacion.repository.js).
const entero = z.number().int().min(0).max(2147483647);
const cantidad = z.number().finite().nonnegative();
const linea = z.object({
  lineNum: entero,
  itemCode: identificador(50),
  quantity: cantidad,
  fromWarehouseCode: identificador(50).nullable(),
  warehouseCode: identificador(50).nullable(),
  uomEntry: z.number().int().min(-1).max(2147483647).nullable(),
  uomCode: z.string().max(100).nullable(),
  inventoryQuantity: cantidad.nullable(),
}).strict();
export const trasladoPreparacionSchema = z.object({
  docEntry: entero,
  docNum: entero,
  cardCode: identificador(50).nullable(),
  docDate: z.iso.date(),
  fromWarehouse: identificador(50),
  toWarehouse: identificador(50),
  lineas: z.array(linea).min(1).max(1000).superRefine((lineas, ctx) => {
    const vistas = new Set();
    lineas.forEach((l, i) => {
      if (vistas.has(l.lineNum)) ctx.addIssue({ code: "custom", path: [i, "lineNum"], message: "Línea repetida" });
      vistas.add(l.lineNum);
    });
  }),
});
export const loteTrasladosPreparacionSchema = loteDe("trasladosPreparacion", trasladoPreparacionSchema,
  "docEntry", "Traslado repetido");
