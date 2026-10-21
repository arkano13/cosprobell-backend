import { loteDe } from "./lote.schemas.js";
import { trasladoPreparacionSchema } from "./trasladosPreparacion.schemas.js";

// Traslado de SAP de la 01 a la 02: el mismo contrato que los que salen de la 02 (ver trasladosPreparacion.schemas.js).
export const loteTrasladosEntradaSchema = loteDe("trasladosEntrada", trasladoPreparacionSchema, "docEntry", "Traslado repetido");
