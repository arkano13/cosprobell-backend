import { AppError } from "../shared/errors/AppError.js";

export default function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const esErrorConocido = error instanceof AppError;

  const statusCode = esErrorConocido
    ? error.statusCode
    : 500;

  const esErrorInterno = statusCode >= 500;

  if (esErrorInterno) {
    req.log?.error({ err: error }, "Error interno");
  } else {
    req.log?.warn(
      { code: error.code, statusCode },
      "Solicitud rechazada"
    );
  }

  return res.status(statusCode).json({
    error: {
      code: esErrorInterno
        ? "INTERNAL_ERROR"
        : error.code,

      message: esErrorInterno
        ? "Error interno del servidor"
        : error.message,
    },
  });
}