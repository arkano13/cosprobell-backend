import { prisma } from "../infrastructure/database/prisma.js";
import { hashApiKey } from "../shared/security/hash.js";
import { autenticarSesion } from "../modules/operadores/operadores.service.js";

// Busca una API key activa (header X-API-Key). Responde 401 y devuelve null si no sirve.
async function validarApiKey(req, res) {
  const clave = req.header("X-API-Key");
  if (!clave) {
    res.status(401).json({ error: "Falta la API key (header X-API-Key)" });
    return null;
  }
  const apiKey = await prisma.apiKey.findUnique({ where: { claveHash: hashApiKey(clave) } });
  if (!apiKey || !apiKey.activa) {
    res.status(401).json({ error: "API key invalida o desactivada" });
    return null;
  }
  // No bloquea la respuesta si falla; es informativo, no critico.
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { ultimoUso: new Date() } })
    .catch((err) => req.log?.warn({ err }, "no se pudo actualizar ultimoUso de la api key"));
  req.appNombre = apiKey.nombre;
  return apiKey;
}

// Aplicaciones propias (X-API-Key con alcance completo) u operadores de bodega con sesión iniciada con PIN
// (Authorization: Bearer <token>). No aplica al puente, que tiene su propia credencial.
export async function requireAppAuth(req, res, next) {
  try {
    const bearer = /^Bearer ([^\s]+)$/i.exec(req.header("Authorization") ?? "");
    if (bearer && !req.header("X-API-Key")) {
      const sesion = await autenticarSesion(bearer[1]);
      if (!sesion) return res.status(401).json({ error: "La sesión venció o no es válida. Volvé a ingresar con tu PIN." });
      req.operador = sesion.operador;
      req.sesionOperadorId = sesion.sesionId;
      req.appNombre = `operador:${sesion.operador.nombre}`;
      return next();
    }
    const apiKey = await validarApiKey(req, res);
    if (!apiKey) return undefined;
    if ((apiKey.alcance ?? "completo") !== "completo") {
      return res.status(403).json({ error: "Esta clave solo permite ingresar con nombre y PIN" });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// Ingreso de operadores: acepta cualquier API key activa, incluida la de solo ingreso de la app de escritorio.
export async function requireIngresoAuth(req, res, next) {
  try {
    return (await validarApiKey(req, res)) ? next() : undefined;
  } catch (err) {
    return next(err);
  }
}

// Lo que se monte después solo está disponible para aplicaciones: un operador llega hasta pedidos y picking.
export function soloAplicaciones(req, res, next) {
  if (req.operador) return res.status(403).json({ error: "Esta función no está disponible con el ingreso de operador" });
  return next();
}

// Credencial independiente de las aplicaciones de consulta.
export { requireBridgeAuth } from "./bridgeAuth.js";
