import {
  iniciarPicking,
  consultarPicking,
  escanearPicking,
  finalizarPicking,
  consultarHistorialPicking,
} from "./picking.service.js";

import { AppError } from "../../shared/errors/AppError.js";

function responderError(error, res, next) {
  // Compatibilidad con las respuestas actuales de picking.
  // La migración al formato estructurado será un cambio separado.
  if (
    error instanceof AppError &&
    error.statusCode < 500
  ) {
    return res.status(error.statusCode).json({
      error: error.message,
    });
  }

  return next(error);
}

// Con ingreso de operador, quien prepara es el operador de la sesión, no lo que diga el cuerpo.
export function datosInicio(req) {
  return req.operador ? { ...req.body, usuarioId: req.operador.nombre } : req.body;
}

export async function iniciar(req, res, next) {
  try {
    const { picking, creada } = await iniciarPicking(datosInicio(req));

    return res.status(creada ? 201 : 200).json({
      data: picking,
    });
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function consultar(req, res, next) {
  try {
    const picking = await consultarPicking(req.params.id);

    return res.json({
      data: picking,
    });
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function escanear(req, res, next) {
  try {
    const linea = await escanearPicking(
      req.params.id,
      req.body.codigo,
      req.body.operacionId,
      { aplicacion: req.appNombre ?? null }
    );

    return res.json({
      data: linea,
    });
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function finalizar(req, res, next) {
  try {
    const picking = await finalizarPicking(req.params.id, req.body);

    return res.json({
      data: picking,
    });
  } catch (error) {
    return responderError(error, res, next);
  }
}
export async function historial(req, res, next) {
  try {
    return res.json(await consultarHistorialPicking(req.params.id, req.validatedQuery));
  } catch (error) {
    return responderError(error, res, next);
  }
}
