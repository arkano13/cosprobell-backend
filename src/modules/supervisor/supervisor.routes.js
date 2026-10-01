import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { soloSupervisor } from "../../middleware/authenticate.js";
import { confirmacionBodySchema } from "../etiquetas/etiquetas.schemas.js";
import { activoSchema, confirmacionMasivaSchema, etiquetasQuerySchema, idParamsSchema, nuevoOperadorSchema, pinSchema } from "./supervisor.schemas.js";
import * as c from "./supervisor.controller.js";

// Panel del supervisor: solo operadores con rol supervisor y sesión iniciada con PIN. Se monta en /supervisor.
const router = Router();
router.use(soloSupervisor);
router.get("/resumen", c.resumen);
router.get("/etiquetas", validate({ query: etiquetasQuerySchema }), c.etiquetas);
router.post("/etiquetas/confirmacion-manual", validate({ body: confirmacionMasivaSchema }), c.confirmarManual);
router.put("/etiquetas/:id/confirmacion", validate({ params: idParamsSchema, body: confirmacionBodySchema }), c.confirmar);
router.delete("/etiquetas/:id/confirmacion", validate({ params: idParamsSchema }), c.revocar);
router.get("/operadores", c.operadores);
router.post("/operadores", validate({ body: nuevoOperadorSchema }), c.crear);
router.put("/operadores/:id/pin", validate({ params: idParamsSchema, body: pinSchema }), c.pin);
router.post("/operadores/:id/desbloqueo", validate({ params: idParamsSchema }), c.desbloqueo);
router.put("/operadores/:id/activo", validate({ params: idParamsSchema, body: activoSchema }), c.activo);
router.get("/revisiones", c.revisiones);
router.post("/revisiones/:id/anulacion", validate({ params: idParamsSchema }), c.anulacion);
router.get("/sincronizacion", c.sincronizacion);
export default router;
