import { ZodError } from "zod";

export function validate(schemas) {
  return (req, res, next) => {
    let params;
    let query;
    let body;

    try {
      if (schemas.params) {
        params = schemas.params.parse(req.params);
      }

      if (schemas.query) {
        query = schemas.query.parse(req.query);
      }

      if (schemas.body) {
        body = schemas.body.parse(req.body);
      }
    } catch (error) {
      if (!(error instanceof ZodError)) {
        return next(error);
      }

      return res.status(400).json({
        error: "Datos de entrada invalidos",
        detalles: error.issues.map((issue) => ({
          campo: issue.path.join("."),
          mensaje: issue.message,
        })),
      });
    }

    // Aplicamos los resultados solo cuando toda la validación terminó.
    if (schemas.params) {
      req.params = params;
    }

    if (schemas.query) {
      req.validatedQuery = query;
    }

    if (schemas.body) {
      req.body = body;
    }

    return next();
  };
}