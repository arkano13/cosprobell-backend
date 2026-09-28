import { etiquetasRepository } from "./etiquetas.repository.js";
import { buscarUnidadMedida } from "../unidades-medida/unidades-medida.service.js";

export async function resolverEtiqueta(codigo) {
  if (
    typeof codigo !== "string" ||
    codigo.trim() === "" ||
    codigo.includes("\u0000")
  ) {
    return { estado: "codigo_invalido" };
  }

  const codigoNormalizado = codigo.trim();

  const productos =
    await etiquetasRepository.buscarProductos(codigoNormalizado);

  if (productos.length === 0) {
    return { estado: "no_encontrado" };
  }

  if (productos.length > 1) {
    return { estado: "codigo_ambiguo" };
  }

  const encontrado = productos[0];

  const contexto = {
    codigo: codigoNormalizado,
    producto: {
      itemCode: encontrado.itemCode,
      itemName: encontrado.itemName,
    },
  };

  // El código principal no tiene una unidad asociada en nuestro modelo.
  // Necesitamos una asociación explícita para esta misma etiqueta.
  if (encontrado.codigosBarras.length === 0) {
    return { ...contexto, estado: "unidad_no_definida" };
  }

  const referencias = new Set(
    encontrado.codigosBarras.map(({ uomEntry }) =>
      uomEntry === -1 || uomEntry == null ? null : uomEntry
    )
  );

  // No elegimos arbitrariamente entre asociaciones diferentes.
  if (referencias.size > 1) {
    return { ...contexto, estado: "unidad_ambigua" };
  }

  const [uomEntry] = referencias;
  const resultado = await buscarUnidadMedida(uomEntry);

  if (resultado.estado !== "encontrada") {
    return {
      ...contexto,
      estado:
        resultado.estado === "no_encontrada"
          ? "unidad_no_encontrada"
          : resultado.estado,
    };
  }

  return {
    ...contexto,
    estado: "resuelta",
    unidad: resultado.unidad,
  };
}