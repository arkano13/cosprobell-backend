import test from "node:test";
import assert from "node:assert/strict";

// Estas pruebas simulan el repositorio; no consultan PostgreSQL.
process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { unidadesMedidaRepository } = await import(
  "../../src/modules/unidades-medida/unidades-medida.repository.js"
);

const { buscarUnidadMedida } = await import(
  "../../src/modules/unidades-medida/unidades-medida.service.js"
);

test("no interpreta una referencia ausente o manual como unidad individual", async (t) => {
  const consulta = t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => null
  );

  for (const valor of [null, undefined, -1]) {
    assert.deepEqual(await buscarUnidadMedida(valor), {
      estado: "unidad_no_definida",
    });
  }

  assert.equal(consulta.mock.callCount(), 0);
});

test("rechaza referencias inválidas sin consultar", async (t) => {
  const consulta = t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => null
  );

  const valores = [
    "",
    "1",
    true,
    {},
    [],
    -2,
    1.5,
    NaN,
    Infinity,
    2_147_483_648,
  ];

  for (const valor of valores) {
    assert.deepEqual(await buscarUnidadMedida(valor), {
      estado: "referencia_invalida",
    });
  }

  assert.equal(consulta.mock.callCount(), 0);
});

test("consulta identificadores válidos y devuelve la unidad", async (t) => {
  t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async (absEntry) => ({
      absEntry,
      code: "CODIGO-PRUEBA",
      name: "Unidad de prueba",
    })
  );

  for (const absEntry of [0, 1, 2_147_483_647]) {
    assert.deepEqual(await buscarUnidadMedida(absEntry), {
      estado: "encontrada",
      unidad: {
        absEntry,
        code: "CODIGO-PRUEBA",
        name: "Unidad de prueba",
      },
    });
  }
});

test("informa cuando la referencia no existe en el catálogo", async (t) => {
  t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => null
  );

  assert.deepEqual(await buscarUnidadMedida(25), {
    estado: "no_encontrada",
  });
});

test("conserva nombres y códigos ausentes sin inventarlos", async (t) => {
  t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => ({
      absEntry: 1,
      code: null,
      name: null,
    })
  );

  assert.deepEqual(await buscarUnidadMedida(1), {
    estado: "encontrada",
    unidad: {
      absEntry: 1,
      code: null,
      name: null,
    },
  });
});

test("propaga fallos técnicos sin convertirlos en unidad inexistente", async (t) => {
  const fallo = new Error("Fallo simulado de base de datos");

  t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => {
      throw fallo;
    }
  );

  await assert.rejects(
    buscarUnidadMedida(1),
    (error) => error === fallo
  );
});