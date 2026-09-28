import { prisma } from "../../infrastructure/database/prisma.js";

const FILAS_POR_INSERCION = 5_000;

function enBloques(filas) {
  const bloques = [];

  for (let inicio = 0; inicio < filas.length; inicio += FILAS_POR_INSERCION) {
    bloques.push(filas.slice(inicio, inicio + FILAS_POR_INSERCION));
  }

  return bloques;
}

export const sincronizacionRepository = {
  enTransaccion(trabajo) {
    return prisma.$transaction(trabajo, {
      maxWait: 10_000,
      timeout: 60_000,
    });
  },

  registrarEjecucion(tx, entidad) {
    return tx.sincronizacion.upsert({
      where: { entidad },
      create: { entidad, estado: "ok" },
      update: { ultimaEjecucion: new Date(), estado: "ok" },
    });
  },

  registrarLote(tx, { loteId, sincronizacionId, cantidadRegistros }) {
    return tx.sincronizacionLote.create({
      data: {
        loteId,
        sincronizacionId,
        cantidadRegistros,
        resultado: "aplicado",
      },
    });
  },

  registrarError({ entidad, loteId, mensaje }) {
    return prisma.errorSincronizacion.create({
      data: { entidad, loteId, mensaje },
    });
  },

  guardarGrupo(tx, grupo) {
    const { number, ...datos } = grupo;

    return tx.grupoProducto.upsert({
      where: { number },
      create: grupo,
      update: datos,
    });
  },

  guardarBodega(tx, bodega) {
    const { warehouseCode, ...datos } = bodega;

    return tx.bodega.upsert({
      where: { warehouseCode },
      create: bodega,
      update: datos,
    });
  },

  async buscarBodegasExistentes(tx, codigos) {
    const bodegas = await tx.bodega.findMany({
      where: { warehouseCode: { in: codigos } },
      select: { warehouseCode: true },
    });

    return new Set(bodegas.map((bodega) => bodega.warehouseCode));
  },

  async buscarGruposExistentes(tx, numeros) {
    const grupos = await tx.grupoProducto.findMany({
      where: { number: { in: numeros } },
      select: { number: true },
    });

    return new Set(grupos.map((grupo) => grupo.number));
  },

  // SAP entrega las colecciones completas de cada producto: se reemplazan.
  async guardarProductos(tx, items) {
    const itemCodes = items.map((item) => item.producto.itemCode);
    const ahora = new Date();

    for (const { producto } of items) {
      const { itemCode, ...datos } = producto;

      await tx.producto.upsert({
        where: { itemCode },
        create: producto,
        update: { ...datos, sincronizadoEn: ahora },
      });
    }

    await tx.productoCodigoBarras.deleteMany({
      where: { itemCode: { in: itemCodes } },
    });

    await tx.productoExistencia.deleteMany({
      where: { itemCode: { in: itemCodes } },
    });

    const codigos = items.flatMap((item) =>
      item.codigosBarras.map((codigo) => ({
        itemCode: item.producto.itemCode,
        ...codigo,
      }))
    );

    const existencias = items.flatMap((item) =>
      item.existencias.map((existencia) => ({
        itemCode: item.producto.itemCode,
        ...existencia,
        actualizadoEn: ahora,
      }))
    );

    for (const bloque of enBloques(codigos)) {
      await tx.productoCodigoBarras.createMany({ data: bloque });
    }

    for (const bloque of enBloques(existencias)) {
      await tx.productoExistencia.createMany({ data: bloque });
    }
  },
};
