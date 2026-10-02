import { z } from "zod";

const id = z.coerce.number().int().min(1).max(2147483647);
const operacionId = z.string().uuid();
const unidades = z.number().int().min(1).max(1_000_000);
export const seleccionLotesSchema = z.array(z.object({ pequenaLoteId: id, unidades }).strict()).min(1).max(200)
  .refine(filas => new Set(filas.map(f => f.pequenaLoteId)).size === filas.length, "No repetir lotes");
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
export const FILTROS_EXISTENCIAS = ["todos", "grande", "pequena", "solo_sap", "diferencia"];
export const existenciasQuerySchema = z.object({
  buscar: z.string().trim().min(1).max(60).optional(), filtro: z.enum(FILTROS_EXISTENCIAS).default("todos"),
  pagina: z.coerce.number().int().min(0).max(10_000).default(0), limit: limit(50),
}).strict();
export const porVencerQuerySchema = z.object({ dias: z.coerce.number().int().min(0).max(365).default(60) }).strict();
export const movimientosQuerySchema = z.object({ itemCode: itemCode.optional(), antesDe: id.optional(), limit: limit(30) }).strict();
export const descuentosQuerySchema = z.object({ antesDe: id.optional(), limit: limit(30) }).strict();

// En cajas: N cajas iguales a la grande, cada una con su etiqueta. Suelto: un bulto a la grande o unidades a la pequeña.
// Grupos: varias filas de cajas iguales, cada una con su lote, y lo que sobra como un bulto; todo junto a la grande.
const grupoCajas = z.object({ cajas: z.number().int().min(1).max(200), unidadesPorCaja: unidades, lote,
  vencimiento: fecha.nullable().optional() }).strict();
const totalRecepcion = (r) => (r.modo === "cajas" ? r.cajas * r.unidadesPorCaja : r.modo === "suelto" ? r.unidades
  : r.grupos.reduce((t, g) => t + g.cajas * g.unidadesPorCaja, 0) + (r.bulto?.unidades ?? 0));
export const recepcionSchema = z.discriminatedUnion("modo", [
  z.object({ operacionId, modo: z.literal("cajas"), itemCode, cajas: z.number().int().min(1).max(200), unidadesPorCaja: unidades,
    lote, vencimiento: fecha.nullable().optional(), adelantar: z.boolean().default(false) }).strict(),
  z.object({ operacionId, modo: z.literal("suelto"), itemCode, unidades, destino: z.enum(["grande", "pequena"]),
    lote, vencimiento: fecha.nullable().optional(), adelantar: z.boolean().default(false) }).strict(),
  z.object({ operacionId, modo: z.literal("grupos"), itemCode, grupos: z.array(grupoCajas).min(1).max(50),
    bulto: z.object({ unidades, lote, vencimiento: fecha.nullable().optional() }).strict().nullable().optional(),
    adelantar: z.boolean().default(false) }).strict(),
]).refine((r) => totalRecepcion(r) <= 1_000_000, { message: "Demasiadas unidades en una sola recepción", path: ["unidadesPorCaja"] })
  .refine((r) => r.modo !== "grupos" || r.grupos.reduce((t, g) => t + g.cajas, 0) <= 500,
    { message: "Hasta 500 cajas en una sola recepción", path: ["grupos"] });

export const reposicionSchema = z.object({ operacionId, caja: cajaParamsSchema.shape.codigo, unidades }).strict();

const asignacion = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("lote"), lote: z.string().trim().min(1).max(60).nullable(), unidades }).strict(),
  z.object({ tipo: z.literal("pequena"), unidades, lotes: seleccionLotesSchema.optional() }).strict(),
]);
const asignaciones = z.array(asignacion).min(1).max(50).refine((lista) => {
  const claves = lista.map((a) => (a.tipo === "pequena" ? "pequena" : `lote:${a.lote ?? ""}`));
  return new Set(claves).size === claves.length;
}, "Cada lote (y la pequeña) va una sola vez");

export const descuentoSchema = z.object({ operacionId, itemCode, unidades, asignaciones }).strict();
export const reasignacionSchema = z.object({ operacionId, asignaciones }).strict();
export const conteoSchema = z.object({ operacionId, unidades: z.number().int().min(0).max(1_000_000),
  lotes: z.array(z.object({ lote, vencimiento: fecha.nullable().optional(), unidades: z.number().int().min(0).max(1_000_000) }).strict())
    .max(200).refine(filas => new Set(filas.map(f => JSON.stringify([f.lote ?? null, f.vencimiento ?? null]))).size === filas.length, "No repetir lotes").optional(),
}).strict();
export const correccionCajaSchema = z.object({ operacionId, unidades: z.number().int().min(0).max(1_000_000) }).strict();

// Panel del supervisor.
// Solo se aceptan almacenes que ya están en la tabla (el servicio lo revisa); el largo no se limita a los 8 de SAP
// para no rechazar los que llegaron por otra vía (datos sembrados).
const codigoAlmacen = z.string().trim().min(1).max(50);
export const almacenesSchema = z.object({
  almacenes: z.array(codigoAlmacen).max(500)
    .refine((lista) => new Set(lista).size === lista.length, "Hay almacenes repetidos"),
  pedidosSoloDeEstaBodega: z.boolean(),
  // Qué almacén marcado es la bodega grande y cuál la pequeña. Sin enviar, queda como estaba.
  almacenGrande: codigoAlmacen.nullable().optional(),
  almacenPequena: codigoAlmacen.nullable().optional(),
}).strict();
export const bodegaParamsSchema = z.object({ bodega: z.enum(["grande", "pequena"]) });
export const bodegaQuerySchema = z.object({
  buscar: z.string().trim().min(1).max(60).optional(), filtro: z.enum(["todos", "registrados", "sin_registrar"]).default("todos"),
  pagina: z.coerce.number().int().min(0).max(10_000).default(0), limit: limit(50),
}).strict();
export const registroCodigoSchema = z.object({
  codigo: z.string().trim().min(1).max(64).regex(/^[\x20-\x7E]+$/, "El código solo puede tener letras, números y símbolos"),
  itemCode,
}).strict();
