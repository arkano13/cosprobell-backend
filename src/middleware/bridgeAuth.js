import { createHash, timingSafeEqual } from "node:crypto";
import env from "../config/env.js";
import { AppError } from "../shared/errors/AppError.js";
const hash = (valor) => createHash("sha256").update(valor).digest();

export function crearAutenticacionPuente(config = env) {
  return (req, _res, next) => {
    if (!config.sapCompanyDb || !config.bridgeApiKey || config.bridgeApiKey.length < 32) {
      return next(new AppError({ code: "PUENTE_NO_CONFIGURADO", message: "Integración no disponible", statusCode: 503 }));
    }
    const cabecera = req.get("Authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/i.exec(cabecera);
    if (!match || !timingSafeEqual(hash(match[1]), hash(config.bridgeApiKey))) {
      return next(new AppError({ code: "PUENTE_NO_AUTORIZADO", message: "Credencial del puente inválida", statusCode: 401 }));
    }
    req.empresaSap = config.sapCompanyDb;
    next();
  };
}
export const requireBridgeAuth = crearAutenticacionPuente();
