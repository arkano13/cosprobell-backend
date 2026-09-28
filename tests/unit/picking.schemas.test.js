import test from "node:test";
import assert from "node:assert/strict";

import {
  iniciarBodySchema,
  idParamsSchema,
  escanearBodySchema,
} from "../../src/modules/picking/picking.schemas.js";

test("acepta un pedido válido y convierte su identificador", () => {
  const resultado = iniciarBodySchema.parse({
    pedidoDocEntry: "9001",
  });

  assert.deepEqual(resultado, {
    pedidoDocEntry: 9001,
  });
});

test("rechaza identificadores de pedido inválidos", () => {
  for (const valor of [undefined, null, "", 0, -1, 1.5, "abc"]) {
    const resultado = iniciarBodySchema.safeParse({
      pedidoDocEntry: valor,
    });

    assert.equal(resultado.success, false);
  }
});

test("valida el identificador de la sesión", () => {
  assert.deepEqual(idParamsSchema.parse({ id: "10" }), {
    id: 10,
  });

  for (const valor of [undefined, "", 0, -1, 1.5, "abc"]) {
    assert.equal(
      idParamsSchema.safeParse({ id: valor }).success,
      false
    );
  }
});

test("conserva los ceros iniciales del código escaneado", () => {
  const resultado = escanearBodySchema.parse({
    codigo: " 0012345678905 ",
  });

  assert.deepEqual(resultado, {
    codigo: "0012345678905",
  });
});

test("rechaza códigos vacíos, no textuales o con byte nulo", () => {
  for (const valor of [
    undefined,
    null,
    "",
    "   ",
    123,
    "ABC\u0000DEF",
  ]) {
    assert.equal(
      escanearBodySchema.safeParse({ codigo: valor }).success,
      false
    );
  }
});

test("acepta usuario opcional y rechaza texto inválido", () => {
  const valido = iniciarBodySchema.parse({
    pedidoDocEntry: 9001,
    usuarioId: " operador-demo ",
  });

  assert.equal(valido.usuarioId, "operador-demo");

  for (const usuarioId of ["", "   ", "A\u0000B"]) {
    assert.equal(
      iniciarBodySchema.safeParse({
        pedidoDocEntry: 9001,
        usuarioId,
      }).success,
      false
    );
  }
});