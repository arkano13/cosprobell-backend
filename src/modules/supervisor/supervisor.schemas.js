import { z } from "zod";
import { FORMATO_PIN } from "../../shared/security/pin.js";
import { ROLES } from "../operadores/operadores.service.js";

const id = z.coerce.number().int().min(1).max(2147483647);
const pin = z.string().regex(FORMATO_PIN, "El PIN debe tener exactamente 4 números");
export const idParamsSchema = z.object({ id });
export const etiquetasQuerySchema = z.object({
  estado: z.enum(["sin_confirmar", "desactualizadas", "confirmadas", "todas"]).default("sin_confirmar"),
  buscar: z.string().trim().min(1).max(60).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const confirmacionMasivaSchema = z.object({ cantidadEsperada: z.number().int().min(1).max(1_000_000),
  versionEsperada: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const nuevoOperadorSchema = z.object({
  nombre: z.string().max(80), pin, rol: z.enum(ROLES).default("operador"),
}).strict();
export const pinSchema = z.object({ pin }).strict();
export const activoSchema = z.object({ activo: z.boolean() }).strict();
