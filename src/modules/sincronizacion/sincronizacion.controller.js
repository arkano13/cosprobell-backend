import { procesarLote } from "./sincronizacion.service.js";

export async function recibirLote(req, res, next) {
  try {
    const resultado = await procesarLote(req.body, { log: req.log });

    return res.json({ data: resultado });
  } catch (error) {
    return next(error);
  }
}
