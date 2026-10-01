import { pedidosRepository as repo } from "./pedidos.repository.js";
import { comprobarPedidoElegible, lineasParaPreparar } from "../picking/picking.pedido.js";
import { AppError } from "../../shared/errors/AppError.js";
import { almacenesParaPedidos } from "../inventario/inventario.service.js";
export async function listarPedidos(query) {
  // El supervisor puede dejar en la lista solo los pedidos de los almacenes de esta bodega.
  const almacenes = await almacenesParaPedidos();
  const filas = await repo.listar({ ...query, almacenes });
  const pagina = filas.slice(0, query.limit);
  // Un pedido preparado sigue abierto hasta que SAP registra la entrega; la bodega lo ve como "Preparado".
  const preparaciones = pagina.length ? await repo.preparaciones(pagina.map((p) => p.docEntry)) : [];
  const ultima = new Map();
  for (const preparacion of preparaciones) {
    if (!ultima.has(preparacion.pedidoDocEntry)) ultima.set(preparacion.pedidoDocEntry, resumirPreparacion(preparacion));
  }
  const data = pagina.map((pedido) => ({ ...pedido, preparado: ultima.get(pedido.docEntry) ?? null }));
  return { data, siguienteCursor: filas.length > query.limit ? pagina.at(-1).docEntry : null };
}
function resumirPreparacion({ id, estado, usuarioId, fechaFin, lineas }) {
  const sumar = (valor) => lineas.reduce((total, linea) => total + valor(linea), 0);
  return { pickingId: id, estado, operador: usuarioId, fechaFin,
    unidadesPreparadas: sumar((l) => Math.min(l.cantidadEscaneada, l.cantidadPedida)), unidadesPedidas: sumar((l) => l.cantidadPedida) };
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
