import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { operadoresRepository: repo } = await import("../../src/modules/operadores/operadores.repository.js");
const { pedidosRepository } = await import("../../src/modules/pedidos/pedidos.repository.js");
const { datosInicio } = await import("../../src/modules/picking/picking.controller.js");
const { hashPin } = await import("../../src/shared/security/pin.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre]; objeto[nombre] = implementacion; t.after(() => { objeto[nombre] = original; });
}
function conClave(t, { nombre = "app-bodega", alcance = "ingreso" } = {}) {
  sustituir(t, prisma.apiKey, "findUnique", async () => ({ id: 1, activa: true, nombre, alcance }));
  sustituir(t, prisma.apiKey, "update", async () => ({}));
  return { "X-API-Key": "clave-ficticia", "Content-Type": "application/json" };
}
const TOKEN = "a".repeat(64);
function conSesion(t, { activo = true, cerradaEn = null, expiraEn = new Date(Date.now() + 3600000) } = {}) {
  t.mock.method(repo, "buscarSesion", async (tokenHash) => (tokenHash === hashApiKey(TOKEN)
    ? { id: 5, cerradaEn, expiraEn, operador: { id: 7, nombre: "Ana López", activo } } : null));
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}
const pedir = (ruta, headers, opciones = {}) => fetch(`${url}${ruta}`, { headers, ...opciones });

test("la lista de operadores pide una clave; la de solo ingreso sirve", async (t) => {
  assert.equal((await pedir("/ingreso/operadores", {})).status, 401);
  t.mock.method(repo, "listarActivos", async () => [{ id: 7, nombre: "Ana López" }]);
  const r = await pedir("/ingreso/operadores", conClave(t));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { data: [{ id: 7, nombre: "Ana López" }] });
});

test("la clave de solo ingreso no llega a los datos", async (t) => {
  const headers = conClave(t);
  for (const ruta of ["/pedidos", "/picking/1", "/productos", "/clientes"]) {
    assert.equal((await pedir(ruta, headers)).status, 403, ruta);
  }
});

test("inicio de sesión: valida el cuerpo, rechaza PIN incorrecto y entrega el token", async (t) => {
  const headers = conClave(t);
  const operador = { id: 7, nombre: "Ana López", pinHash: hashPin("4827"), activo: true, intentosFallidos: 0, bloqueadoHasta: null };
  t.mock.method(repo, "buscarPorId", async () => ({ ...operador }));
  t.mock.method(repo, "sumarIntentoFallido", async () => 1);
  const creadas = [];
  t.mock.method(repo, "crearSesion", async (datos) => { creadas.push(datos); });
  const enviar = (cuerpo) => pedir("/ingreso/sesion", headers, { method: "POST", body: JSON.stringify(cuerpo) });

  assert.equal((await enviar({ operadorId: 7, pin: "48a7" })).status, 400);
  assert.equal((await enviar({ operadorId: 7, pin: "4827", extra: 1 })).status, 400);
  const mal = await enviar({ operadorId: 7, pin: "0000" });
  assert.equal(mal.status, 401);
  assert.deepEqual(await mal.json(), { error: { code: "PIN_INCORRECTO", message: "PIN incorrecto" } });
  const bien = await enviar({ operadorId: 7, pin: "4827" });
  assert.equal(bien.status, 201);
  const { data } = await bien.json();
  assert.match(data.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(data.operador, { id: 7, nombre: "Ana López", rol: "operador" });
  assert.equal(creadas[0].aplicacion, "app-bodega");
  assert.equal(creadas[0].tokenHash, hashApiKey(data.token));
});

test("con sesión de operador: pedidos y picking sí, el resto no", async (t) => {
  const headers = conSesion(t);
  t.mock.method(pedidosRepository, "listar", async () => []);
  assert.equal((await pedir("/pedidos", headers)).status, 200);
  for (const ruta of ["/productos", "/clientes", "/etiquetas", "/facturas", "/pagos", "/bodegas"]) {
    assert.equal((await pedir(ruta, headers)).status, 403, ruta);
  }
});

test("sesión inválida, vencida, cerrada o de operador desactivado: 401", async (t) => {
  assert.equal((await pedir("/pedidos", { Authorization: "Bearer otro" })).status, 401);
  for (const caso of [{ expiraEn: new Date(Date.now() - 1000) }, { cerradaEn: new Date() }, { activo: false }]) {
    const headers = conSesion(t, caso);
    const r = await pedir("/pedidos", headers);
    assert.equal(r.status, 401, JSON.stringify(caso));
    assert.match((await r.json()).error, /PIN/);
    t.mock.restoreAll();
  }
});

test("cerrar sesión solo con sesión de operador", async (t) => {
  const cerradas = [];
  t.mock.method(repo, "cerrarSesion", async (id) => { cerradas.push(id); });
  const headers = conSesion(t);
  assert.equal((await pedir("/ingreso/sesion", headers, { method: "DELETE" })).status, 204);
  assert.deepEqual(cerradas, [5]);
  t.mock.restoreAll();
  assert.equal((await pedir("/ingreso/sesion", conClave(t, { alcance: "completo" }), { method: "DELETE" })).status, 400);
});

test("al iniciar una preparación, el preparador es el operador de la sesión", () => {
  assert.deepEqual(datosInicio({ operador: { id: 7, nombre: "Ana López" }, body: { pedidoDocEntry: 9, usuarioId: "otro" } }),
    { pedidoDocEntry: 9, usuarioId: "Ana López" });
  assert.deepEqual(datosInicio({ body: { pedidoDocEntry: 9, usuarioId: "equipo" } }), { pedidoDocEntry: 9, usuarioId: "equipo" });
});

test("las claves existentes (alcance completo o sin alcance) siguen funcionando igual", async (t) => {
  t.mock.method(pedidosRepository, "listar", async () => []);
  assert.equal((await pedir("/pedidos", conClave(t, { alcance: "completo" }))).status, 200);
  sustituir(t, prisma.apiKey, "findUnique", async () => ({ id: 2, activa: true, nombre: "vieja" }));
  assert.equal((await pedir("/pedidos", { "X-API-Key": "x" })).status, 200);
});
