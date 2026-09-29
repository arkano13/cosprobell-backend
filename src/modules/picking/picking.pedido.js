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
  if (pedido.docType !== "dDocument_Items") {
    throw new AppError({ code: "TIPO_PEDIDO_NO_PERMITIDO", message: "Solo se preparan pedidos de artículos con tipo confirmado", statusCode: 409 });
  }
}

export function lineasParaPreparar(pedido) {
  const error = (code, message) => new AppError({ code, message, statusCode: 409 });
  const abiertas = [];
  for (const linea of pedido.lineas) {
    if (linea.lineStatus === "bost_Close") continue;
    if (linea.lineStatus !== "bost_Open") throw error("ESTADO_LINEA_DESCONOCIDO", "No se puede confirmar el estado de una línea");
    const pendiente = linea.remainingOpenQuantity;
    if (!Number.isSafeInteger(pendiente) || pendiente < 0 || !Number.isFinite(linea.quantity) || pendiente > linea.quantity) {
      throw error("PENDIENTE_NO_CONFIRMADO", "La cantidad pendiente no es válida para preparar unidades individuales");
    }
    if (pendiente === 0) continue;
    if (!Number.isInteger(linea.uomEntry) || linea.uomEntry < 0 || !linea.itemCode) {
      throw error("UNIDAD_NO_DEFINIDA", "La línea requiere un producto y una unidad de medida confirmados");
    }
    if (linea.remainingOpenInventoryQuantity !== pendiente || linea.inventoryQuantity !== linea.quantity) {
      throw error("CONVERSION_NO_CONFIRMADA", "Las cantidades de venta e inventario requieren revisar su equivalencia");
    }
    abiertas.push({ pedidoLineNum: linea.lineNum, itemCode: linea.itemCode,
      cantidadPedida: pendiente, uomEntry: linea.uomEntry, uomCode: linea.uomCode ?? null });
  }
  if (!abiertas.length) throw error("PEDIDO_SIN_PENDIENTES", "El pedido no tiene líneas pendientes para preparar");
  return abiertas;
}

export function sesionCoincideConPedido(sesion, pedido) {
  let esperadas;
  try { esperadas = lineasParaPreparar(pedido); }
  catch (error) { if (error instanceof AppError) return false; throw error; }
  const normalizar = lineas => [...lineas].sort((a, b) => a.pedidoLineNum - b.pedidoLineNum)
    .map(l => [l.pedidoLineNum, l.itemCode, l.cantidadPedida, l.uomEntry, l.uomCode ?? null]);
  return JSON.stringify(normalizar(sesion.lineas)) === JSON.stringify(normalizar(esperadas));
}
