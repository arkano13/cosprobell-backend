import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { sincronizacionRepository: repo } = await import("../../src/modules/sincronizacion/sincronizacion.repository.js");
const { registrarRecorrido } = await import("../../src/modules/sincronizacion/recorridos.service.js");
const { observarRegistros } = await import("../../src/modules/sincronizacion/observados.service.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
const lista = { itemCode: "C", tipo: "iAssemblyTree", cantidad: 1, lineas: [{ itemCode: "A", cantidad: 1, tipo: "pit_Item" }] };

test("receta nueva o cambiada exige revisar sesiones activas sin reescribir sus líneas", async () => {
  let previo = null, revisiones = 0;
  const db = { listaMateriales: { findUnique: async () => previo,
    upsert: async ({ create }) => { previo = create; return create; } },
    pickingPedido: { updateMany: async q => { revisiones++; assert.equal(q.where.estado, "en_proceso"); assert.equal(q.data.estado, "requiere_revision"); } } };
  await repo.guardarListaMateriales(lista, db); assert.equal(revisiones, 1);
  await repo.guardarListaMateriales(lista, db); assert.equal(revisiones, 1);
  await repo.guardarListaMateriales({ ...lista, cantidad: 2 }, db); assert.equal(revisiones, 2);
});
test("receta sin cambios confirma presencia y revierte retirada sin cambiar contenido", async t => {
  let observado;
  const db = { listaMateriales: { count: async () => 1, updateMany: async q => { observado = q; } } };
  t.mock.method(repo, "conBloqueo", fn => fn(db));
  t.mock.method(repo, "consultarEstado", async () => ({ empresa: "SAP" }));
  t.mock.method(repo, "existeOtraEmpresa", async () => false);
  assert.deepEqual(await observarRegistros("listasMateriales", { claves: ["C"] }, "SAP"), { observados: 1 });
  assert.equal(observado.data.retiradoEnSap, false);
  assert.equal(observado.data.lineas, undefined);
});
test("solo un recorrido completo retira recetas ausentes, con secuencia exacta", async t => {
  const id = "11111111-1111-4111-8111-111111111111";
  let retiradas = 0, revisiones = 0, finalizada = false;
  const db = { listaMateriales: { findMany: async () => [{ itemCode: "C" }], updateMany: async () => { retiradas++; } },
    pickingPedido: { updateMany: async () => { revisiones++; } } };
  t.mock.method(repo, "conBloqueo", fn => fn(db));
  t.mock.method(repo, "existeOtraEmpresa", async () => false);
  t.mock.method(repo, "consultarRecorrido", async () => ({ recorridoId: id, iniciadoEn: new Date(), finalizadoEn: finalizada ? new Date() : null, secuencia: 1 }));
  t.mock.method(repo, "consultarEstado", async () => ({ secuencia: 1 }));
  t.mock.method(repo, "finalizarRecorrido", async () => { finalizada = true; });
  await assert.rejects(registrarRecorrido("listasMateriales", "finalizar", { recorridoId: id, secuencia: 0 }, "SAP"));
  assert.equal(retiradas, 0);
  await registrarRecorrido("listasMateriales", "finalizar", { recorridoId: id, secuencia: 1 }, "SAP");
  await registrarRecorrido("listasMateriales", "finalizar", { recorridoId: id, secuencia: 1 }, "SAP");
  assert.equal(retiradas, 1); assert.equal(revisiones, 1);
});
