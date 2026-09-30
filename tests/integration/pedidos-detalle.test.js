import test, { after } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { pedidosRepository } = await import("../../src/modules/pedidos/pedidos.repository.js");

after(() => prisma.$disconnect());

function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre]; objeto[nombre] = implementacion; t.after(() => { objeto[nombre] = original; });
}

test("el detalle del pedido agrega el nombre de cada producto", async (t) => {
  sustituir(t, prisma.pedido, "findUnique", async () => ({ docEntry: 9, lineas: [{ lineNum: 0, itemCode: "P1" }, { lineNum: 1, itemCode: "P2" }] }));
  let consulta;
  sustituir(t, prisma.producto, "findMany", async (args) => { consulta = args; return [{ itemCode: "P1", itemName: "Shampoo" }]; });
  const pedido = await pedidosRepository.obtener(9);
  assert.deepEqual(consulta.where, { itemCode: { in: ["P1", "P2"] } });
  assert.deepEqual(pedido.lineas.map((l) => [l.itemCode, l.itemName]), [["P1", "Shampoo"], ["P2", null]]);
  sustituir(t, prisma.pedido, "findUnique", async () => null);
  assert.equal(await pedidosRepository.obtener(10), null);
});

test("las preparaciones de la lista son solo las finalizadas de esos pedidos, la más reciente primero", async (t) => {
  let consulta;
  sustituir(t, prisma.pickingPedido, "findMany", async (args) => { consulta = args; return []; });
  await pedidosRepository.preparaciones([9, 10]);
  assert.deepEqual(consulta.where, { pedidoDocEntry: { in: [9, 10] }, estado: { in: ["completo", "con_diferencias"] } });
  assert.deepEqual(consulta.orderBy, [{ fechaFin: "desc" }, { id: "desc" }]);
  assert.deepEqual(consulta.select.lineas, { select: { cantidadPedida: true, cantidadEscaneada: true } });
});
