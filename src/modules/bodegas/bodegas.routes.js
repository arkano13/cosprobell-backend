import { Router } from "express";
import { prisma } from "../../infrastructure/database/prisma.js";

const router = Router();

// Sin parametros de entrada que validar - se deja igual.
router.get("/bodegas", async (req, res, next) => {
  try {
    const bodegas = await prisma.bodega.findMany({
      where: { inactive: false },
      orderBy: { warehouseName: "asc" },
    });
    res.json({ data: bodegas });
  } catch (err) {
    next(err);
  }
});

export default router;