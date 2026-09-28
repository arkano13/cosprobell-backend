import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { pickingRepository } = await import(
  "../../src/modules/picking/picking.repository.js"
);

const {
  escanearPicking,
  finalizarPicking,
} = await import(
  "../../src/modules/picking/picking.service.js"
);

const { AppError } = await import(
  "../../src/shared/errors/AppError.js"
);

function preparar(t, cambios = {}) {
  const operaciones = {
    buscarEstadoSesion: async () => ({
      estado: "en_proceso",
    }),

    incrementarLinea: async () => [],

    buscarLineaProducto: async () => null,

    buscarSesionConLineas: async () => null,

    guardarFinalizacion: async (id, estado, fechaFin) => ({
      id,
      estado,
      fechaFin,
    }),

    ...cambios,
  };

  const mocks = {};

  for (const [nombre, implementacion] of Object.entries(
    operaciones
  )) {
    mocks[nombre] = t.mock.method(
      pickingRepository,
      nombre,
      implementacion
    );
  }

  return mocks;
}

function comprobarError(code, statusCode) {
  return (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  };
}

test("escanear devuelve la línea actualizada", async (t) => {
  const linea = {
    id: 10,
    itemCode: "PROD-001",
    cantidadEscaneada: 1,
  };

  const mocks = preparar(t, {
    incrementarLinea: async (id, codigo) => {
      assert.equal(id, 25);
      assert.equal(codigo, "PROD-001");
      return [linea];
    },
  });

  const resultado = await escanearPicking(25, "PROD-001");

  assert.deepEqual(resultado, linea);

  assert.equal(
    mocks.buscarLineaProducto.mock.callCount(),
    0
  );
});

test("una sesión inexistente impide escanear y finalizar", async (t) => {
  const mocks = preparar(t, {
    buscarEstadoSesion: async () => null,
  });

  await assert.rejects(
    escanearPicking(999, "PROD-001"),
    comprobarError("PICKING_NO_ENCONTRADO", 404)
  );

  await assert.rejects(
    finalizarPicking(999),
    comprobarError("PICKING_NO_ENCONTRADO", 404)
  );

  assert.equal(
    mocks.incrementarLinea.mock.callCount(),
    0
  );

  assert.equal(
    mocks.guardarFinalizacion.mock.callCount(),
    0
  );
});

test("una sesión cerrada impide incrementar cantidades", async (t) => {
  const mocks = preparar(t, {
    buscarEstadoSesion: async () => ({
      estado: "completo",
    }),
  });

  await assert.rejects(
    escanearPicking(25, "PROD-001"),
    comprobarError("PICKING_NO_ACTIVO", 400)
  );

  assert.equal(
    mocks.incrementarLinea.mock.callCount(),
    0
  );
});

test("escanear rechaza un producto ajeno al pedido", async (t) => {
  preparar(t);

  await assert.rejects(
    escanearPicking(25, "OTRO-PRODUCTO"),
    comprobarError("PRODUCTO_FUERA_DEL_PEDIDO", 409)
  );
});

test("conserva el rechazo cuando la cantidad está completa", async (t) => {
  preparar(t, {
    buscarLineaProducto: async () => ({
      itemCode: "PROD-001",
      cantidadPedida: 10,
      cantidadEscaneada: 10,
    }),
  });

  await assert.rejects(
    escanearPicking(25, "PROD-001"),
    comprobarError("CANTIDAD_COMPLETADA", 409)
  );
});

test("un fallo de persistencia se propaga sin reinterpretarlo", async (t) => {
  const fallo = new Error("Fallo simulado");

  const mocks = preparar(t, {
    incrementarLinea: async () => {
      throw fallo;
    },
  });

  await assert.rejects(
    escanearPicking(25, "PROD-001"),
    (error) => error === fallo
  );

  assert.equal(
    mocks.buscarLineaProducto.mock.callCount(),
    0
  );
});

test("finalizar marca completo cuando coinciden las cantidades", async (t) => {
  const mocks = preparar(t, {
    buscarSesionConLineas: async () => ({
      id: 25,
      lineas: [
        {
          cantidadPedida: 10,
          cantidadEscaneada: 10,
        },
        {
          cantidadPedida: 5,
          cantidadEscaneada: 5,
        },
      ],
    }),
  });

  const resultado = await finalizarPicking(25);

  assert.equal(resultado.id, 25);
  assert.equal(resultado.estado, "completo");
  assert.ok(resultado.fechaFin instanceof Date);

  assert.equal(
    mocks.guardarFinalizacion.mock.callCount(),
    1
  );
});

test("finalizar conserva el estado con diferencias si falta cantidad", async (t) => {
  preparar(t, {
    buscarSesionConLineas: async () => ({
      id: 25,
      lineas: [
        {
          cantidadPedida: 10,
          cantidadEscaneada: 8,
        },
      ],
    }),
  });

  const resultado = await finalizarPicking(25);

  assert.equal(resultado.estado, "con_diferencias");
});