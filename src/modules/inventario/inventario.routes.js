import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { soloSupervisor } from "../../middleware/authenticate.js";
import * as v from "./inventario.schemas.js";
import * as c from "./inventario.controller.js";

// Inventario de la bodega. Se monta en /inventario. Consultar, recibir, reponer y elegir el lote de lo que SAP
// descontó: aplicaciones y operadores. Cambiar un lote ya elegido, contar la pequeña y corregir una caja: solo el supervisor.
const router = Router();
router.get("/resumen", c.resumen);
router.get("/productos", validate({ query: v.buscarQuerySchema }), c.productos);
router.get("/productos/:itemCode", validate({ params: v.itemCodeParamsSchema }), c.producto);
router.get("/pendientes", c.pendientes);
router.get("/pendientes/inicial", validate({ query: v.conteoInicialQuerySchema }), c.conteoInicial);
router.get("/existencias", validate({ query: v.existenciasQuerySchema }), c.existencias);
router.get("/bodegas/:bodega", validate({ params: v.bodegaParamsSchema, query: v.bodegaQuerySchema }), c.bodega);
router.get("/almacenes", c.almacenes);
router.get("/almacenes/:codigo/productos", validate({ params: v.almacenParamsSchema, query: v.almacenQuerySchema }), c.productosDeAlmacen);
router.get("/cajas/:codigo", validate({ params: v.cajaParamsSchema }), c.caja);
router.get("/por-vencer", validate({ query: v.porVencerQuerySchema }), c.porVencer);
router.get("/movimientos", validate({ query: v.movimientosQuerySchema }), c.movimientos);
router.get("/descuentos", validate({ query: v.descuentosQuerySchema }), c.descuentos);
router.post("/recepciones", validate({ body: v.recepcionSchema }), c.recibir);
router.post("/reposiciones", validate({ body: v.reposicionSchema }), c.reponer);
router.post("/descuentos", validate({ body: v.descuentoSchema }), c.descontar);
router.post("/descuentos/:id/reasignacion", soloSupervisor, validate({ params: v.idParamsSchema, body: v.reasignacionSchema }), c.reasignar);
router.put("/productos/:itemCode/pequena", soloSupervisor, validate({ params: v.itemCodeParamsSchema, body: v.conteoSchema }), c.contar);
router.put("/cajas/:id/unidades", soloSupervisor, validate({ params: v.idParamsSchema, body: v.correccionCajaSchema }), c.corregir);
export default router;
