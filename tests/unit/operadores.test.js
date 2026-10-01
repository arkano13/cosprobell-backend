import test from "node:test";
import assert from "node:assert/strict";
import { hashPin, verificarPin, pinValido } from "../../src/shared/security/pin.js";
import { hashApiKey } from "../../src/shared/security/hash.js";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const {
  iniciarSesion, autenticarSesion, cerrarSesion,
  DURACION_SESION_MS, PAUSA_MS, BLOQUEO_INDEFINIDO,
} = await import("../../src/modules/operadores/operadores.service.js");

test("pin: solo 4 números; se guarda con sal y se verifica sin guardarlo en claro", () => {
  for (const malo of ["123", "12345", "12a4", " 1234", "", null, 1234]) assert.equal(pinValido(malo), false, String(malo));
  const a = hashPin("4827"), b = hashPin("4827");
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /4827/);
  assert.equal(verificarPin("4827", a), true);
  assert.equal(verificarPin("4828", a), false);
  assert.equal(verificarPin("4827", "otro-formato"), false);
  assert.equal(verificarPin("48271", a), false);
  assert.throws(() => hashPin("12"), /4 números/);
});

// Repositorio en memoria con un reloj controlado.
function escenario({ pin = "4827", activo = true } = {}) {
  let ahora = new Date("2026-09-29T10:00:00Z");
  const operador = { id: 7, nombre: "Ana López", pinHash: hashPin(pin), activo, intentosFallidos: 0, bloqueadoHasta: null };
  const sesiones = [];
  const repo = {
    buscarPorId: async (id) => (id === operador.id ? { ...operador } : null),
    sumarIntentoFallido: async () => ++operador.intentosFallidos,
    bloquear: async (_id, hasta) => { operador.bloqueadoHasta = hasta; },
    reiniciarIntentos: async () => { operador.intentosFallidos = 0; operador.bloqueadoHasta = null; },
    crearSesion: async (datos) => { sesiones.push({ id: sesiones.length + 1, cerradaEn: null, ...datos }); },
    buscarSesion: async (tokenHash) => {
      const s = sesiones.find((x) => x.tokenHash === tokenHash);
      return s && { ...s, operador: { id: operador.id, nombre: operador.nombre, activo: operador.activo } };
    },
    cerrarSesion: async (id, cuando) => { sesiones.find((x) => x.id === id).cerradaEn = cuando; },
  };
  const deps = { repo, ahora: () => ahora };
  return { operador, sesiones, deps, avanzar: (ms) => { ahora = new Date(ahora.getTime() + ms); } };
}
const intentar = (e, pin) => iniciarSesion({ operadorId: 7, pin, aplicacion: "app-bodega" }, e.deps);

test("ingreso correcto: sesión de un turno; en la base solo queda el hash del token", async () => {
  const e = escenario();
  const r = await intentar(e, "4827");
  assert.deepEqual(r.operador, { id: 7, nombre: "Ana López", rol: "operador" });
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.equal(r.expiraEn.getTime() - new Date("2026-09-29T10:00:00Z").getTime(), DURACION_SESION_MS);
  assert.equal(e.sesiones[0].tokenHash, hashApiKey(r.token));
  assert.notEqual(e.sesiones[0].tokenHash, r.token);
  assert.equal(e.sesiones[0].aplicacion, "app-bodega");
});

test("5 PIN incorrectos: pausa de 15 minutos en la que ni el correcto entra; luego vuelve a funcionar", async () => {
  const e = escenario();
  for (let i = 1; i <= 4; i++) await assert.rejects(intentar(e, "0000"), (err) => err.code === "PIN_INCORRECTO" && err.statusCode === 401);
  await assert.rejects(intentar(e, "0000"), (err) => err.code === "OPERADOR_EN_PAUSA" && err.statusCode === 429 && /15 minutos/.test(err.message));
  await assert.rejects(intentar(e, "4827"), (err) => err.code === "OPERADOR_EN_PAUSA");
  e.avanzar(PAUSA_MS - 60000);
  await assert.rejects(intentar(e, "4827"), (err) => /1 minuto\./.test(err.message));
  e.avanzar(60000);
  await intentar(e, "4827");
  assert.equal(e.operador.intentosFallidos, 0);
  assert.equal(e.operador.bloqueadoHasta, null);
});

test("10 PIN incorrectos seguidos: bloqueado hasta que el supervisor lo desbloquee", async () => {
  const e = escenario();
  for (let i = 1; i <= 5; i++) await intentar(e, "1111").catch(() => {});
  e.avanzar(PAUSA_MS);
  for (let i = 6; i <= 9; i++) await assert.rejects(intentar(e, "1111"), (err) => err.code === "PIN_INCORRECTO");
  await assert.rejects(intentar(e, "1111"), (err) => err.code === "OPERADOR_BLOQUEADO" && err.statusCode === 423);
  assert.equal(e.operador.bloqueadoHasta, BLOQUEO_INDEFINIDO);
  e.avanzar(30 * 24 * 60 * 60 * 1000);
  await assert.rejects(intentar(e, "4827"), (err) => err.code === "OPERADOR_BLOQUEADO");
});

test("operador inexistente o desactivado no ingresa", async () => {
  await assert.rejects(iniciarSesion({ operadorId: 99, pin: "4827" }, escenario().deps), (err) => err.code === "OPERADOR_NO_DISPONIBLE");
  await assert.rejects(intentar(escenario({ activo: false }), "4827"), (err) => err.code === "OPERADOR_NO_DISPONIBLE");
});

test("sesión: vigente, vencida, cerrada, operador desactivado y token mal formado", async () => {
  const e = escenario();
  const { token } = await intentar(e, "4827");
  assert.deepEqual(await autenticarSesion(token, e.deps), { sesionId: 1, operador: { id: 7, nombre: "Ana López", rol: "operador" } });
  assert.equal(await autenticarSesion("x".repeat(64), e.deps), null);
  assert.equal(await autenticarSesion(undefined, e.deps), null);
  e.operador.activo = false;
  assert.equal(await autenticarSesion(token, e.deps), null);
  e.operador.activo = true;
  await cerrarSesion(1, e.deps);
  assert.equal(await autenticarSesion(token, e.deps), null);
  const otra = await intentar(e, "4827");
  e.avanzar(DURACION_SESION_MS);
  assert.equal(await autenticarSesion(otra.token, e.deps), null);
});
