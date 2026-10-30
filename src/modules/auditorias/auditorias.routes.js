import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { soloSupervisor } from "../../middleware/authenticate.js";
import * as v from "./auditorias.schemas.js";
import * as s from "./auditorias.service.js";

// Auditorías de bodega. Se monta en /inventario/auditorias. Ver y escanear: operadores y aplicaciones. Iniciar,
// terminar, anular y ver el resultado: el supervisor (o una aplicación).
const router = Router();
const manejar = (accion, estado = 200) => async (req, res, next) => {
  try { res.status(estado).json(await accion(req)); } catch (error) { next(error); }
};
const quien = (req) => ({ aplicacion: req.appNombre ?? null });
const supervisor = (req, res, next) => (req.operador ? soloSupervisor(req, res, next) : next());

router.get("/", manejar(() => s.listarAlmacenes()));
router.get("/historial", supervisor, validate({ query: v.historialQuerySchema }), manejar((req) => s.historial(req.validatedQuery)));
router.post("/", supervisor, validate({ body: v.iniciarSchema }), manejar((req) => s.iniciar(req.body, quien(req)), 201));
router.get("/:id", validate({ params: v.idParamsSchema }), manejar((req) => s.consultar(req.params.id)));
router.post("/:id/lecturas", validate({ params: v.idParamsSchema, body: v.lecturaSchema }),
  manejar((req) => s.escanear(req.params.id, req.body, quien(req)), 201));
router.post("/:id/quitar-ultima", validate({ params: v.idParamsSchema, body: v.vacioSchema }), manejar((req) => s.quitarUltima(req.params.id, quien(req))));
router.post("/:id/terminar", supervisor, validate({ params: v.idParamsSchema, body: v.vacioSchema }), manejar((req) => s.terminar(req.params.id, quien(req))));
router.post("/:id/anular", supervisor, validate({ params: v.idParamsSchema, body: v.vacioSchema }), manejar((req) => s.anular(req.params.id, quien(req))));
router.get("/:id/resultado", supervisor, validate({ params: v.idParamsSchema }), manejar((req) => s.resultado(req.params.id)));
export default router;
