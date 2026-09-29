import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { pedidoParamsSchema, pedidosQuerySchema } from "./pedidos.schemas.js";
import { listar, obtener } from "./pedidos.controller.js";
const router = Router();
router.get("/pedidos", validate({ query: pedidosQuerySchema }), listar);
router.get("/pedidos/:docEntry", validate({ params: pedidoParamsSchema }), obtener);
export default router;
