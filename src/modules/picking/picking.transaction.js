import { prisma } from "../../infrastructure/database/prisma.js";

export async function conSesionBloqueada(id, operacion) {
  return prisma.$transaction(
    async (tx) => {
      const sesiones = await tx.$queryRaw`
        SELECT id, estado
        FROM picking_pedidos
        WHERE id = ${id}
        FOR UPDATE
      `;

      const sesion = sesiones[0] ?? null;

      return operacion({
        tx,
        sesion,
      });
    },
    {
      isolationLevel: "ReadCommitted",
      maxWait: 5_000,
      timeout: 10_000,
    }
  );
}