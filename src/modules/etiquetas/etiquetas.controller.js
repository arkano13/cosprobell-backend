import { listarEtiquetas, confirmarEtiqueta, revocarConfirmacion } from "./etiquetas.service.js";
export async function listar(req, res, next) {
  try { res.json(await listarEtiquetas(req.validatedQuery)); } catch (error) { next(error); }
}
export async function confirmar(req, res, next) {
  try { res.json(await confirmarEtiqueta(req.params.id, req.body, { aplicacion: req.appNombre ?? null })); } catch (error) { next(error); }
}
export async function revocar(req, res, next) {
  try { res.json(await revocarConfirmacion(req.params.id)); } catch (error) { next(error); }
}
