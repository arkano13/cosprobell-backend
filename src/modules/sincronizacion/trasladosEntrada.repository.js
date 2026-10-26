// Traslados de SAP de la bodega grande a la pequeña (la 01 a la 02). Solo se guardan las líneas que van del almacén de
// la grande al de la pequeña, en unidades de inventario (Manual = unidad). Lo ya pasado en la bodega (aceptadas) no se
// toca al volver a recibir el traslado: SAP no cambia un traslado después de creado.
const POR_DEFECTO = { grande: "01", pequena: "02" };

const deGrandeAPequena = (traslado, { grande, pequena }) => traslado.lineas
  .filter((l) => (l.fromWarehouseCode ?? traslado.fromWarehouse) === grande && (l.warehouseCode ?? traslado.toWarehouse) === pequena)
  .map((l) => ({ lineNum: l.lineNum, itemCode: l.itemCode,
    unidades: Math.round(l.uomEntry === null ? l.quantity : l.inventoryQuantity ?? l.quantity) }));

export function lineasDeEntrada(traslado, almacenes) {
  return deGrandeAPequena(traslado, almacenes).filter((l) => l.unidades > 0);
}

// Unidades por producto, para comparar dos traslados sin importar el orden de las líneas.
const porProducto = (lineas) => JSON.stringify(Object.entries(lineas.reduce((t, l) => ({ ...t, [l.itemCode]: (t[l.itemCode] ?? 0) + l.unidades }), {}))
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// Cancelar un traslado en SAP crea otro con las mismas líneas en negativo. Se cierra el original solo si es un traslado
// anterior con exactamente los mismos productos y unidades y sin nada pasado ni cerrado; si no hay uno así, queda para el
// supervisor. Al volver a recibir la cancelación el original ya está cerrado y no se toca nada.
async function cerrarCancelado(traslado, lineas, tx) {
  const cancela = lineas.filter((l) => l.unidades < 0).map((l) => ({ itemCode: l.itemCode, unidades: -l.unidades }));
  if (!cancela.length || cancela.length !== lineas.length) return;
  const buscado = porProducto(cancela);
  const candidatos = await tx.trasladoEntradaLinea.findMany({ where: { docEntry: { lt: traslado.docEntry },
    itemCode: { in: [...new Set(cancela.map((l) => l.itemCode))] }, aceptadas: 0, cerradaPor: null },
    select: { docEntry: true }, distinct: ["docEntry"], orderBy: { docEntry: "desc" } });
  for (const { docEntry } of candidatos) {
    const suyas = await tx.trasladoEntradaLinea.findMany({ where: { docEntry } });
    if (suyas.some((l) => l.aceptadas > 0 || l.cerradaPor) || porProducto(suyas) !== buscado) continue;
    await tx.trasladoEntradaLinea.updateMany({ where: { docEntry, aceptadas: 0, cerradaPor: null },
      data: { cerradaPor: `cancelado en SAP (${traslado.docNum})`, aceptadoEn: new Date() } });
    return;
  }
}

export async function guardarTrasladoEntrada(traslado, tx) {
  const opcion = await tx.configuracion.findUnique({ where: { clave: "almacenesPorBodega" } });
  const almacenes = { grande: opcion?.valor?.grande ?? POR_DEFECTO.grande, pequena: opcion?.valor?.pequena ?? POR_DEFECTO.pequena };
  const datos = { docNum: traslado.docNum, docDate: new Date(`${traslado.docDate}T00:00:00Z`), sincronizadoEn: new Date() };
  await tx.trasladoEntrada.upsert({ where: { docEntry: traslado.docEntry }, create: { docEntry: traslado.docEntry, ...datos }, update: datos });
  for (const l of lineasDeEntrada(traslado, almacenes)) {
    const actual = await tx.trasladoEntradaLinea.findUnique({ where: { docEntry_lineNum: { docEntry: traslado.docEntry, lineNum: l.lineNum } } });
    if (!actual) await tx.trasladoEntradaLinea.create({ data: { docEntry: traslado.docEntry, ...l } });
    else await tx.trasladoEntradaLinea.update({ where: { id: actual.id },
      data: { itemCode: l.itemCode, unidades: Math.max(l.unidades, actual.aceptadas) } });
  }
  await cerrarCancelado(traslado, deGrandeAPequena(traslado, almacenes), tx);
}
