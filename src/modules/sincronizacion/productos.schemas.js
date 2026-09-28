import { z } from "zod";
const identificador = (max) => z.string().min(1).max(max)
  .refine((v) => v === v.trim() && !v.includes("\0"), "Identificador inválido");
export const loteProductosSchema = z.object({
  version: z.literal(1),
  empresa: identificador(128),
  secuencia: z.number().int().min(1).max(2147483647),
  productos: z.array(z.object({
    itemCode: identificador(50),
    itemName: z.string().trim().min(1).max(200).refine((v) => !v.includes("\0")),
    barCode: identificador(254).nullable(),
    valid: z.boolean(),
    frozen: z.boolean(),
  }).strict()).min(1).max(100),
}).strict().superRefine((lote, ctx) => {
  const vistos = new Set();
  lote.productos.forEach((p, i) => {
    if (vistos.has(p.itemCode)) ctx.addIssue({ code: "custom", path: ["productos", i, "itemCode"], message: "Producto repetido en el lote" });
    vistos.add(p.itemCode);
  });
});
