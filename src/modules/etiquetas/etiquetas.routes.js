import { Router } from "express";
import env from "../../config/env.js";
import { validate } from "../../middleware/validate.js";
import { autorizarApps } from "../../middleware/autorizarApps.js";
import { etiquetaParamsSchema, etiquetasQuerySchema, confirmacionBodySchema } from "./etiquetas.schemas.js";
import { listar, confirmar, revocar } from "./etiquetas.controller.js";
const router = Router();
// Consultar: cualquier aplicación autenticada. Confirmar o revocar: solo las de ETIQUETAS_APPS_AUTORIZADAS.
const soloAutorizadas = autorizarApps(env.etiquetasAppsAutorizadas, "confirmar etiquetas");
router.get("/etiquetas", validate({ query: etiquetasQuerySchema }), listar);
router.put("/etiquetas/:id/confirmacion", soloAutorizadas, validate({ params: etiquetaParamsSchema, body: confirmacionBodySchema }), confirmar);
router.delete("/etiquetas/:id/confirmacion", soloAutorizadas, validate({ params: etiquetaParamsSchema }), revocar);
export default router;
