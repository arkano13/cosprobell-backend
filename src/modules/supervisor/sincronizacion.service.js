// Cuándo llegaron por última vez los datos de SAP de cada tipo. Los registros sin cambios también actualizan
// sincronizadoEn (el puente confirma su presencia), así que la fecha refleja el último recorrido.
import { prisma } from "../../infrastructure/database/prisma.js";
import { TIPOS_DOCUMENTO } from "../sincronizacion/documentos.schemas.js";

export const sincronizacionEstadoRepository = {
  async leer() {
    const [clientes, productos, pedidos, pedidosAbiertos, codigos, unidades, estados] = await Promise.all([
      prisma.cliente.aggregate({ _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.producto.aggregate({ _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.pedido.aggregate({ _max: { sincronizadoEn: true } }),
      prisma.pedido.count({ where: { documentStatus: "bost_Open", cancelled: false } }),
      prisma.productoCodigoBarras.aggregate({ where: { retiradoEnSap: false }, _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.unidadMedida.count(),
      prisma.sincronizacionEstado.findMany({ select: { entidad: true, empresa: true, actualizadoEn: true } }),
    ]);
    const [almacenes, [existencias], documentos] = await Promise.all([
      prisma.bodega.aggregate({ _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.$queryRaw`SELECT COUNT(DISTINCT "itemCode")::int AS productos, MAX("actualizadoEn") AS "actualizadoEn" FROM productos_existencias`,
      prisma.documentoStock.aggregate({ where: { cancelado: false }, _count: { _all: true }, _max: { sincronizadoEn: true } }),
    ]);
    return { clientes, productos, pedidos, pedidosAbiertos, codigos, unidades, estados, almacenes, existencias, documentos };
  },
};

const masReciente = (...fechas) => fechas.filter(Boolean).sort((a, b) => b - a)[0] ?? null;

export async function estadoSincronizacion({ repo = sincronizacionEstadoRepository } = {}) {
  const d = await repo.leer();
  const lote = new Map(d.estados.map((e) => [e.entidad, e.actualizadoEn]));
  return {
    empresa: d.estados[0]?.empresa ?? null,
    entidades: [
      { entidad: "pedidos", registros: d.pedidosAbiertos, ultimaRecepcion: masReciente(d.pedidos._max.sincronizadoEn, lote.get("pedidos")) },
      { entidad: "clientes", registros: d.clientes._count._all, ultimaRecepcion: masReciente(d.clientes._max.sincronizadoEn, lote.get("clientes")) },
      { entidad: "productos", registros: d.productos._count._all, ultimaRecepcion: masReciente(d.productos._max.sincronizadoEn, lote.get("productos")) },
      { entidad: "unidades", registros: d.unidades, ultimaRecepcion: lote.get("unidades") ?? null },
      { entidad: "codigosBarras", registros: d.codigos._count._all, ultimaRecepcion: masReciente(d.codigos._max.sincronizadoEn, lote.get("codigosBarras")) },
      // Inventario: almacenes, productos con existencia en algún almacén y documentos de stock (los cinco tipos juntos).
      { entidad: "almacenes", registros: d.almacenes?._count._all ?? 0, ultimaRecepcion: masReciente(d.almacenes?._max.sincronizadoEn, lote.get("almacenes")) },
      { entidad: "existencias", registros: d.existencias?.productos ?? 0, ultimaRecepcion: masReciente(d.existencias?.actualizadoEn, lote.get("existencias")) },
      { entidad: "documentos", registros: d.documentos?._count._all ?? 0, ultimaRecepcion: masReciente(d.documentos?._max.sincronizadoEn,
        ...Object.keys(TIPOS_DOCUMENTO).map((e) => lote.get(e))) },
    ],
  };
}
