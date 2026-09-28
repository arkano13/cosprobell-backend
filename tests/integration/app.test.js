import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// Se prueban HTTP, autenticacion y validacion con persistencia simulada.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { productosRepository } = await import("../../src/modules/productos/productos.repository.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server;
let baseUrl;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
    server.closeAllConnections();
  });
  await prisma.$disconnect();
});

// Prisma expone metodos dinamicos mediante Proxy: se sustituyen y restauran
// directamente, ya que mock.method requiere descriptores de metodos propios.
function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre];
  objeto[nombre] = implementacion;
  t.after(() => { objeto[nombre] = original; });
}

function autenticar(t) {
  sustituir(t, prisma.apiKey, "findUnique", async () => ({ id: 1, activa: true, nombre: "prueba" }));
  sustituir(t, prisma.apiKey, "update", async () => ({}));
  return { "X-API-Key": "clave-ficticia-de-prueba" };
}

test("las rutas de negocio siguen requiriendo autenticacion", async () => {
  for (const ruta of ["/productos", "/bodegas", "/clientes", "/facturas", "/pagos", "/picking/1"]) {
    const respuesta = await fetch(`${baseUrl}${ruta}`);
    assert.equal(respuesta.status, 401, ruta);
    assert.deepEqual(await respuesta.json(), { error: "Falta la API key (header X-API-Key)" });
  }
});

test("GET productos conserva busqueda, limite y respuesta", async (t) => {
  const headers = autenticar(t);
  const productos = [{ itemCode: "A", itemName: "Agua", valid: true, quantityOnStock: 3 }];
  t.mock.method(productosRepository, "listar", async (filtro) => {
    assert.deepEqual(filtro, { q: "Agua", take: 2 });
    return productos;
  });
  const respuesta = await fetch(`${baseUrl}/productos?q=Agua&limit=2`, { headers });
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { data: productos });
});

test("un limite invalido se rechaza antes de consultar productos", async (t) => {
  const headers = autenticar(t);
  const consulta = t.mock.method(productosRepository, "listar", async () => []);
  const respuesta = await fetch(`${baseUrl}/productos?limit=101`, { headers });
  assert.equal(respuesta.status, 400);
  assert.equal((await respuesta.json()).error, "Datos de entrada invalidos");
  assert.equal(consulta.mock.callCount(), 0);
});

test("detalle inexistente conserva el 404", async (t) => {
  const headers = autenticar(t);
  t.mock.method(productosRepository, "buscarPorItemCode", async () => null);
  const respuesta = await fetch(`${baseUrl}/productos/NO-EXISTE`, { headers });
  assert.equal(respuesta.status, 404);
  assert.deepEqual(await respuesta.json(), { error: "Producto no encontrado" });
});

test("un fallo interno responde 500 sin exponer su detalle", async (t) => {
  const headers = autenticar(t);
  t.mock.method(productosRepository, "listar", async () => { throw new Error("detalle-interno-privado"); });
  const respuesta = await fetch(`${baseUrl}/productos`, { headers });
  assert.equal(respuesta.status, 500);
assert.deepEqual(await respuesta.json(), {
  error: {
    code: "INTERNAL_ERROR",
    message: "Error interno del servidor",
  },
});
});

test("health sigue siendo publico", async (t) => {
  sustituir(t, prisma, "$queryRaw", async () => [{ valor: 1 }]);
  const respuesta = await fetch(`${baseUrl}/health`);
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { status: "ok", db: "ok" });
});

test("health informa indisponibilidad sin exponer el fallo", async (t) => {
  sustituir(t, prisma, "$queryRaw", async () => { throw new Error("fallo simulado"); });
  const respuesta = await fetch(`${baseUrl}/health`);
  assert.equal(respuesta.status, 503);
  assert.deepEqual(await respuesta.json(), { status: "error", db: "unreachable" });
});
