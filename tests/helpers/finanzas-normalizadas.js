import { FINANZAS } from "../../src/shared/finanzas/contratos.js";
import { tipoCampo } from "../../src/modules/finanzas/finanzas.tablas.js";

export function ejemploFinanciero(entidad, cambios = {}) {
  const datos = Object.fromEntries(Object.entries(FINANZAS[entidad].campos).map(([k, schema]) => {
    if (schema.isNullable()) return [k, null];
    const tipo = tipoCampo(schema);
    return [k, tipo === "Decimal" ? "123.456789" : tipo === "DateTime" ? "2026-10-27"
      : tipo === "Int" ? 1 : schema.safeParse("N").success && !schema.safeParse("texto").success ? "N" : "ejemplo"];
  }));
  return FINANZAS[entidad].schema.parse({ ...datos, ...cambios });
}
