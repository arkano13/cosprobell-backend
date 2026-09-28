import { prisma } from "../../infrastructure/database/prisma.js";

export const pickingEscaneosRepository = {
  buscarOperacion(pickingId, operacionId, db = prisma) {
    return db.pickingEscaneo.findUnique({
      where: { pickingId_operacionId: { pickingId, operacionId } },
    });
  },

  crear(datos, db = prisma) {
    return db.pickingEscaneo.create({ data: datos });
  },

  listar(pickingId, { limit, despuesDe }, db = prisma) {
    return db.pickingEscaneo.findMany({
      where: {
        pickingId,
        ...(despuesDe === undefined ? {} : { id: { gt: despuesDe } }),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        operacionId: true,
        codigo: true,
        resultado: true,
        lineaId: true,
        itemCode: true,
        uomEntry: true,
        cantidadRegistrada: true,
        cantidadAntes: true,
        cantidadDespues: true,
        httpStatus: true,
        errorCode: true,
        errorMessage: true,
        aplicacion: true,
        creadoEn: true,
      },
    });
  },
};
