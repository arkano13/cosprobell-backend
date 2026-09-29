import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireAppAuth, requireIngresoAuth } from "../../middleware/authenticate.js";
import { iniciarSesionSchema } from "./operadores.schemas.js";
import { listar, iniciar, cerrar } from "./operadores.controller.js";

// Ingreso de operadores con PIN. Se monta antes de la autenticación general: acepta la clave de solo ingreso
// que viaja dentro de la app de escritorio.
const router = Router();
router.get("/ingreso/operadores", requireIngresoAuth, listar);
router.post("/ingreso/sesion", requireIngresoAuth, validate({ body: iniciarSesionSchema }), iniciar);
router.delete("/ingreso/sesion", requireAppAuth, cerrar);
export default router;
