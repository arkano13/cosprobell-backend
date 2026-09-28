import { pickingRepository } from "./picking.repository.js";
import { AppError } from "../../shared/errors/AppError.js";

function sesionNoEncontrada() {
  return new AppError({
    code: "PICKING_NO_ENCONTRADO",
    message: "Sesion de picking no encontrada",
    statusCode: 404,
  });
}

export async function iniciarPicking({
  pedidoDocEntry,
  usuarioId,
}) {
  const pedido =
    await pickingRepository.buscarPedidoConLineas(pedidoDocEntry);

  if (!pedido) {
    throw new AppError({
      code: "PEDIDO_NO_ENCONTRADO",
      message: "Pedido no encontrado",
      statusCode: 404,
    });
  }

  if (pedido.lineas.length === 0) {
    throw new AppError({
      code: "PEDIDO_SIN_LINEAS",
      message: "El pedido no tiene lineas",
      statusCode: 400,
    });
  }

  return pickingRepository.crearSesion({
    pedidoDocEntry: pedido.docEntry,
    usuarioId,
    lineas: pedido.lineas.map((linea) => ({
      pedidoLineNum: linea.lineNum,
      itemCode: linea.itemCode,
      cantidadPedida: linea.quantity,
    })),
  });
}

export async function consultarPicking(id) {
  const picking =
    await pickingRepository.buscarSesionConLineas(id);

  if (!picking) {
    throw sesionNoEncontrada();
  }

  return picking;
}

export async function escanearPicking(id, codigo) {
  const picking =
    await pickingRepository.buscarEstadoSesion(id);

  if (!picking) {
    throw sesionNoEncontrada();
  }

  if (picking.estado !== "en_proceso") {
    throw new AppError({
      code: "PICKING_NO_ACTIVO",
      message: `El picking ya esta en estado '${picking.estado}'`,
      statusCode: 400,
    });
  }

  const filas =
    await pickingRepository.incrementarLinea(id, codigo);

  if (filas.length > 0) {
    return filas[0];
  }

  const linea =
    await pickingRepository.buscarLineaProducto(id, codigo);

  if (!linea) {
    throw new AppError({
      code: "PRODUCTO_FUERA_DEL_PEDIDO",
      message: "Ese producto no pertenece a este pedido",
      statusCode: 409,
    });
  }

  // Conserva la interpretación actual.
  // Revisaremos este caso junto con los bloqueos y la concurrencia.
  throw new AppError({
    code: "CANTIDAD_COMPLETADA",
    message: "Ese producto ya completo su cantidad pedida",
    statusCode: 409,
  });
}

export async function finalizarPicking(id) {
  const picking =
    await pickingRepository.buscarSesionConLineas(id);

  if (!picking) {
    throw sesionNoEncontrada();
  }

  const hayDiferencias = picking.lineas.some(
    (linea) =>
      linea.cantidadEscaneada !== linea.cantidadPedida
  );

  const estado = hayDiferencias
    ? "con_diferencias"
    : "completo";

  return pickingRepository.guardarFinalizacion(
    id,
    estado,
    new Date()
  );
}