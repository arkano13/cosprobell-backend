import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
const { configurar } = await import("../../puente/config.js");
const { entidadesHabilitadas } = await import("../../puente/entidades.js");
const { desdeFacturas, sincronizar } = await import("../../puente/sincronizar.js");

// Puente con facturas: ventana de días después de la primera carga y revisión de las pendientes.
const linea = (n = 0, almacen = "02") => ({ LineNum: n, ItemCode: `P${n}`, Quantity: 5, LineStatus: "bost_Close",
  WarehouseCode: almacen, UoMEntry: -1, UoMCode: "Manual", RemainingOpenQuantity: 0,
  InventoryQuantity: 5, RemainingOpenInventoryQuantity: 0 });
const facturaSap = () => ({ DocEntry: 9, DocNum: 100, DocType: "dDocument_Items", CardCode: "C1", DocDate: "2026-10-12",
  DocDueDate: "2026-10-12", DocTotal: 50, DocumentStatus: "bost_Close", Cancelled: "tNO", CancelStatus: "csNo",
  ReserveInvoice: "tNO", DocumentLines: [linea(), linea(1, "01")],
  CreditosPreparacion: [{ lineNum: 0, itemCode: "P0", quantity: 2, inventoryQuantity: 2 }] });
const variables = { SAP_SERVICE_LAYER_URL: "https://sap.example/b1s/v1", BACKEND_URL: "https://backend.example",
  SAP_COMPANY_DB: "TEST", SAP_USER: "test", SAP_PASSWORD: "test", BRIDGE_API_KEY: "a".repeat(32), BRIDGE_STATE_DIR: ".bridge-state",
  BRIDGE_PICKING_SOURCE: "facturas", BRIDGE_PICKING_INVOICE_SINCE: "2026-10-12" };

test("puente: primera carga desde la fecha de inicio; después solo los últimos días, sin ir antes del inicio", () => {
  const config = configurar({ ...variables, BRIDGE_PICKING_INVOICE_DAYS: "2" });
  assert.equal(config.facturasDias, 2);
  assert.equal(configurar(variables).facturasDias, 2);
  assert.throws(() => configurar({ ...variables, BRIDGE_PICKING_INVOICE_DAYS: "0" }));
  const hoy = new Date(2026, 10, 20, 9, 30);
  assert.equal(desdeFacturas(config, {}, hoy), "2026-10-12", "primera carga: todas");
  assert.equal(desdeFacturas(config, { ultimoCompleto: "2026-11-19T10:00:00Z" }, hoy), "2026-11-19", "hoy y ayer");
  assert.equal(desdeFacturas(config, { ultimoCompleto: "2026-10-13T10:00:00Z" }, new Date(2026, 9, 13)), "2026-10-12");
});

test("puente: el recorrido pide a SAP las facturas desde su fecha y al final revisa las pendientes que no vio", async () => {
  const config = { ...configurar(variables), soloCambios: false };
  const e = entidadesHabilitadas(config).find(x => x.nombre === "facturasPreparacion");
  const pedidas = [], revisadas = [], enviados = [];
  const almacen = { estado: { secuencia: 0, cursor: null, ultimoCompleto: "2026-11-19T10:00:00Z" },
    async guardar(x) { this.estado = structuredClone(x); } };
  const backend = { estado: async () => enviados.length, hora: async () => "2026-11-20T15:00:00.000Z",
    pedidosAbiertos: async (ruta) => { pedidas.push(ruta);
      return { pedidos: [{ docEntry: 4, sincronizadoEn: "2026-11-10T00:00:00.000Z" }, { docEntry: 9, sincronizadoEn: "2026-11-20T15:01:00.000Z" }] }; },
    enviar: async (lote) => { enviados.push(lote); return { secuencia: lote.secuencia, recibidos: lote.facturasPreparacion.length, repetido: false }; } };
  let filtro;
  const sap = { pagina: async (cursor, entidad) => { filtro = entidad.filtro; return cursor === null ? [facturaSap()] : []; },
    documento: async (clave) => { revisadas.push(clave); return { ...facturaSap(), DocEntry: clave, Cancelled: "tYES", CancelStatus: "csYes" }; } };
  const r = await sincronizar({ config, almacen, sap, backend, entidad: e });
  assert.equal(r.completo, true);
  assert.match(filtro, /DocDate ge '20\d\d-\d\d-\d\d'/);
  assert.deepEqual(pedidas, ["facturasPreparacion/pendientes"]);
  assert.deepEqual(revisadas, [4], "solo la pendiente que no se vio en el recorrido");
  assert.equal(enviados.at(-1).facturasPreparacion[0].cancelled, true);
  assert.equal(almacen.estado.desdeRecorrido, null);
});
