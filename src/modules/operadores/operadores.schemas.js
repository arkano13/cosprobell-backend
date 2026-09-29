import { z } from "zod";
import { FORMATO_PIN } from "../../shared/security/pin.js";

export const iniciarSesionSchema = z.object({
  operadorId: z.number().int().min(1).max(2147483647),
  pin: z.string().regex(FORMATO_PIN, "El PIN debe tener exactamente 4 números"),
}).strict();
