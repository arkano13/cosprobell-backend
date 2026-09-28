import test from "node:test";
import assert from "node:assert/strict";

import { parseEnv } from "../../src/config/env.schema.js";

const databaseUrl =
  "postgresql://usuario:clave@localhost:5432/cosprobell_test";

test("aplica valores predeterminados", () => {
  const env = parseEnv({
    DATABASE_URL: databaseUrl,
  });

  assert.equal(env.nodeEnv, "development");
  assert.equal(env.port, 3000);
  assert.equal(env.databaseUrl, databaseUrl);
  assert.ok(Object.isFrozen(env));
});

test("acepta un entorno y puerto explícitos", () => {
  const env = parseEnv({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "production",
    PORT: "8080",
  });

  assert.equal(env.nodeEnv, "production");
  assert.equal(env.port, 8080);
});

test("rechaza una conexión ausente o inválida", () => {
  for (const valor of [
    undefined,
    "",
    "   ",
    "texto-invalido",
    "https://localhost/base",
    "postgresql://localhost",
  ]) {
    assert.throws(
      () => parseEnv({ DATABASE_URL: valor }),
      /DATABASE_URL/
    );
  }
});

test("rechaza puertos inválidos", () => {
  for (const port of [
    "",
    "0",
    "65536",
    "-1",
    "3000.5",
    "abc",
  ]) {
    assert.throws(
      () => parseEnv({
        DATABASE_URL: databaseUrl,
        PORT: port,
      }),
      /PORT/
    );
  }
});

test("rechaza un entorno desconocido", () => {
  assert.throws(
    () => parseEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "prod",
    }),
    /NODE_ENV/
  );
});

test("el secreto del sincronizador es opcional pero debe ser largo", () => {
  assert.equal(parseEnv({ DATABASE_URL: databaseUrl }).bridgeSecret, undefined);

  const secreto = "x".repeat(32);
  assert.equal(
    parseEnv({ DATABASE_URL: databaseUrl, BRIDGE_SECRET: secreto }).bridgeSecret,
    secreto
  );

  assert.throws(
    () => parseEnv({ DATABASE_URL: databaseUrl, BRIDGE_SECRET: "corto-secreto" }),
    (error) => {
      assert.match(error.message, /BRIDGE_SECRET/);
      assert.equal(error.message.includes("corto-secreto"), false);
      return true;
    }
  );
});

test("el mensaje de error no revela credenciales", () => {
  const secreto = "CLAVE_QUE_NO_DEBE_APARECER";

  assert.throws(
    () => parseEnv({
      DATABASE_URL:
        `https://usuario:${secreto}@localhost/base`,
    }),
    (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.equal(error.message.includes(secreto), false);
      return true;
    }
  );
});