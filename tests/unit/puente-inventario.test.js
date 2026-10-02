import test from "node:test";
import assert from "node:assert/strict";
import { ALMACENES, EXISTENCIAS, entidadesHabilitadas } from "../../puente/entidades.js";
import { construirLoteAlmacenes } from "../../puente/almacenes.js";
import { construirLoteExistencias } from "../../puente/existencias.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { entidadPendiente } from "../../puente/control.js";
import { crearClienteSap } from "../../puente/sap.client.js";

const wh = (WarehouseCode = "01", InStock = 3) => ({ WarehouseCode, InStock, Committed: 0, Ordered: 0 });
const item = (lista = [wh()]) => ({ ItemCode: "P1", InventoryItem: "tYES", ItemWarehouseInfoCollection: lista });
test("almacenes: transforma código, nombre e inactividad; no modifica selección local", () => {
  assert.deepEqual(construirLoteAlmacenes([{ WarehouseCode: "01", WarehouseName: "Principal", Inactive: "tNO" }], "TEST", 1).almacenes,
    [{ warehouseCode: "01", warehouseName: "Principal", inactive: false }]);
  assert.throws(() => construirLoteAlmacenes([{ WarehouseCode: "01", WarehouseName: "Principal", Inactive: null }], "TEST", 1), { code: "ALMACEN_SAP_INVALIDO" });
});
test("existencias: conserva ceros iniciales, negativos y cantidades comprometidas; orden estable", () => {
  const filas = [wh("03", 0), wh("02", -2), { ...wh("01", 0), Committed: 2 }];
  const crear = f => construirLoteExistencias([item(f)], "TEST", 1).existencias;
  assert.deepEqual(crear(filas), [{ itemCode: "P1", almacenes: [
    { warehouseCode: "01", inStock: 0, committed: 2, ordered: 0 }, { warehouseCode: "02", inStock: -2, committed: 0, ordered: 0 },
  ] }]);
  assert.deepEqual(crear(filas), crear([...filas].reverse()));
});
test("almacén sin nombre conserva código e inactividad y deja advertencia", t => {
  const aviso = t.mock.method(console, "warn", () => {});
  assert.deepEqual(construirLoteAlmacenes([{ WarehouseCode: "24", WarehouseName: null, Inactive: "tYES" }], "TEST", 1).almacenes,
    [{ warehouseCode: "24", warehouseName: "Almacén 24", inactive: true }]);
  assert.equal(JSON.parse(aviso.mock.calls[0].arguments[0]).codigo, "ALMACEN_SIN_NOMBRE");
});

test("actualización de un recorrido antiguo reinicia desde el inicio conservando secuencia", async () => {
  const e = escenario(); e.almacen.estado.cursor = "P9";
  const consultados = [];
  await e.ejecutar({ pagina: async cursor => { consultados.push(cursor); return []; } });
  assert.deepEqual(consultados, [null]);
  assert.equal(e.almacen.estado.secuencia, 0);
});
test("existencias: artículo en cero envía lista vacía en lugar de desaparecer", () => {
  assert.deepEqual(construirLoteExistencias([item([wh("01", 0)])], "TEST", 1).existencias, [{ itemCode: "P1", almacenes: [] }]);
  assert.deepEqual(construirLoteExistencias([{ ...item(), InventoryItem: "tNO" }], "TEST", 1).existencias, [{ itemCode: "P1", almacenes: [] }]);
});
for (const [nombre, fila] of [
  ["colección ausente", { ...item(), ItemWarehouseInfoCollection: undefined }],
  ["stock ausente", item([{ WarehouseCode: "01", Committed: 0, Ordered: 0 }])],
  ["stock no numérico", item([wh("01", "3")])],
  ["almacenes duplicados", item([wh(), wh()])],
  ["colección parcial", { ...item(), "ItemWarehouseInfoCollection@odata.nextLink": "pagina2" }],
  ["tipo desconocido", { ...item(), InventoryItem: null }],
]) test(`existencias: ${nombre} falla sin interpretar ceros`, () => {
  assert.throws(() => construirLoteExistencias([fila], "TEST", 1), { code: "EXISTENCIA_SAP_INVALIDA" });
});
test("inventario se activa explícitamente y depende de catálogo y almacenes", () => {
  assert.equal(entidadesHabilitadas({}).length, 5);
  assert.equal(entidadesHabilitadas({ inventarioHabilitado: true }).length, 7);
  assert.deepEqual(EXISTENCIAS.dependencias, ["productos", "almacenes"]);
});

function escenario(entidad = EXISTENCIAS) {
  const pasos = [], huellas = {};
  let secuencia = 0;
  const almacen = { estado: { secuencia: 0, cursor: null, pendiente: null },
    guardar: async s => { almacen.estado = structuredClone(s); }, leerHuellas: async () => huellas,
    confirmarHuellas: async h => Object.assign(huellas, h) };
  const backend = { estado: async () => secuencia,
    recorrido: async (_e, accion, id) => { pasos.push([accion, id]); },
    enviar: async lote => { secuencia = lote.secuencia; pasos.push(["lote", structuredClone(lote)]); },
    observar: async claves => { pasos.push(["observados", claves]); } };
  const config = { empresa: "TEST", soloCambios: true };
  const ejecutar = sap => sincronizar({ config, almacen, backend, entidad, sap });
  return { pasos, almacen, backend, ejecutar };
}
test("recorrido: interrupción conserva identificador y no habilita comparación hasta EOF", async () => {
  const e = escenario(); let consultas = 0;
  await assert.rejects(e.ejecutar({ pagina: async () => {
    if (consultas++) throw Object.assign(new Error(), { code: "PRESUPUESTO_AGOTADO" }); return [item()];
  } }), { code: "PRESUPUESTO_AGOTADO" });
  const id = e.almacen.estado.recorridoId;
  assert.ok(id); assert.ok(!e.pasos.some(p => p[0] === "finalizar"));
  assert.equal(entidadPendiente(e.almacen.estado, "existencias", {}), true);
  assert.equal((await e.ejecutar({ pagina: async () => [] })).completo, true);
  assert.deepEqual(e.pasos.filter(p => p[0] === "iniciar").map(p => p[1]), [id, id]);
  assert.equal(e.pasos.at(-1)[0], "finalizar");
  assert.equal(e.almacen.estado.recorridoId, null);
});
test("recorrido sin cambios confirma presencia y fin sin reenviar existencias", async () => {
  const e = escenario(); const sap = { pagina: async cursor => cursor === null ? [item()] : [] };
  await e.ejecutar(sap); await e.ejecutar(sap);
  assert.equal(e.pasos.filter(p => p[0] === "lote").length, 1);
  assert.equal(e.pasos.filter(p => p[0] === "observados").length, 1);
  assert.equal(e.pasos.filter(p => p[0] === "finalizar").length, 2);
});
test("respuesta final perdida se recupera sin volver a consultar SAP", async () => {
  const e = escenario(); let fallar = true;
  e.backend.recorrido = async (_e, accion) => { if (accion === "finalizar" && fallar) { fallar = false; throw new Error("conexión perdida"); } };
  await assert.rejects(e.ejecutar({ pagina: async cursor => cursor === null ? [item()] : [] }), /conexión perdida/);
  assert.equal(e.almacen.estado.finalizando, true);
  await e.ejecutar({ pagina: async () => assert.fail("No debe consultar SAP") });
  assert.equal(e.almacen.estado.recorridoId, null);
});
test("recorrido vacío también confirma fin con secuencia cero", async () => {
  const e = escenario(ALMACENES);
  assert.equal((await e.ejecutar({ pagina: async () => [] })).ultimaSecuencia, 0);
  assert.deepEqual(e.pasos.map(p => p[0]), ["iniciar", "finalizar"]);
});
test("SAP: consulta mínima de existencias, cinco artículos por página y sin filtrar stock cero", async () => {
  const urls = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1", empresa: "TEST", usuario: "test", password: "test" }, async url => {
    urls.push(url);
    return url.endsWith("/Login") ? new Response("{}", { headers: { "Set-Cookie": "B1SESSION=test" } }) : Response.json({ value: [] });
  });
  await sap.pagina("P1", EXISTENCIAS);
  assert.ok(urls[1].includes("$select=ItemCode,InventoryItem,ItemWarehouseInfoCollection"));
  assert.ok(urls[1].includes("$top=5"));
  assert.ok(!urls[1].includes("InventoryItem%20eq"));
});
