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
const { inventarioRepository } = await import("../../src/modules/inventario/inventario.repository.js");
const { devolverPorAnulacion } = await import("../../src/modules/inventario/inventario.service.js");

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

test("documento de cancelación sin Cancelled no falla ni permite preparar", t => {
  fuenteFacturas(t);
  for (const Cancelled of [undefined, null]) {
    const f = construirLoteFacturasPreparacion([{ ...facturaSap(), DocEntry: 17065, Cancelled, CancelStatus: "csCancellation" }], "TEST", 1).facturasPreparacion[0];
    assert.equal(f.cancelStatus, "csCancellation");
    assert.throws(() => comprobarPedidoElegible(proyectarFactura(f)), e => e.code === "PEDIDO_CANCELADO");
  }
  assert.throws(() => construirLoteFacturasPreparacion([{ ...facturaSap(), Cancelled: undefined }], "TEST", 1), { code: "PEDIDO_SAP_INVALIDO" });
});

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
test("lista de materiales de venta (promo 2+1): se preparan sus productos y la línea de la promo no", () => {
  const f = facturaSap(); f.CreditosPreparacion = [];
  f.DocumentLines = [{ ...linea(0), ItemCode: "ER10492", TreeType: "iSalesTree" },
    { ...linea(1), ItemCode: "TINTE1", TreeType: "iIngredient", Quantity: 2, InventoryQuantity: 2 },
    { ...linea(2), ItemCode: "TINTE2", TreeType: "iIngredient", Quantity: 1, InventoryQuantity: 1 }];
  const p = proyectarFactura(construirLoteFacturasPreparacion([f], "TEST", 1).facturasPreparacion[0]);
  assert.deepEqual(lineasParaPreparar(p).map(l => [l.itemCode, l.cantidadPedida]), [["TINTE1", 2], ["TINTE2", 1]]);
  // Con un combo (Conjunto) en la misma factura, los componentes de la promo no lo bloquean.
  f.DocumentLines.push({ ...linea(3), ItemCode: "COMBO", TreeType: "iAssemblyTree", Quantity: 1, InventoryQuantity: 1 });
  const conCombo = proyectarFactura(construirLoteFacturasPreparacion([f], "TEST", 1).facturasPreparacion[0]);
  conCombo.combos = new Map([["COMBO", { cantidad: 1, lineas: [{ itemCode: "P9", cantidad: 3 }] }]]);
  assert.deepEqual(lineasParaPreparar(conCombo).map(l => [l.itemCode, l.cantidadPedida]), [["TINTE1", 2], ["TINTE2", 1], ["P9", 3]]);
});
test("artículos que no son de inventario: la promo se salta y un combo (tampoco de inventario) se prepara", () => {
  const f = facturaSap(); f.CreditosPreparacion = [];
  f.DocumentLines = [{ ...linea(0), ItemCode: "ER10492", Quantity: 1, InventoryQuantity: 1 },
    { ...linea(1), ItemCode: "TINTE1", Quantity: 2, InventoryQuantity: 2 },
    { ...linea(2), ItemCode: "ER10474", Quantity: 1, InventoryQuantity: 1 }];
  const p = proyectarFactura(construirLoteFacturasPreparacion([f], "TEST", 1).facturasPreparacion[0]);
  p.noInventario = new Set(["ER10492", "ER10474"]);
  p.combos = new Map([["ER10474", { cantidad: 1, lineas: [{ itemCode: "BS12", cantidad: 1 }, { itemCode: "BS16", cantidad: 1 }, { itemCode: "BS10", cantidad: 1 }] }]]);
  assert.deepEqual(lineasParaPreparar(p).map(l => [l.itemCode, l.cantidadPedida]), [["TINTE1", 2], ["BS12", 1], ["BS16", 1], ["BS10", 1]]);
});
test("recibir crédito nuevo exige revisión solo a sesiones activas y conserva las finalizadas", async () => {
  const f = construirLoteFacturasPreparacion([facturaSap()], "TEST", 1).facturasPreparacion[0];
  const anterior = proyectarFactura({ ...f, creditos: [] }); const cambios = []; const guardadas = [];
  const tx = { cliente: { findUnique: async () => ({ cardCode: "C1" }) }, $queryRaw: async () => [{ hay: false }], $executeRaw: async () => 1,
    listaMateriales: { findMany: async () => [] },
    producto: { findMany: async () => [] },
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
  assert.doesNotMatch(e.filtro, /DocumentStatus|DocDate/);
  assert.equal(e.revisarCierres, true); assert.equal(e.rutaRevision, "facturasPreparacion/pendientes");
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
  // Solo los documentos para preparar: productos y existencias siguen en la programación del puente.
  assert.deepEqual(s.entidades, ["facturasPreparacion"]);
});
test("listado de facturas incluye pagadas, filtra 02 y separa órdenes; cierre exige todas las unidades", async t => {
  fuenteFacturas(t);
  let sql, valores, consulta;
  sustituir(t, prisma, "$queryRaw", async (partes, ...v) => { sql = partes.join("?"); valores = v; return [{ docEntry: -10 }]; });
  sustituir(t, prisma.pedido, "findMany", async q => { consulta = q; return []; });
  await pedidosRepository.listar({ limit: 25, estado: "abiertos", almacenes: ["01", "02"] });
  // Facturas pagadas o no (sin documentStatus), solo líneas de la 02 con algo pendiente, y las ya preparadas solo 24 horas.
  assert.match(sql, /"fuenteDocumento" IN \('factura', 'traslado'\)/); assert.doesNotMatch(sql, /documentStatus/);
  assert.match(sql, /"warehouseCode" = '02'/); assert.match(sql, /"fechaFin" </); assert.ok(valores.includes(24));
  assert.deepEqual(consulta.where, { docEntry: { in: [-10] } });
  sustituir(t, prisma, "$transaction", async fn => fn({ $queryRaw: async () => [{ id: 1, estado: "en_proceso", fuenteDocumento: "factura" }] }));
  t.mock.method(pickingRepository, "buscarSesionConLineas", async () => ({ id: 1, lineas: [{ cantidadEscaneada: 1, cantidadPedida: 2 }] }));
  await assert.rejects(finalizarPicking(1), e => e.code === "FACTURA_PREPARACION_INCOMPLETA");
});

test("factura anulada después de prepararla: la mercadería vuelve a la pequeña, a sus lotes, una sola vez", async t => {
  const f = construirLoteFacturasPreparacion([{ ...facturaSap(), Cancelled: "tYES", CancelStatus: "csYes" }], "TEST", 1).facturasPreparacion[0];
  const anterior = proyectarFactura(construirLoteFacturasPreparacion([facturaSap()], "TEST", 1).facturasPreparacion[0]);
  const movimientos = [{ id: 1, tipo: "picking", bodega: "pequena", itemCode: "P0", cantidad: -2, lote: "L1", pequenaLoteId: 71, pickingId: 5 },
    { id: 2, tipo: "picking", bodega: "pequena", itemCode: "P0", cantidad: -1, lote: "L2", pequenaLoteId: 72, pickingId: 5 }];
  const hecho = { lotes: [], pequena: [], registrados: [] };
  t.mock.method(inventarioRepository, "movimientosDePicking", async () => movimientos);
  t.mock.method(inventarioRepository, "bloquearProductos", async () => {});
  t.mock.method(inventarioRepository, "cambiarLotePequena", async (id, item, delta) => { hecho.lotes.push([id, delta]); return { id }; });
  t.mock.method(inventarioRepository, "cambiarPequena", async (item, delta) => hecho.pequena.push(delta));
  t.mock.method(inventarioRepository, "registrarMovimientos", async (lista) => { hecho.registrados.push(...lista); movimientos.push(...lista); });
  const tx = { cliente: { findUnique: async () => ({ cardCode: "C1" }) }, $queryRaw: async () => [], $executeRaw: async () => 1,
    listaMateriales: { findMany: async () => [] },
    producto: { findMany: async () => [] },
    pedido: { findUnique: async () => anterior, upsert: async () => {} },
    pickingPedido: { updateMany: async () => {}, findMany: async (q) => (q.where.estado?.in ? [{ id: 5 }] : []) },
    pedidoLinea: { upsert: async () => {}, deleteMany: async () => {} } };
  await guardarFacturaPreparacion(f, tx);
  assert.deepEqual(hecho.lotes, [[71, 2], [72, 1]]);
  assert.deepEqual(hecho.pequena, [2, 1]);
  assert.deepEqual(hecho.registrados.map((m) => [m.tipo, m.itemCode, m.cantidad, m.lote, m.pickingId, m.observacion]),
    [["anulacion", "P0", 2, "L1", 5, "Devuelto por anulación de la factura 100"], ["anulacion", "P0", 1, "L2", 5, "Devuelto por anulación de la factura 100"]]);
  // La anulación vuelve a llegar (otro recorrido): no se devuelve dos veces.
  await guardarFacturaPreparacion(f, tx);
  assert.equal(hecho.registrados.length, 2);
  assert.deepEqual(await devolverPorAnulacion({ pickingId: 5, docNum: 100 }, tx), []);
});

