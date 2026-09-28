import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { listarQuerySchema, itemCodeParamsSchema } from "./productos.schemas.js";
import { listar, obtener } from "./productos.controller.js";

const router = Router();
router.get("/productos", validate({ query: listarQuerySchema }), listar);
router.get("/productos/:itemCode", validate({ params: itemCodeParamsSchema }), obtener);

export default router;
