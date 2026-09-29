import { z } from "zod";
const id = z.coerce.number().int().min(0).max(2147483647);
export const pedidoParamsSchema = z.object({ docEntry: id });
export const pedidosQuerySchema = z.object({
  cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.enum(["abiertos", "todos"]).default("abiertos"),
}).strict();
