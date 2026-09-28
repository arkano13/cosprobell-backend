import { comprobarPedidoElegible } from "./picking.pedido.js";
import { pickingEscaneosRepository } from "./picking.escaneos.repository.js";
import { escanearBodySchema, historialQuerySchema } from "./picking.schemas.js";
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

export async function iniciarPicking({ pedidoDocEntry, usuarioId }) {
  return pickingRepository.conPedidoBloqueado(pedidoDocEntry, async (tx) => {
    const pedido = await pickingRepository.buscarPedidoConLineas(pedidoDocEntry, tx);
    comprobarPedidoElegible(pedido);

    const sesiones = await pickingRepository.buscarSesionesDelPedido(pedidoDocEntry, tx);
    const activas = sesiones.filter((sesion) => sesion.estado === "en_proceso");
    if (activas.length > 1) {
      throw new AppError({ code: "SESIONES_DUPLICADAS", message: "El pedido tiene varias sesiones activas; requiere revisión", statusCode: 409 });
    }
    if (activas.length === 1) return { picking: activas[0], creada: false };
    if (sesiones.length > 0) {
      throw new AppError({ code: "PEDIDO_CON_PICKING_FINALIZADO", message: "El pedido ya tiene un picking finalizado; requiere revisión antes de iniciar otro", statusCode: 409 });
    }
    if (pedido.lineas.length === 0) {
      throw new AppError({ code: "PEDIDO_SIN_LINEAS", message: "El pedido no tiene lineas", statusCode: 400 });
    }
    const picking = await pickingRepository.crearSesion({
      pedidoDocEntry: pedido.docEntry,
      usuarioId,
      lineas: pedido.lineas.map((linea) => ({
        pedidoLineNum: linea.lineNum,
        itemCode: linea.itemCode,
        cantidadPedida: linea.quantity,
        uomEntry: linea.uomEntry ?? null,
        uomCode: linea.uomCode ?? null,
      })),
    }, tx);
    return { picking, creada: true };
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

async function registrarUnidad(id, codigo, tx) {
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
  // Todas las lÃ­neas del producto deben tener cantidades compatibles.
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
      message: "La lÃ­nea cambiÃ³ durante el escaneo; vuelva a consultar la sesiÃ³n",
      statusCode: 409,
    });
  }

  return filas[0];
}

export async function escanearPicking(id, codigo, operacionId, { aplicacion = null } = {}) {
  const entrada = escanearBodySchema.safeParse({ codigo, operacionId });
  if (!entrada.success) {
    throw new AppError({
      code: "DATOS_ESCANEO_INVALIDOS",
      message: "El escaneo requiere un cÃ³digo vÃ¡lido y un operacionId UUID",
      statusCode: 400,
    });
  }

  const datos = entrada.data;
  const evento = await conSesionBloqueada(id, async ({ tx, sesion }) => {
    if (!sesion) throw sesionNoEncontrada();

    // Consultar antes del estado permite recuperar una respuesta perdida
    // incluso si la sesiÃ³n ya se cerrÃ³ despuÃ©s de aquella lectura.
    const anterior = await pickingEscaneosRepository.buscarOperacion(id, datos.operacionId, tx);
    if (anterior) {
      if (anterior.codigo !== datos.codigo) {
        throw new AppError({
          code: "OPERACION_REUTILIZADA",
          message: "El operacionId ya se utilizÃ³ con otro cÃ³digo de barras",
          statusCode: 409,
        });
      }
      return anterior;
    }

    const base = {
      pickingId: id,
      operacionId: datos.operacionId,
      codigo: datos.codigo,
      aplicacion,
    };

    let linea;
    try {
      comprobarSesionActiva(sesion);
      linea = await registrarUnidad(id, datos.codigo, tx);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      // Un rechazo de negocio no incrementa cantidades. Lo persistimos y
      // lo convertimos de nuevo en error DESPUÃ‰S de confirmar la transacciÃ³n.
      return pickingEscaneosRepository.crear({
        ...base,
        resultado: "rechazado",
        cantidadRegistrada: 0,
        httpStatus: error.statusCode,
        errorCode: error.code,
        errorMessage: error.message,
      }, tx);
    }

    // El evento y el incremento se confirman juntos. Si falla esta escritura,
    // PostgreSQL revierte tambiÃ©n la unidad; no se pierde el historial.
    return pickingEscaneosRepository.crear({
      ...base,
      resultado: "aceptado",
      lineaId: linea.id,
      itemCode: linea.itemCode,
      uomEntry: linea.uomEntry,
      cantidadRegistrada: 1,
      cantidadAntes: linea.cantidadEscaneada - 1,
      cantidadDespues: linea.cantidadEscaneada,
      httpStatus: 200,
      respuesta: JSON.parse(JSON.stringify(linea)),
    }, tx);
  });

  if (evento.resultado === "rechazado") {
    throw new AppError({
      code: evento.errorCode,
      message: evento.errorMessage,
      statusCode: evento.httpStatus,
    });
  }

  // Respuesta histÃ³rica de ESTA lectura, no el total actual de la sesiÃ³n.
  return evento.respuesta;
}

export async function consultarHistorialPicking(id, query = {}) {
  const entrada = historialQuerySchema.safeParse(query);
  if (!entrada.success) {
    throw new AppError({
      code: "PAGINACION_INVALIDA",
      message: "La paginaciÃ³n del historial no es vÃ¡lida",
      statusCode: 400,
    });
  }
  const sesion = await pickingRepository.buscarEstadoSesion(id);
  if (!sesion) throw sesionNoEncontrada();
  const filas = await pickingEscaneosRepository.listar(id, entrada.data);
  const data = filas.slice(0, entrada.data.limit);
  return {
    data,
    siguienteCursor: filas.length > entrada.data.limit ? data.at(-1).id : null,
  };
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