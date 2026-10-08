import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { registrarCodigo } = await import("../../src/modules/etiquetas/codigos.service.js");

function base({ producto = { itemCode: "P1", itemName: "Shampoo" }, activos = [], fichaDeOtro = null } = {}) {
  const ops = [];
  const tx = {
    producto: {
      findUnique: async () => producto,
      findFirst: async ({ where }) => { ops.push(["ficha", where]); return fichaDeOtro; },
    },
    productoCodigoBarras: {
      findMany: async ({ where }) => { ops.push(["buscar", where]); return activos; },
      create: async ({ data }) => { ops.push(["crear", data]); return { id: 50, ...data }; },
      update: async ({ where, data }) => { ops.push(["actualizar", where.id, data]); return { ...activos[0], ...data }; },
    },
    confirmacionEtiquetaPicking: { upsert: async (q) => { ops.push(["confirmar", q]); } },
    inventarioCodigoCaja: { findUnique: async () => null },
  };
  const repo = { conCodigoBloqueado: async (codigo, op) => { ops.push(["bloquear", codigo]); return op(tx); } };
  return { repo, ops };
}
const quien = { aplicacion: "operador:Carmen Díaz" };

test("código nuevo: queda con la unidad Manual, origen app y confirmado como unidad", async () => {
  const { repo, ops } = base();
  const r = await registrarCodigo({ codigo: "7401234567890", itemCode: "P1" }, quien, { repo });
  assert.deepEqual(r.data, { id: 50, codigo: "7401234567890", itemCode: "P1", itemName: "Shampoo", origen: "app", nuevo: true });
  assert.deepEqual(ops[0], ["bloquear", "7401234567890"]);
  assert.deepEqual(ops.find((o) => o[0] === "crear")[1],
    { itemCode: "P1", codigo: "7401234567890", uomEntry: -1, origen: "app", registradoPor: "operador:Carmen Díaz" });
  const { create } = ops.find((o) => o[0] === "confirmar")[1];
  assert.equal(create.esUnidadIndividual, true);
  assert.equal(create.uomEntryConfirmado, -1);
  assert.equal(create.confirmadaPor, "operador:Carmen Díaz");
});

test("el mismo código de otro producto o de la ficha de otro producto se rechaza", async () => {
  let { repo, ops } = base({ activos: [{ id: 3, itemCode: "P2", codigo: "X", producto: { itemCode: "P2", itemName: "Crema" } }] });
  await assert.rejects(registrarCodigo({ codigo: "X", itemCode: "P1" }, quien, { repo }), { code: "CODIGO_EN_USO", statusCode: 409, message: /Crema \(P2\)/ });
  assert.ok(!ops.some((o) => o[0] === "crear" || o[0] === "confirmar"));
  ({ repo, ops } = base({ fichaDeOtro: { itemCode: "P3", itemName: "Gel" } }));
  await assert.rejects(registrarCodigo({ codigo: "X", itemCode: "P1" }, quien, { repo }), { code: "CODIGO_EN_USO" });
  assert.ok(!ops.some((o) => o[0] === "crear"));
});

test("producto inexistente: 404 sin crear nada", async () => {
  const { repo, ops } = base({ producto: null });
  await assert.rejects(registrarCodigo({ codigo: "X", itemCode: "NO" }, quien, { repo }), { code: "PRODUCTO_NO_ENCONTRADO", statusCode: 404 });
  assert.ok(!ops.some((o) => o[0] === "crear"));
});

test("código que ya tiene el producto: no se duplica, solo se confirma", async () => {
  const { repo, ops } = base({ activos: [{ id: 7, itemCode: "P1", codigo: "X", uomEntry: 1, origen: "sap", producto: { itemCode: "P1", itemName: "Shampoo" } }] });
  const r = await registrarCodigo({ codigo: "X", itemCode: "P1" }, quien, { repo });
  assert.equal(r.data.nuevo, false); assert.equal(r.data.origen, "sap");
  assert.ok(!ops.some((o) => o[0] === "crear" || o[0] === "actualizar"));
  assert.equal(ops.find((o) => o[0] === "confirmar")[1].where.codigoBarrasId, 7);
});

test("sin unidad: el cargado desde la app se corrige; el de SAP no se toca", async () => {
  let { repo, ops } = base({ activos: [{ id: 8, itemCode: "P1", codigo: "X", uomEntry: null, origen: "app", producto: {} }] });
  await registrarCodigo({ codigo: "X", itemCode: "P1" }, quien, { repo });
  assert.deepEqual(ops.find((o) => o[0] === "actualizar").slice(1), [8, { uomEntry: -1 }]);
  ({ repo, ops } = base({ activos: [{ id: 9, itemCode: "P1", codigo: "X", uomEntry: null, origen: "sap", producto: {} }] }));
  await assert.rejects(registrarCodigo({ codigo: "X", itemCode: "P1" }, quien, { repo }), { code: "UNIDAD_NO_DEFINIDA" });
  assert.ok(!ops.some((o) => o[0] === "actualizar" || o[0] === "confirmar"));
});

test("un código de caja no se registra como unidad: en un pedido contaría una unidad por caja", async () => {
  const { repo } = base();
  const tx = { producto: { findUnique: async () => ({ itemCode: "P1", itemName: "Shampoo" }), findFirst: async () => null },
    productoCodigoBarras: { findMany: async () => [] },
    inventarioCodigoCaja: { findUnique: async () => ({ codigo: "C1", itemCode: "P1", producto: { itemCode: "P1", itemName: "Shampoo" } }) } };
  repo.conCodigoBloqueado = async (codigo, op) => op(tx);
  await assert.rejects(registrarCodigo({ codigo: "C1", itemCode: "P1" }, quien, { repo }), { code: "ES_CODIGO_DE_CAJA" });
});
