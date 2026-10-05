import test from "node:test";
import assert from "node:assert/strict";
import { CONSULTA_EXISTENCIAS, convertirExistenciaSql, validarConsultaExistencias } from "../../puente/existencias.sql.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { entidadesHabilitadas } from "../../puente/entidades.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { configurar } from "../../puente/config.js";
import { construirLoteExistencias } from "../../puente/existencias.js";
import { entidadPendiente } from "../../puente/control.js";
import { DatabaseSync } from "node:sqlite";

const entidad = entidadesHabilitadas({ inventarioHabilitado: true, modoExistencias: "sql-01-02" }).find(e => e.nombre === "existencias");
const config = { sapUrl: "https://sap.test/b1s/v1", empresa: "TEST", usuario: "test", password: "test" };
const fila = (codigo = "P1", saldo = 7) => ({ ItemCode: codigo, InvntItem: "Y", Warehouse1: "01", InStock1: saldo,
  Committed1: 0, Ordered1: 0, Warehouse2: "02", InStock2: 0, Committed2: 0, Ordered2: 0 });
const datos = filas => ({ SqlText: CONSULTA_EXISTENCIAS.SqlText, value: filas });
function cliente(responder) {
  const llamadas = [];
  const sap = crearClienteSap(config, async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=test" } });
    const almacen = /Warehouses\('(01|02)'\)/.exec(url);
    if (almacen) return Response.json({ WarehouseCode: almacen[1] });
    return responder(url, opciones);
  });
  return { sap, llamadas };
}
test("SQL de existencias restringe ambos JOIN en SAP y conserva artículos en cero", () => {
  assert.match(CONSULTA_EXISTENCIAS.SqlText, /A\.\[WhsCode\] = '01'/);
  assert.match(CONSULTA_EXISTENCIAS.SqlText, /B\.\[WhsCode\] = '02'/);
  assert.match(CONSULTA_EXISTENCIAS.SqlText, /WHERE I\.\[ItemCode\] > :after/);
  assert.doesNotMatch(CONSULTA_EXISTENCIAS.SqlText, /OnHand\]\s*>|UPDATE|DELETE|INSERT/i);
  const convertir = f => construirLoteExistencias([convertirExistenciaSql(f)], "TEST", 1).existencias[0];
  assert.equal(convertir(fila()).almacenes[0].inStock, 7);
  assert.deepEqual(convertir(fila("P1", 0)).almacenes, []);
  assert.deepEqual(convertir({ ...fila(), InvntItem: "N" }).almacenes, []);
});
test("SQL distingue un LEFT JOIN ausente de datos incompletos", () => {
  const f = { ...fila(), Warehouse2: null, InStock2: null, Committed2: null, Ordered2: null };
  assert.equal(convertirExistenciaSql(f).ItemWarehouseInfoCollection.length, 1);
  for (const cambio of [{ Warehouse1: "03" }, { InStock1: null }, { InStock1: "7" }, { Committed1: undefined },
    { Warehouse2: null }, { InvntItem: null }]) {
    assert.throws(() => convertirExistenciaSql({ ...fila(), ...cambio }), { code: "EXISTENCIA_SAP_INVALIDA" });
  }
});
test("SQL rechaza definición ajena y permite la normalización de SAP", () => {
  validarConsultaExistencias(CONSULTA_EXISTENCIAS.SqlText.replaceAll("[", "").replaceAll("]", ""));
  assert.throws(() => validarConsultaExistencias(CONSULTA_EXISTENCIAS.SqlText.replace("'02'", "'03'")), { code: "CONSULTA_EXISTENCIAS_INCOMPATIBLE" });
  assert.throws(() => validarConsultaExistencias(CONSULTA_EXISTENCIAS.SqlText.replace("'02'", "'0 2'")), { code: "CONSULTA_EXISTENCIAS_INCOMPATIBLE" });
});
test("SQL pagina por clave escapada, limita veinte filas y no sigue enlaces externos", async () => {
  const { sap, llamadas } = cliente(async () => Response.json({ ...datos([fila("P2")]), "odata.nextLink": "https://ajeno.test" }));
  await sap.pagina("P'1&x=1", entidad);
  const peticion = llamadas.at(-1);
  assert.equal(new URL(peticion.url).searchParams.get("after"), "'P''1&x=1'");
  assert.equal(peticion.opciones.headers.Prefer, "odata.maxpagesize=20");
  assert.equal(llamadas.length, 4); // login, dos almacenes, página
  assert.ok(llamadas.every(l => l.url.startsWith(config.sapUrl)));
  assert.ok(!llamadas.some(l => l.url.includes("/Items?")));
});
test("SQL valida cero filas, paginación parcial y duplicados sin dar por completo un error", async () => {
  for (const respuesta of [datos([fila(), fila()]), { ...datos([]), "odata.nextLink": "siguiente" }, datos(Array.from({length:21}, (_,i) => fila(`P${i}`)))]) {
    const { sap } = cliente(async () => Response.json(respuesta));
    await assert.rejects(sap.pagina(null, entidad));
  }
  const { sap } = cliente(async () => Response.json(datos([])));
  assert.deepEqual(await sap.pagina(null, entidad), []);
});
test("SQL no vuelve a la consulta masiva si faltan permisos", async () => {
  const { sap, llamadas } = cliente(async () => new Response("{}", { status: 403 }));
  await assert.rejects(sap.pagina(null, entidad), { code: "HTTP_403" });
  assert.ok(!llamadas.some(l => l.url.includes("/Items?")));
});
test("preparación comprueba sin escribir y registro solo crea definición ausente", async () => {
  const { sap, llamadas } = cliente(async () => new Response("{}", { status: 404 }));
  await assert.rejects(sap.prepararConsultaExistencias(), { code: "HTTP_404" });
  assert.ok(!llamadas.some(l => l.url.endsWith("/SQLQueries") && l.opciones.method === "POST"));
  let creada = false;
  const c = cliente(async (_url, opciones) => {
    if (opciones.method === "POST") { assert.deepEqual(JSON.parse(opciones.body), CONSULTA_EXISTENCIAS); creada = true; return Response.json({}, { status: 201 }); }
    return creada ? Response.json(CONSULTA_EXISTENCIAS) : new Response("{}", { status: 404 });
  });
  assert.equal(await c.sap.prepararConsultaExistencias(true), "creada");
  assert.equal(await c.sap.prepararConsultaExistencias(true), "existente");
  assert.equal(c.llamadas.filter(l => l.url.endsWith("/SQLQueries") && l.opciones.method === "POST").length, 1);
});
test("cambio de fuente reinicia cursor sin perder secuencia y elimina almacenes ajenos en el lote", async () => {
  const recibidos = [], cursores = [];
  const almacen = { estado: { secuencia: 7, cursor: "Z9", pendiente: null, recorridoId: "recorrido-previo" },
    guardar: async s => { almacen.estado = s; }, leerHuellas: async () => ({}), confirmarHuellas: async () => {} };
  const resultado = await sincronizar({ config: { empresa: "TEST", soloCambios: true }, almacen, entidad,
    sap: { pagina: async cursor => { cursores.push(cursor); return cursor === null ? [convertirExistenciaSql(fila())] : []; } },
    backend: { estado: async () => 7, recorrido: async () => {}, enviar: async l => recibidos.push(l) } });
  assert.equal(cursores[0], null);
  assert.equal(resultado.ultimaSecuencia, 8);
  assert.equal(almacen.estado.fuenteExistencias, "sql-01-02-v1");
  assert.deepEqual(recibidos[0].existencias[0].almacenes.map(w => w.warehouseCode), ["01"]);
});
test("cambio de fuente con lote sin confirmar se rechaza sin tocar estado", async () => {
  const almacen = { estado: { secuencia: 7, cursor: "P1", pendiente: { lote: { secuencia: 8 } } }, guardar: async () => assert.fail() };
  await assert.rejects(sincronizar({ config: {}, almacen, entidad, sap: {}, backend: { estado: async () => 7 } }), { code: "CAMBIO_FUENTE_CON_PENDIENTE" });
});
test("modo SQL es explícito y no acepta errores de escritura", () => {
  const v = { SAP_SERVICE_LAYER_URL: config.sapUrl, SAP_COMPANY_DB: "TEST", SAP_USER: "test", SAP_PASSWORD: "test",
    BACKEND_URL: "https://backend.test", BRIDGE_API_KEY: "x".repeat(40), BRIDGE_STATE_DIR: ".bridge-state" };
  assert.equal(configurar(v).modoExistencias, "items");
  assert.equal(configurar({ ...v, BRIDGE_STOCK_MODE: "sql-01-02" }).modoExistencias, "sql-01-02");
  assert.throws(() => configurar({ ...v, BRIDGE_STOCK_MODE: "SQL" }));
});
test("cambio de modo se atiende aunque el recorrido anterior sea reciente", () => {
  const estado = { cursor: null, ultimoCompleto: new Date().toISOString() };
  assert.equal(entidadPendiente(estado, "existencias", { modoExistencias: "sql-01-02" }), true);
  assert.equal(entidadPendiente({ ...estado, fuenteExistencias: "sql-01-02-v1" }, "existencias", { modoExistencias: "sql-01-02" }), false);
});
test("JOIN de la consulta conserva ceros y ausencia sin traer saldos de otros almacenes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE OITM(ItemCode TEXT PRIMARY KEY,InvntItem TEXT);
      CREATE TABLE OITW(ItemCode TEXT,WhsCode TEXT,OnHand REAL,IsCommited REAL,OnOrder REAL,PRIMARY KEY(ItemCode,WhsCode));
      INSERT INTO OITM VALUES ('A','Y'),('B','Y'),('C','N');
      INSERT INTO OITW VALUES ('A','01',4,1,0),('A','02',0,0,0),('A','03',999,0,0),('B','03',888,0,0);`);
    // SQLite local comprueba los JOIN y el cursor; no sustituye el sondeo de SQLQueries en SAP.
    const stmt = db.prepare(CONSULTA_EXISTENCIAS.SqlText.replace('TOP 20 ', '') + ' LIMIT 20');
    const filas = stmt.all({ after: '' });
    assert.equal(filas.length, 3);
    const lote = construirLoteExistencias(filas.map(convertirExistenciaSql), 'TEST', 1);
    assert.deepEqual(lote.existencias[0].almacenes, [{warehouseCode:'01',inStock:4,committed:1,ordered:0}]);
    assert.deepEqual(lote.existencias.slice(1).map(f=>f.almacenes), [[],[]]);
    assert.deepEqual(stmt.all({after:'A'}).map(f=>f.ItemCode), ['B','C']);
    db.exec("UPDATE OITW SET OnHand=0,IsCommited=0 WHERE ItemCode='A' AND WhsCode='01'");
    assert.deepEqual(construirLoteExistencias(stmt.all({after:''}).map(convertirExistenciaSql),'TEST',2).existencias[0].almacenes, []);
  } finally { db.close(); }
});
