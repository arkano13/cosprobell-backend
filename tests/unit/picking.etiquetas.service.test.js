import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { pickingEtiquetasRepository } = await import(
  "../../src/modules/picking/picking.etiquetas.repository.js"
);

const { resolverEtiquetaParaPicking } = await import(
  "../../src/modules/picking/picking.etiquetas.service.js"
);

const { AppError } = await import(
  "../../src/shared/errors/AppError.js"
);

function crearAsociacion() {
  return {
    id: 10,
    itemCode: "PROD-001",
    codigo: "00123",
    uomEntry: 1,
    confirmacionPicking: {
      codigoBarrasId: 10,
      esUnidadIndividual: true,
      itemCodeConfirmado: "PROD-001",
      codigoConfirmado: "00123",
      uomEntryConfirmado: 1,
    },
  };
}

function crearProducto(asociaciones = [crearAsociacion()]) {
  return {
    itemCode: "PROD-001",
    codigosBarras: asociaciones,
  };
}

function comprobarError(code, statusCode) {
  return (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  };
}

test("rechaza códigos inválidos sin consultar", async (t) => {
  const consulta = t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => []
  );

  for (const codigo of [undefined, null, 123, "", " ", "A\u0000B"]) {
    await assert.rejects(
      resolverEtiquetaParaPicking(codigo),
      comprobarError("CODIGO_INVALIDO", 400)
    );
  }

  assert.equal(consulta.mock.callCount(), 0);
});

test("resuelve una etiqueta confirmada y conserva la transacción recibida", async (t) => {
  const tx = {};

  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async (codigo, db) => {
      assert.equal(codigo, "00123");
      assert.equal(db, tx);
      return [crearProducto()];
    }
  );

  assert.deepEqual(
    await resolverEtiquetaParaPicking(" 00123 ", tx),
    {
      codigoBarrasId: 10,
      codigo: "00123",
      itemCode: "PROD-001",
      uomEntry: 1,
      cantidadUnidades: 1,
    }
  );
});

test("rechaza una etiqueta inexistente", async (t) => {
  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => []
  );

  await assert.rejects(
    resolverEtiquetaParaPicking("DESCONOCIDO"),
    comprobarError("ETIQUETA_NO_ENCONTRADA", 404)
  );
});

test("rechaza un código compartido por distintos productos", async (t) => {
  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => [
      crearProducto(),
      { itemCode: "PROD-002", codigosBarras: [] },
    ]
  );

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    comprobarError("CODIGO_AMBIGUO", 409)
  );
});

test("rechaza el código principal si no tiene asociación explícita", async (t) => {
  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => [crearProducto([])]
  );

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    comprobarError("ETIQUETA_SIN_CONFIRMAR", 409)
  );
});

test("rechaza asociaciones duplicadas sin escoger una confirmación", async (t) => {
  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => [
      crearProducto([
        crearAsociacion(),
        { ...crearAsociacion(), id: 11 },
      ]),
    ]
  );

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    comprobarError("ASOCIACION_AMBIGUA", 409)
  );
});

test("aplica las reglas de confirmación a los datos consultados", async (t) => {
  let asociacion;

  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => [crearProducto([asociacion])]
  );

  asociacion = crearAsociacion();
  asociacion.confirmacionPicking = null;

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    comprobarError("ETIQUETA_SIN_CONFIRMAR", 409)
  );

  asociacion = crearAsociacion();
  asociacion.confirmacionPicking.esUnidadIndividual = false;

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    comprobarError("PRESENTACION_NO_PERMITIDA", 409)
  );

  asociacion = crearAsociacion();
  asociacion.uomEntry = 2;

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    comprobarError("CONFIRMACION_DESACTUALIZADA", 409)
  );
});

test("propaga fallos técnicos sin convertirlos en rechazos de etiqueta", async (t) => {
  const fallo = new Error("Fallo simulado de consulta");

  t.mock.method(
    pickingEtiquetasRepository,
    "buscarProductos",
    async () => {
      throw fallo;
    }
  );

  await assert.rejects(
    resolverEtiquetaParaPicking("00123"),
    (error) => error === fallo
  );
});