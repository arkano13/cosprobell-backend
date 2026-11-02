import { z } from "zod";

const id = z.coerce.number().int().min(1).max(2147483647);
const operacionId = z.string().trim().uuid().transform((valor) => valor.toLowerCase());

export const idParamsSchema = z.object({ id });
export const iniciarSchema = z.object({ almacen: z.string().trim().min(1).max(8), operacionId: operacionId.optional() }).strict();
export const lecturaSchema = z.object({ codigo: z.string().trim().min(1).max(64).refine((v) => !v.includes("\0")), operacionId }).strict();
export const vacioSchema = z.object({ operacionId: operacionId.optional() }).strict();
export const historialQuerySchema = z.object({ almacen: z.string().trim().min(1).max(8).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
// Corrección del supervisor: el producto (itemCode de una fila, o codigo para agregar uno) y cuántas unidades tiene.
export const correccionSchema = z.object({
  itemCode: z.string().trim().min(1).max(50).optional(),
  codigo: z.string().trim().min(1).max(64).refine((v) => !v.includes("\0")).optional(),
  escaneado: z.number().int().min(0).max(1000000),
  motivo: z.string().trim().max(200).optional(),
}).strict().refine((d) => !d.itemCode !== !d.codigo, { message: "Mandá itemCode o codigo (uno solo)", path: ["itemCode"] });
