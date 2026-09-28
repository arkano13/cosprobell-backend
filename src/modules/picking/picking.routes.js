import { Router } from "express";
import { validate } from "../../middleware/validate.js";

import {
  iniciarBodySchema,
  idParamsSchema,
  escanearBodySchema,
} from "./picking.schemas.js";

import {
  iniciar,
  consultar,
  escanear,
  finalizar,
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

export default router;