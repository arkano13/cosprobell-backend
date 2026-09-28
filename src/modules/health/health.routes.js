import { Router } from "express";
import { prisma } from "../../infrastructure/database/prisma.js";

const router = Router();

// Health check simple: confirma que el proceso responde y que hay conexion
// con PostgreSQL. No expone detalles internos en la respuesta.
router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    req.log?.error({ err }, "health check: fallo la conexion a la base de datos");
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

export default router;