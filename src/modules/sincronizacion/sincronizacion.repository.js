import { prisma } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { guardarPedido } from "./pedidos.repository.js";
import { UNIDAD_MANUAL } from "../picking/picking.cantidades.js";
import { registrarCambioExistencias } from "../inventario/inventario.sap.js";

// El código de la ficha del artículo (campo BarCode de Items) también sirve para escanear: se guarda como
// código de origen "ficha" con la unidad Manual del artículo, y se confirma como los demás. Si la ficha
// cambia o lo quita, el anterior se retira. Un código igual ya existente (de SAP o de la app) no se duplica.
async function sincronizarCodigoFicha(itemCode, barCode, db) {
  await db.productoCodigoBarras.updateMany({
    where: { itemCode, origen: "ficha", retiradoEnSap: false, ...(barCode ? { codigo: { not: barCode } } : {}) },
    data: { retiradoEnSap: true } });
  if (!barCode) return;
  const activo = await db.productoCodigoBarras.findFirst({ where: { itemCode, codigo: barCode, retiradoEnSap: false },
    select: { id: true, origen: true }, orderBy: { id: "asc" } });
  if (activo) {
    if (activo.origen === "ficha") await db.productoCodigoBarras.update({ where: { id: activo.id }, data: { sincronizadoEn: new Date() } });
    return;
  }
  const retirado = await db.productoCodigoBarras.findFirst({ where: { itemCode, codigo: barCode, origen: "ficha" },
    select: { id: true }, orderBy: { id: "asc" } });
  if (retirado) {
    await db.productoCodigoBarras.update({ where: { id: retirado.id }, data: { retiradoEnSap: false, sincronizadoEn: new Date() } });
    return;
  }
  await db.productoCodigoBarras.create({ data: { itemCode, codigo: barCode, uomEntry: UNIDAD_MANUAL, origen: "ficha", sincronizadoEn: new Date() } });
}
export const sincronizacionRepository = {
  guardarPedido,
  conBloqueo(operacion, db = prisma) {
    return db.$transaction(async (tx) => {
      // Una sola empresa por base local. Coordina incluso el primer lote de cada entidad.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260928, 1001)::text`;
      return operacion(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 30000 });
  },
  listarPedidosAbiertos(db = prisma) {
    return db.pedido.findMany({ where: { documentStatus: "bost_Open" }, select: { docEntry: true, sincronizadoEn: true }, orderBy: { docEntry: "asc" } });
  },
  async existeOtraEmpresa(empresa, db = prisma) {
    const filas = await db.$queryRaw`SELECT 1 FROM sincronizacion_estados WHERE empresa <> ${empresa} LIMIT 1`;
    return filas.length > 0;
  },
  async consultarEstado(entidad, db = prisma) {
    const filas = await db.$queryRaw`SELECT * FROM sincronizacion_estados WHERE entidad = ${entidad}`;
    return filas[0] ?? null;
  },
  async guardarProducto(producto, db) {
    const anterior = await db.producto.findUnique({ where: { itemCode: producto.itemCode }, select: { quantityOnStock: true } });
    const guardado = await db.producto.upsert({
      where: { itemCode: producto.itemCode },
      create: { ...producto, sincronizadoEn: new Date() },
      update: { ...producto, sincronizadoEn: new Date() },
    });
    await sincronizarCodigoFicha(producto.itemCode, producto.barCode, db);
    if (anterior && producto.quantityOnStock !== undefined && producto.quantityOnStock !== anterior.quantityOnStock) {
      await registrarCambioExistencias(producto.itemCode, (producto.quantityOnStock ?? 0) - (anterior.quantityOnStock ?? 0), db);
    }
    return guardado;
  },
  guardarCliente(cliente, db) {
    // Solo los campos del contrato: no toca pedidos, facturas ni otros datos del cliente.
    return db.cliente.upsert({
      where: { cardCode: cliente.cardCode },
      create: { ...cliente, sincronizadoEn: new Date() },
      update: { ...cliente, sincronizadoEn: new Date() },
    });
  },
  guardarUnidad(unidad, db) {
    const { absEntry, ...datos } = unidad;
    return db.unidadMedida.upsert({ where: { absEntry }, create: unidad, update: datos });
  },
  async guardarCodigoBarras(registro, db) {
    const producto = await db.producto.findUnique({ where: { itemCode: registro.itemCode }, select: { itemCode: true } });
    if (!producto) throw new AppError({ code: "PRODUCTO_NO_SINCRONIZADO",
      message: "Debe sincronizar el producto antes de recibir sus códigos de barras", statusCode: 409 });
    const datos = { itemCode: registro.itemCode, codigo: registro.codigo, uomEntry: registro.uomEntry, sincronizadoEn: new Date(),
      retiradoEnSap: false, origen: "sap" };
    const existente = await db.productoCodigoBarras.findUnique({ where: { sapAbsEntry: registro.absEntry }, select: { id: true } });
    if (existente) return db.productoCodigoBarras.update({ where: { id: existente.id }, data: datos });
    // Una asociación creada a mano o tomada de la ficha con los mismos datos se vincula a SAP y conserva su confirmación.
    const local = await db.productoCodigoBarras.findFirst({ where: { sapAbsEntry: null, itemCode: registro.itemCode,
      codigo: registro.codigo, uomEntry: registro.uomEntry }, select: { id: true }, orderBy: { id: "asc" } });
    if (local) return db.productoCodigoBarras.update({ where: { id: local.id }, data: { ...datos, sapAbsEntry: registro.absEntry } });
    return db.productoCodigoBarras.create({ data: { ...datos, sapAbsEntry: registro.absEntry } });
  },
  // Códigos de SAP que no se recibieron desde "antesDe": SAP ya no los lista. Se marcan, no se borran,
  // para conservar su confirmación si vuelven a aparecer.
  async marcarCodigosRetirados(antesDe, db = prisma) {
    const { count } = await db.productoCodigoBarras.updateMany({
      where: { sapAbsEntry: { not: null }, retiradoEnSap: false, OR: [{ sincronizadoEn: null }, { sincronizadoEn: { lt: antesDe } }] },
      data: { retiradoEnSap: true } });
    return count;
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
