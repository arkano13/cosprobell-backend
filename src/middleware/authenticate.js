import { prisma } from "../infrastructure/database/prisma.js";
import { hashApiKey } from "../shared/security/hash.js";
// Fase C+: valida la API key de las apps propias (escaner, reportes, etc.)
// via el header X-API-Key. No aplica al puente (eso es Fase B, mecanismo aparte).
export async function requireAppAuth(req, res, next) {
  try {
    const clave = req.header("X-API-Key");

    if (!clave) {
      return res.status(401).json({ error: "Falta la API key (header X-API-Key)" });
    }

    const claveHash = hashApiKey(clave);
    const apiKey = await prisma.apiKey.findUnique({ where: { claveHash } });

    if (!apiKey || !apiKey.activa) {
      return res.status(401).json({ error: "API key invalida o desactivada" });
    }

    // No bloquea la respuesta si falla; es informativo, no critico.
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { ultimoUso: new Date() } })
      .catch((err) => req.log?.warn({ err }, "no se pudo actualizar ultimoUso de la api key"));

    req.appNombre = apiKey.nombre;
    next();
  } catch (err) {
    next(err);
  }
}

// Credencial independiente de las aplicaciones de consulta.
export { requireBridgeAuth } from "./bridgeAuth.js";
