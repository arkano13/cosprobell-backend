import { prisma } from "../../infrastructure/database/prisma.js";

export const pickingEtiquetasRepository = {
  buscarProductos(codigo, db = prisma) {
    return db.producto.findMany({
      where: {
        OR: [
          { barCode: codigo },
          { codigosBarras: { some: { codigo, retiradoEnSap: false } } },
        ],
      },
      select: {
        itemCode: true,
        codigosBarras: {
          where: { codigo, retiradoEnSap: false },
          select: {
            id: true,
            itemCode: true,
            codigo: true,
            uomEntry: true,
            confirmacionPicking: true,
          },
          take: 2,
        },
      },
      take: 2,
    });
  },
};