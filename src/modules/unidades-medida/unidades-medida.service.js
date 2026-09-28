import { unidadesMedidaRepository } from "./unidades-medida.repository.js";

export async function buscarUnidadMedida(uomEntry) {
  // No tenemos una referencia de catálogo utilizable.
  // -1 aparece en la muestra asociado a "Manual".
  // Ninguno de estos valores confirma una unidad individual.
  if (uomEntry === null || uomEntry === undefined || uomEntry === -1) {
    return { estado: "unidad_no_definida" };
  }

  // SAP declara este identificador como entero de 32 bits.
  // No convertimos cadenas o decimales automáticamente.
  if (
    !Number.isInteger(uomEntry) ||
    uomEntry < 0 ||
    uomEntry > 2_147_483_647
  ) {
    return { estado: "referencia_invalida" };
  }

  const unidad =
    await unidadesMedidaRepository.buscarPorId(uomEntry);

  if (!unidad) {
    return { estado: "no_encontrada" };
  }

  return {
    estado: "encontrada",
    unidad,
  };
}