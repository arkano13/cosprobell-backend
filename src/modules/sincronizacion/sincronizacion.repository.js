import { prisma } from "../../infrastructure/database/prisma.js";
export const sincronizacionRepository = {
  conBloqueo(operacion, db = prisma) {
    return db.$transaction(async (tx) => {
      // Una sola empresa por base local. Coordina incluso el primer lote de cada entidad.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260928, 1001)::text`;
      return operacion(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 30000 });
  },
  async existeOtraEmpresa(empresa, db = prisma) {
    const filas = await db.$queryRaw`SELECT 1 FROM sincronizacion_estados WHERE empresa <> ${empresa} LIMIT 1`;
    return filas.length > 0;
  },
  async consultarEstado(entidad, db = prisma) {
    const filas = await db.$queryRaw`SELECT * FROM sincronizacion_estados WHERE entidad = ${entidad}`;
    return filas[0] ?? null;
  },
  guardarProducto(producto, db) {
    return db.producto.upsert({
      where: { itemCode: producto.itemCode },
      create: { ...producto, sincronizadoEn: new Date() },
      update: { ...producto, sincronizadoEn: new Date() },
    });
  },
  guardarCliente(cliente, db) {
    // Solo los campos del contrato: no toca pedidos, facturas ni otros datos del cliente.
    return db.cliente.upsert({
      where: { cardCode: cliente.cardCode },
      create: { ...cliente, sincronizadoEn: new Date() },
      update: { ...cliente, sincronizadoEn: new Date() },
    });
  },
  async guardarEstado({ entidad, empresa, secuencia, hash, cantidad }, db) {
    await db.$executeRaw`
      INSERT INTO sincronizacion_estados (entidad, empresa, secuencia, hash, cantidad, "actualizadoEn")
      VALUES (${entidad}, ${empresa}, ${secuencia}, ${hash}, ${cantidad}, now())
      ON CONFLICT (entidad) DO UPDATE SET empresa = EXCLUDED.empresa,
        secuencia = EXCLUDED.secuencia, hash = EXCLUDED.hash,
        cantidad = EXCLUDED.cantidad, "actualizadoEn" = EXCLUDED."actualizadoEn"
    `;
  },
};
