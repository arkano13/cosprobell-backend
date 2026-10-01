import { z } from "zod";

const id = z.coerce.number().int().min(1).max(2147483647);
const unidades = z.number().int().min(1).max(1_000_000);
const itemCode = z.string().trim().min(1).max(50);
const lote = z.string().trim().min(1).max(60).nullable().optional();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha con formato AAAA-MM-DD")
  .refine((f) => !Number.isNaN(Date.parse(`${f}T00:00:00Z`)) && new Date(`${f}T00:00:00Z`).toISOString().startsWith(f), "Fecha inválida");
const limit = (porDefecto, maximo = 100) => z.coerce.number().int().min(1).max(maximo).default(porDefecto);

export const itemCodeParamsSchema = z.object({ itemCode });
export const idParamsSchema = z.object({ id });
export const cajaParamsSchema = z.object({ codigo: z.string().trim().toUpperCase().regex(/^CJ-\d{6,}$/, "Código de caja inválido") });

export const buscarQuerySchema = z.object({ buscar: z.string().trim().min(1).max(60), limit: limit(20, 50) }).strict();
export const conteoInicialQuerySchema = z.object({
  buscar: z.string().trim().min(1).max(60).optional(), pagina: z.coerce.number().int().min(0).max(10_000).default(0), limit: limit(50),
}).strict();
export const porVencerQuerySchema = z.object({ dias: z.coerce.number().int().min(0).max(365).default(60) }).strict();
export const movimientosQuerySchema = z.object({ itemCode: itemCode.optional(), antesDe: id.optional(), limit: limit(30) }).strict();
export const descuentosQuerySchema = z.object({ antesDe: id.optional(), limit: limit(30) }).strict();

// En cajas: N cajas iguales a la grande, cada una con su etiqueta. Suelto: un bulto a la grande o unidades a la pequeña.
export const recepcionSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("cajas"), itemCode, cajas: z.number().int().min(1).max(200), unidadesPorCaja: unidades,
    lote, vencimiento: fecha.nullable().optional(), adelantar: z.boolean().default(false) }).strict(),
  z.object({ modo: z.literal("suelto"), itemCode, unidades, destino: z.enum(["grande", "pequena"]),
    lote, vencimiento: fecha.nullable().optional(), adelantar: z.boolean().default(false) }).strict(),
]).refine((r) => r.modo === "cajas" ? r.cajas * r.unidadesPorCaja <= 1_000_000 : true,
  { message: "Demasiadas unidades en una sola recepción", path: ["unidadesPorCaja"] });

export const reposicionSchema = z.object({ caja: cajaParamsSchema.shape.codigo, unidades }).strict();

const asignacion = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("lote"), lote: z.string().trim().min(1).max(60).nullable(), unidades }).strict(),
  z.object({ tipo: z.literal("pequena"), unidades }).strict(),
]);
const asignaciones = z.array(asignacion).min(1).max(50).refine((lista) => {
  const claves = lista.map((a) => (a.tipo === "pequena" ? "pequena" : `lote:${a.lote ?? ""}`));
  return new Set(claves).size === claves.length;
}, "Cada lote (y la pequeña) va una sola vez");

export const descuentoSchema = z.object({ itemCode, unidades, asignaciones }).strict();
export const reasignacionSchema = z.object({ asignaciones }).strict();
export const conteoSchema = z.object({ unidades: z.number().int().min(0).max(1_000_000) }).strict();
export const correccionCajaSchema = z.object({ unidades: z.number().int().min(0).max(1_000_000) }).strict();

// Panel del supervisor.
export const almacenesSchema = z.object({
  almacenes: z.array(z.string().trim().min(1).max(8)).max(500)
    .refine((lista) => new Set(lista).size === lista.length, "Hay almacenes repetidos"),
  pedidosSoloDeEstaBodega: z.boolean(),
}).strict();
export const registroCodigoSchema = z.object({
  codigo: z.string().trim().min(1).max(64).regex(/^[\x20-\x7E]+$/, "El código solo puede tener letras, números y símbolos"),
  itemCode,
}).strict();
