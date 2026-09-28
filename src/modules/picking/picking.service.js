import { resolverEtiquetaParaPicking } from "./picking.etiquetas.service.js";
import { validarCompatibilidadLinea } from "./picking.cantidades.js";
import { pickingRepository } from "./picking.repository.js";
import { conSesionBloqueada } from "./picking.transaction.js";
import { AppError } from "../../shared/errors/AppError.js";

function sesionNoEncontrada() {
  return new AppError({
    code: "PICKING_NO_ENCONTRADO",
    message: "Sesion de picking no encontrada",
    statusCode: 404,
  });
}

function comprobarSesionActiva(sesion) {
  if (!sesion) {
    throw sesionNoEncontrada();
  }

  if (sesion.estado !== "en_proceso") {
    throw new AppError({
      code: "PICKING_NO_ACTIVO",
      message: `El picking ya esta en estado '${sesion.estado}'`,
      statusCode: 400,
    });
  }
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
      uomEntry: linea.uomEntry ?? null,
      uomCode: linea.uomCode ?? null,
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
  return conSesionBloqueada(id, async ({ tx, sesion }) => {
    comprobarSesionActiva(sesion);

    const etiqueta = await resolverEtiquetaParaPicking(codigo, tx);
    const picking = await pickingRepository.buscarSesionConLineas(id, tx);

    if (!picking) {
      throw sesionNoEncontrada();
    }

    const lineas = picking.lineas
      .filter((linea) => linea.itemCode === etiqueta.itemCode)
      .sort((a, b) => a.id - b.id);

    if (lineas.length === 0) {
      throw new AppError({
        code: "PRODUCTO_FUERA_DEL_PEDIDO",
        message: "Ese producto no pertenece a este pedido",
        statusCode: 409,
      });
    }

    // En este alcance no repartimos lecturas entre presentaciones distintas.
    // Todas las líneas del producto deben tener cantidades compatibles.
    for (const linea of lineas) {
      validarCompatibilidadLinea(linea, etiqueta);
    }

    const pendiente = lineas.find(
      (linea) => linea.cantidadEscaneada < linea.cantidadPedida
    );

    if (!pendiente) {
      throw new AppError({
        code: "CANTIDAD_COMPLETADA",
        message: "Ese producto ya completo su cantidad pedida",
        statusCode: 409,
      });
    }

    const filas = await pickingRepository.incrementarLinea({
      pickingId: id,
      lineaId: pendiente.id,
      itemCode: etiqueta.itemCode,
      codigo: etiqueta.codigo,
      uomEntry: etiqueta.uomEntry,
    }, tx);

    if (filas.length !== 1) {
      throw new AppError({
        code: "LINEA_MODIFICADA",
        message: "La línea cambió durante el escaneo; vuelva a consultar la sesión",
        statusCode: 409,
      });
    }

    return filas[0];
  });
}

export async function finalizarPicking(id) {
  return conSesionBloqueada(id, async ({ tx, sesion }) => {
    comprobarSesionActiva(sesion);

    const picking =
      await pickingRepository.buscarSesionConLineas(id, tx);

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
      new Date(),
      tx
    );
  });
}