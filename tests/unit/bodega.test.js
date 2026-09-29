import test from "node:test";
import assert from "node:assert/strict";
import { crearApi, ErrorApi } from "../../public/bodega/js/api.js";
import { crearColaLecturas } from "../../public/bodega/js/lecturas.js";
import { nuevoUuid } from "../../public/bodega/js/uuid.js";

const sinEspera = async () => {};
const temporal = () => new ErrorApi({ mensaje: "Sin conexión con el servidor", temporal: true });

test("uuid: formato v4 válido para operacionId y distinto en cada lectura", () => {
  const a = nuevoUuid(), b = nuevoUuid();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test("api: envía la clave, arma rutas y normaliza los dos formatos de error", async () => {
  const pedidos = [];
  const respuestas = [
    Response.json({ data: [], siguienteCursor: null }),
    Response.json({ error: "Ese producto no pertenece a este pedido" }, { status: 409 }),
    Response.json({ error: { code: "PEDIDO_NO_ENCONTRADO", message: "Pedido no encontrado" } }, { status: 404 }),
    new Response("sin json", { status: 503 }),
  ];
  const api = crearApi({ clave: "clave-equipo", fetchImpl: async (url, opciones) => { pedidos.push([url, opciones]); return respuestas.shift(); } });
  await api.pedidos(15);
  assert.equal(pedidos[0][0], "/pedidos?estado=abiertos&limit=25&cursor=15");
  assert.equal(pedidos[0][1].headers["X-API-Key"], "clave-equipo");
  await assert.rejects(api.escanear(7, "740", "uuid"), (e) => e instanceof ErrorApi && e.status === 409 && e.mensaje === "Ese producto no pertenece a este pedido" && !e.temporal);
  assert.deepEqual(JSON.parse(pedidos[1][1].body), { codigo: "740", operacionId: "uuid" });
  await assert.rejects(api.pedido(9), (e) => e.codigo === "PEDIDO_NO_ENCONTRADO" && e.mensaje === "Pedido no encontrado");
  await assert.rejects(api.sesion(1), (e) => e.status === 503 && e.temporal === true);
});

test("api: sin red o sin respuesta a tiempo es un error temporal", async () => {
  const sinRed = crearApi({ clave: "x", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(sinRed.pedidos(), (e) => e.temporal === true && e.status === 0);
  const lenta = crearApi({ clave: "x", tiempoMs: 20, fetchImpl: (_url, { signal }) => new Promise((_r, rechazar) => signal.addEventListener("abort", () => rechazar(new Error("abortado")))) });
  await assert.rejects(lenta.pedidos(), (e) => e.temporal === true);
});

test("cola: envía en orden, de a una, y conserva el operacionId en los reintentos", async () => {
  const enviados = []; let fallar = 2; let enVuelo = 0, maxEnVuelo = 0;
  const cola = crearColaLecturas({ esperar: sinEspera, enviar: async (l) => {
    enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    await new Promise((r) => setTimeout(r, 1));
    enVuelo--; enviados.push([l.codigo, l.operacionId]);
    if (l.codigo === "A" && fallar-- > 0) throw temporal();
    return { data: l.codigo };
  } });
  const a = cola.agregar("A"); const b = cola.agregar("B"); cola.agregar("C");
  await cola.procesar();
  assert.deepEqual(enviados.map(([c]) => c), ["A", "A", "A", "B", "C"]);
  assert.ok(enviados.filter(([c]) => c === "A").every(([, op]) => op === a.operacionId));
  assert.notEqual(a.operacionId, b.operacionId);
  assert.equal(maxEnVuelo, 1);
  assert.equal(cola.pendientes, 0);
});

test("cola: una lectura rechazada se descarta y la siguiente continúa", async () => {
  const eventos = [];
  const cola = crearColaLecturas({ esperar: sinEspera, alCambiar: (e) => eventos.push(e.tipo),
    enviar: async (l) => { if (l.codigo === "MAL") throw new ErrorApi({ status: 409, mensaje: "no" }); return { data: 1 }; } });
  cola.agregar("MAL"); cola.agregar("BIEN");
  await cola.procesar();
  assert.deepEqual(eventos.filter((t) => ["aceptada", "rechazada"].includes(t)), ["rechazada", "aceptada"]);
});

test("cola: sin conexión persistente se detiene, guarda las lecturas y las reanuda sin duplicar", async () => {
  let guardado = []; let conectado = false; const recibidos = new Map();
  const enviar = async (l) => {
    if (!conectado) throw temporal();
    recibidos.set(l.operacionId, (recibidos.get(l.operacionId) ?? 0) + 1);
    return { data: l.codigo };
  };
  const cola = crearColaLecturas({ esperar: sinEspera, reintentos: 2, enviar, guardar: (p) => { guardado = p; } });
  const a = cola.agregar("A"); cola.agregar("B");
  await cola.procesar();
  assert.equal(cola.detenida, true);
  assert.deepEqual(guardado.map((l) => l.codigo), ["A", "B"]);
  assert.equal(guardado[0].operacionId, a.operacionId);
  // Se recarga la página: una cola nueva retoma las lecturas guardadas con sus mismos operacionId.
  conectado = true;
  const nueva = crearColaLecturas({ esperar: sinEspera, enviar, guardar: (p) => { guardado = p; }, pendientes: guardado });
  await nueva.procesar();
  assert.deepEqual([...recibidos.keys()][0], a.operacionId);
  assert.deepEqual([...recibidos.values()], [1, 1]);
  assert.deepEqual(guardado, []);
});

test("cola: una clave rechazada detiene la cola sin perder la lectura", async () => {
  const cola = crearColaLecturas({ esperar: sinEspera, enviar: async () => { throw new ErrorApi({ status: 401, mensaje: "clave" }); } });
  cola.agregar("A");
  await cola.procesar();
  assert.equal(cola.detenida, true);
  assert.equal(cola.pendientes, 1);
});
