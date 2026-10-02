import { AppError } from "../../shared/errors/AppError.js";
import { etiquetasRepository as repo } from "./etiquetas.repository.js";
import { unidadConocida } from "../picking/picking.cantidades.js";

// estado: sin_confirmar | desactualizada (cambió en SAP después de confirmarse) | unidad_individual | no_es_unidad.
function vista(f) {
  const estado = !f.confirmada ? "sin_confirmar" : f.desactualizada ? "desactualizada"
    : f.esUnidadIndividual ? "unidad_individual" : "no_es_unidad";
  return {
    id: f.id, itemCode: f.itemCode, itemName: f.itemName, codigo: f.codigo, uomEntry: f.uomEntry,
    unidad: f.uomCode ? { code: f.uomCode, nombre: f.uomNombre } : null, sapAbsEntry: f.sapAbsEntry, origen: f.origen ?? "sap", estado,
    confirmacion: f.confirmada ? { esUnidadIndividual: f.esUnidadIndividual, confirmadaEn: f.confirmadaEn,
      confirmadaPor: f.confirmadaPor, observacion: f.observacion } : null,
  };
}
const noEncontrada = () => new AppError({ code: "ETIQUETA_NO_ENCONTRADA", message: "Código de barras no encontrado", statusCode: 404 });

export async function listarEtiquetas(query) {
  const filas = await repo.listar(query);
  const data = filas.slice(0, query.limit).map(vista);
  return { data, siguienteCursor: filas.length > query.limit ? data.at(-1).id : null };
}

export async function confirmarEtiqueta(id, { esUnidadIndividual, observacion = null }, { aplicacion }) {
  await repo.conEtiquetaBloqueada(id, async ({ tx, etiqueta }) => {
    if (!etiqueta) throw noEncontrada();
    if (etiqueta.retiradoEnSap) {
      throw new AppError({ code: "ETIQUETA_RETIRADA", message: "SAP ya no lista este código de barras", statusCode: 409 });
    }
    // Sin unidad no se identifica una presentación: no se confirma como unidad individual. "Manual" (-1) sí:
    // es la unidad del artículo, y quien confirma decide si el código es de una unidad o de una caja.
    // Marcarla como "no es unidad" siempre se permite.
    if (esUnidadIndividual && !unidadConocida(etiqueta.uomEntry)) {
      throw new AppError({ code: "UNIDAD_NO_DEFINIDA", message: "El código no tiene una unidad de medida definida en SAP", statusCode: 409 });
    }
    await repo.guardarConfirmacion({
      codigoBarrasId: etiqueta.id, esUnidadIndividual,
      itemCodeConfirmado: etiqueta.itemCode, codigoConfirmado: etiqueta.codigo, uomEntryConfirmado: etiqueta.uomEntry,
      confirmadaEn: new Date(), confirmadaPor: aplicacion, observacion,
    }, tx);
  });
  return { data: vista(await repo.obtener(id)) };
}

export function contarEtiquetas() {
  return repo.contar();
}

export async function confirmarManualPendientes({ cantidadEsperada, versionEsperada }, { aplicacion }) {
  const { confirmadas, disponibles } = await repo.confirmarManualPendientes({ cantidadEsperada, versionEsperada, confirmadaPor: aplicacion });
  if (disponibles !== cantidadEsperada) {
    throw new AppError({ code: "CANTIDAD_CAMBIO", statusCode: 409,
      message: `Ahora hay ${disponibles} códigos con unidad Manual sin confirmar (antes ${cantidadEsperada}). Revisá la lista y volvé a intentar.` });
  }
  return { data: { confirmadas } };
}

export async function revocarConfirmacion(id) {
  await repo.conEtiquetaBloqueada(id, async ({ tx, etiqueta }) => {
    if (!etiqueta) throw noEncontrada();
    await repo.eliminarConfirmacion(etiqueta.id, tx);
  });
  return { data: vista(await repo.obtener(id)) };
}
