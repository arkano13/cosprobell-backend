import { productosRepository } from "./productos.repository.js";

export function listarProductos({ q, limit } = {}) {
  return productosRepository.listar({ q, take: limit || 20 });
}

export function obtenerProducto(itemCode) {
  return productosRepository.buscarPorItemCode(itemCode);
}

export async function buscarProductoPorCodigo(codigo) {
  if (typeof codigo !== "string" || codigo.trim() === "") {
    return { estado: "codigo_invalido" };
  }
  const productos = await productosRepository.buscarPorCodigo(codigo.trim());
  if (productos.length === 0) {
    return { estado: "no_encontrado" };
  }
  if (productos.length > 1) {
    return { estado: "codigo_ambiguo" };
  }
  return { estado: "encontrado", producto: productos[0] };
}
