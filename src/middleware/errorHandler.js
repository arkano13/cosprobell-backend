import { AppError } from "../shared/errors/AppError.js";

export default function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  // Errores del lector JSON en la entrada del puente son errores de petición.
  if (req.originalUrl?.startsWith("/integracion/") &&
      ["entity.parse.failed", "entity.too.large"].includes(error.type)) {
    const grande = error.type === "entity.too.large";
    return res.status(grande ? 413 : 400).json({ error: {
      code: grande ? "CUERPO_DEMASIADO_GRANDE" : "JSON_INVALIDO",
      message: grande ? "El envío supera el tamaño permitido" : "El cuerpo debe ser JSON válido",
    } });
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