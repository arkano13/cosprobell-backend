import test from "node:test";
import assert from "node:assert/strict";
import { construirLotePedidos } from "../../puente/pedidos.js";
import { pedidoSap } from "../fixtures/pedido.js";
import { lineasParaPreparar } from "../../src/modules/picking/picking.pedido.js";
import { contenidoPreparacion, guardarPedido } from "../../src/modules/sincronizacion/pedidos.repository.js";
const pedido = () => construirLotePedidos([pedidoSap()], "TEST", 1).pedidos[0];

test("prepara pendiente 3, no cantidad original 5; excluye líneas cerradas y sin pendiente", () => {
  const p = pedido();
  p.lineas.push({ ...p.lineas[0], lineNum: 1, lineStatus: "bost_Close" },
    { ...p.lineas[0], lineNum: 2, remainingOpenQuantity: 0 });
  assert.deepEqual(lineasParaPreparar(p), [{ pedidoLineNum: 0, itemCode: "P1", cantidadPedida: 3, uomEntry: 1, uomCode: "UN" }]);
});
for (const [cambio, code] of [
  [{ remainingOpenQuantity: null }, "PENDIENTE_NO_CONFIRMADO"],
  [{ remainingOpenQuantity: 6 }, "PENDIENTE_NO_CONFIRMADO"],
  [{ remainingOpenQuantity: 1.5 }, "PENDIENTE_NO_CONFIRMADO"],
  [{ lineStatus: null }, "ESTADO_LINEA_DESCONOCIDO"],
  [{ uomEntry: null }, "UNIDAD_NO_DEFINIDA"],
  [{ uomEntry: -2 }, "UNIDAD_NO_DEFINIDA"],
  [{ remainingOpenInventoryQuantity: 36 }, "CONVERSION_NO_CONFIRMADA"],
  [{ inventoryQuantity: null }, "CONVERSION_NO_CONFIRMADA"],
  [{ remainingOpenQuantity: 0 }, "PEDIDO_SIN_PENDIENTES"],
]) test(`picking impide preparar ${JSON.stringify(cambio)}`, () => {
  const p = pedido(); Object.assign(p.lineas[0], cambio);
  assert.throws(() => lineasParaPreparar(p), { code });
});

function baseFalsa(anterior, { cliente = true, falloLinea = false } = {}) {
  const llamadas = [];
  return { llamadas, db: {
    cliente: { findUnique: async () => cliente ? { cardCode: "C1" } : null },
    $queryRaw: async () => { llamadas.push("bloqueo"); return []; },
    pedido: { findUnique: async () => anterior, upsert: async (q) => { llamadas.push(["cabecera", q]); } },
    pedidoLinea: { upsert: async (q) => { if (falloLinea) throw new Error("fallo"); llamadas.push(["linea", q]); },
      deleteMany: async q => { llamadas.push(["retirar", q]); } },
    pickingPedido: { findMany: async () => [], updateMany: async q => { llamadas.push(["revision", q]); } },
  } };
}
test("receptor bloquea pedido y sesiones antes de actualizar; no toca escaneos", async () => {
  const p = pedido(); const anterior = structuredClone(p); anterior.lineas[0].remainingOpenQuantity = 4;
  const { db, llamadas } = baseFalsa(anterior);
  await guardarPedido(p, db);
  assert.deepEqual(llamadas.slice(0, 2), ["bloqueo", "bloqueo"]);
  assert.deepEqual(llamadas[2], ["revision", { where: { pedidoDocEntry: 9, estado: "en_proceso" }, data: { estado: "requiere_revision" } }]);
  assert.equal(llamadas[3][1].update.docDate.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.deepEqual(llamadas.find((l) => l[0] === "retirar"), ["retirar", { where: { pedidoDocEntry: 9, lineNum: { notIn: [0] } } }]);
});
test("recepción idéntica o cambio de precio conserva la sesión activa", async () => {
  const p = pedido(); const anterior = structuredClone(p); anterior.docTotal = 200;
  const { db, llamadas } = baseFalsa(anterior); await guardarPedido(p, db);
  assert.ok(!llamadas.some(l => l[0] === "revision"));
});
test("recepción idéntica detecta una sesión antigua creada con el total", async () => {
  const p = pedido(); const { db, llamadas } = baseFalsa(p);
  db.pickingPedido.findMany = async () => [{ id: 7, lineas: [{ pedidoLineNum: 0,
    itemCode: "P1", cantidadPedida: 5, uomEntry: 1, uomCode: "UN" }] }];
  await guardarPedido(p, db);
  assert.deepEqual(llamadas[2], ["revision", { where: { id: { in: [7] }, estado: "en_proceso" }, data: { estado: "requiere_revision" } }]);
});
for (const campo of ["warehouseCode", "uomEntry", "itemCode", "lineStatus", "remainingOpenQuantity"]) {
  test(`detecta cambio operativo de ${campo}`, () => {
    const p = pedido(), modificado = structuredClone(p); modificado.lineas[0][campo] = "cambio";
    assert.notEqual(contenidoPreparacion(p), contenidoPreparacion(modificado));
  });
}
test("cliente ausente rechaza antes de modificar el pedido", async () => {
  const { db, llamadas } = baseFalsa(null, { cliente: false });
  await assert.rejects(guardarPedido(pedido(), db), { code: "CLIENTE_NO_SINCRONIZADO" });
  assert.deepEqual(llamadas, []);
});
test("fallo de línea se propaga para que la transacción revierta", async () => {
  const { db, llamadas } = baseFalsa(null, { falloLinea: true });
  await assert.rejects(guardarPedido(pedido(), db), /fallo/);
  assert.ok(!llamadas.some(l => l[0] === "retirar"));
});
