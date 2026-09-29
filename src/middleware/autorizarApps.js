import { AppError } from "../shared/errors/AppError.js";

// Restringe una función a ciertas aplicaciones (nombre de su API key). Cerrada si no hay ninguna configurada.
export function autorizarApps(permitidas, funcion) {
  return (req, _res, next) => {
    if (!permitidas.length) {
      return next(new AppError({ code: "FUNCION_NO_HABILITADA", message: `Ninguna aplicación está autorizada para ${funcion}`, statusCode: 403 }));
    }
    if (!permitidas.includes(req.appNombre)) {
      return next(new AppError({ code: "APLICACION_NO_AUTORIZADA", message: `Esta aplicación no está autorizada para ${funcion}`, statusCode: 403 }));
    }
    return next();
  };
}
