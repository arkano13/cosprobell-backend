import { Router } from "express";
import { requireBridgeAuth } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { loteSchema } from "./sincronizacion.schemas.js";
import { recibirLote } from "./sincronizacion.controller.js";

const router = Router();

router.post(
  "/sync/lotes",
  requireBridgeAuth,
  validate({ body: loteSchema }),
  recibirLote
);

export default router;
