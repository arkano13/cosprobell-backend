import { pedidosRepository as repo } from "./pedidos.repository.js";
import { comprobarPedidoElegible, lineasParaPreparar } from "../picking/picking.pedido.js";
import { AppError } from "../../shared/errors/AppError.js";
export async function listarPedidos(query) {
  const filas = await repo.listar(query);
  const data = filas.slice(0, query.limit);
  return { data, siguienteCursor: filas.length > query.limit ? data.at(-1).docEntry : null };
}
export async function obtenerPedido(docEntry) {
  const pedido = await repo.obtener(docEntry);
  if (!pedido) throw new AppError({ code: "PEDIDO_NO_ENCONTRADO", message: "Pedido no encontrado", statusCode: 404 });
  let preparacion;
  try {
    comprobarPedidoElegible(pedido);
    preparacion = { datosValidos: true, lineas: lineasParaPreparar(pedido) };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    preparacion = { datosValidos: false, code: error.code, message: error.message };
  }
  // Es un diagnóstico de los datos locales; iniciarPicking comprueba además las sesiones.
  return { data: pedido, preparacion };
}
