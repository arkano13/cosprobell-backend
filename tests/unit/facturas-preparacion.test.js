import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());
const { construirLoteFacturasPreparacion } = await import("../../puente/facturasPreparacion.js");
const { proyectarFactura, guardarFacturaPreparacion } = await import("../../src/modules/sincronizacion/facturasPreparacion.repository.js");
const { contenidoPreparacion } = await import("../../src/modules/sincronizacion/pedidos.repository.js");
const { comprobarPedidoElegible, lineasParaPreparar } = await import("../../src/modules/picking/picking.pedido.js");
const { configurar } = await import("../../puente/config.js");
const { entidadesHabilitadas } = await import("../../puente/entidades.js");
const { crearClienteSap } = await import("../../puente/sap.client.js");
const { consultaCreditosPreparacion } = await import("../../puente/facturasPreparacion.sql.js");
const { crearServicioSolicitudes } = await import("../../src/modules/sincronizacion/solicitudes.service.js");
const { pedidosRepository } = await import("../../src/modules/pedidos/pedidos.repository.js");
const { iniciarBodySchema } = await import("../../src/modules/picking/picking.schemas.js");
const { finalizarPicking } = await import("../../src/modules/picking/picking.service.js");
const { pickingRepository } = await import("../../src/modules/picking/picking.repository.js");

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
function fuenteFacturas(t) {
  const previo = process.env.PREPARACION_FUENTE; process.env.PREPARACION_FUENTE = "facturas";
  t.after(() => { if (previo == null) delete process.env.PREPARACION_FUENTE; else process.env.PREPARACION_FUENTE = previo; });
}
function sustituir(t, objeto, metodo, valor) {
  const previo = objeto[metodo]; objeto[metodo] = valor; t.after(() => { objeto[metodo] = previo; });
}

test("factura pagada: prepara el saldo de artículos de 02 tras el crédito, con identidad separada", t => {
  fuenteFacturas(t);
  const f = construirLoteFacturasPreparacion([facturaSap()], "TEST", 1).facturasPreparacion[0];
  const p = proyectarFactura(f);
  assert.equal(p.docEntry, -10); assert.equal(p.sapDocEntry, 9); assert.equal(p.fuenteDocumento, "factura");
  assert.equal(iniciarBodySchema.parse({ pedidoDocEntry: -10 }).pedidoDocEntry, -10);
  comprobarPedidoElegible(p);
  assert.deepEqual(lineasParaPreparar(p).map(l => [l.itemCode, l.cantidadPedida]), [["P0", 3]]);
  assert.equal(p.lineas[0].quantity, 5); assert.equal(p.lineas[0].cantidadCredito, 2);
  assert.throws(() => comprobarPedidoElegible({ ...p, cancelled: true }), e => e.code === "PEDIDO_CANCELADO");
  assert.throws(() => comprobarPedidoElegible({ ...p, fuenteDocumento: "pedido" }), e => e.code === "FUENTE_PREPARACION_INCORRECTA");
  const pagada = { ...p, documentStatus: "bost_Open", lineas: p.lineas.map(l => ({ ...l, lineStatus: "bost_Open" })) };
  assert.equal(contenidoPreparacion(p), contenidoPreparacion(pagada), "cobrar no cambia la preparación");
});
test("créditos inválidos, recetas parciales y reserva se rechazan sin descontar datos inventados", () => {
  for (const creditos of [undefined, [{ lineNum: 7, itemCode: "P0", quantity: 2, inventoryQuantity: 2 }],
    [{ lineNum: 0, itemCode: "OTRO", quantity: 2, inventoryQuantity: 2 }],
    [{ lineNum: 0, itemCode: "P0", quantity: 6, inventoryQuantity: 6 }]]) {
    assert.throws(() => construirLoteFacturasPreparacion([{ ...facturaSap(), CreditosPreparacion: creditos }], "TEST", 1));
  }
  assert.throws(() => construirLoteFacturasPreparacion([{ ...facturaSap(), ReserveInvoice: "tYES" }], "TEST", 1), e => e.code === "FACTURA_RESERVA_NO_ADMITIDA");
  const completo = facturaSap(); completo.CreditosPreparacion[0].quantity = completo.CreditosPreparacion[0].inventoryQuantity = 5;
  assert.throws(() => lineasParaPreparar(proyectarFactura(construirLoteFacturasPreparacion([completo], "TEST", 1).facturasPreparacion[0])), e => e.code === "PEDIDO_SIN_PENDIENTES");
});
test("combos en factura: el crédito descuenta combos antes de multiplicar componentes", () => {
  const f = facturaSap(); f.DocumentLines = [{ ...linea(), ItemCode: "PROMO", TreeType: "iAssemblyTree" }];
  f.CreditosPreparacion[0].itemCode = "PROMO";
  const p = proyectarFactura(construirLoteFacturasPreparacion([f], "TEST", 1).facturasPreparacion[0]);
  p.combos = new Map([["PROMO", { cantidad: 1, lineas: [{ itemCode: "P1", cantidad: 1 }, { itemCode: "P2", cantidad: 2 }] }]]);
  assert.deepEqual(lineasParaPreparar(p).map(l => [l.itemCode, l.cantidadPedida]), [["P1", 3], ["P2", 6]]);
});
test("recibir crédito nuevo exige revisión solo a sesiones activas y conserva las finalizadas", async () => {
  const f = construirLoteFacturasPreparacion([facturaSap()], "TEST", 1).facturasPreparacion[0];
  const anterior = proyectarFactura({ ...f, creditos: [] }); const cambios = []; const guardadas = [];
  const tx = { cliente: { findUnique: async () => ({ cardCode: "C1" }) }, $queryRaw: async () => [{ hay: false }],
    listaMateriales: { findMany: async () => [] },
    pedido: { findUnique: async () => anterior, upsert: async q => guardadas.push(q) },
    pickingPedido: { updateMany: async q => cambios.push(q), findMany: async () => [] },
    pedidoLinea: { upsert: async q => guardadas.push(q), deleteMany: async () => {} } };
  await guardarFacturaPreparacion(f, tx);
  assert.equal(cambios.length, 1); assert.deepEqual(cambios[0].where, { pedidoDocEntry: -10, estado: "en_proceso" });
  assert.equal(cambios[0].data.estado, "requiere_revision");
  assert.equal(guardadas[0].create.sapDocEntry, 9); assert.equal(guardadas[1].create.remainingOpenQuantity, 3);
});
test("SAP lee facturas de la fecha fija sin filtrar por pago y obtiene créditos hasta la última página", async () => {
  const config = configurar(variables); const entidades = entidadesHabilitadas(config);
  assert.equal(entidades.some(e => e.nombre === "pedidos"), false);
  const e = entidades.find(e => e.nombre === "facturasPreparacion");
  assert.match(e.filtro, /2026-10-12/); assert.doesNotMatch(e.filtro, /DocumentStatus/);
  assert.throws(() => configurar({ ...variables, BRIDGE_PICKING_INVOICE_SINCE: "2026-02-30" }));
  assert.equal(configurar({ ...variables, BRIDGE_FREQUENCIES_JSON: '{"pedidos":600}' }).frecuencias.facturasPreparacion, 600);
  let creditos = 0; const urls = [];
  const sap = crearClienteSap(config, async url => {
    urls.push(url);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=sesion" } });
    if (url.includes("/Invoices?")) return Response.json({ value: [facturaSap()] });
    if (url.includes("/List?")) {
      creditos++;
      return Response.json({ SqlText: consultaCreditosPreparacion.SqlText,
        value: creditos === 1 ? [{ lineNum: 0, itemCode: "P0", quantity: "2.000", inventoryQuantity: "2E0" }] : [],
        ...(creditos === 1 ? { "odata.nextLink": "ignorado" } : {}) });
    }
    return new Response(null, { status: 204 });
  });
  const filas = await sap.pagina(null, e); await sap.cerrar();
  assert.equal(creditos, 2); assert.ok(urls.some(u => u.endsWith("entry=9&after=0")));
  assert.equal(construirLoteFacturasPreparacion(filas, "TEST", 1).facturasPreparacion[0].creditos[0].quantity, 2);
});
test("botón manual pide facturas en lugar de pedidos cuando el puente anuncia esa capacidad", async () => {
  let d = {}; const servicio = crearServicioSolicitudes({ repo: { leer: async () => d, cambiar: async (_empresa, fn) => {
    const r = fn(d); d = r.siguiente; return r.resultado; } } });
  await servicio.consultar("TEST", { entidades: ["clientes", "productos", "facturasPreparacion", "existencias"] });
  const s = await servicio.solicitar("TEST", 1);
  assert.deepEqual(s.entidades, ["productos", "facturasPreparacion", "existencias"]);
});
test("listado de facturas incluye pagadas, filtra 02 y separa órdenes; cierre exige todas las unidades", async t => {
  fuenteFacturas(t);
  let consulta;
  sustituir(t, prisma.pedido, "findMany", async q => { consulta = q; return []; });
  await pedidosRepository.listar({ limit: 25, estado: "abiertos", almacenes: ["01", "02"] });
  assert.equal(consulta.where.fuenteDocumento, "factura"); assert.equal(consulta.where.documentStatus, undefined);
  assert.equal(consulta.where.lineas.some.warehouseCode, "02");
  sustituir(t, prisma, "$transaction", async fn => fn({ $queryRaw: async () => [{ id: 1, estado: "en_proceso", fuenteDocumento: "factura" }] }));
  t.mock.method(pickingRepository, "buscarSesionConLineas", async () => ({ id: 1, lineas: [{ cantidadEscaneada: 1, cantidadPedida: 2 }] }));
  await assert.rejects(finalizarPicking(1), e => e.code === "FACTURA_PREPARACION_INCOMPLETA");
});
