import { AppError } from "../../shared/errors/AppError.js";
import { pickingEtiquetasRepository } from "./picking.etiquetas.repository.js";
import { validarEtiquetaParaPicking } from "./picking.etiqueta.js";

export async function resolverEtiquetaParaPicking(codigo, db) {
  if (
    typeof codigo !== "string" ||
    codigo.trim() === "" ||
    codigo.includes("\u0000")
  ) {
    throw new AppError({
      code: "CODIGO_INVALIDO",
      message: "El código de barras no es válido",
      statusCode: 400,
    });
  }

  const codigoNormalizado = codigo.trim();

  const productos = await pickingEtiquetasRepository.buscarProductos(
    codigoNormalizado,
    db
  );

  if (productos.length === 0) {
    throw new AppError({
      code: "ETIQUETA_NO_ENCONTRADA",
      message: "No se encontró un producto para esta etiqueta",
      statusCode: 404,
    });
  }

  if (productos.length > 1) {
    throw new AppError({
      code: "CODIGO_AMBIGUO",
      message: "La etiqueta está asociada a más de un producto",
      statusCode: 409,
    });
  }

  const asociaciones = productos[0].codigosBarras;

  if (asociaciones.length === 0) {
    throw new AppError({
      code: "ETIQUETA_SIN_CONFIRMAR",
      message: "La etiqueta requiere una asociación confirmada para picking",
      statusCode: 409,
    });
  }

  if (asociaciones.length > 1) {
    throw new AppError({
      code: "ASOCIACION_AMBIGUA",
      message: "La etiqueta tiene asociaciones duplicadas que requieren revisión",
      statusCode: 409,
    });
  }

  return validarEtiquetaParaPicking(asociaciones[0]);
}