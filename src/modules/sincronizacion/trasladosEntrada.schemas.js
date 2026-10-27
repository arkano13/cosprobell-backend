import { z } from "zod";
import { loteDe } from "./lote.schemas.js";
import { trasladoSchema } from "./trasladosPreparacion.schemas.js";

// Traslado de SAP de la 01 a la 02: el mismo contrato que los que salen de la 02 (ver trasladosPreparacion.schemas.js),
// pero con cantidades negativas, que trae la cancelación de un traslado. El receptor solo guarda las líneas positivas.
export const loteTrasladosEntradaSchema = loteDe("trasladosEntrada", trasladoSchema(z.number().finite()), "docEntry", "Traslado repetido");
