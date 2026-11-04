import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { validate } from "../../middleware/validate.js";
import { safeString } from "../../shared/validation/safeString.js";
import { exigirConsultaFinanciera } from "../finanzas/finanzas.permisos.js";
import { leerLegadoFinanciero } from "../finanzas/finanzas.lectura-tablas.js";

const router = Router();
router.use("/facturas", exigirConsultaFinanciera);

const listarQuerySchema = z.object({
  cardCode: safeString(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get("/facturas", validate({ query: listarQuerySchema }), async (req, res, next) => {
  try {
    const { cardCode, limit } = req.validatedQuery;
    const take = limit || 20;

    const facturas = await leerLegadoFinanciero(prisma, ["facturas"], (tx, versiones) => tx.factura.findMany({
      where: { finVersion: versiones.facturas, ...(cardCode ? { cardCode } : {}) },
      take,
      orderBy: { docDate: "desc" },
    }));

    res.json({ data: facturas });
  } catch (err) {
    next(err);
  }
});

const docEntryParamsSchema = z.object({
  docEntry: z.coerce.number().int().positive(),
});

router.get("/facturas/:docEntry", validate({ params: docEntryParamsSchema }), async (req, res, next) => {
  try {
    const { docEntry } = req.params;

    const factura = await leerLegadoFinanciero(prisma, ["facturas", "facturaLineas", "aplicacionesPagos", "pagos"], (tx, versiones) => tx.factura.findFirst({
      where: { docEntry, finVersion: versiones.facturas },
      include: {
        lineas: { where: { finVersion: versiones.facturaLineas } },
        aplicaciones: { where: { finVersion: versiones.aplicacionesPagos, pago: { finVersion: versiones.pagos } }, include: { pago: true } },
        cliente: { select: { cardCode: true, cardName: true } },
      },
    }));

    if (!factura) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    res.json({ data: factura });
  } catch (err) {
    next(err);
  }
});

export default router;
