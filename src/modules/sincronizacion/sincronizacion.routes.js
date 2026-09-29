import { Router } from "express";
import { requireBridgeAuth } from "../../middleware/bridgeAuth.js";
import { recibir, estado, pedidosAbiertos } from "./sincronizacion.controller.js";
import { ENTIDADES_SINCRONIZABLES } from "./sincronizacion.service.js";
const router = Router();
router.use(requireBridgeAuth);
// Rutas fijas por entidad (/integracion/productos, /integracion/clientes...), sin parámetros libres.
for (const entidad of ENTIDADES_SINCRONIZABLES) {
  router.post(`/${entidad}`, recibir(entidad));
  router.get(`/${entidad}/estado`, estado(entidad));
}
router.get("/pedidos/abiertos", pedidosAbiertos);
router.use((_req, res) => res.status(404).json({ error: "Recurso no encontrado" }));
export default router;
