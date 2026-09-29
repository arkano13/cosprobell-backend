import { listarOperadores, iniciarSesion, cerrarSesion } from "./operadores.service.js";

export async function listar(_req, res, next) {
  try { res.json({ data: await listarOperadores() }); } catch (error) { next(error); }
}
export async function iniciar(req, res, next) {
  try { res.status(201).json({ data: await iniciarSesion({ ...req.body, aplicacion: req.appNombre ?? null }) }); } catch (error) { next(error); }
}
export async function cerrar(req, res, next) {
  try {
    if (!req.sesionOperadorId) return res.status(400).json({ error: "No hay una sesión de operador para cerrar" });
    await cerrarSesion(req.sesionOperadorId);
    res.status(204).end();
  } catch (error) { next(error); }
}
