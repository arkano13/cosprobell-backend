import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { crearClienteBackend, ErrorBackend } from "../src/backend.js";
// Verifica con el código del backend real que ambas firmas coinciden.
import { firmaValida } from "../../src/shared/security/firma.js";

const secreto = "secreto-compartido-".padEnd(40, "x");

const lote = {
  loteId: "3f2b8c1e-5d4a-4b7e-9c2f-1a6e8d0b4c3a",
  entidad: "Warehouses",
  registros: [{ WarehouseCode: "01" }],
};

async function iniciarBackendFalso(t, respuestas) {
  const recibidas = [];

  const servidor = http.createServer(async (req, res) => {
    let cuerpo = "";
    for await (const parte of req) cuerpo += parte;

    const valida = firmaValida(
      secreto,
      {
        marcaTiempo: req.headers["x-bridge-timestamp"],
        metodo: req.method,
        ruta: req.url,
        cuerpo,
      },
      req.headers["x-bridge-signature"] ?? ""
    );

    recibidas.push({ valida, cuerpo: JSON.parse(cuerpo), firma: req.headers["x-bridge-signature"] });

    const [status, respuesta] = respuestas[Math.min(recibidas.length - 1, respuestas.length - 1)];
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(respuesta));
  });

  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  t.after(() => new Promise((resolve) => servidor.close(resolve)));

  return { url: `http://127.0.0.1:${servidor.address().port}`, recibidas };
}

function cliente(url, esperas = []) {
  return crearClienteBackend({
    url,
    secreto,
    reintentos: 2,
    esperar: async (ms) => {
      esperas.push(ms);
    },
  });
}

test("envía el lote con una firma que el backend acepta", async (t) => {
  const backend = await iniciarBackendFalso(t, [[200, { data: { estado: "aplicado" } }]]);

  const resultado = await cliente(backend.url).enviarLote(lote);

  assert.deepEqual(resultado, { estado: "aplicado" });
  assert.equal(backend.recibidas.length, 1);
  assert.equal(backend.recibidas[0].valida, true);
  assert.deepEqual(backend.recibidas[0].cuerpo, lote);
});

test("reintenta errores del servidor con el mismo lote", async (t) => {
  const esperas = [];
  const backend = await iniciarBackendFalso(t, [
    [503, { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }],
    [500, { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } }],
    [200, { data: { estado: "duplicado" } }],
  ]);

  const resultado = await cliente(backend.url, esperas).enviarLote(lote);

  assert.deepEqual(resultado, { estado: "duplicado" });
  assert.deepEqual(esperas, [2000, 4000]);
  assert.equal(backend.recibidas.length, 3);
  assert.ok(backend.recibidas.every((recibida) => recibida.valida));
  assert.ok(backend.recibidas.every((recibida) => recibida.cuerpo.loteId === lote.loteId));
});

test("no reintenta un rechazo del lote y muestra los campos inválidos", async (t) => {
  const esperas = [];
  const backend = await iniciarBackendFalso(t, [
    [
      400,
      {
        error: "Datos de entrada invalidos",
        detalles: [{ campo: "registros.0.Inactive", mensaje: "Invalid option" }],
      },
    ],
  ]);

  await assert.rejects(cliente(backend.url, esperas).enviarLote(lote), (error) => {
    assert.ok(error instanceof ErrorBackend);
    assert.equal(error.status, 400);
    assert.match(error.message, /registros\.0\.Inactive: Invalid option/);
    return true;
  });

  assert.equal(backend.recibidas.length, 1);
  assert.deepEqual(esperas, []);
});

test("se rinde después de los reintentos si el backend no responde", async () => {
  const esperas = [];

  await assert.rejects(
    cliente("http://127.0.0.1:1", esperas).enviarLote(lote),
    /No se pudo contactar al backend/
  );

  assert.deepEqual(esperas, [2000, 4000]);
});
