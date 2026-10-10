import { z } from "zod";

function esUrlPostgres(value) {
  try {
    const url = new URL(value);

    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname !== "" &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z
    .string()
    .regex(/^\d+$/)
    .default("3000")
    .pipe(z.coerce.number().int().min(1).max(65535)),

  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .refine(esUrlPostgres),

  BRIDGE_API_KEY: z.string().optional(),
  SAP_COMPANY_DB: z.string().trim().min(1).max(128).optional(),
  APP_JWT_SECRET: z.string().optional(),
  // Nombres de API keys (separados por coma) que pueden confirmar etiquetas como unidad individual.
  ETIQUETAS_APPS_AUTORIZADAS: z.string().optional(),
  FINANZAS_APPS_AUTORIZADAS: z.string().optional(),
  INVENTARIO_SAP_MAX_AGE_MINUTES: z.string().regex(/^\d+$/).default("30")
    .pipe(z.coerce.number().int().min(5).max(240)),
  // Actualizaciones de la app de escritorio: token de GitHub de solo lectura del repositorio de la app (privado).
  // Vacío cuenta como no configurado (no impide arrancar).
  ACTUALIZACIONES_GITHUB_TOKEN: z.string().trim().optional().transform((v) => v || undefined),
  ACTUALIZACIONES_REPO: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/).default("arkano13/cosprobell-bodega-escritorio"),
  INVENTARIO_SAP_WAREHOUSES: z.string().optional().transform(v => v === undefined ? [] : v.split(",").map(s => s.trim()))
    .refine(v => v.every(s => /^[A-Za-z0-9_-]{1,8}$/.test(s)) && new Set(v).size === v.length),
});

export function parseEnv(variables) {
  const resultado = envSchema.safeParse(variables);

  if (!resultado.success) {
    const campos = [
      ...new Set(
        resultado.error.issues.map((issue) =>
          issue.path.join(".")
        )
      ),
    ];

    throw new Error(
      `Configuración inválida. Revisa: ${campos.join(", ")}`
    );
  }

  const datos = resultado.data;

  return Object.freeze({
    nodeEnv: datos.NODE_ENV,
    port: datos.PORT,
    databaseUrl: datos.DATABASE_URL,
    bridgeApiKey: datos.BRIDGE_API_KEY,
    sapCompanyDb: datos.SAP_COMPANY_DB,
    appJwtSecret: datos.APP_JWT_SECRET,
    actualizacionesToken: datos.ACTUALIZACIONES_GITHUB_TOKEN,
    actualizacionesRepo: datos.ACTUALIZACIONES_REPO,
    inventarioSapMaxAgeMinutes: datos.INVENTARIO_SAP_MAX_AGE_MINUTES,
    inventarioSapWarehouses: Object.freeze(datos.INVENTARIO_SAP_WAREHOUSES),
    etiquetasAppsAutorizadas: Object.freeze((datos.ETIQUETAS_APPS_AUTORIZADAS ?? "")
      .split(",").map((nombre) => nombre.trim()).filter(Boolean)),
    finanzasAppsAutorizadas: Object.freeze((datos.FINANZAS_APPS_AUTORIZADAS ?? "")
      .split(",").map(nombre => nombre.trim()).filter(Boolean)),
  });
}
