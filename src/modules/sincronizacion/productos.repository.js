import { prisma } from "../../infrastructure/database/prisma.js";
export const sincronizacionProductosRepository = {
  conBloqueo(operacion, db = prisma) {
    return db.$transaction(async (tx) => {
      // Una sola empresa por base local. Coordina incluso el primer lote.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260928, 1001)::text`;
      return operacion(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 30000 });
  },
  async consultarEstado(db = prisma) {
    const filas = await db.$queryRaw`SELECT * FROM sincronizacion_estados WHERE entidad = 'productos'`;
    return filas[0] ?? null;
  },
  guardarProducto(producto, db) {
    return db.producto.upsert({
      where: { itemCode: producto.itemCode },
      create: { ...producto, sincronizadoEn: new Date() },
      update: { ...producto, sincronizadoEn: new Date() },
    });
  },
  async guardarEstado({ empresa, secuencia, hash, cantidad }, db) {
    await db.$executeRaw`
      INSERT INTO sincronizacion_estados (entidad, empresa, secuencia, hash, cantidad, "actualizadoEn")
      VALUES ('productos', ${empresa}, ${secuencia}, ${hash}, ${cantidad}, now())
      ON CONFLICT (entidad) DO UPDATE SET empresa = EXCLUDED.empresa,
        secuencia = EXCLUDED.secuencia, hash = EXCLUDED.hash,
        cantidad = EXCLUDED.cantidad, "actualizadoEn" = EXCLUDED."actualizadoEn"
    `;
  },
};
