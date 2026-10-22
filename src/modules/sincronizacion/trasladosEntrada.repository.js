// Traslados de SAP de la bodega grande a la pequeña (la 01 a la 02). Solo se guardan las líneas que van del almacén de
// la grande al de la pequeña, en unidades de inventario (Manual = unidad). Lo ya pasado en la bodega (aceptadas) no se
// toca al volver a recibir el traslado: SAP no cambia un traslado después de creado.
const POR_DEFECTO = { grande: "01", pequena: "02" };

export function lineasDeEntrada(traslado, { grande, pequena }) {
  return traslado.lineas
    .filter((l) => (l.fromWarehouseCode ?? traslado.fromWarehouse) === grande && (l.warehouseCode ?? traslado.toWarehouse) === pequena)
    .map((l) => ({ lineNum: l.lineNum, itemCode: l.itemCode,
      unidades: Math.round(l.uomEntry === null ? l.quantity : l.inventoryQuantity ?? l.quantity) }))
    .filter((l) => l.unidades > 0);
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
}
