import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { validate } from "../../middleware/validate.js";
import { safeString } from "../../shared/validation/safeString.js";
import { exigirConsultaFinanciera } from "../finanzas/finanzas.permisos.js";
import { leerLegadoFinanciero } from "../finanzas/finanzas.lectura-tablas.js";

const router = Router();
router.use("/pagos", exigirConsultaFinanciera);

const listarQuerySchema = z.object({
  cardCode: safeString(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get("/pagos", validate({ query: listarQuerySchema }), async (req, res, next) => {
  try {
    const { cardCode, limit } = req.validatedQuery;
    const take = limit || 20;

    const pagos = await leerLegadoFinanciero(prisma, ["pagos", "aplicacionesPagos"], (tx, versiones) => tx.pago.findMany({
      where: { finVersion: versiones.pagos, ...(cardCode ? { cardCode } : {}) },
      take,
      orderBy: { docDate: "desc" },
      include: { aplicaciones: { where: { finVersion: versiones.aplicacionesPagos } } },
    }));

    res.json({ data: pagos });
  } catch (err) {
    next(err);
  }
});

export default router;
