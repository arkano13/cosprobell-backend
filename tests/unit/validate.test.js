import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { validate } from "../../src/middleware/validate.js";

function crearRespuesta() {
  return {
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

test("valida y transforma parámetros, query y cuerpo", () => {
  const middleware = validate({
    params: z.object({
      id: z.coerce.number().int().positive(),
    }),
    query: z.object({
      limit: z.coerce.number().int().positive(),
    }),
    body: z.object({
      codigo: z.string().trim().min(1),
    }),
  });

  const req = {
    params: { id: "5" },
    query: { limit: "10" },
    body: { codigo: " 00123 " },
  };

  const queryOriginal = req.query;
  const res = crearRespuesta();
  let continuaciones = 0;

  middleware(req, res, (error) => {
    assert.equal(error, undefined);
    continuaciones++;
  });

  assert.deepEqual(req.params, { id: 5 });
  assert.deepEqual(req.validatedQuery, { limit: 10 });
  assert.deepEqual(req.body, { codigo: "00123" });
  assert.equal(req.query, queryOriginal);
  assert.equal(continuaciones, 1);
  assert.equal(res.statusCode, null);
});

test("rechaza datos inválidos sin continuar", () => {
  const middleware = validate({
    body: z.object({
      codigo: z.string().min(1),
    }),
  });

  const req = { body: { codigo: "" } };
  const res = crearRespuesta();
  let continuo = false;

  middleware(req, res, () => {
    continuo = true;
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Datos de entrada invalidos");
  assert.equal(res.body.detalles[0].campo, "codigo");
  assert.equal(continuo, false);
});

test("envía los fallos inesperados al manejador central", () => {
  const fallo = new Error("Fallo de programación simulado");

  const middleware = validate({
    body: {
      parse() {
        throw fallo;
      },
    },
  });

  const res = crearRespuesta();
  let errorRecibido;

  middleware({ body: {} }, res, (error) => {
    errorRecibido = error;
  });

  assert.equal(errorRecibido, fallo);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});

test("no modifica los parámetros si después falla el cuerpo", () => {
  const middleware = validate({
    params: z.object({
      id: z.coerce.number().int().positive(),
    }),
    body: z.object({
      codigo: z.string().min(1),
    }),
  });

  const req = {
    params: { id: "5" },
    body: { codigo: "" },
  };

  const res = crearRespuesta();

  middleware(req, res, () => {
    assert.fail("No debe continuar con datos inválidos");
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(req.params, { id: "5" });
});