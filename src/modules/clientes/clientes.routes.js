import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { validate } from "../../middleware/validate.js";
import { safeString } from "../../shared/validation/safeString.js";
import { puedeConsultarFinanzas } from "../finanzas/finanzas.permisos.js";
import { leerLegadoFinanciero } from "../finanzas/finanzas.lectura-tablas.js";

const router = Router();

const listarQuerySchema = z.object({
  q: safeString(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get("/clientes", validate({ query: listarQuerySchema }), async (req, res, next) => {
  try {
    const { q, limit } = req.validatedQuery;
    const take = limit || 20;

    const consultar = (db, versiones = {}) => db.cliente.findMany({
      where: { ...(versiones.clientes ? { finVersion: versiones.clientes } : {}), ...(q
        ? {
            OR: [
              { cardName: { contains: q, mode: "insensitive" } },
              { cardCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}) },
      take,
      orderBy: { cardName: "asc" },
      select: {
        cardCode: true,
        cardName: true,
        valid: true,
        ...(puedeConsultarFinanzas(req) ? { creditLimit: true, currentAccountBalance: true } : {}),
      },
    });
    const clientes = puedeConsultarFinanzas(req)
      ? await leerLegadoFinanciero(prisma, ["clientes"], consultar) : await consultar(prisma);

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

    const consultar = (db, versiones = {}) => db.cliente.findFirst({
      where: { cardCode, ...(versiones.clientes ? { finVersion: versiones.clientes } : {}) },
      ...(puedeConsultarFinanzas(req) ? { include: {
        facturas: { where: { finVersion: versiones.facturas }, orderBy: { docDate: "desc" }, take: 10 },
        pedidos: { orderBy: { docDate: "desc" }, take: 10 },
      } } : { select: { cardCode: true, cardName: true, valid: true, frozen: true, sincronizadoEn: true } }),
    });
    const cliente = puedeConsultarFinanzas(req)
      ? await leerLegadoFinanciero(prisma, ["clientes", "facturas"], consultar) : await consultar(prisma);

    if (!cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    res.json({ data: cliente });
  } catch (err) {
    next(err);
  }
});

export default router;
