import test from "node:test";
import assert from "node:assert/strict";

import { createShutdown } from "../../src/infrastructure/shutdown.js";

const logger = {
  info() {},
  error() {},
};

test("cierra HTTP antes de desconectar la base", async () => {
  const pasos = [];
  let finalizarHttp;
  let terminar;

  const terminado = new Promise((resolve) => {
    terminar = resolve;
  });

  const shutdown = createShutdown({
    server: {
      close(callback) {
        pasos.push("cerrar-http");
        finalizarHttp = callback;
      },
    },
    prisma: {
      async $disconnect() {
        pasos.push("desconectar-base");
      },
    },
    logger,
    exit(code) {
      pasos.push(`salir-${code}`);
      terminar();
    },
  });

  shutdown("SIGTERM");

  assert.deepEqual(pasos, ["cerrar-http"]);

  finalizarHttp();
  await terminado;

  assert.deepEqual(pasos, [
    "cerrar-http",
    "desconectar-base",
    "salir-0",
  ]);
});

test("no inicia dos cierres por señales repetidas", async () => {
  let cierres = 0;
  let finalizarHttp;

  const shutdown = createShutdown({
    server: {
      close(callback) {
        cierres++;
        finalizarHttp = callback;
      },
    },
    prisma: {
      async $disconnect() {},
    },
    logger,
    exit() {},
  });

  shutdown("SIGINT");
  shutdown("SIGTERM");

  assert.equal(cierres, 1);

  await finalizarHttp();
});

test("sale con error si falla la desconexión", async () => {
  let finalizarHttp;
  let codigoSalida;

  const shutdown = createShutdown({
    server: {
      close(callback) {
        finalizarHttp = callback;
      },
    },
    prisma: {
      async $disconnect() {
        throw new Error("Fallo simulado");
      },
    },
    logger,
    exit(code) {
      codigoSalida = code;
    },
  });

  shutdown("SIGTERM");
  await finalizarHttp();

  assert.equal(codigoSalida, 1);
});

test("intenta desconectar la base aunque falle el cierre HTTP", async () => {
  let finalizarHttp;
  let desconectado = false;
  let codigoSalida;

  const shutdown = createShutdown({
    server: {
      close(callback) {
        finalizarHttp = callback;
      },
    },
    prisma: {
      async $disconnect() {
        desconectado = true;
      },
    },
    logger,
    exit(code) {
      codigoSalida = code;
    },
  });

  shutdown("SIGTERM");
  await finalizarHttp(new Error("Fallo HTTP simulado"));

  assert.equal(desconectado, true);
  assert.equal(codigoSalida, 1);
});

test("sale con error cuando se agota el tiempo", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let codigoSalida;

  const shutdown = createShutdown({
    server: {
      close() {
        // Simulamos peticiones que nunca terminan.
      },
    },
    prisma: {
      async $disconnect() {},
    },
    logger,
    timeoutMs: 100,
    exit(code) {
      codigoSalida = code;
    },
  });

  shutdown("SIGTERM");

  t.mock.timers.tick(99);
  assert.equal(codigoSalida, undefined);

  t.mock.timers.tick(1);
  assert.equal(codigoSalida, 1);
});