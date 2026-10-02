import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { etiquetasRepository: repo, versionEtiquetas } = await import("../../src/modules/etiquetas/etiquetas.repository.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
const filas = [{ id: 1, itemCode: "P1", codigo: "00123", uomEntry: -1 }];

test("confirmación masiva: mismo conteo con código cambiado se rechaza sin escribir", async (t) => {
  const tx = { $queryRaw: async () => [{ ...filas[0], codigo: "00999" }], $executeRaw: async () => assert.fail("No debe confirmar") };
  const original = prisma.$transaction; t.after(() => { prisma.$transaction = original; });
  prisma.$transaction = async fn => fn(tx);
  await assert.rejects(repo.confirmarManualPendientes({ cantidadEsperada: 1, versionEsperada: versionEtiquetas(filas), confirmadaPor: "supervisor" }), { code: "ETIQUETAS_CAMBIARON" });
});
test("confirmación masiva: conjunto revisado sin cambios se confirma", async (t) => {
  let escrituras = 0;
  const original = prisma.$transaction; t.after(() => { prisma.$transaction = original; });
  prisma.$transaction = async fn => fn({ $queryRaw: async () => filas, $executeRaw: async () => ++escrituras });
  assert.deepEqual(await repo.confirmarManualPendientes({ cantidadEsperada: 1, versionEsperada: versionEtiquetas(filas), confirmadaPor: "supervisor" }), { confirmadas: 1, disponibles: 1 });
  assert.equal(escrituras, 1);
});
