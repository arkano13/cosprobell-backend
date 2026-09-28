import { Router } from "express";
import { requireBridgeAuth } from "../../middleware/bridgeAuth.js";
import { recibir, estado } from "./productos.controller.js";
const router = Router();
router.use(requireBridgeAuth);
router.post("/productos", recibir);
router.get("/productos/estado", estado);
router.use((_req, res) => res.status(404).json({ error: "Recurso no encontrado" }));
export default router;
