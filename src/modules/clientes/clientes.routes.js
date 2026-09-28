import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { validate } from "../../middleware/validate.js";
import { safeString } from "../../shared/validation/safeString.js";

const router = Router();

const listarQuerySchema = z.object({
  q: safeString(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get("/clientes", validate({ query: listarQuerySchema }), async (req, res, next) => {
  try {
    const { q, limit } = req.validatedQuery;
    const take = limit || 20;

    const clientes = await prisma.cliente.findMany({
      where: q
        ? {
            OR: [
              { cardName: { contains: q, mode: "insensitive" } },
              { cardCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      take,
      orderBy: { cardName: "asc" },
      select: {
        cardCode: true,
        cardName: true,
        valid: true,
        creditLimit: true,
        currentAccountBalance: true,
      },
    });

    res.json({ data: clientes });
  } catch (err) {
    next(err);
  }
});

const cardCodeParamsSchema = z.object({
  cardCode: safeString(1),
});

router.get("/clientes/:cardCode", validate({ params: cardCodeParamsSchema }), async (req, res, next) => {
  try {
    const { cardCode } = req.params;

    const cliente = await prisma.cliente.findUnique({
      where: { cardCode },
      include: {
        facturas: { orderBy: { docDate: "desc" }, take: 10 },
        pedidos: { orderBy: { docDate: "desc" }, take: 10 },
      },
    });

    if (!cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    res.json({ data: cliente });
  } catch (err) {
    next(err);
  }
});

export default router;  