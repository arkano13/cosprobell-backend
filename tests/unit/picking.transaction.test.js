import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import(
  "../../src/infrastructure/database/prisma.js"
);

const { conSesionBloqueada } = await import(
  "../../src/modules/picking/picking.transaction.js"
);

function simularTransaccion(t, tx) {
  const original = prisma.$transaction;

  prisma.$transaction = async (operacion) => {
    return operacion(tx);
  };

  t.after(() => {
    prisma.$transaction = original;
  });
}

test("consulta y bloquea antes de ejecutar la operación", async (t) => {
  const pasos = [];

  const sesion = {
    id: 25,
    estado: "en_proceso",
  };

  const tx = {
    async $queryRaw(partes, ...valores) {
      pasos.push("bloquear");

      assert.match(partes.join("?"), /FOR UPDATE/);
      assert.deepEqual(valores, [25]);

      return [sesion];
    },
  };

  simularTransaccion(t, tx);

  const resultado = await conSesionBloqueada(
    25,
    async (contexto) => {
      pasos.push("operar");

      assert.equal(contexto.tx, tx);
      assert.deepEqual(contexto.sesion, sesion);

      return { resultado: "correcto" };
    }
  );

  assert.deepEqual(pasos, ["bloquear", "operar"]);

  assert.deepEqual(resultado, {
    resultado: "correcto",
  });
});

test("entrega null cuando la sesión no existe", async (t) => {
  const tx = {
    async $queryRaw() {
      return [];
    },
  };

  simularTransaccion(t, tx);

  await conSesionBloqueada(999, async ({ sesion }) => {
    assert.equal(sesion, null);
  });
});

test("no ejecuta la operación si falla el bloqueo", async (t) => {
  const fallo = new Error("Fallo de consulta simulado");
  let ejecutada = false;

  const tx = {
    async $queryRaw() {
      throw fallo;
    },
  };

  simularTransaccion(t, tx);

  await assert.rejects(
    conSesionBloqueada(25, async () => {
      ejecutada = true;
    }),
    (error) => error === fallo
  );

  assert.equal(ejecutada, false);
});

test("propaga el error de la operación a la transacción", async (t) => {
  const fallo = new Error("Fallo de operación simulado");

  const tx = {
    async $queryRaw() {
      return [{ id: 25, estado: "en_proceso" }];
    },
  };

  simularTransaccion(t, tx);

  await assert.rejects(
    conSesionBloqueada(25, async () => {
      throw fallo;
    }),
    (error) => error === fallo
  );
});