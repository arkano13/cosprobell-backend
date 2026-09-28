import env from "../config/env.js";
import { prisma } from "../infrastructure/database/prisma.js";
import { AppError } from "../shared/errors/AppError.js";
import { firmaValida, VENTANA_FIRMA_MS } from "../shared/security/firma.js";
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

function rechazoPuente(code, message) {
  return new AppError({ code, message, statusCode: 401 });
}

// Autentica al sincronizador: firma HMAC del cuerpo crudo con marca de tiempo.
// Un reenvío dentro de la ventana no duplica datos porque cada lote es idempotente.
export function crearAutenticacionPuente({ secreto, ahora = Date.now }) {
  return function requireBridgeAuth(req, _res, next) {
    if (!secreto) {
      return next(
        new AppError({
          code: "PUENTE_NO_CONFIGURADO",
          message: "La sincronización no está configurada",
          statusCode: 503,
        })
      );
    }

    const marcaTiempo = req.header("X-Bridge-Timestamp");
    const firma = req.header("X-Bridge-Signature");

    if (!marcaTiempo || !firma) {
      return next(rechazoPuente("FIRMA_REQUERIDA", "Falta la firma del sincronizador"));
    }

    if (
      !/^\d{13}$/.test(marcaTiempo) ||
      Math.abs(ahora() - Number(marcaTiempo)) > VENTANA_FIRMA_MS
    ) {
      return next(rechazoPuente("FIRMA_VENCIDA", "La marca de tiempo es inválida o está vencida"));
    }

    const datos = {
      marcaTiempo,
      metodo: req.method,
      ruta: req.originalUrl,
      cuerpo: req.rawBody?.toString("utf8") ?? "",
    };

    if (!firmaValida(secreto, datos, firma)) {
      return next(rechazoPuente("FIRMA_INVALIDA", "La firma del sincronizador no es válida"));
    }

    return next();
  };
}

export const requireBridgeAuth = crearAutenticacionPuente({
  secreto: env.bridgeSecret,
});