import { prisma } from "../../infrastructure/database/prisma.js";

export const unidadesMedidaRepository = {
  buscarPorId(absEntry) {
    return prisma.unidadMedida.findUnique({
      where: { absEntry },
      select: {
        absEntry: true,
        code: true,
        name: true,
      },
    });
  },
};