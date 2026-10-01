// Códigos de barras que SAP no tiene: el supervisor escanea el envase, elige el producto y el código queda
// guardado con la unidad Manual del artículo, ya confirmado como unidad. La sincronización no lo retira.
import { prisma } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { UNIDAD_MANUAL, unidadConocida } from "../picking/picking.cantidades.js";

const enUso = (otro) => new AppError({ code: "CODIGO_EN_USO", statusCode: 409,
  message: `Ese código ya está registrado para ${otro.itemName} (${otro.itemCode})` });

export const codigosRepository = {
  // Un registro a la vez por código: dos supervisores no pueden asignarlo a productos distintos.
  conCodigoBloqueado(codigo, operacion) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`codigo:${codigo}`}))::text`;
      return operacion(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
  },
};

export async function registrarCodigo({ codigo, itemCode }, { aplicacion }, { repo = codigosRepository } = {}) {
  return repo.conCodigoBloqueado(codigo, async (tx) => {
    const producto = await tx.producto.findUnique({ where: { itemCode }, select: { itemCode: true, itemName: true } });
    if (!producto) throw new AppError({ code: "PRODUCTO_NO_ENCONTRADO", message: "Producto no encontrado", statusCode: 404 });
    const activos = await tx.productoCodigoBarras.findMany({ where: { codigo, retiradoEnSap: false },
      include: { confirmacionPicking: true, producto: { select: { itemCode: true, itemName: true } } }, orderBy: { id: "asc" } });
    const deOtro = activos.find((c) => c.itemCode !== itemCode);
    if (deOtro) throw enUso(deOtro.producto);
    const fichaDeOtro = await tx.producto.findFirst({ where: { barCode: codigo, itemCode: { not: itemCode } }, select: { itemCode: true, itemName: true } });
    if (fichaDeOtro) throw enUso(fichaDeOtro);

    let fila = activos[0] ?? null;
    const nuevo = !fila;
    if (!fila) {
      fila = await tx.productoCodigoBarras.create({ data: { itemCode, codigo, uomEntry: UNIDAD_MANUAL, origen: "app", registradoPor: aplicacion } });
    } else if (!unidadConocida(fila.uomEntry)) {
      // Un código cargado a mano sin unidad se corrige; uno de SAP sin unidad no se toca.
      if (fila.origen !== "app") throw new AppError({ code: "UNIDAD_NO_DEFINIDA", statusCode: 409,
        message: "Ese código viene de SAP sin unidad de medida: hay que corregirlo en SAP" });
      fila = await tx.productoCodigoBarras.update({ where: { id: fila.id }, data: { uomEntry: UNIDAD_MANUAL } });
    }
    const datos = { esUnidadIndividual: true, itemCodeConfirmado: fila.itemCode, codigoConfirmado: fila.codigo,
      uomEntryConfirmado: fila.uomEntry, confirmadaEn: new Date(), confirmadaPor: aplicacion,
      observacion: nuevo ? "Registrado desde la app" : "Confirmado al registrarlo desde la app" };
    await tx.confirmacionEtiquetaPicking.upsert({ where: { codigoBarrasId: fila.id }, create: { codigoBarrasId: fila.id, ...datos }, update: datos });
    return { data: { id: fila.id, codigo: fila.codigo, itemCode: producto.itemCode, itemName: producto.itemName, origen: fila.origen, nuevo } };
  });
}
