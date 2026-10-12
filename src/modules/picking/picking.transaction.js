import { prisma } from "../../infrastructure/database/prisma.js";

export async function conSesionBloqueada(id, operacion) {
  return prisma.$transaction(
    async (tx) => {
      const sesiones = await tx.$queryRaw`
        SELECT s.id, s.estado, p."fuenteDocumento"
        FROM picking_pedidos s JOIN pedidos p ON p."docEntry" = s."pedidoDocEntry"
        WHERE s.id = ${id}
        FOR UPDATE OF s
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
