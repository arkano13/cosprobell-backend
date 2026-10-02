import { Router } from "express";
import { requireBridgeAuth } from "../../middleware/bridgeAuth.js";
import { recibir, estado, pedidosAbiertos, hora, codigosRetirados } from "./sincronizacion.controller.js";
import { ENTIDADES_SINCRONIZABLES } from "./sincronizacion.service.js";
import { observarRegistros } from "./observados.service.js";
import { registrarRecorrido } from "./recorridos.service.js";
const router = Router();
router.use(requireBridgeAuth);
for (const entidad of ["almacenes", "existencias"]) {
  for (const accion of ["iniciar", "finalizar"]) router.post(`/${entidad}/recorrido/${accion}`, async (req, res, next) => {
    try { res.json({ data: await registrarRecorrido(entidad, accion, req.body, req.empresaSap) }); }
    catch (error) { next(error); }
  });
}
// Rutas fijas por entidad (/integracion/productos, /integracion/clientes...), sin parámetros libres.
for (const entidad of ENTIDADES_SINCRONIZABLES) {
  router.post(`/${entidad}/observados`, async (req, res, next) => {
    try { res.json({ data: await observarRegistros(entidad, req.body, req.empresaSap) }); }
    catch (error) { next(error); }
  });
  router.post(`/${entidad}`, recibir(entidad));
  router.get(`/${entidad}/estado`, estado(entidad));
}
router.get("/pedidos/abiertos", pedidosAbiertos);
router.get("/hora", hora);
router.post("/codigosBarras/retirados", codigosRetirados);
router.use((_req, res) => res.status(404).json({ error: "Recurso no encontrado" }));
export default router;
