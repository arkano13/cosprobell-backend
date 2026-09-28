import test from "node:test";
import assert from "node:assert/strict";

// Las pruebas sustituyen el repositorio; no consultan PostgreSQL.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { sincronizacionRepository } = await import(
  "../../src/modules/sincronizacion/sincronizacion.repository.js"
);
const { procesarLote } = await import(
  "../../src/modules/sincronizacion/sincronizacion.service.js"
);
const { AppError } = await import("../../src/shared/errors/AppError.js");

const loteId = "3f2b8c1e-5d4a-4b7e-9c2f-1a6e8d0b4c3a";
const txFalsa = { nombre: "transaccion-simulada" };

const bodegas = [
  { warehouseCode: "01", warehouseName: "Principal", city: null, country: "HN", inactive: false },
  { warehouseCode: "02", warehouseName: "Sucursal", city: null, country: "HN", inactive: true },
];

function item(itemCode, { grupo = 100, bodegas = ["01"] } = {}) {
  return {
    producto: { itemCode, itemName: itemCode, itemsGroupCode: grupo },
    existencias: bodegas.map((warehouseCode) => ({
      warehouseCode,
      inStock: 1,
      committed: 0,
      ordered: 0,
    })),
    codigosBarras: [],
  };
}

function errorDeClaveUnica(modelName) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { modelName },
  });
}

function simularRepositorio(t, cambios = {}) {
  const llamadas = [];

  const registrar = (nombre, resultado) => async (...args) => {
    llamadas.push([nombre, ...args.filter((arg) => arg !== txFalsa)]);
    return resultado?.(...args);
  };

  const operaciones = {
    enTransaccion: async (trabajo) => trabajo(txFalsa),
    registrarEjecucion: registrar("registrarEjecucion", () => ({ id: 7 })),
    registrarLote: registrar("registrarLote"),
    registrarError: registrar("registrarError"),
    guardarGrupo: registrar("guardarGrupo"),
    guardarBodega: registrar("guardarBodega"),
    buscarBodegasExistentes: async () => new Set(["01", "02"]),
    buscarGruposExistentes: async () => new Set([100]),
    guardarProductos: registrar("guardarProductos"),
    ...cambios,
  };

  const mocks = {};

  for (const [nombre, implementacion] of Object.entries(operaciones)) {
    mocks[nombre] = t.mock.method(sincronizacionRepository, nombre, implementacion);
  }

  return { llamadas, mocks };
}

test("aplica un lote de bodegas dentro de una transacción", async (t) => {
  const { llamadas } = simularRepositorio(t);

  const resultado = await procesarLote({ loteId, entidad: "Warehouses", registros: bodegas });

  assert.deepEqual(resultado, {
    estado: "aplicado",
    loteId,
    entidad: "Warehouses",
    registros: 2,
  });
  assert.deepEqual(llamadas, [
    ["registrarEjecucion", "Warehouses"],
    ["registrarLote", { loteId, sincronizacionId: 7, cantidadRegistros: 2 }],
    ["guardarBodega", bodegas[0]],
    ["guardarBodega", bodegas[1]],
  ]);
});

test("aplica un lote de grupos", async (t) => {
  const { llamadas } = simularRepositorio(t);
  const grupos = [{ number: 100, groupName: "Bebidas" }];

  await procesarLote({ loteId, entidad: "ItemGroups", registros: grupos });

  assert.deepEqual(llamadas.at(-1), ["guardarGrupo", grupos[0]]);
});

test("guarda productos cuando existen sus bodegas y grupos", async (t) => {
  const { llamadas, mocks } = simularRepositorio(t);
  const items = [item("A", { bodegas: ["01", "02"] }), item("B", { grupo: null })];

  await procesarLote({ loteId, entidad: "Items", registros: items });

  assert.deepEqual(mocks.buscarBodegasExistentes.mock.calls[0].arguments[1], ["01", "02"]);
  assert.deepEqual(mocks.buscarGruposExistentes.mock.calls[0].arguments[1], [100]);
  assert.deepEqual(llamadas.at(-1), ["guardarProductos", items]);
});

test("rechaza productos con bodegas o grupos inexistentes", async (t) => {
  const { llamadas, mocks } = simularRepositorio(t, {
    buscarBodegasExistentes: async () => new Set(["01"]),
    buscarGruposExistentes: async () => new Set(),
  });

  await assert.rejects(
    procesarLote({
      loteId,
      entidad: "Items",
      registros: [item("A", { bodegas: ["01", "99"] })],
    }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "DEPENDENCIAS_FALTANTES");
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /bodegas 99; grupos 100/);
      return true;
    }
  );

  assert.equal(mocks.guardarProductos.mock.callCount(), 0);
  assert.deepEqual(llamadas.at(-1), [
    "registrarError",
    {
      entidad: "Items",
      loteId,
      mensaje: mocks.registrarError.mock.calls[0].arguments[0].mensaje,
    },
  ]);
  assert.match(mocks.registrarError.mock.calls[0].arguments[0].mensaje, /bodegas 99/);
});

test("limita la cantidad de códigos faltantes en el mensaje", async (t) => {
  simularRepositorio(t, { buscarBodegasExistentes: async () => new Set() });
  const faltantes = Array.from({ length: 25 }, (_, i) => `B${i}`);

  await assert.rejects(
    procesarLote({ loteId, entidad: "Items", registros: [item("A", { bodegas: faltantes })] }),
    /B19 y 5 más/
  );
});

test("informa un lote repetido sin volver a guardar ni registrar error", async (t) => {
  const { mocks } = simularRepositorio(t, {
    registrarLote: async () => {
      throw errorDeClaveUnica("SincronizacionLote");
    },
  });

  const resultado = await procesarLote({ loteId, entidad: "Warehouses", registros: bodegas });

  assert.deepEqual(resultado, { estado: "duplicado", loteId, entidad: "Warehouses" });
  assert.equal(mocks.guardarBodega.mock.callCount(), 0);
  assert.equal(mocks.registrarError.mock.callCount(), 0);
});

test("no confunde una clave repetida de otra tabla con un lote repetido", async (t) => {
  const fallo = errorDeClaveUnica("Bodega");
  simularRepositorio(t, {
    guardarBodega: async () => {
      throw fallo;
    },
  });

  await assert.rejects(
    procesarLote({ loteId, entidad: "Warehouses", registros: bodegas }),
    (error) => error === fallo
  );
});

test("registra un fallo técnico sin exponer su detalle", async (t) => {
  const fallo = new Error("detalle-interno-privado");
  const { mocks } = simularRepositorio(t, {
    guardarBodega: async () => {
      throw fallo;
    },
  });

  await assert.rejects(
    procesarLote({ loteId, entidad: "Warehouses", registros: bodegas }),
    (error) => error === fallo
  );

  assert.deepEqual(mocks.registrarError.mock.calls[0].arguments[0], {
    entidad: "Warehouses",
    loteId,
    mensaje: "Error interno al procesar el lote",
  });
});

test("conserva el error original si no puede registrarlo", async (t) => {
  const fallo = new Error("Conexión perdida");
  const avisos = [];

  simularRepositorio(t, {
    guardarBodega: async () => {
      throw fallo;
    },
    registrarError: async () => {
      throw new Error("Tampoco se pudo registrar");
    },
  });

  await assert.rejects(
    procesarLote(
      { loteId, entidad: "Warehouses", registros: bodegas },
      { log: { warn: (...args) => avisos.push(args) } }
    ),
    (error) => error === fallo
  );

  assert.equal(avisos.length, 1);
});
