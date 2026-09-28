import { prisma } from "../../infrastructure/database/prisma.js";

export const etiquetasRepository = {
  buscarProductos(codigo) {
    return prisma.producto.findMany({
      where: {
        OR: [
          { barCode: codigo },
          { codigosBarras: { some: { codigo } } },
        ],
      },
      select: {
        itemCode: true,
        itemName: true,
        codigosBarras: {
          where: { codigo },
          select: { uomEntry: true },
        },
      },
      take: 2,
    });
  },
};