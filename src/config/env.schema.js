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
  APP_JWT_SECRET: z.string().optional(),
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
    appJwtSecret: datos.APP_JWT_SECRET,
  });
}