import { z } from "zod";
import { PERIODOS } from "./reportes.periodo.js";

const operador = z.string().trim().min(1).max(80).optional();
const periodo = (valores, defecto) => z.enum(valores).default(defecto);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Fecha inválida");

export const preparacionesQuerySchema = z.object({ periodo: periodo(PERIODOS, "7d"), operador,
  documento: z.enum(["todos", "facturas", "traslados"]).default("todos") }).strict();
export const erroresQuerySchema = z.object({ periodo: periodo(PERIODOS, "30d"), operador }).strict();
export const salidasQuerySchema = z.object({ periodo: periodo(["7d", "30d", "90d"], "30d"),
  limite: z.coerce.number().int().min(5).max(100).default(20) }).strict();
export const reposicionesQuerySchema = z.object({ periodo: periodo(["30d", "60d", "90d"], "60d"),
  como: z.enum(["todas", "sap", "mano"]).default("todas") }).strict();
export const correccionesQuerySchema = z.object({ periodo: periodo(PERIODOS, "30d"),
  tipo: z.enum(["todos", "conteo", "lote", "anulada", "codigo"]).default("todos"), persona: operador }).strict();
export const pendientesQuerySchema = z.object({ minDias: z.coerce.number().int().refine((v) => [0, 1, 3, 7].includes(v)).default(3) }).strict();
export const actividadQuerySchema = z.object({ dia: fecha.optional(), persona: operador }).strict();
