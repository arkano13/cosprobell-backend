import { listarPedidos, obtenerPedido } from "./pedidos.service.js";
export async function listar(req, res, next) {
  try { res.json(await listarPedidos(req.validatedQuery)); } catch (error) { next(error); }
}
export async function obtener(req, res, next) {
  try { res.json(await obtenerPedido(req.params.docEntry)); } catch (error) { next(error); }
}
