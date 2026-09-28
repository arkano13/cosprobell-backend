import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import(
  "../../src/infrastructure/database/prisma.js"
);

const { pickingRepository } = await import(
  "../../src/modules/picking/picking.repository.js"
);

const { iniciarPicking } = await import(
  "../../src/modules/picking/picking.service.js"
);

const casos = [
  {
    nombre: "conserva la unidad del pedido al guardar picking",
    entrada: { uomEntry: 1, uomCode: "UN" },
    esperado: { uomEntry: 1, uomCode: "UN" },
  },
  {
    nombre: "conserva la referencia manual sin interpretarla",
    entrada: { uomEntry: -1, uomCode: "Manual" },
    esperado: { uomEntry: -1, uomCode: "Manual" },
  },
  {
    nombre: "guarda null cuando el pedido no informa su unidad",
    entrada: {},
    esperado: { uomEntry: null, uomCode: null },
  },
];

for (const caso of casos) {
  test(caso.nombre, async (t) => {
    const lineaPedido = {
      lineNum: 0,
      itemCode: "PROD-001",
      quantity: 3,
      ...caso.entrada,
    };

    const pedido = {
      docEntry: 9001,
      lineas: [lineaPedido],
    };

    const original = structuredClone(pedido);

    t.mock.method(
      pickingRepository,
      "buscarPedidoConLineas",
      async () => pedido
    );

    // Ejecutamos el servicio y el repositorio reales.
    // Solo sustituimos la escritura final de Prisma.
    let datosGuardados;
    const crearOriginal = prisma.pickingPedido.create;

    prisma.pickingPedido.create = async ({ data }) => {
      datosGuardados = data;
      return { id: 25 };
    };

    t.after(() => {
      prisma.pickingPedido.create = crearOriginal;
    });

    await iniciarPicking({
      pedidoDocEntry: 9001,
      usuarioId: "operador-demo",
    });

    assert.deepEqual(datosGuardados.lineas.create, [
      {
        pedidoLineNum: 0,
        itemCode: "PROD-001",
        cantidadPedida: 3,
        ...caso.esperado,
      },
    ]);

    assert.deepEqual(
      pedido,
      original,
      "Crear picking no debe modificar el pedido recibido"
    );
  });
}