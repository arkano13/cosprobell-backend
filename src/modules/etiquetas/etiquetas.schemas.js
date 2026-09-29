import { z } from "zod";
const id = z.coerce.number().int().min(1).max(2147483647);
export const etiquetaParamsSchema = z.object({ id });
export const etiquetasQuerySchema = z.object({
  estado: z.enum(["pendientes", "confirmadas", "todas"]).default("pendientes"),
  itemCode: z.string().trim().min(1).max(50).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const confirmacionBodySchema = z.object({
  esUnidadIndividual: z.boolean(),
  observacion: z.string().trim().max(500).nullable().optional(),
}).strict();
