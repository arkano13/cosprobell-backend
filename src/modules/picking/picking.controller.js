import {
  iniciarPicking,
  consultarPicking,
  escanearPicking,
  finalizarPicking,
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

export async function iniciar(req, res, next) {
  try {
    const picking = await iniciarPicking(req.body);

    return res.status(201).json({
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
      req.body.codigo
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
    const picking = await finalizarPicking(req.params.id);

    return res.json({
      data: picking,
    });
  } catch (error) {
    return responderError(error, res, next);
  }
}