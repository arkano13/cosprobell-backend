import test from "node:test";
import assert from "node:assert/strict";
import { crearControl, entidadPendiente, ordenarEntidades } from "../../puente/control.js";
import { separarCambios } from "../../puente/huellas.js";
import { PRODUCTOS, CODIGOS_BARRAS } from "../../puente/entidades.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { abrirAlmacen } from "../../puente/estado.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("presupuesto limita peticiones y espacia su inicio", async () => {
  let reloj = 0; const pausas = [];
  const control = crearControl({ maxConsultas: 2, maxDuracionMs: 1000, pausaMs: 100 }, {
    ahora: () => reloj, dormir: async ms => { pausas.push(ms); reloj += ms; },
  });
  await control.antesDeConsultar(); await control.antesDeConsultar();
  await assert.rejects(control.antesDeConsultar(), { code: "PRESUPUESTO_AGOTADO" });
  assert.deepEqual(pausas, [100]); assert.equal(control.resumen().consultasSap, 2);
});
test("presupuesto comprueba duración después de esperar", async () => {
  let reloj = 0;
  const control = crearControl({ maxConsultas: 10, maxDuracionMs: 50, pausaMs: 100 }, {
    ahora: () => reloj, dormir: async ms => { reloj += ms; },
  });
  await control.antesDeConsultar();
  await assert.rejects(control.antesDeConsultar(), { code: "PRESUPUESTO_AGOTADO" });
});
test("frecuencias son independientes y sin configuración no repite la carga", () => {
  const estado = { cursor: null, pendiente: null, ultimoCompleto: new Date(0).toISOString() };
  assert.equal(entidadPendiente(estado, "productos", {}, 99999999), false);
  const config = { frecuencias: { productos: 3600, pedidos: 60 } };
  assert.equal(entidadPendiente(estado, "productos", config, 120000), false);
  assert.equal(entidadPendiente(estado, "pedidos", config, 120000), true);
  assert.equal(entidadPendiente({ ...estado, cursor: "P2" }, "productos", config, 120000), true);
  assert.equal(entidadPendiente(estado, "productos", { forzar: true }, 1), true);
});
test("huellas distinguen contenido y admiten claves especiales sin tocar prototipos", () => {
  const fila = { itemCode: "__proto__", itemName: "A" };
  const primera = separarCambios([fila], PRODUCTOS);
  assert.deepEqual(separarCambios([fila], PRODUCTOS, primera.huellas).observados, ["__proto__"]);
  assert.equal(separarCambios([{ ...fila, itemName: "B" }], PRODUCTOS, primera.huellas).cambios.length, 1);
});

async function escenario(t, entidad = PRODUCTOS) {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-cambios-"));
  t.after(() => rm(directorio, { force: true, recursive: true }));
  const config = { directorio, empresa: "TEST", origen: "prueba", soloCambios: true };
  let secuencia = 0;
  const lotes = [], observados = [], retirados = [];
  const backend = { estado: async () => secuencia,
    hora: async () => "2026-09-29T12:00:00.000Z",
    enviar: async lote => { secuencia = lote.secuencia; lotes.push(structuredClone(lote)); },
    observar: async claves => { observados.push(claves); },
    marcarRetirados: async fecha => { retirados.push(fecha); },
  };
  const abrir = () => abrirAlmacen(config, entidad);
  return { config, backend, abrir, lotes, observados, retirados };
}
const producto = (codigo, nombre = "Nombre") => ({ ItemCode: codigo, ItemName: nombre, BarCode: null, Valid: "tYES", Frozen: "tNO" });

test("entidades pendientes se turnan para no acaparar el presupuesto", () => {
  const entidades = [{ nombre: "grande" }, { nombre: "nuevo" }, { nombre: "antiguo" }];
  const almacenes = [{ estado: { ultimaAtencion: "2026-09-29T12:00:00Z" } }, { estado: {} },
    { estado: { ultimaAtencion: "2026-09-28T12:00:00Z" } }];
  assert.deepEqual(ordenarEntidades(entidades, almacenes).map(e => e.i), [1, 2, 0]);
});

test("agotar presupuesto conserva avance sin retirar barras ausentes", async t => {
  const f = await escenario(t, CODIGOS_BARRAS);
  const sap = { pagina: async cursor => {
    if (cursor !== null) throw Object.assign(new Error("pausa"), { code: "PRESUPUESTO_AGOTADO" });
    return [{ AbsEntry: 1, ItemNo: "A", Barcode: "001", UoMEntry: 1 }];
  } };
  await assert.rejects(sincronizar({ ...f, entidad: CODIGOS_BARRAS, almacen: await f.abrir(), sap }), { code: "PRESUPUESTO_AGOTADO" });
  assert.equal((await f.abrir()).estado.cursor, 1);
  assert.deepEqual(f.retirados, []);
});

test("segunda pasada sin cambios no reenvía contenido ni aumenta la secuencia", async t => {
  const f = await escenario(t);
  const sap = { pagina: async cursor => cursor === null ? [producto("A"), producto("B")] : [] };
  for (let i = 0; i < 2; i++) await sincronizar({ ...f, almacen: await f.abrir(), sap });
  assert.equal(f.lotes.length, 1); assert.deepEqual(f.observados, [["A", "B"]]);
  assert.equal((await f.abrir()).estado.secuencia, 1);
});
test("página mixta persiste cursor completo y recupera una respuesta perdida", async t => {
  const f = await escenario(t); let nombre = "Viejo";
  const sap = { pagina: async cursor => cursor === null ? [producto("A", nombre), producto("B")] : [] };
  await sincronizar({ ...f, almacen: await f.abrir(), sap }); nombre = "Nuevo";
  const enviar = f.backend.enviar; let perder = true;
  f.backend.enviar = async lote => { await enviar(lote); if (perder) { perder = false; throw new Error("corte"); } };
  await assert.rejects(sincronizar({ ...f, almacen: await f.abrir(), sap }), /corte/);
  const estado = (await f.abrir()).estado;
  assert.equal(estado.pendiente.cursor, "B"); assert.equal(estado.pendiente.lote.productos.length, 1);
  await sincronizar({ ...f, almacen: await f.abrir(), sap });
  assert.deepEqual(f.lotes[1], f.lotes[2]); assert.deepEqual(f.observados.at(-1), ["B"]);
  assert.equal((await f.abrir()).estado.secuencia, 2);
});
test("fallo de observación no adelanta cursor ni confirma huellas", async t => {
  const f = await escenario(t);
  const sap = { pagina: async cursor => cursor === null ? [producto("A")] : [] };
  await sincronizar({ ...f, almacen: await f.abrir(), sap });
  f.backend.observar = async () => { throw new Error("corte"); };
  await assert.rejects(sincronizar({ ...f, almacen: await f.abrir(), sap }), /corte/);
  assert.equal((await f.abrir()).estado.cursor, null);
});
test("barras sin cambios se observan antes de retirar ausentes", async t => {
  const f = await escenario(t, CODIGOS_BARRAS);
  const sap = { pagina: async cursor => cursor === null ? [{ AbsEntry: 1, ItemNo: "A", Barcode: "001", UoMEntry: 1 }] : [] };
  for (let i = 0; i < 2; i++) await sincronizar({ ...f, entidad: CODIGOS_BARRAS, almacen: await f.abrir(), sap });
  assert.equal(f.lotes.length, 1); assert.deepEqual(f.observados, [[1]]); assert.equal(f.retirados.length, 2);
});
test("reconciliar reenvía contenido aunque la huella coincida", async t => {
  const f = await escenario(t);
  const sap = { pagina: async cursor => cursor === null ? [producto("A")] : [] };
  await sincronizar({ ...f, almacen: await f.abrir(), sap }); f.config.reconciliar = true;
  await sincronizar({ ...f, almacen: await f.abrir(), sap }); assert.equal(f.lotes.length, 2);
});
