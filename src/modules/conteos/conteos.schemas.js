import { z } from "zod";

const id = z.coerce.number().int().min(1).max(2147483647);
const operacionId = z.string().trim().uuid().transform((valor) => valor.toLowerCase());

export const idParamsSchema = z.object({ id });
export const iniciarSchema = z.object({ nombre: z.string().trim().min(1).max(80).refine((v) => !v.includes("\0")),
  operacionId: operacionId.optional() }).strict();
export const lecturaSchema = z.object({ codigo: z.string().trim().min(1).max(64).refine((v) => !v.includes("\0")), operacionId }).strict();
export const vacioSchema = z.object({ operacionId: operacionId.optional() }).strict();
export const listarQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
