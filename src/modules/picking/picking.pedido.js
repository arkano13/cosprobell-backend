import { AppError } from "../../shared/errors/AppError.js";
import { unidadConocida, UNIDAD_MANUAL } from "./picking.cantidades.js";
import { productosDelCombo } from "./picking.combos.js";
import { fuentesDocumento, esSalidaSap } from "../pedidos/preparacion.fuente.js";

export function comprobarPedidoElegible(pedido) {
  if (!pedido) throw new AppError({
    code: "PEDIDO_NO_ENCONTRADO", message: "Pedido no encontrado", statusCode: 404,
  });
  if (!fuentesDocumento().includes(pedido.fuenteDocumento ?? "pedido")) throw new AppError({
    code: "FUENTE_PREPARACION_INCORRECTA", message: "Este documento pertenece a la fuente anterior de preparación", statusCode: 409 });
  if (pedido.cancelled === true || ["csYes", "csCancellation"].includes(pedido.cancelStatus)) {
    throw new AppError({ code: "PEDIDO_CANCELADO", message: "El pedido está cancelado", statusCode: 409 });
  }
  // cancelled es Boolean en nuestra BD, no el texto tNO/tYES recibido de SAP.
  // cancelStatus es opcional; si existe, solo reconocemos csNo como no cancelado.
  if (pedido.cancelled !== false || (pedido.cancelStatus != null && pedido.cancelStatus !== "csNo")) {
    throw new AppError({ code: "ESTADO_PEDIDO_DESCONOCIDO", message: "No se puede confirmar el estado de cancelación del pedido", statusCode: 409 });
  }
  if (!esSalidaSap(pedido.fuenteDocumento) && pedido.documentStatus === "bost_Close") {
    throw new AppError({ code: "PEDIDO_CERRADO", message: "El pedido está cerrado", statusCode: 409 });
  }
  if (!["bost_Open", ...(esSalidaSap(pedido.fuenteDocumento) ? ["bost_Close"] : [])].includes(pedido.documentStatus)) {
    throw new AppError({ code: "ESTADO_PEDIDO_DESCONOCIDO", message: "No se puede confirmar que el pedido esté abierto", statusCode: 409 });
  }
  if (pedido.docType !== "dDocument_Items") {
    throw new AppError({ code: "TIPO_PEDIDO_NO_PERMITIDO", message: "Solo se preparan pedidos de artículos con tipo confirmado", statusCode: 409 });
  }
}

// Lo que no es mercadería no se prepara: la línea de una lista de materiales de venta (el padre; sus productos vienen como
// líneas propias, iIngredient) y los artículos que en SAP no son "de inventario" (pedido.noInventario, por ejemplo una
// promoción 2+1 que solo lleva el precio: los tintes vienen en otras líneas). No se escanean ni salen de la bodega.
export const TIPO_LISTA_VENTA = "iSalesTree";

export function lineasParaPreparar(pedido) {
  const error = (code, message) => new AppError({ code, message, statusCode: 409 });
  const abiertas = [];
  const conListaVenta = pedido.lineas.some((l) => l.treeType === TIPO_LISTA_VENTA);
  for (const linea of pedido.lineas) {
    if (linea.treeType === TIPO_LISTA_VENTA || pedido.noInventario?.has(linea.itemCode)) continue;
    if (esSalidaSap(pedido.fuenteDocumento) && linea.warehouseCode !== "02") continue;
    if (!esSalidaSap(pedido.fuenteDocumento) && linea.lineStatus === "bost_Close") continue;
    if (!["bost_Open", ...(esSalidaSap(pedido.fuenteDocumento) ? ["bost_Close"] : [])].includes(linea.lineStatus)) throw error("ESTADO_LINEA_DESCONOCIDO", "No se puede confirmar el estado de una línea");
    const pendiente = linea.remainingOpenQuantity;
    if (!Number.isSafeInteger(pendiente) || pendiente < 0 || !Number.isFinite(linea.quantity) || pendiente > linea.quantity) {
      throw error("PENDIENTE_NO_CONFIRMADO", "La cantidad pendiente no es válida para preparar unidades individuales");
    }
    if (pendiente === 0) continue;
    if (!unidadConocida(linea.uomEntry) || !linea.itemCode) {
      throw error("UNIDAD_NO_DEFINIDA", "La línea requiere un producto y una unidad de medida confirmados");
    }
    if (linea.remainingOpenInventoryQuantity !== pendiente || linea.inventoryQuantity !== linea.quantity) {
      throw error("CONVERSION_NO_CONFIRMADA", "Las cantidades de venta e inventario requieren revisar su equivalencia");
    }
    const combo = pedido.combos?.get(linea.itemCode);
    if (linea.treeType === "iAssemblyTree" && !combo) throw error("COMBO_SIN_RECETA", "Falta sincronizar la receta del combo.");
    if (combo) {
      // Los componentes de una lista de venta también vienen como iIngredient: esos no son de este combo.
      if (!conListaVenta && pedido.lineas.some(l => l.treeType === "iIngredient")) throw error("COMBO_YA_DESGLOSADO", "SAP incluye componentes en el pedido; revisar su relación antes de expandir el combo.");
      // El combo no se escanea: se preparan sus productos, en unidades de inventario (cada código de barras ya está
      // confirmado como una unidad individual del producto).
      for (const { itemCode, factor } of productosDelCombo(combo)) {
        if (itemCode === linea.itemCode || pedido.combos?.has(itemCode)) throw error("COMBO_ANIDADO", "Revisar la receta: contiene otro combo o se referencia a sí misma.");
        if (!Number.isSafeInteger(pendiente * factor) || pendiente * factor > 2147483647) throw error("COMBO_CANTIDAD_NO_ENTERA", "La cantidad del componente excede el límite permitido.");
        abiertas.push({ pedidoLineNum: linea.lineNum, itemCode, cantidadPedida: pendiente * factor,
          uomEntry: UNIDAD_MANUAL, uomCode: null, comboItemCode: linea.itemCode, comboFactor: factor });
      }
      continue;
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
  const normalizar = lineas => lineas
    .map(l => [l.pedidoLineNum, l.itemCode, l.cantidadPedida, l.uomEntry, l.uomCode ?? null, l.comboItemCode ?? null, l.comboFactor ?? null])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return JSON.stringify(normalizar(sesion.lineas)) === JSON.stringify(normalizar(esperadas));
}
