import { z } from "zod";
import { safeString } from "../../shared/validation/safeString.js";
import { seleccionLotesSchema } from "../inventario/inventario.schemas.js";

export const finalizarBodySchema = z.object({
  lotes: z.array(z.object({ itemCode: z.string().trim().min(1).max(50), lotes: seleccionLotesSchema }).strict())
    .max(1000).refine(filas => new Set(filas.map(f => f.itemCode)).size === filas.length, "No repetir productos").default([]),
}).strict().default({ lotes: [] });

export const iniciarBodySchema = z.object({
  pedidoDocEntry: z.coerce.number().int().positive(),
  usuarioId: safeString(1).optional(),
});

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const escanearBodySchema = z.object({
  codigo: safeString(1),
  operacionId: z.string().trim().uuid().transform((valor) => valor.toLowerCase()),
});
export const historialQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  despuesDe: z.coerce.number().int().positive().max(2_147_483_647).optional(),
});
