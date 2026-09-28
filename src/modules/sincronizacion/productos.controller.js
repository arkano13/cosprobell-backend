import { recibirProductos, consultarEstadoProductos } from "./productos.service.js";
export async function recibir(req, res, next) {
  try { res.json({ data: await recibirProductos(req.body, req.empresaSap) }); }
  catch (error) { next(error); }
}
export async function estado(req, res, next) {
  try { res.json({ data: await consultarEstadoProductos(req.empresaSap) }); }
  catch (error) { next(error); }
}
