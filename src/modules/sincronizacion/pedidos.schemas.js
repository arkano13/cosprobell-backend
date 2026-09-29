import { z } from "zod";
import { identificador, loteDe } from "./lote.schemas.js";

const entero = z.number().int().min(0).max(2147483647);
const cantidad = z.number().finite().nonnegative();
const estado = z.enum(["bost_Open", "bost_Close"]);
const fecha = z.iso.date();

// Cantidades de venta y de inventario se conservan por separado. Ninguna
// cantidad ausente se sustituye por el total ni implica una unidad individual.
const linea = z.object({
  lineNum: entero,
  itemCode: identificador(50),
  quantity: cantidad,
  lineStatus: estado,
  warehouseCode: identificador(50).nullable(),
  uomEntry: z.number().int().min(-1).max(2147483647).nullable(),
  uomCode: z.string().max(100).nullable(),
  remainingOpenQuantity: cantidad.nullable(),
  inventoryQuantity: cantidad.nullable(),
  remainingOpenInventoryQuantity: cantidad.nullable(),
}).strict();

export const pedidoSincronizadoSchema = z.object({
  docEntry: entero,
  docNum: entero,
  docType: z.literal("dDocument_Items"),
  cardCode: identificador(50),
  docDate: fecha,
  docDueDate: fecha.nullable(),
  docTotal: z.number().finite(),
  documentStatus: estado,
  cancelled: z.boolean(),
  cancelStatus: z.enum(["csNo", "csYes", "csCancellation"]).nullable(),
  lineas: z.array(linea).min(1).max(1000).superRefine((lineas, ctx) => {
    const vistas = new Set();
    lineas.forEach((l, i) => {
      if (vistas.has(l.lineNum)) ctx.addIssue({ code: "custom", path: [i, "lineNum"], message: "Línea repetida" });
      vistas.add(l.lineNum);
    });
  }),
});

export const lotePedidosSchema = loteDe("pedidos", pedidoSincronizadoSchema,
  "docEntry", "Pedido repetido en el lote");
