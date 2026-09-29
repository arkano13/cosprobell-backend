import { z } from "zod";
export const identificador = (max) => z.string().min(1).max(max)
  .refine((v) => v === v.trim() && !v.includes("\0"), "Identificador inválido");
export const texto = (max) => z.string().trim().min(1).max(max).refine((v) => !v.includes("\0"));
// Contrato v1 común a todas las entidades: una empresa, un número de secuencia y
// entre 1 y 100 registros estrictos, sin claves repetidas. El campo del lote es el nombre de la entidad.
export function loteDe(entidad, registro, clave, mensajeRepetido) {
  return z.object({
    version: z.literal(1),
    empresa: identificador(128),
    secuencia: z.number().int().min(1).max(2147483647),
    [entidad]: z.array(registro.strict()).min(1).max(100),
  }).strict().superRefine((lote, ctx) => {
    const vistos = new Set();
    lote[entidad].forEach((r, i) => {
      if (vistos.has(r[clave])) ctx.addIssue({ code: "custom", path: [entidad, i, clave], message: mensajeRepetido });
      vistos.add(r[clave]);
    });
  });
}
