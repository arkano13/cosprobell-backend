import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import * as v from "./conteos.schemas.js";
import * as s from "./conteos.service.js";

// Conteos con nombre. Se monta en /conteos. Cualquier operador inicia, escanea y finaliza los suyos; el supervisor y las
// aplicaciones ven todos.
const router = Router();
const manejar = (accion, estado = 200) => async (req, res, next) => {
  try { res.status(estado).json(await accion(req)); } catch (error) { next(error); }
};
const quien = (req) => ({ operador: req.operador ?? null, aplicacion: req.appNombre ?? null });

router.get("/", validate({ query: v.listarQuerySchema }), manejar((req) => s.listar(req.validatedQuery, quien(req))));
router.post("/", validate({ body: v.iniciarSchema }), manejar((req) => s.iniciar(req.body, quien(req)), 201));
router.get("/:id", validate({ params: v.idParamsSchema }), manejar((req) => s.consultar(req.params.id, quien(req))));
router.post("/:id/lecturas", validate({ params: v.idParamsSchema, body: v.lecturaSchema }),
  manejar((req) => s.escanear(req.params.id, req.body, quien(req)), 201));
router.post("/:id/quitar-ultima", validate({ params: v.idParamsSchema, body: v.vacioSchema }), manejar((req) => s.quitarUltima(req.params.id, quien(req))));
router.post("/:id/terminar", validate({ params: v.idParamsSchema, body: v.vacioSchema }), manejar((req) => s.terminar(req.params.id, quien(req))));
router.post("/:id/anular", validate({ params: v.idParamsSchema, body: v.vacioSchema }), manejar((req) => s.anular(req.params.id, quien(req))));
export default router;
