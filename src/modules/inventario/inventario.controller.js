import * as s from "./inventario.service.js";

const manejar = (accion, estado = 200) => async (req, res, next) => {
  try { res.status(estado).json(await accion(req)); } catch (error) { next(error); }
};
const quien = (req) => ({ aplicacion: req.appNombre ?? null });

export const resumen = manejar(() => s.resumenInventario());
export const productos = manejar((req) => s.buscarProductos(req.validatedQuery));
export const producto = manejar((req) => s.consultarProducto(req.params.itemCode));
export const pendientes = manejar(() => s.listarPendientes());
export const conteoInicial = manejar((req) => s.listarConteoInicial(req.validatedQuery));
export const existencias = manejar((req) => s.listarExistencias(req.validatedQuery));
export const bodega = manejar((req) => s.listarBodega(req.params.bodega, req.validatedQuery));
export const almacenes = manejar(() => s.listarAlmacenesSap());
export const productosDeAlmacen = manejar((req) => s.listarProductosDeAlmacen(req.params.codigo, req.validatedQuery));
export const caja = manejar((req) => s.consultarCaja(req.params.codigo));
export const porVencer = manejar((req) => s.listarPorVencer(req.validatedQuery));
export const movimientos = manejar((req) => s.listarMovimientos(req.validatedQuery));
export const descuentos = manejar((req) => s.listarDescuentos(req.validatedQuery));
export const recibir = manejar((req) => s.recibir(req.body, quien(req)), 201);
export const reponer = manejar((req) => s.reponer(req.body, quien(req)));
export const descontar = manejar((req) => s.descontar(req.body, quien(req)), 201);
export const reasignar = manejar((req) => s.reasignarDescuento(req.params.id, req.body, quien(req)));
export const contar = manejar((req) => s.contarPequena(req.params.itemCode, req.body, quien(req)));
export const corregir = manejar((req) => s.corregirCaja(req.params.id, req.body, quien(req)));
