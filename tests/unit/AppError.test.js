import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../src/shared/errors/AppError.js";

test("conserva el código, mensaje y estado HTTP", () => {
  const error = new AppError({
    code: "PRODUCTO_NO_ENCONTRADO",
    message: "El producto no existe.",
    statusCode: 404,
  });

  assert.ok(error instanceof Error);
  assert.ok(error instanceof AppError);
  assert.equal(error.name, "AppError");
  assert.equal(error.code, "PRODUCTO_NO_ENCONTRADO");
  assert.equal(error.message, "El producto no existe.");
  assert.equal(error.statusCode, 404);
});

test("utiliza 400 cuando no se indica estado HTTP", () => {
  const error = new AppError({
    code: "CODIGO_INVALIDO",
    message: "El código es inválido.",
  });

  assert.equal(error.statusCode, 400);
});

test("rechaza códigos y mensajes inválidos", () => {
  for (const valor of [undefined, null, "", "   ", 123]) {
    assert.throws(
      () => new AppError({
        code: valor,
        message: "Mensaje válido",
      }),
      TypeError
    );

    assert.throws(
      () => new AppError({
        code: "ERROR_VALIDO",
        message: valor,
      }),
      TypeError
    );
  }
});

test("rechaza estados HTTP inválidos", () => {
  for (const statusCode of [200, 399, 600, 404.5, "404", null]) {
    assert.throws(
      () => new AppError({
        code: "ERROR_VALIDO",
        message: "Mensaje válido",
        statusCode,
      }),
      TypeError
    );
  }
});