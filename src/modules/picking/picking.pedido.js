import { AppError } from "../../shared/errors/AppError.js";

export function comprobarPedidoElegible(pedido) {
  if (!pedido) throw new AppError({
    code: "PEDIDO_NO_ENCONTRADO", message: "Pedido no encontrado", statusCode: 404,
  });
  if (pedido.cancelled === true || ["csYes", "csCancellation"].includes(pedido.cancelStatus)) {
    throw new AppError({ code: "PEDIDO_CANCELADO", message: "El pedido está cancelado", statusCode: 409 });
  }
  // cancelled es Boolean en nuestra BD, no el texto tNO/tYES recibido de SAP.
  // cancelStatus es opcional; si existe, solo reconocemos csNo como no cancelado.
  if (pedido.cancelled !== false || (pedido.cancelStatus != null && pedido.cancelStatus !== "csNo")) {
    throw new AppError({ code: "ESTADO_PEDIDO_DESCONOCIDO", message: "No se puede confirmar el estado de cancelación del pedido", statusCode: 409 });
  }
  if (pedido.documentStatus === "bost_Close") {
    throw new AppError({ code: "PEDIDO_CERRADO", message: "El pedido está cerrado", statusCode: 409 });
  }
  if (pedido.documentStatus !== "bost_Open") {
    throw new AppError({ code: "ESTADO_PEDIDO_DESCONOCIDO", message: "No se puede confirmar que el pedido esté abierto", statusCode: 409 });
  }
}
