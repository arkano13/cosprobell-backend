import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { etiquetasRepository } = await import(
  "../../src/modules/productos/etiquetas.repository.js"
);

const { unidadesMedidaRepository } = await import(
  "../../src/modules/unidades-medida/unidades-medida.repository.js"
);

const { resolverEtiqueta } = await import(
  "../../src/modules/productos/etiquetas.service.js"
);

function producto(referencias) {
  return {
    itemCode: "PROD-001",
    itemName: "Producto de prueba",
    codigosBarras: referencias.map((uomEntry) => ({ uomEntry })),
  };
}

test("rechaza códigos inválidos sin consultar", async (t) => {
  const consulta = t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async () => []
  );

  for (const codigo of [null, undefined, 123, "", "  ", "A\u0000B"]) {
    assert.deepEqual(await resolverEtiqueta(codigo), {
      estado: "codigo_invalido",
    });
  }

  assert.equal(consulta.mock.callCount(), 0);
});

test("distingue código inexistente y producto ambiguo", async (t) => {
  const consultaUnidad = t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => null
  );

  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async (codigo) =>
      codigo === "INEXISTENTE"
        ? []
        : [producto([1]), { ...producto([1]), itemCode: "PROD-002" }]
  );

  assert.equal(
    (await resolverEtiqueta("INEXISTENTE")).estado,
    "no_encontrado"
  );

  assert.equal(
    (await resolverEtiqueta("DUPLICADO")).estado,
    "codigo_ambiguo"
  );

  assert.equal(consultaUnidad.mock.callCount(), 0);
});

test("conserva ceros iniciales y resuelve asociaciones repetidas equivalentes", async (t) => {
  const unidad = { absEntry: 1, code: "PRUEBA", name: "Medida de prueba" };

  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async (codigo) => {
      assert.equal(codigo, "00123");
      return [producto([1, 1])];
    }
  );

  t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async (id) => {
      assert.equal(id, 1);
      return unidad;
    }
  );

  assert.deepEqual(await resolverEtiqueta(" 00123 "), {
    estado: "resuelta",
    codigo: "00123",
    producto: {
      itemCode: "PROD-001",
      itemName: "Producto de prueba",
    },
    unidad,
  });
});

test("no asigna una unidad a etiquetas sin referencia o manuales", async (t) => {
  let referencias = [];

  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async () => [producto(referencias)]
  );

  const consultaUnidad = t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => null
  );

  for (const caso of [[], [null], [-1], [null, -1]]) {
    referencias = caso;

    assert.equal(
      (await resolverEtiqueta("00123")).estado,
      "unidad_no_definida"
    );
  }

  assert.equal(consultaUnidad.mock.callCount(), 0);
});

test("rechaza asociaciones de unidad contradictorias o incompletas", async (t) => {
  let referencias;

  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async () => [producto(referencias)]
  );

  const consultaUnidad = t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => null
  );

  for (const caso of [[1, 2], [1, null], [1, -1]]) {
    referencias = caso;

    assert.equal(
      (await resolverEtiqueta("00123")).estado,
      "unidad_ambigua"
    );
  }

  assert.equal(consultaUnidad.mock.callCount(), 0);
});

test("distingue referencia inválida y unidad ausente del catálogo", async (t) => {
  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async (codigo) => [producto([codigo === "INVALIDA" ? -2 : 25])]
  );

  const consulta = t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async (id) => {
      assert.equal(id, 25);
      return null;
    }
  );

  assert.equal(
    (await resolverEtiqueta("INVALIDA")).estado,
    "referencia_invalida"
  );

  assert.equal(
    (await resolverEtiqueta("SIN-CATALOGO")).estado,
    "unidad_no_encontrada"
  );

  assert.equal(consulta.mock.callCount(), 1);
});

test("propaga un fallo al consultar productos", async (t) => {
  const fallo = new Error("Fallo simulado de productos");

  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async () => {
      throw fallo;
    }
  );

  await assert.rejects(
    resolverEtiqueta("00123"),
    (error) => error === fallo
  );
});

test("propaga un fallo al consultar unidades", async (t) => {
  const fallo = new Error("Fallo simulado de unidades");

  t.mock.method(
    etiquetasRepository,
    "buscarProductos",
    async () => [producto([1])]
  );

  t.mock.method(
    unidadesMedidaRepository,
    "buscarPorId",
    async () => {
      throw fallo;
    }
  );

  await assert.rejects(
    resolverEtiqueta("00123"),
    (error) => error === fallo
  );
});