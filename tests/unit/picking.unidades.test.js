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
    nombre: "rechaza iniciar con referencia manual sin interpretarla",
    entrada: { uomEntry: -1, uomCode: "Manual" },
    esperado: { uomEntry: -1, uomCode: "Manual" },
  },
  {
    nombre: "rechaza iniciar cuando el pedido no informa su unidad",
    entrada: {},
    esperado: { uomEntry: null, uomCode: null },
  },
];

for (const caso of casos) {
  test(caso.nombre, async (t) => {
    t.mock.method(pickingRepository, "conPedidoBloqueado", async (_id, operacion) => operacion(prisma));
    t.mock.method(pickingRepository, "buscarSesionesDelPedido", async () => []);
    const lineaPedido = {
      lineNum: 0,
      itemCode: "PROD-001",
      quantity: 3,
      lineStatus: "bost_Open", remainingOpenQuantity: 3, inventoryQuantity: 3, remainingOpenInventoryQuantity: 3,
      ...caso.entrada,
    };

    const pedido = {
      docEntry: 9001,
      docType: "dDocument_Items",
      documentStatus: "bost_Open", cancelled: false,
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

    if (caso.entrada.uomEntry === undefined || caso.entrada.uomEntry < 0) {
      await assert.rejects(iniciarPicking({ pedidoDocEntry: 9001 }), { code: "UNIDAD_NO_DEFINIDA" });
      assert.equal(datosGuardados, undefined);
      assert.deepEqual(pedido, original);
      return;
    }
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
