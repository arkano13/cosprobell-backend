import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { retirarLotes, contarLotes } = await import("../../src/modules/inventario/inventario.lotes.js");
const { inventarioRepository: repo } = await import("../../src/modules/inventario/inventario.repository.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { finalizarBodySchema } = await import("../../src/modules/picking/picking.schemas.js");
after(() => prisma.$disconnect());

function preparar(t, filas) {
  const saldos = filas.map(f => ({ itemCode: "P1", vencimiento: null, ...f }));
  const cambios = [];
  t.mock.method(repo, "lotesPequena", async () => saldos.filter(f => f.unidades > 0).map(f => ({ ...f })));
  t.mock.method(repo, "cambiarLotePequena", async (id, itemCode, delta) => {
    const fila = saldos.find(f => f.id === id && f.itemCode === itemCode);
    if (!fila || fila.unidades + delta < 0) return null;
    fila.unidades += delta; cambios.push([id, delta]); return { ...fila };
  });
  t.mock.method(repo, "sumarLotePequena", async (itemCode, lote, vencimiento, unidades) => {
    let fila = saldos.find(f => f.lote === lote && f.vencimiento === (vencimiento ?? null));
    if (!fila) { fila = { id: saldos.length + 1, itemCode, lote, vencimiento: vencimiento ?? null, unidades: 0 }; saldos.push(fila); }
    fila.unidades += unidades; return { ...fila };
  });
  return { saldos, cambios };
}
test("lotes pequeña: no elegir automáticamente entre dos lotes", async t => {
  const { cambios } = preparar(t, [{ id: 1, lote: "A", unidades: 5 }, { id: 2, lote: "B", unidades: 5 }]);
  await assert.rejects(retirarLotes("P1", 3, undefined, {}), { code: "LOTES_REQUERIDOS" });
  assert.deepEqual(cambios, []);
});
test("lotes pequeña: descontar exactamente los lotes físicos elegidos", async t => {
  const { saldos } = preparar(t, [{ id: 1, lote: "A", unidades: 5 }, { id: 2, lote: "B", unidades: 5 }]);
  const movimientos = await retirarLotes("P1", 6, [{ pequenaLoteId: 1, unidades: 2 }, { pequenaLoteId: 2, unidades: 4 }], {});
  assert.deepEqual(saldos.map(f => f.unidades), [3, 1]);
  assert.deepEqual(movimientos, [{ pequenaLoteId: 1, lote: "A", cantidad: -2 }, { pequenaLoteId: 2, lote: "B", cantidad: -4 }]);
});
test("lotes pequeña: único lote conserva identificación sin selección adicional", async t => {
  preparar(t, [{ id: 1, lote: "A", unidades: 5 }]);
  assert.deepEqual(await retirarLotes("P1", 5, undefined, {}), [{ pequenaLoteId: 1, lote: "A", cantidad: -5 }]);
});
for (const [nombre, seleccion, code] of [
  ["ajeno al producto", [{ pequenaLoteId: 99, unidades: 3 }], "LOTE_INSUFICIENTE"],
  ["repetido", [{ pequenaLoteId: 1, unidades: 1 }, { pequenaLoteId: 1, unidades: 2 }], "ASIGNACION_LOTES_INVALIDA"],
  ["suma distinta", [{ pequenaLoteId: 1, unidades: 2 }], "ASIGNACION_LOTES_INVALIDA"],
  ["sin cantidad suficiente", [{ pequenaLoteId: 1, unidades: 3 }], "LOTE_INSUFICIENTE"],
]) test(`lotes pequeña: rechaza ${nombre} antes de descontar`, async t => {
  const { cambios } = preparar(t, [{ id: 1, lote: "A", unidades: 2 }, { id: 2, lote: "B", unidades: 5 }]);
  await assert.rejects(retirarLotes("P1", 3, seleccion, {}), { code });
  assert.deepEqual(cambios, []);
});
test("lotes pequeña: faltante exige reposición y no descuenta", async t => {
  const { cambios } = preparar(t, [{ id: 1, lote: "A", unidades: 2 }]);
  await assert.rejects(retirarLotes("P1", 3, undefined, {}), { code: "PEQUENA_INSUFICIENTE" });
  assert.deepEqual(cambios, []);
});
test("conteo: no mezcla lotes existentes en un total sin identificar", async t => {
  const { cambios } = preparar(t, [{ id: 1, lote: "A", unidades: 2 }, { id: 2, lote: "B", unidades: 3 }]);
  await assert.rejects(contarLotes("P1", 4, undefined, {}), { code: "LOTES_REQUERIDOS" });
  assert.deepEqual(cambios, []);
});
test("conteo: permite corregir distribución conservando el total y audita ambos lotes", async t => {
  const { saldos } = preparar(t, [{ id: 1, lote: "A", unidades: 2 }, { id: 2, lote: "B", unidades: 3 }]);
  const movimientos = await contarLotes("P1", 5, [{ lote: "A", unidades: 4 }, { lote: "B", unidades: 1 }], {});
  assert.deepEqual(saldos.map(f => f.unidades), [4, 1]);
  assert.deepEqual(movimientos.map(m => m.cantidad), [2, -2]);
});
test("conteo: suma por lotes incorrecta no modifica nada", async t => {
  const { cambios } = preparar(t, [{ id: 1, lote: "A", unidades: 2 }]);
  await assert.rejects(contarLotes("P1", 4, [{ lote: "A", unidades: 3 }], {}), { code: "ASIGNACION_LOTES_INVALIDA" });
  assert.deepEqual(cambios, []);
});
test("finalización HTTP: valida productos repetidos, fracciones y lotes duplicados", () => {
  const entrada = { itemCode: "P1", lotes: [{ pequenaLoteId: 1, unidades: 2 }] };
  assert.equal(finalizarBodySchema.safeParse({ lotes: [entrada] }).success, true);
  assert.equal(finalizarBodySchema.safeParse({ lotes: [entrada, entrada] }).success, false);
  assert.equal(finalizarBodySchema.safeParse({ lotes: [{ ...entrada, lotes: [{ pequenaLoteId: 1, unidades: 0.5 }] }] }).success, false);
});
