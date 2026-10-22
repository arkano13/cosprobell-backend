import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
const { construirLoteTrasladosPreparacion } = await import("../../puente/trasladosPreparacion.js");
const { proyectarTraslado, claveTrasladoPreparacion } = await import("../../src/modules/sincronizacion/trasladosPreparacion.repository.js");
const { comprobarPedidoElegible, lineasParaPreparar } = await import("../../src/modules/picking/picking.pedido.js");
const { configurar } = await import("../../puente/config.js");
const { entidadesHabilitadas } = await import("../../puente/entidades.js");

const lineaSap = (n, desde, hacia, extra = {}) => ({ LineNum: n, ItemCode: `P${n}`, Quantity: 6, FromWarehouseCode: desde,
  WarehouseCode: hacia, UoMEntry: -1, UoMCode: "Manual", InventoryQuantity: 6, ...extra });
const trasladoSap = () => ({ DocEntry: 4687, DocNum: 4687, DocDate: "2026-10-12", CardCode: "C10256", FromWarehouse: "02",
  ToWarehouse: "C64", StockTransferLines: [lineaSap(1, "02", "01"), lineaSap(0, "02", "C64"), lineaSap(2, "01", "C64"),
    lineaSap(3, "02", "C64", { UoMEntry: undefined, UoMCode: undefined, InventoryQuantity: undefined, Quantity: 2 })] });
const variables = { SAP_SERVICE_LAYER_URL: "https://sap.example/b1s/v1", BACKEND_URL: "https://backend.example",
  SAP_COMPANY_DB: "TEST", SAP_USER: "test", SAP_PASSWORD: "test", BRIDGE_API_KEY: "a".repeat(32), BRIDGE_STATE_DIR: ".bridge-state",
  BRIDGE_PICKING_SOURCE: "facturas", BRIDGE_PICKING_INVOICE_SINCE: "2026-10-12" };
const tx = (clientes = ["C10256"]) => ({
  bodega: { findMany: async () => [{ warehouseCode: "01" }, { warehouseCode: "02" }] },
  cliente: { findUnique: async ({ where }) => clientes.includes(where.cardCode) ? { cardCode: where.cardCode } : null },
});
function fuente(t, valor) {
  const previo = process.env.PREPARACION_FUENTE; process.env.PREPARACION_FUENTE = valor;
  t.after(() => { if (previo == null) delete process.env.PREPARACION_FUENTE; else process.env.PREPARACION_FUENTE = previo; });
}

test("puente: el traslado de SAP cumple el contrato, sin cliente vacío y sin líneas paginadas", () => {
  const lote = construirLoteTrasladosPreparacion([trasladoSap()], "TEST", 1);
  const [t] = lote.trasladosPreparacion;
  assert.equal(t.toWarehouse, "C64");
  assert.deepEqual(t.lineas.map(l => l.lineNum), [0, 1, 2, 3]);
  assert.equal(t.lineas[3].uomEntry, null);
  assert.equal(construirLoteTrasladosPreparacion([{ ...trasladoSap(), CardCode: "" }], "TEST", 1).trasladosPreparacion[0].cardCode, null);
  assert.throws(() => construirLoteTrasladosPreparacion([{ ...trasladoSap(), "StockTransferLines@odata.nextLink": "x" }], "TEST", 1),
    { code: "TRASLADO_SAP_INVALIDO" });
});

test("receptor: solo líneas que salen de la 02 a un almacén fuera de la bodega, con su propia clave", async () => {
  const [t] = construirLoteTrasladosPreparacion([trasladoSap()], "TEST", 1).trasladosPreparacion;
  const p = await proyectarTraslado(t, tx());
  assert.equal(p.docEntry, claveTrasladoPreparacion(4687));
  assert.ok(p.docEntry < -1_000_000_000);
  assert.equal(p.fuenteDocumento, "traslado"); assert.equal(p.sapDocEntry, 4687); assert.equal(p.almacenDestino, "C64");
  assert.equal(p.cardCode, "C10256");
  assert.deepEqual(p.lineas.map(l => l.lineNum), [0, 3]);
  assert.ok(p.lineas.every(l => l.warehouseCode === "02" && l.remainingOpenQuantity === l.quantity));
  // Sin unidad de medida en SAP: unidad de inventario (Manual).
  assert.deepEqual([p.lineas[1].uomEntry, p.lineas[1].inventoryQuantity, p.lineas[1].remainingOpenInventoryQuantity], [-1, 2, 2]);
  assert.equal((await proyectarTraslado(t, tx([]))).cardCode, null);
});

test("preparación: con facturas el traslado se prepara completo; con pedidos, no", async t => {
  const [sap] = construirLoteTrasladosPreparacion([trasladoSap()], "TEST", 1).trasladosPreparacion;
  const p = await proyectarTraslado(sap, tx());
  fuente(t, "facturas");
  comprobarPedidoElegible(p);
  assert.deepEqual(lineasParaPreparar(p).map(l => [l.itemCode, l.cantidadPedida]), [["P0", 6], ["P3", 2]]);
  process.env.PREPARACION_FUENTE = "pedidos";
  assert.throws(() => comprobarPedidoElegible(p), { code: "FUENTE_PREPARACION_INCORRECTA" });
});

test("puente: los traslados se activan aparte, solo con facturas, y heredan la frecuencia de las facturas", async () => {
  const nombres = c => entidadesHabilitadas(c).map(e => e.nombre);
  assert.ok(!nombres(configurar(variables)).includes("trasladosPreparacion"));
  const c = configurar({ ...variables, BRIDGE_PICKING_TRANSFERS: "true", BRIDGE_FREQUENCIES_JSON: '{"facturasPreparacion":240}' });
  assert.ok(nombres(c).includes("trasladosPreparacion"));
  assert.equal(c.frecuencias.trasladosPreparacion, 240);
  const e = entidadesHabilitadas(c).find(x => x.nombre === "trasladosPreparacion");
  assert.equal(e.filtro, "FromWarehouse eq '02'");
  // Los de la 01 a la 02 vienen con los mismos: misma frecuencia y ventana de días, otra entidad.
  assert.ok(!nombres(configurar(variables)).includes("trasladosEntrada"));
  const entrada = entidadesHabilitadas(c).find(x => x.nombre === "trasladosEntrada");
  assert.deepEqual([entrada.filtro, entrada.recurso, entrada.ventanaFacturas, c.frecuencias.trasladosEntrada], ["FromWarehouse eq '01'", "StockTransfers", true, 240]);
  const { construirLoteTrasladosEntrada } = await import("../../puente/trasladosPreparacion.js");
  assert.equal(construirLoteTrasladosEntrada([{ ...trasladoSap(), FromWarehouse: "01", ToWarehouse: "02" }], "TEST", 1).trasladosEntrada[0].fromWarehouse, "01");
  assert.throws(() => configurar({ ...variables, BRIDGE_PICKING_SOURCE: "pedidos", BRIDGE_PICKING_TRANSFERS: "true" }));
  assert.throws(() => configurar({ ...variables, BRIDGE_PICKING_TRANSFERS: "si" }));
});

test("puente: el recorrido de traslados usa la ventana de días y no revisa pendientes", async () => {
  const { sincronizar } = await import("../../puente/sincronizar.js");
  const config = { ...configurar({ ...variables, BRIDGE_PICKING_TRANSFERS: "true" }), soloCambios: false };
  const e = entidadesHabilitadas(config).find(x => x.nombre === "trasladosPreparacion");
  const enviados = [];
  const almacen = { estado: { secuencia: 0, cursor: null, ultimoCompleto: "2026-11-19T10:00:00Z" },
    async guardar(x) { this.estado = structuredClone(x); } };
  const backend = { estado: async () => enviados.length,
    pedidosAbiertos: async () => { throw new Error("no debe revisar pendientes"); },
    enviar: async (lote) => { enviados.push(lote); return { secuencia: lote.secuencia, recibidos: 1, repetido: false }; } };
  let filtro;
  const sap = { pagina: async (cursor, entidad) => { filtro = entidad.filtro; return cursor === null ? [trasladoSap()] : []; } };
  const r = await sincronizar({ config, almacen, sap, backend, entidad: e });
  assert.equal(r.completo, true);
  assert.match(filtro, /^FromWarehouse eq '02' and DocDate ge '20\d\d-\d\d-\d\d'$/);
  assert.equal(enviados[0].trasladosPreparacion[0].docEntry, 4687);
  assert.equal(almacen.estado.desdeRecorrido, null);
});
