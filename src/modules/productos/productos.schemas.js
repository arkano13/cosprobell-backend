import { z } from "zod";
import { safeString } from "../../shared/validation/safeString.js";

export const listarQuerySchema = z.object({
  q: safeString(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const itemCodeParamsSchema = z.object({
  itemCode: safeString(1),
});
