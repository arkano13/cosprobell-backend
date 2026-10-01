import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
// La lista de pedidos pregunta si el supervisor la filtró por almacenes: en estas pruebas no hay filtro.
prisma.configuracion.findUnique = async () => null;
const { operadoresRepository: repo } = await import("../../src/modules/operadores/operadores.repository.js");
const { etiquetasRepository } = await import("../../src/modules/etiquetas/etiquetas.repository.js");
const { operadoresAdminRepository: adminRepo, listarOperadoresAdmin, crearOperador, cambiarPin, cambiarActivo } =
  await import("../../src/modules/operadores/operadores.admin.js");
const { listarRevisiones, revisionesRepository, anularRevision } = await import("../../src/modules/supervisor/revisiones.service.js");
const { estadoSincronizacion } = await import("../../src/modules/supervisor/sincronizacion.service.js");
const { BLOQUEO_INDEFINIDO } = await import("../../src/modules/operadores/operadores.service.js");
const { verificarPin } = await import("../../src/shared/security/pin.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre]; objeto[nombre] = implementacion; t.after(() => { objeto[nombre] = original; });
}
const TOKEN = "b".repeat(64);
function conSesion(t, rol) {
  t.mock.method(repo, "buscarSesion", async (tokenHash) => (tokenHash === hashApiKey(TOKEN)
    ? { id: 5, cerradaEn: null, expiraEn: new Date(Date.now() + 3600000), operador: { id: 9, nombre: "Carmen Díaz", activo: true, rol } } : null));
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}
const pedir = (ruta, headers, opciones = {}) => fetch(`${url}${ruta}`, { headers, ...opciones });
const enviar = (ruta, headers, metodo, cuerpo) => pedir(ruta, headers, { method: metodo, body: JSON.stringify(cuerpo) });

test("el panel es solo para supervisores con sesión de PIN", async (t) => {
  assert.equal((await pedir("/supervisor/sincronizacion")).status, 401);
  assert.equal((await pedir("/supervisor/sincronizacion", conSesion(t, "operador"))).status, 403);
  t.mock.restoreAll();
  sustituir(t, prisma.apiKey, "findUnique", async () => ({ id: 1, activa: true, nombre: "app", alcance: "completo" }));
  sustituir(t, prisma.apiKey, "update", async () => ({}));
  assert.equal((await pedir("/supervisor/sincronizacion", { "X-API-Key": "x" })).status, 403);
});

test("el ingreso devuelve el rol y la sesión del supervisor llega a pedidos y al panel, no al resto", async (t) => {
  const headers = conSesion(t, "supervisor");
  sustituir(t, prisma.pedido, "findMany", async () => []);
  assert.equal((await pedir("/pedidos", headers)).status, 200);
  assert.equal((await pedir("/productos", headers)).status, 403);
});

test("etiquetas: filtros y búsqueda llegan al repositorio; confirmar registra quién fue", async (t) => {
  const headers = conSesion(t, "supervisor");
  const consultas = [];
  t.mock.method(etiquetasRepository, "listar", async (q) => { consultas.push(q); return []; });
  assert.equal((await pedir("/supervisor/etiquetas?estado=desactualizadas&buscar=%20labial%20", headers)).status, 200);
  assert.equal((await pedir("/supervisor/etiquetas", headers)).status, 200);
  assert.equal((await pedir("/supervisor/etiquetas?estado=otra", headers)).status, 400);
  assert.deepEqual(consultas, [{ estado: "desactualizadas", buscar: "labial", limit: 50 }, { estado: "sin_confirmar", limit: 50 }]);

  const guardadas = [];
  t.mock.method(etiquetasRepository, "conEtiquetaBloqueada", async (_id, operacion) =>
    operacion({ tx: {}, etiqueta: { id: 3, itemCode: "P1", codigo: "7401", uomEntry: -1, retiradoEnSap: false } }));
  t.mock.method(etiquetasRepository, "guardarConfirmacion", async (c) => { guardadas.push(c); });
  t.mock.method(etiquetasRepository, "obtener", async () => ({ id: 3, confirmada: true, esUnidadIndividual: true, desactualizada: false }));
  const r = await enviar("/supervisor/etiquetas/3/confirmacion", headers, "PUT", { esUnidadIndividual: true });
  assert.equal(r.status, 200);
  assert.equal(guardadas[0].confirmadaPor, "operador:Carmen Díaz");
  assert.equal(guardadas[0].uomEntryConfirmado, -1);
});

test("confirmación masiva: solo si la cantidad sigue siendo la que vio el supervisor", async (t) => {
  const headers = conSesion(t, "supervisor");
  const llamadas = [];
  t.mock.method(etiquetasRepository, "confirmarManualPendientes", async (datos) => {
    llamadas.push(datos); return datos.cantidadEsperada === 12 ? { confirmadas: 12, disponibles: 12 } : { confirmadas: 0, disponibles: 12 };
  });
  const bien = await enviar("/supervisor/etiquetas/confirmacion-manual", headers, "POST", { cantidadEsperada: 12 });
  assert.equal(bien.status, 200); assert.deepEqual((await bien.json()).data, { confirmadas: 12 });
  const distinta = await enviar("/supervisor/etiquetas/confirmacion-manual", headers, "POST", { cantidadEsperada: 10 });
  assert.equal(distinta.status, 409); assert.equal((await distinta.json()).error.code, "CANTIDAD_CAMBIO");
  assert.equal((await enviar("/supervisor/etiquetas/confirmacion-manual", headers, "POST", { cantidadEsperada: 0 })).status, 400);
  assert.deepEqual(llamadas.map((l) => l.confirmadaPor), ["operador:Carmen Díaz", "operador:Carmen Díaz"]);
});

test("operadores: estado, alta con aviso de PIN fácil, duplicado, cambio de PIN y no desactivarse a sí mismo", async (t) => {
  const ahora = new Date("2026-10-01T15:00:00Z");
  t.mock.method(adminRepo, "listar", async () => [
    { id: 1, nombre: "Ana", rol: "operador", activo: true, intentosFallidos: 0, bloqueadoHasta: null, sesiones: [{ creadaEn: ahora }] },
    { id: 2, nombre: "Luis", rol: "operador", activo: true, intentosFallidos: 10, bloqueadoHasta: BLOQUEO_INDEFINIDO, sesiones: [] },
    { id: 3, nombre: "María", rol: "operador", activo: true, intentosFallidos: 5, bloqueadoHasta: new Date("2026-10-01T15:10:00Z"), sesiones: [] },
    { id: 4, nombre: "Pedro", rol: "operador", activo: false, intentosFallidos: 0, bloqueadoHasta: null, sesiones: [] },
    { id: 9, nombre: "Carmen", rol: "supervisor", activo: true, intentosFallidos: 0, bloqueadoHasta: null, sesiones: [] },
  ]);
  assert.deepEqual((await listarOperadoresAdmin({ ahora })).map((o) => [o.nombre, o.estado, o.rol, o.ultimoIngreso]),
    [["Ana", "activo", "operador", ahora], ["Luis", "bloqueado", "operador", null], ["María", "pausa", "operador", null],
      ["Pedro", "inactivo", "operador", null], ["Carmen", "activo", "supervisor", null]]);

  const creados = [];
  t.mock.method(adminRepo, "buscarPorNombre", async (nombre) => (nombre === "Ana López" ? { id: 1 } : null));
  t.mock.method(adminRepo, "crear", async (datos) => { creados.push(datos); return { id: 20, ...datos }; });
  const nuevo = await crearOperador({ nombre: "  Rosa   Mejía ", pin: "1111" });
  assert.deepEqual(nuevo.operador, { id: 20, nombre: "Rosa Mejía", rol: "operador" });
  assert.match(nuevo.advertencia, /fácil/);
  assert.ok(verificarPin("1111", creados[0].pinHash));
  await assert.rejects(crearOperador({ nombre: "Ana López", pin: "4827" }), { code: "OPERADOR_DUPLICADO" });
  await assert.rejects(crearOperador({ nombre: "X", pin: "4827" }), { code: "NOMBRE_INVALIDO" });
  await assert.rejects(crearOperador({ nombre: "Rosa", pin: "4827", rol: "jefe" }), { code: "ROL_INVALIDO" });

  const cambios = [];
  t.mock.method(adminRepo, "buscarPorId", async (id) => ({ id, nombre: id === 9 ? "Carmen" : "Luis" }));
  t.mock.method(adminRepo, "actualizar", async (id, data, opciones) => { cambios.push({ id, data, opciones }); });
  await cambiarPin(9, "5093", { exceptoSesionId: 5 });
  assert.equal(cambios[0].data.intentosFallidos, 0); assert.equal(cambios[0].data.bloqueadoHasta, null);
  assert.deepEqual(cambios[0].opciones, { cerrarSesiones: true, exceptoSesionId: 5 });
  await assert.rejects(cambiarActivo(9, false, { actorId: 9 }), { code: "NO_DESACTIVAR_PROPIO" });
  await cambiarActivo(2, false, { actorId: 9 });
  assert.deepEqual(cambios.at(-1), { id: 2, data: { activo: false }, opciones: { cerrarSesiones: true } });
});

test("operadores por HTTP: el PIN se valida y la sesión de quien lo cambia sigue abierta", async (t) => {
  const headers = conSesion(t, "supervisor");
  const cambios = [];
  t.mock.method(adminRepo, "buscarPorId", async (id) => ({ id, nombre: "Carmen" }));
  t.mock.method(adminRepo, "actualizar", async (id, data, opciones) => { cambios.push(opciones); });
  assert.equal((await enviar("/supervisor/operadores/9/pin", headers, "PUT", { pin: "12a4" })).status, 400);
  const r = await enviar("/supervisor/operadores/9/pin", headers, "PUT", { pin: "4827" });
  assert.equal(r.status, 200);
  assert.deepEqual(cambios, [{ cerrarSesiones: true, exceptoSesionId: 5 }]);
  const propio = await enviar("/supervisor/operadores/9/activo", headers, "PUT", { activo: false });
  assert.equal(propio.status, 409);
});

const lineaSesion = (n, itemCode, cantidadPedida, cantidadEscaneada = 0) =>
  ({ pedidoLineNum: n, itemCode, cantidadPedida, cantidadEscaneada, uomEntry: -1, uomCode: "Manual" });
const lineaPedido = (lineNum, itemCode, cantidad) => ({ lineNum, itemCode, quantity: cantidad, lineStatus: "bost_Open", uomEntry: -1, uomCode: "Manual",
  remainingOpenQuantity: cantidad, inventoryQuantity: cantidad, remainingOpenInventoryQuantity: cantidad });
const pedidoAbierto = (docEntry, lineas) => ({ docEntry, docNum: docEntry + 1000, cardCode: "C1", cliente: { cardName: "Cliente" },
  docType: "dDocument_Items", documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo", lineas });

test("revisiones: qué cambió en SAP, finalizados con diferencias y preparados sin entrega", async () => {
  const ahora = new Date("2026-10-02T12:00:00Z");
  const repoFalso = {
    enRevision: async () => [
      { id: 1, pedidoDocEntry: 10, usuarioId: "Ana", fechaInicio: ahora, lineas: [lineaSesion(0, "P1", 4, 3), lineaSesion(1, "P2", 2), lineaSesion(2, "P3", 1)] },
      { id: 2, pedidoDocEntry: 11, usuarioId: "Luis", fechaInicio: ahora, lineas: [lineaSesion(0, "P1", 1)] },
    ],
    finalizadasAbiertas: async () => [
      { id: 3, pedidoDocEntry: 12, estado: "con_diferencias", usuarioId: "Ana", fechaFin: new Date("2026-10-02T10:00:00Z"), lineas: [lineaSesion(0, "P1", 9, 2)] },
      { id: 4, pedidoDocEntry: 13, estado: "completo", usuarioId: "Ana", fechaFin: new Date("2026-10-01T10:00:00Z"), lineas: [lineaSesion(0, "P1", 1, 1)] },
      { id: 5, pedidoDocEntry: 14, estado: "completo", usuarioId: "Ana", fechaFin: new Date("2026-10-02T11:00:00Z"), lineas: [lineaSesion(0, "P1", 1, 1)] },
    ],
    pedidos: async () => [
      pedidoAbierto(10, [lineaPedido(0, "P1", 6), lineaPedido(1, "P2", 2), lineaPedido(3, "P4", 5)]),
      { ...pedidoAbierto(11, [lineaPedido(0, "P1", 1)]), documentStatus: "bost_Close" },
      pedidoAbierto(12, []), pedidoAbierto(13, []), pedidoAbierto(14, []),
    ],
    nombresProductos: async () => [{ itemCode: "P1", itemName: "Protector" }],
  };
  const r = await listarRevisiones({ repo: repoFalso, ahora });
  const [cambios, cerrado] = r.enRevision;
  assert.equal(cambios.motivo, "CAMBIOS_EN_SAP"); assert.equal(cambios.pedidoAbierto, true);
  assert.deepEqual(cambios.cambios, [
    { itemCode: "P1", antes: 4, ahora: 6, itemName: "Protector" },
    { itemCode: "P3", antes: 1, ahora: null, itemName: null },
    { itemCode: "P4", antes: null, ahora: 5, itemName: null },
  ]);
  assert.deepEqual([cambios.unidadesPreparadas, cambios.unidadesPedidas], [3, 7]);
  assert.deepEqual([cerrado.motivo, cerrado.pedidoAbierto, cerrado.cambios], ["PEDIDO_CERRADO", false, []]);
  assert.deepEqual(r.conDiferencias.map((f) => f.pickingId), [3]);
  assert.deepEqual(r.sinEntrega.map((f) => [f.pickingId, f.horasSinEntrega]), [[4, 26]]);
});

test("anular: solo una preparación que sigue en revisión, dentro del bloqueo del pedido", async (t) => {
  sustituir(t, prisma.pickingPedido, "findUnique", async () => ({ pedidoDocEntry: 10 }));
  const actualizadas = [];
  const tx = { pickingPedido: { update: async (args) => { actualizadas.push(args); } } };
  const picking = (estado) => ({ conPedidoBloqueado: async (docEntry, operacion) => { assert.equal(docEntry, 10); return operacion(tx); },
    buscarSesionesDelPedido: async () => [{ id: 1, estado }] });
  const fin = new Date("2026-10-02T12:00:00Z");
  assert.deepEqual(await anularRevision(1, { picking: picking("requiere_revision"), ahora: () => fin }), { pickingId: 1, estado: "anulada" });
  assert.deepEqual(actualizadas, [{ where: { id: 1 }, data: { estado: "anulada", fechaFin: fin } }]);
  await assert.rejects(anularRevision(1, { picking: picking("completo") }), { code: "PICKING_NO_EN_REVISION" });
  sustituir(t, prisma.pickingPedido, "findUnique", async () => null);
  await assert.rejects(anularRevision(99, { picking: picking("requiere_revision") }), { code: "PICKING_NO_ENCONTRADO" });
});

test("sincronización: última recepción por tipo de dato y cantidad de registros", async () => {
  const f = (iso) => new Date(iso);
  const repoFalso = { leer: async () => ({
    clientes: { _count: { _all: 1240 }, _max: { sincronizadoEn: f("2026-10-02T09:00:00Z") } },
    productos: { _count: { _all: 2315 }, _max: { sincronizadoEn: f("2026-10-02T09:00:00Z") } },
    pedidos: { _max: { sincronizadoEn: f("2026-10-02T11:56:00Z") } }, pedidosAbiertos: 37,
    codigos: { _count: { _all: 3020 }, _max: { sincronizadoEn: null } }, unidades: 18,
    estados: [{ entidad: "codigosBarras", empresa: "PRUEBAS", actualizadoEn: f("2026-10-01T10:00:00Z") },
      { entidad: "pedidos", empresa: "PRUEBAS", actualizadoEn: f("2026-10-02T11:50:00Z") },
      { entidad: "salidasInventario", empresa: "PRUEBAS", actualizadoEn: f("2026-10-02T08:00:00Z") },
      { entidad: "entradasCompra", empresa: "PRUEBAS", actualizadoEn: f("2026-10-02T07:00:00Z") }],
    almacenes: { _count: { _all: 20 }, _max: { sincronizadoEn: f("2026-10-02T06:00:00Z") } },
    existencias: { productos: 812, actualizadoEn: f("2026-10-02T11:40:00Z") },
    documentos: { _count: { _all: 64 }, _max: { sincronizadoEn: null } },
  }) };
  const r = await estadoSincronizacion({ repo: repoFalso });
  assert.equal(r.empresa, "PRUEBAS");
  assert.deepEqual(r.entidades.map((e) => [e.entidad, e.registros, e.ultimaRecepcion?.toISOString() ?? null]), [
    ["pedidos", 37, "2026-10-02T11:56:00.000Z"], ["clientes", 1240, "2026-10-02T09:00:00.000Z"],
    ["productos", 2315, "2026-10-02T09:00:00.000Z"], ["unidades", 18, null], ["codigosBarras", 3020, "2026-10-01T10:00:00.000Z"],
    ["almacenes", 20, "2026-10-02T06:00:00.000Z"], ["existencias", 812, "2026-10-02T11:40:00.000Z"],
    // Documentos: el lote más reciente de cualquiera de los cinco tipos.
    ["documentos", 64, "2026-10-02T08:00:00.000Z"],
  ]);
});

test("revisiones por HTTP usa el repositorio real de revisiones", async (t) => {
  const headers = conSesion(t, "supervisor");
  t.mock.method(revisionesRepository, "enRevision", async () => []);
  t.mock.method(revisionesRepository, "finalizadasAbiertas", async () => []);
  const r = await pedir("/supervisor/revisiones", headers);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data, { enRevision: [], conDiferencias: [], sinEntrega: [] });
});

test("una preparación anulada queda en el historial y no impide empezar otra con unidad Manual", async (t) => {
  const { pickingRepository } = await import("../../src/modules/picking/picking.repository.js");
  const { iniciarPicking } = await import("../../src/modules/picking/picking.service.js");
  t.mock.method(pickingRepository, "conPedidoBloqueado", async (_id, operacion) => operacion(prisma));
  t.mock.method(pickingRepository, "buscarPedidoConLineas", async () => pedidoAbierto(10, [lineaPedido(0, "P1", 2)]));
  t.mock.method(pickingRepository, "buscarSesionesDelPedido", async () => [{ id: 1, estado: "anulada", lineas: [] }]);
  const creadas = [];
  t.mock.method(pickingRepository, "crearSesion", async (datos) => { creadas.push(datos); return { id: 2 }; });
  const r = await iniciarPicking({ pedidoDocEntry: 10, usuarioId: "Ana" });
  assert.equal(r.creada, true);
  assert.deepEqual(creadas[0].lineas, [{ pedidoLineNum: 0, itemCode: "P1", cantidadPedida: 2, uomEntry: -1, uomCode: "Manual" }]);
});
