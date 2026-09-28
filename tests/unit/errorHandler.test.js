import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../../src/shared/errors/AppError.js";
import errorHandler from "../../src/middleware/errorHandler.js";

function crearRespuesta() {
  return {
    headersSent: false,
    statusCode: null,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("devuelve el código y mensaje de un error conocido", () => {
  const res = crearRespuesta();

  const error = new AppError({
    code: "PRODUCTO_NO_ENCONTRADO",
    message: "El producto no existe.",
    statusCode: 404,
  });

  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 404);

  assert.deepEqual(res.body, {
    error: {
      code: "PRODUCTO_NO_ENCONTRADO",
      message: "El producto no existe.",
    },
  });
});

test("oculta un fallo inesperado y lo registra", () => {
  const res = crearRespuesta();
  const error = new Error("Detalle privado de PostgreSQL");

  let errorRegistrado;

  const req = {
    log: {
      error(datos) {
        errorRegistrado = datos.err;
      },
    },
  };

  errorHandler(error, req, res, () => {});

  assert.equal(errorRegistrado, error);
  assert.equal(res.statusCode, 500);

  assert.deepEqual(res.body, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  });
});

test("oculta también el detalle de un AppError interno", () => {
  const res = crearRespuesta();

  const error = new AppError({
    code: "DATABASE_UNAVAILABLE",
    message: "Detalle privado de conexión",
    statusCode: 503,
  });

  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 503);

  assert.deepEqual(res.body, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  });
});

test("delega si la respuesta ya empezó a enviarse", () => {
  const res = crearRespuesta();
  res.headersSent = true;

  const error = new Error("Fallo durante la respuesta");
  let errorDelegado;

  errorHandler(error, {}, res, (recibido) => {
    errorDelegado = recibido;
  });

  assert.equal(errorDelegado, error);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});