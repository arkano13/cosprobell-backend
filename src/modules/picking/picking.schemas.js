import { z } from "zod";
import { safeString } from "../../shared/validation/safeString.js";

export const iniciarBodySchema = z.object({
  pedidoDocEntry: z.coerce.number().int().positive(),
  usuarioId: safeString(1).optional(),
});

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const escanearBodySchema = z.object({
  codigo: safeString(1),
});