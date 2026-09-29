import { prisma } from "../../infrastructure/database/prisma.js";

export const productosRepository = {
  listar({ q, take }) {
    return prisma.producto.findMany({
      where: q
        ? {
            OR: [
              { itemName: { contains: q, mode: "insensitive" } },
              { itemCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      take,
      orderBy: { itemName: "asc" },
      select: {
        itemCode: true,
        itemName: true,
        valid: true,
        quantityOnStock: true,
      },
    });
  },

  buscarPorItemCode(itemCode) {
    return prisma.producto.findUnique({
      where: { itemCode },
      include: {
        existencias: { include: { bodega: true } },
        precios: { include: { listaPrecio: true } },
      },
    });
  },

  buscarPorCodigo(codigo) {
    return prisma.producto.findMany({
      where: {
        OR: [
          { barCode: codigo },
          { codigosBarras: { some: { codigo, retiradoEnSap: false } } },
        ],
      },
      select: { itemCode: true, itemName: true },
      take: 2,
    });
  },
};
