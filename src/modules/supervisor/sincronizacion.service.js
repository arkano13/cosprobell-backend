// Cuándo llegaron por última vez los datos de SAP de cada tipo. Los registros sin cambios también actualizan
// sincronizadoEn (el puente confirma su presencia), así que la fecha refleja el último recorrido.
import { prisma } from "../../infrastructure/database/prisma.js";
import { TIPOS_DOCUMENTO } from "../sincronizacion/documentos.schemas.js";
import { fuentePreparacion } from "../pedidos/preparacion.fuente.js";
import { sincronizacionRepository } from "../sincronizacion/sincronizacion.repository.js";

export const sincronizacionEstadoRepository = {
  async leer() {
    const fuenteDocumento = fuentePreparacion();
    const [clientes, productos, pedidos, pedidosAbiertos, codigos, unidades, estados] = await Promise.all([
      prisma.cliente.aggregate({ _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.producto.aggregate({ _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.pedido.aggregate({ where: { fuenteDocumento }, _max: { sincronizadoEn: true } }),
      fuenteDocumento === "pedido" ? prisma.pedido.count({ where: { fuenteDocumento, cancelled: false, documentStatus: "bost_Open" } })
        // Facturas: las que faltan preparar (las mismas que el puente vuelve a revisar).
        : sincronizacionRepository.listarFacturasPendientes().then((f) => f.length),
      prisma.productoCodigoBarras.aggregate({ where: { retiradoEnSap: false }, _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.unidadMedida.count(),
      prisma.sincronizacionEstado.findMany({ select: { entidad: true, empresa: true, actualizadoEn: true } }),
    ]);
    const traslados = fuenteDocumento === "factura" ? await sincronizacionRepository.contarTrasladosPendientes() : null;
    // Traslados de la 01 a la 02 con algo por pasar.
    const entrada = fuenteDocumento === "factura" ? await prisma.trasladoEntrada.count({ where: { lineas: { some: {
      cerradaPor: null, aceptadas: { lt: prisma.trasladoEntradaLinea.fields.unidades } } } } }) : null;
    const [almacenes, [existencias], documentos] = await Promise.all([
      prisma.bodega.aggregate({ _count: { _all: true }, _max: { sincronizadoEn: true } }),
      prisma.$queryRaw`SELECT COUNT(DISTINCT "itemCode")::int AS productos, MAX("actualizadoEn") AS "actualizadoEn" FROM productos_existencias`,
      prisma.documentoStock.aggregate({ where: { cancelado: false }, _count: { _all: true }, _max: { sincronizadoEn: true } }),
    ]);
    return { clientes, productos, pedidos, pedidosAbiertos, traslados, entrada, codigos, unidades, estados, almacenes, existencias, documentos };
  },
};

const masReciente = (...fechas) => fechas.filter(Boolean).sort((a, b) => b - a)[0] ?? null;

export async function estadoSincronizacion({ repo = sincronizacionEstadoRepository } = {}) {
  const d = await repo.leer();
  const lote = new Map(d.estados.map((e) => [e.entidad, e.actualizadoEn]));
  return {
    empresa: d.estados[0]?.empresa ?? null, fuentePreparacion: fuentePreparacion(),
    entidades: [
      { entidad: "pedidos", nombre: fuentePreparacion() === "factura" ? "Facturas para preparar" : "Pedidos",
        registros: d.pedidosAbiertos, ultimaRecepcion: masReciente(d.pedidos._max.sincronizadoEn,
          lote.get(fuentePreparacion() === "factura" ? "facturasPreparacion" : "pedidos")) },
      // Solo con facturas: los traslados de la 02 se preparan junto con ellas.
      ...(d.traslados == null ? [] : [{ entidad: "trasladosPreparacion", nombre: "Traslados para preparar", registros: d.traslados,
        ultimaRecepcion: lote.get("trasladosPreparacion") ?? null }]),
      ...(d.entrada == null ? [] : [{ entidad: "trasladosEntrada", nombre: "Traslados de la 01 a la 02", registros: d.entrada,
        ultimaRecepcion: lote.get("trasladosEntrada") ?? null }]),
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
