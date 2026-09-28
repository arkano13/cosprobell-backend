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

function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre];

  objeto[nombre] = implementacion;

  t.after(() => {
    objeto[nombre] = original;
  });
}

test("crearSesion envía la cabecera y sus líneas a Prisma", async (t) => {
  const sesionEsperada = {
    id: 1,
    pedidoDocEntry: 9001,
    estado: "en_proceso",
    lineas: [],
  };

  let datosRecibidos;

  sustituir(
    t,
    prisma.pickingPedido,
    "create",
    async (argumentos) => {
      datosRecibidos = argumentos;
      return sesionEsperada;
    }
  );

  const resultado = await pickingRepository.crearSesion({
    pedidoDocEntry: 9001,
    usuarioId: "operador-demo",
    lineas: [
      {
        pedidoLineNum: 0,
        itemCode: "PROD-001",
        cantidadPedida: 10,
      },
    ],
  });

  assert.deepEqual(datosRecibidos, {
    data: {
      pedidoDocEntry: 9001,
      usuarioId: "operador-demo",
      estado: "en_proceso",
      lineas: {
        create: [
          {
             pedidoLineNum: 0,
            itemCode: "PROD-001",
            cantidadPedida: 10,
            uomEntry: null,
            uomCode: null,
          },
        ],
      },
    },
    include: {
      lineas: true,
    },
  });

  assert.equal(resultado, sesionEsperada);
});

test("crearSesion guarda null cuando no recibe usuario", async (t) => {
  let usuarioGuardado;

  sustituir(
    t,
    prisma.pickingPedido,
    "create",
    async ({ data }) => {
      usuarioGuardado = data.usuarioId;
      return { id: 1 };
    }
  );

  await pickingRepository.crearSesion({
    pedidoDocEntry: 9001,
    lineas: [],
  });

  assert.equal(usuarioGuardado, null);
});

test("crearSesion propaga un fallo de persistencia", async (t) => {
  const fallo = new Error("Fallo de persistencia simulado");

  sustituir(t, prisma.pickingPedido, "create", async () => {
    throw fallo;
  });

  await assert.rejects(
    async () => {
      await pickingRepository.crearSesion({
        pedidoDocEntry: 9001,
        lineas: [],
      });
    },
    (error) => error === fallo
  );
});

test("incremento limita la escritura a la línea validada y guarda la etiqueta", async () => {
  let sql;
  let parametros;
  const tx = { async $queryRaw(partes, ...valores) {
    sql = partes.join("?"); parametros = valores; return [{ id: 10 }];
  } };
  const resultado = await pickingRepository.incrementarLinea({
    pickingId: 25, lineaId: 10, itemCode: "PROD-001", codigo: "00123", uomEntry: 1,
  }, tx);
  assert.deepEqual(parametros, ["00123", 10, 25, "PROD-001", 1]);
  assert.match(sql, /"cantidadEscaneada" \+ 1 <= "cantidadPedida"/);
  assert.match(sql, /"uomEntry" = \?/);
  assert.deepEqual(resultado, [{ id: 10 }]);
});
