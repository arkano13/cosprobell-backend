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

router.get("/pagos", validate({ query: listarQuerySchema }), async (req, res, next) => {
  try {
    const { cardCode, limit } = req.validatedQuery;
    const take = limit || 20;

    const pagos = await prisma.pago.findMany({
      where: cardCode ? { cardCode } : undefined,
      take,
      orderBy: { docDate: "desc" },
      include: { aplicaciones: true },
    });

    res.json({ data: pagos });
  } catch (err) {
    next(err);
  }
});

export default router;