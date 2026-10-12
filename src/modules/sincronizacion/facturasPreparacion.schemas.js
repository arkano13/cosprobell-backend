import { z } from "zod";
import { pedidoSincronizadoSchema } from "./pedidos.schemas.js";
import { loteDe } from "./lote.schemas.js";

// El número recibido sigue siendo el DocEntry de SAP. La clave de preparación
// se asigna en el receptor, en un espacio separado de las órdenes de venta.
const credito = z.object({ lineNum: z.number().int().nonnegative().max(2147483647),
  itemCode: z.string().min(1).max(50), quantity: z.number().finite().nonnegative(),
  inventoryQuantity: z.number().finite().nonnegative() }).strict();
export const facturaPreparacionSchema = pedidoSincronizadoSchema.extend({
  creditos: z.array(credito).max(1000),
}).superRefine((f, ctx) => {
  const vistas = new Set();
  for (const c of f.creditos) {
    const l = f.lineas.find(l => l.lineNum === c.lineNum);
    if (vistas.has(c.lineNum) || !l || l.itemCode !== c.itemCode || c.quantity > l.quantity ||
        l.inventoryQuantity == null || c.inventoryQuantity > l.inventoryQuantity) {
      ctx.addIssue({ code: "custom", path: ["creditos"], message: "Crédito sin línea base o cantidad inválida" });
    }
    vistas.add(c.lineNum);
  }
});
export const loteFacturasPreparacionSchema = loteDe("facturasPreparacion", facturaPreparacionSchema,
  "docEntry", "Factura repetida");
