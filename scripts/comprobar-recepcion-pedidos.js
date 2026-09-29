// Ejecutar más adelante contra PostgreSQL de pruebas. Todo el escenario termina
// en ROLLBACK, incluso cuando pasa. No usa SAP ni borra datos existentes.
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { guardarPedido } from "../src/modules/sincronizacion/pedidos.repository.js";

if (process.argv.length !== 3 || process.argv[2] !== "--base-de-pruebas") {
  console.log("Uso: node scripts/comprobar-recepcion-pedidos.js --base-de-pruebas");
  console.log("Revisar antes que DATABASE_URL corresponda a la base de pruebas.");
  process.exitCode = 1;
} else {
  await import("../src/config/env.js");
  const { prisma } = await import("../src/infrastructure/database/prisma.js");
  const rollback = new Error("ROLLBACK_DE_LA_PRUEBA");
  try {
    await prisma.$transaction(async tx => {
      const cardCode = `TEST-${randomUUID()}`;
      const docEntry = randomInt(1000000000, 2000000000);
      await tx.cliente.create({ data: { cardCode, cardName: "Prueba temporal de pedidos" } });
      // create reserva la clave: una colisión aborta, nunca pisa otra orden.
      await tx.pedido.create({ data: { docEntry, docNum: docEntry, cardCode, docDate: new Date(), docTotal: 0 } });
      const pedido = { docEntry, docNum: docEntry, cardCode, docType: "dDocument_Items",
        docDate: "2026-09-28", docDueDate: null, docTotal: 0, documentStatus: "bost_Open",
        cancelled: false, cancelStatus: "csNo", lineas: [{ lineNum: 0, itemCode: "TEST-ARTICULO",
          quantity: 5, lineStatus: "bost_Open", warehouseCode: "TEST", uomEntry: 1, uomCode: "UN",
          remainingOpenQuantity: 3, inventoryQuantity: 5, remainingOpenInventoryQuantity: 3 }] };
      await guardarPedido(pedido, tx);
      const sesion = await tx.pickingPedido.create({ data: { pedidoDocEntry: docEntry,
        estado: "en_proceso", lineas: { create: { pedidoLineNum: 0, itemCode: "TEST-ARTICULO",
          cantidadPedida: 3, cantidadEscaneada: 1, uomEntry: 1, uomCode: "UN" } } } });
      const evento = await tx.pickingEscaneo.create({ data: { pickingId: sesion.id, operacionId: randomUUID(),
        codigo: "TEST", resultado: "aceptado", cantidadRegistrada: 1, httpStatus: 200 } });
      await guardarPedido(pedido, tx);
      assert.equal((await tx.pickingPedido.findUnique({ where: { id: sesion.id } })).estado, "en_proceso");
      pedido.lineas[0].remainingOpenQuantity = 2;
      pedido.lineas[0].remainingOpenInventoryQuantity = 2;
      await guardarPedido(pedido, tx);
      const revisada = await tx.pickingPedido.findUnique({ where: { id: sesion.id }, include: { lineas: true } });
      assert.equal(revisada.estado, "requiere_revision");
      assert.equal(revisada.lineas[0].cantidadPedida, 3);
      assert.equal(revisada.lineas[0].cantidadEscaneada, 1);
      assert.ok(await tx.pickingEscaneo.findUnique({ where: { id: evento.id } }));
      assert.equal((await tx.pedido.findUnique({ where: { docEntry }, include: { lineas: true } })).lineas.length, 1);
      throw rollback;
    }, { maxWait: 10000, timeout: 30000 });
  } catch (error) {
    if (error === rollback) console.log("APROBADO: recepción, reintento y bloqueo por cambios. Datos de prueba revertidos.");
    else { console.error("FALLÓ la comprobación de recepción. Transacción revertida."); process.exitCode = 1; }
  } finally { await prisma.$disconnect(); }
}
