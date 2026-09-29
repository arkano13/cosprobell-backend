import { recibirLote, consultarEstadoLote, consultarPedidosAbiertos, consultarHora, retirarCodigosNoListados } from "./sincronizacion.service.js";
export const recibir = (entidad) => async (req, res, next) => {
  try { res.json({ data: await recibirLote(entidad, req.body, req.empresaSap) }); }
  catch (error) { next(error); }
};
export const estado = (entidad) => async (req, res, next) => {
  try { res.json({ data: await consultarEstadoLote(entidad, req.empresaSap) }); }
  catch (error) { next(error); }
};
export async function pedidosAbiertos(req, res, next) {
  try { res.json({ data: await consultarPedidosAbiertos(req.empresaSap) }); }
  catch (error) { next(error); }
}
export async function hora(req, res, next) {
  try { res.json({ data: await consultarHora(req.empresaSap) }); }
  catch (error) { next(error); }
}
export async function codigosRetirados(req, res, next) {
  try { res.json({ data: await retirarCodigosNoListados(req.body, req.empresaSap) }); }
  catch (error) { next(error); }
}
