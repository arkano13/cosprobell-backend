import { recibirLote, consultarEstadoLote } from "./sincronizacion.service.js";
export const recibir = (entidad) => async (req, res, next) => {
  try { res.json({ data: await recibirLote(entidad, req.body, req.empresaSap) }); }
  catch (error) { next(error); }
};
export const estado = (entidad) => async (req, res, next) => {
  try { res.json({ data: await consultarEstadoLote(entidad, req.empresaSap) }); }
  catch (error) { next(error); }
};
