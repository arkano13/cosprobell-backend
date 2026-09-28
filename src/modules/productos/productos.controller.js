import { listarProductos, obtenerProducto } from "./productos.service.js";

export async function listar(req, res, next) {
  try {
    const productos = await listarProductos(req.validatedQuery);
    res.json({ data: productos });
  } catch (err) {
    next(err);
  }
}

export async function obtener(req, res, next) {
  try {
    const producto = await obtenerProducto(req.params.itemCode);
    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json({ data: producto });
  } catch (err) {
    next(err);
  }
}
