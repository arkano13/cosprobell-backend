import { AppError } from "../../shared/errors/AppError.js";

function unidadConocida(valor) {
  return (
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor <= 2_147_483_647
  );
}

// "etiqueta" debe venir de resolverEtiquetaParaPicking,
// que ya comprueba la confirmación local.
export function validarCompatibilidadLinea(linea, etiqueta) {
  if (linea.itemCode !== etiqueta.itemCode) {
    throw new AppError({
      code: "PRODUCTO_FUERA_DE_LINEA",
      message: "La etiqueta no corresponde al producto de esta línea",
      statusCode: 409,
    });
  }

  if (etiqueta.cantidadUnidades !== 1) {
    throw new AppError({
      code: "PRESENTACION_NO_PERMITIDA",
      message: "Solo se permite registrar una unidad individual por lectura",
      statusCode: 409,
    });
  }

  if (
    !unidadConocida(linea.uomEntry) ||
    !unidadConocida(etiqueta.uomEntry)
  ) {
    throw new AppError({
      code: "UNIDAD_NO_DEFINIDA",
      message: "Falta una unidad de medida conocida para comparar las cantidades",
      statusCode: 409,
    });
  }

  if (linea.uomEntry !== etiqueta.uomEntry) {
    throw new AppError({
      code: "UNIDAD_INCOMPATIBLE",
      message: "La etiqueta y la línea del pedido utilizan unidades diferentes",
      statusCode: 409,
    });
  }

  const cantidadesValidas =
    Number.isSafeInteger(linea.cantidadPedida) &&
    linea.cantidadPedida > 0 &&
    Number.isSafeInteger(linea.cantidadEscaneada) &&
    linea.cantidadEscaneada >= 0 &&
    linea.cantidadEscaneada <= linea.cantidadPedida;

  if (!cantidadesValidas) {
    throw new AppError({
      code: "CANTIDADES_INVALIDAS",
      message: "La línea no tiene cantidades válidas para picking por unidades individuales",
      statusCode: 409,
    });
  }
}