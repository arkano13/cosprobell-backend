import { Router } from "express";
import { validate } from "../../middleware/validate.js";

import {
  iniciarBodySchema,
  idParamsSchema,
  escanearBodySchema,
  historialQuerySchema,
} from "./picking.schemas.js";

import {
  iniciar,
  consultar,
  escanear,
  finalizar,
  historial,
} from "./picking.controller.js";

const router = Router();

router.post(
  "/picking",
  validate({ body: iniciarBodySchema }),
  iniciar
);

router.get(
  "/picking/:id",
  validate({ params: idParamsSchema }),
  consultar
);

router.post(
  "/picking/:id/escanear",
  validate({
    params: idParamsSchema,
    body: escanearBodySchema,
  }),
  escanear
);

router.post(
  "/picking/:id/finalizar",
  validate({ params: idParamsSchema }),
  finalizar
);

router.get(
  "/picking/:id/escaneos",
  validate({ params: idParamsSchema, query: historialQuerySchema }),
  historial
);

export default router;