import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// URL ficticia: el repositorio de sincronización está simulado.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.BRIDGE_SECRET = "secreto-de-prueba-".padEnd(40, "x");

const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
const { firmar } = await import("../../src/shared/security/firma.js");
const { sincronizacionRepository } = await import(
  "../../src/modules/sincronizacion/sincronizacion.repository.js"
);

logger.level = "silent";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  await prisma.$disconnect();
});

const loteBodegas = {
  loteId: "3f2b8c1e-5d4a-4b7e-9c2f-1a6e8d0b4c3a",
  entidad: "Warehouses",
  registros: [
    { WarehouseCode: "01", WarehouseName: "Principal", City: null, Country: "HN", Inactive: "tNO" },
  ],
};

function enviar(lote, { firma, marcaTiempo = String(Date.now()), cuerpo } = {}) {
  const texto = cuerpo ?? JSON.stringify(lote);

  return fetch(`${baseUrl}/sync/lotes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Timestamp": marcaTiempo,
      "X-Bridge-Signature":
        firma ??
        firmar(process.env.BRIDGE_SECRET, {
          marcaTiempo,
          metodo: "POST",
          ruta: "/sync/lotes",
          cuerpo: texto,
        }),
    },
    body: texto,
  });
}

function simularRepositorio(t) {
  const guardadas = [];

  t.mock.method(sincronizacionRepository, "enTransaccion", async (trabajo) => trabajo({}));
  t.mock.method(sincronizacionRepository, "registrarEjecucion", async () => ({ id: 1 }));
  t.mock.method(sincronizacionRepository, "registrarLote", async () => ({}));
  t.mock.method(sincronizacionRepository, "registrarError", async () => ({}));
  t.mock.method(sincronizacionRepository, "guardarBodega", async (_tx, bodega) => {
    guardadas.push(bodega);
  });

  return guardadas;
}

test("aplica un lote firmado sin requerir la API key de aplicaciones", async (t) => {
  const guardadas = simularRepositorio(t);

  const respuesta = await enviar(loteBodegas);

  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), {
    data: {
      estado: "aplicado",
      loteId: loteBodegas.loteId,
      entidad: "Warehouses",
      registros: 1,
    },
  });
  assert.deepEqual(guardadas, [
    { warehouseCode: "01", warehouseName: "Principal", city: null, country: "HN", inactive: false },
  ]);
});

test("rechaza un lote sin firma antes de procesarlo", async (t) => {
  const guardadas = simularRepositorio(t);

  const respuesta = await fetch(`${baseUrl}/sync/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loteBodegas),
  });

  assert.equal(respuesta.status, 401);
  assert.deepEqual(await respuesta.json(), {
    error: { code: "FIRMA_REQUERIDA", message: "Falta la firma del sincronizador" },
  });
  assert.equal(guardadas.length, 0);
});

test("rechaza un cuerpo distinto al firmado", async (t) => {
  const guardadas = simularRepositorio(t);
  const marcaTiempo = String(Date.now());
  const firma = firmar(process.env.BRIDGE_SECRET, {
    marcaTiempo,
    metodo: "POST",
    ruta: "/sync/lotes",
    cuerpo: JSON.stringify(loteBodegas),
  });

  const alterado = {
    ...loteBodegas,
    registros: [{ ...loteBodegas.registros[0], WarehouseName: "Alterada" }],
  };

  const respuesta = await enviar(alterado, { firma, marcaTiempo });

  assert.equal(respuesta.status, 401);
  assert.equal((await respuesta.json()).error.code, "FIRMA_INVALIDA");
  assert.equal(guardadas.length, 0);
});

test("rechaza una firma vencida", async (t) => {
  simularRepositorio(t);

  const respuesta = await enviar(loteBodegas, {
    marcaTiempo: String(Date.now() - 10 * 60 * 1000),
  });

  assert.equal(respuesta.status, 401);
  assert.equal((await respuesta.json()).error.code, "FIRMA_VENCIDA");
});

test("devuelve los campos inválidos de un lote firmado", async (t) => {
  const guardadas = simularRepositorio(t);
  const invalido = {
    ...loteBodegas,
    registros: [{ ...loteBodegas.registros[0], Inactive: "Y" }],
  };

  const respuesta = await enviar(invalido);

  assert.equal(respuesta.status, 400);
  assert.deepEqual((await respuesta.json()).detalles.map((d) => d.campo), [
    "registros.0.Inactive",
  ]);
  assert.equal(guardadas.length, 0);
});

test("las demás rutas siguen exigiendo la API key de aplicaciones", async () => {
  const respuesta = await fetch(`${baseUrl}/bodegas`);

  assert.equal(respuesta.status, 401);
});
