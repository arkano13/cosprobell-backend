import { AppError } from "../../shared/errors/AppError.js";

export function validarEtiquetaParaPicking(etiqueta) {
  if (!etiqueta) {
    throw new AppError({
      code: "ETIQUETA_NO_ENCONTRADA",
      message: "No existe una asociación para esta etiqueta",
      statusCode: 404,
    });
  }

  const confirmacion = etiqueta.confirmacionPicking;

  if (!confirmacion) {
    throw new AppError({
      code: "ETIQUETA_SIN_CONFIRMAR",
      message: "La etiqueta todavía no está confirmada para picking",
      statusCode: 409,
    });
  }

  const coincide =
    confirmacion.codigoBarrasId === etiqueta.id &&
    confirmacion.itemCodeConfirmado === etiqueta.itemCode &&
    confirmacion.codigoConfirmado === etiqueta.codigo &&
    confirmacion.uomEntryConfirmado === etiqueta.uomEntry;

  if (!coincide) {
    throw new AppError({
      code: "CONFIRMACION_DESACTUALIZADA",
      message: "La asociación de la etiqueta cambió y requiere revisión",
      statusCode: 409,
    });
  }

  if (confirmacion.esUnidadIndividual !== true) {
    throw new AppError({
      code: "PRESENTACION_NO_PERMITIDA",
      message: "El picking solo permite unidades individuales",
      statusCode: 409,
    });
  }

  return {
    codigoBarrasId: etiqueta.id,
    codigo: etiqueta.codigo,
    itemCode: etiqueta.itemCode,
    uomEntry: etiqueta.uomEntry,
    cantidadUnidades: 1,
  };
}