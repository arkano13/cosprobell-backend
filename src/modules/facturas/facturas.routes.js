import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { validate } from "../../middleware/validate.js";
import { safeString } from "../../shared/validation/safeString.js";

const router = Router();

const listarQuerySchema = z.object({
  cardCode: safeString(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get("/facturas", validate({ query: listarQuerySchema }), async (req, res, next) => {
  try {
    const { cardCode, limit } = req.validatedQuery;
    const take = limit || 20;

    const facturas = await prisma.factura.findMany({
      where: cardCode ? { cardCode } : undefined,
      take,
      orderBy: { docDate: "desc" },
    });

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

    const factura = await prisma.factura.findUnique({
      where: { docEntry },
      include: {
        lineas: true,
        aplicaciones: { include: { pago: true } },
        cliente: { select: { cardCode: true, cardName: true } },
      },
    });

    if (!factura) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    res.json({ data: factura });
  } catch (err) {
    next(err);
  }
});

export default router;