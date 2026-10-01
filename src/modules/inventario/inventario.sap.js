// Lo que la sincronización con SAP le avisa al inventario. Solo toca productos que ya están en el inventario.

// Cambió la existencia total en SAP. Si subió, primero cubre lo que la bodega recibió antes que SAP.
export async function registrarCambioExistencias(itemCode, delta, db) {
  const sube = Math.max(0, Math.round(delta));
  await db.$executeRaw`
    UPDATE inventario_productos SET "sapCambioEn" = now(), adelantado = GREATEST(0, adelantado - ${sube}), "actualizadoEn" = now()
    WHERE "itemCode" = ${itemCode}`;
}

// Cambió un pedido ya preparado (por ejemplo, SAP registró su entrega). Hasta que lleguen también las
// existencias nuevas, la diferencia de esos productos puede no cuadrar por unos minutos.
export async function registrarCambioPedido(docEntry, itemCodes, db) {
  if (!itemCodes.length) return;
  const [fila] = await db.$queryRaw`
    SELECT EXISTS (SELECT 1 FROM picking_pedidos WHERE "pedidoDocEntry" = ${docEntry} AND estado IN ('completo', 'con_diferencias')) AS hay`;
  if (!fila?.hay) return;
  await db.$executeRaw`
    UPDATE inventario_productos SET "sapCambioEn" = now(), "actualizadoEn" = now() WHERE "itemCode" = ANY(${[...new Set(itemCodes)]})`;
}
