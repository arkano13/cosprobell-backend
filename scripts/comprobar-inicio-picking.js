import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { iniciarPicking, finalizarPicking } from "../src/modules/picking/picking.service.js";
import { pickingRepository } from "../src/modules/picking/picking.repository.js";

const cardCode = `TEST-INICIO-${randomUUID()}`;
const itemCode = `TEST-${randomUUID()}`;
const docEntry = -randomInt(100000, 2000000000);
let creado = false;
try {
  await prisma.$transaction(async (tx) => {
    await tx.cliente.create({ data: { cardCode, cardName: "Prueba temporal de inicio" } });
    await tx.producto.create({ data: { itemCode, itemName: "Producto temporal de inicio" } });
    await tx.inventarioProducto.create({ data: { itemCode, pequena: 5 } });
    await tx.inventarioPequenaLote.create({ data: { itemCode, clave: JSON.stringify([itemCode, "DEMO", null]), lote: "DEMO", unidades: 5 } });
    await tx.pedido.create({ data: {
      docEntry, docNum: docEntry, cardCode, docDate: new Date(), docTotal: 0,
      documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo",
      docType: "dDocument_Items",
      lineas: { create: [{ lineNum: 0, itemCode, quantity: 5, uomEntry: 1, uomCode: "UN",
        lineStatus: "bost_Open", remainingOpenQuantity: 5, remainingOpenInventoryQuantity: 5, inventoryQuantity: 5 }] },
    } });
  }, { maxWait: 10000, timeout: 20000 });
  creado = true;

  for (const datos of [
    { documentStatus: "bost_Close", cancelled: false },
    { documentStatus: "bost_Open", cancelled: true },
    { documentStatus: null, cancelled: false },
  ]) {
    await prisma.pedido.update({ where: { docEntry }, data: datos });
    await assert.rejects(iniciarPicking({ pedidoDocEntry: docEntry }), (error) => error.statusCode === 409);
    assert.equal(await prisma.pickingPedido.count({ where: { pedidoDocEntry: docEntry } }), 0);
  }
  await prisma.pedido.update({ where: { docEntry }, data: { documentStatus: "bost_Open", cancelled: false } });
  console.log("APROBADO: cerrado, cancelado y estado desconocido no crean sesiones.");

  // Fallar después del INSERT debe revertir también las líneas de la sesión.
  const crearOriginal = pickingRepository.crearSesion;
  try {
    pickingRepository.crearSesion = async (...args) => {
      await crearOriginal(...args);
      throw new Error("Fallo controlado de prueba");
    };
    await assert.rejects(iniciarPicking({ pedidoDocEntry: docEntry }), /Fallo controlado/);
  } finally { pickingRepository.crearSesion = crearOriginal; }
  assert.equal(await prisma.pickingPedido.count({ where: { pedidoDocEntry: docEntry } }), 0);
  console.log("APROBADO: un fallo revierte la sesión recién creada.");

  const resultados = await Promise.allSettled([
    iniciarPicking({ pedidoDocEntry: docEntry, usuarioId: "primero" }),
    iniciarPicking({ pedidoDocEntry: docEntry, usuarioId: "segundo" }),
  ]);
  for (const resultado of resultados) {
    if (resultado.status === "rejected") throw resultado.reason;
  }
  const [a, b] = resultados.map((r) => r.value);
  assert.equal(a.picking.id, b.picking.id);
  assert.equal(Number(a.creada) + Number(b.creada), 1);
  assert.equal(await prisma.pickingPedido.count({ where: { pedidoDocEntry: docEntry } }), 1);
  console.log("APROBADO: dos inicios simultáneos devuelven una sola sesión.");

  // Preparación controlada de un avance para comprobar que retomar no lo borra.
  await prisma.pickingPedidoLinea.update({ where: { id: a.picking.lineas[0].id }, data: { cantidadEscaneada: 2 } });
  const retomada = await iniciarPicking({ pedidoDocEntry: docEntry, usuarioId: "otro" });
  assert.equal(retomada.creada, false);
  assert.equal(retomada.picking.usuarioId, a.picking.usuarioId);
  assert.equal(retomada.picking.lineas[0].cantidadEscaneada, 2);
  console.log("APROBADO: retomar conserva usuario y avance de 2 de 5.");

  await prisma.pedido.update({ where: { docEntry }, data: { cancelled: true } });
  await assert.rejects(iniciarPicking({ pedidoDocEntry: docEntry }), { code: "PEDIDO_CANCELADO" });
  await prisma.pedido.update({ where: { docEntry }, data: { cancelled: false } });
  await finalizarPicking(a.picking.id);
  await assert.rejects(iniciarPicking({ pedidoDocEntry: docEntry }), { code: "PEDIDO_CON_PICKING_FINALIZADO" });
  assert.equal(await prisma.pickingPedido.count({ where: { pedidoDocEntry: docEntry } }), 1);
  console.log("APROBADO: pedido cancelado no se retoma; picking finalizado no se duplica.");
} catch (error) {
  // No imprimir objetos del driver: podrían contener datos de conexión.
  console.error("FALLÓ la comprobación de inicio de picking.");
  console.error("Tipo:", error.name, "Código:", error.code ?? "sin código");
  process.exitCode = 1;
} finally {
  try {
    if (creado) {
      await prisma.$transaction(async (tx) => {
        const propio = await tx.pedido.findFirst({ where: { docEntry, cardCode } });
        assert.ok(propio, "No se puede confirmar la propiedad del pedido temporal");
        const sesiones = await tx.pickingPedido.findMany({ where: { pedidoDocEntry: docEntry }, select: { id: true } });
        const ids = sesiones.map((x) => x.id);
        await tx.pickingEscaneo.deleteMany({ where: { pickingId: { in: ids } } });
        await tx.pickingPedidoLinea.deleteMany({ where: { pickingId: { in: ids } } });
        await tx.pickingPedido.deleteMany({ where: { id: { in: ids } } });
        await tx.pedidoLinea.deleteMany({ where: { pedidoDocEntry: docEntry } });
        await tx.pedido.delete({ where: { docEntry } });
        await tx.cliente.delete({ where: { cardCode } });
        await tx.inventarioMovimiento.deleteMany({ where: { itemCode } });
        await tx.inventarioPequenaLote.deleteMany({ where: { itemCode } });
        await tx.inventarioProducto.delete({ where: { itemCode } });
        await tx.producto.delete({ where: { itemCode } });
      }, { maxWait: 10000, timeout: 20000 });
      console.log("Datos temporales eliminados.");
    }
  } catch {
    console.error("No se completó la limpieza. Pedido temporal:", docEntry, "Cliente:", cardCode);
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
